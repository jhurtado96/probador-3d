// Despacho de jobs al worker GPU (Modal, región UE) con un JobDispatch.
// El worker no recibe credenciales: solo URLs firmadas de vida corta.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTRACTS_VERSION,
  type DrapeJobContext,
  type DrapeJobInput,
  type GarmentJobInput,
  type JobDispatch,
  type JobType,
  type SignedUpload,
  validate,
} from "./contracts.ts";
import { env } from "./env.ts";
import { signedHeaders } from "./hmac.ts";
import { ASSETS_BUCKET, publicUrl, splitPath } from "./storage.ts";

/** Vida de las URLs firmadas de descarga que recibe el worker (docs/architecture.md §3.2). */
const INPUT_URL_TTL_SECONDS = 15 * 60;

/** Fila que devuelve public.claim_jobs_for_dispatch. */
export interface ClaimedJob {
  id: string;
  user_id: string | null;
  type: JobType;
  input: Record<string, unknown>;
  attempt: number;
  input_paths: string[];
  cache_key: string | null;
}

type PlannedOutput = Pick<SignedUpload, "name" | "path" | "content_type">;

/**
 * Artefactos que cada tipo de job sube, con su ruta en el bucket assets. La
 * ruta es única por job e intento y solo admite una subida (sin sobrescribir).
 */
export function planOutputs(job: ClaimedJob): PlannedOutput[] {
  const owner = job.user_id ?? "catalog";
  const stem = `${job.id}-a${job.attempt}`;
  const glb = "model/gltf-binary";
  switch (job.type) {
    case "avatar":
      return [{ name: "glb", path: `${ASSETS_BUCKET}/${owner}/avatars/${stem}.glb`, content_type: glb }];
    case "garment": {
      const dir = `${ASSETS_BUCKET}/${owner}/garments/${(job.input as unknown as GarmentJobInput).garment_id}`;
      return [
        { name: "glb", path: `${dir}/${stem}.glb`, content_type: glb },
        { name: "image", path: `${dir}/${stem}-cutout.png`, content_type: "image/png" },
        { name: "sewing_pattern", path: `${dir}/${stem}-pattern.json`, content_type: "application/json" },
      ];
    }
    case "drape":
      return [{ name: "glb", path: `${ASSETS_BUCKET}/${owner}/drapes/${stem}.glb`, content_type: glb }];
    case "color":
      return [];
  }
}

/**
 * Lo que el simulador necesita y la app no envía (DrapeJobInput solo trae
 * ids): cuerpo, prenda y clave de caché. Las rutas que devuelve se firman y
 * van en `input_urls`.
 */
async function drapeContext(
  admin: SupabaseClient,
  job: ClaimedJob,
): Promise<{ context: DrapeJobContext; paths: string[] }> {
  const input = job.input as unknown as DrapeJobInput;
  const [{ data: avatar, error: e1 }, { data: garment, error: e2 }, { data: sizes, error: e3 }] = await Promise.all([
    admin.from("avatars")
      .select(
        "glb_path, body_model, model_version, shape_hash, measurements, measurements_override, measurements_sigma_cm",
      )
      .eq("id", input.avatar_id).maybeSingle(),
    admin.from("garments")
      .select("glb_path, sewing_pattern_path, sewing_pattern_format, level, category, design_fit, attributes")
      .eq("id", input.garment_id).maybeSingle(),
    admin.from("garment_measurements").select("size_label, zones, source")
      .eq("garment_id", input.garment_id).eq("size_label", input.size_label).maybeSingle(),
  ]);
  if (e1 || e2 || e3) throw new Error(`drape context: ${(e1 ?? e2 ?? e3)?.message}`);
  if (!avatar || !garment) throw new Error("drape context: avatar or garment no longer exists");
  if (!job.cache_key) throw new Error("drape context: job has no cache_key");
  if (!garment.category || !garment.design_fit || !(garment.sewing_pattern_path || garment.glb_path)) {
    throw new Error("drape context: garment is not ready");
  }
  const context: DrapeJobContext = {
    cache_key: job.cache_key,
    simulator_version: env.drapeSimulatorVersion(),
    avatar: {
      glb_path: avatar.glb_path,
      body_model: avatar.body_model,
      model_version: avatar.model_version,
      shape_hash: avatar.shape_hash,
      // Las correcciones del usuario prevalecen sobre lo estimado.
      measurements: { ...avatar.measurements, ...(avatar.measurements_override ?? {}) },
      ...(avatar.measurements_sigma_cm ? { measurements_sigma_cm: avatar.measurements_sigma_cm } : {}),
    },
    garment: {
      sewing_pattern_path: garment.sewing_pattern_path,
      sewing_pattern_format: garment.sewing_pattern_format,
      glb_path: garment.glb_path,
      level: garment.level,
      category: garment.category,
      design_fit: garment.design_fit,
      attributes: garment.attributes ?? {},
      measurements: sizes ?? null,
    },
  };
  const paths = [avatar.glb_path, garment.sewing_pattern_path, garment.glb_path]
    .filter((p): p is string => typeof p === "string");
  return { context, paths };
}

export type DispatchOutcome = { job_id: string; ok: true } | { job_id: string; ok: false; error: string };

async function dispatchClaimed(admin: SupabaseClient, job: ClaimedJob): Promise<DispatchOutcome> {
  const workerUrl = env.workerDispatchUrl();
  const release = async (error: string): Promise<DispatchOutcome> => {
    await admin.rpc("release_job_dispatch", { p_job_id: job.id, p_attempt: job.attempt, p_error: error });
    console.warn("dispatch failed", { job_id: job.id, attempt: job.attempt, error });
    return { job_id: job.id, ok: false, error };
  };
  if (!workerUrl) return await release("WORKER_DISPATCH_URL is not configured");
  // Nunca se despacha sin firmar: el worker rechazaría la petición.
  const secret = env.dispatchSecret();
  if (!secret) return await release("PROBADOR_DISPATCH_SECRET is not configured");

  try {
    // URLs de subida de los artefactos de salida.
    const outputs = planOutputs(job);
    const output_uploads: SignedUpload[] = [];
    for (const o of outputs) {
      const { bucket, name } = splitPath(o.path);
      // Sin upsert: una sola subida por ruta. La URL caduca a las 2 h (límite fijo de Supabase).
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(name);
      if (error || !data) throw new Error(`signed upload url: ${error?.message}`);
      output_uploads.push({ ...o, upload_url: publicUrl(data.signedUrl) });
    }

    // Rutas de entrada: las fotos de raw-uploads y, en el drapeado, las del contexto.
    const drape = job.type === "drape" ? await drapeContext(admin, job) : null;

    // URLs de descarga de las entradas, indexadas por ruta.
    const input_urls: Record<string, string> = {};
    for (const path of [...job.input_paths, ...(drape?.paths ?? [])]) {
      const { bucket, name } = splitPath(path);
      const { data, error } = await admin.storage.from(bucket).createSignedUrl(name, INPUT_URL_TTL_SECONDS);
      if (error || !data) throw new Error(`signed download url: ${error?.message}`);
      input_urls[path] = publicUrl(data.signedUrl);
    }

    // Autorizar estas rutas de salida ANTES de que el worker pueda llamar de vuelta.
    const { error: pathsError } = await admin.rpc("set_job_output_paths", {
      p_job_id: job.id,
      p_attempt: job.attempt,
      p_output_paths: outputs.map((o) => o.path),
    });
    if (pathsError) throw new Error(`set_job_output_paths: ${pathsError.message}`);

    // `input` viene de la base de datos (ya validado al crear el job); la unión
    // discriminada se comprueba en ejecución contra el JSON Schema.
    const dispatch = {
      job_id: job.id,
      user_id: job.user_id,
      type: job.type,
      input: job.input,
      ...(drape ? { context: drape.context } : {}),
      input_urls,
      output_uploads,
      callback_url: env.jobCallbackUrl(),
      attempt: job.attempt,
      contracts_version: CONTRACTS_VERSION,
    } as unknown as JobDispatch;
    const check = validate.jobDispatch(dispatch);
    if (!check.ok) throw new Error(`JobDispatch does not match contract: ${JSON.stringify(check.errors)}`);

    // Misma firma que el callback: timestamp + HMAC del cuerpo exacto que se envía.
    const body = JSON.stringify(dispatch);
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await signedHeaders(secret, body)) },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    if (!res.ok) return await release(`worker responded ${res.status}`);
    return { job_id: job.id, ok: true };
  } catch (err) {
    return await release(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Reserva y despacha jobs en cola cuyas fotos ya están subidas. Sin
 * WORKER_DISPATCH_URL no reserva nada (los jobs esperan en cola).
 */
export async function dispatchQueued(
  admin: SupabaseClient,
  opts: { jobId?: string; limit?: number } = {},
): Promise<DispatchOutcome[]> {
  if (!env.workerDispatchUrl()) return [];
  const { data, error } = await admin.rpc("claim_jobs_for_dispatch", {
    p_job_id: opts.jobId ?? null,
    p_limit: opts.limit ?? 20,
  });
  if (error) throw new Error(`claim_jobs_for_dispatch: ${error.message}`);
  const claimed = (data ?? []) as ClaimedJob[];
  return await Promise.all(claimed.map((job) => dispatchClaimed(admin, job)));
}
