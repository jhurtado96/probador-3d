// Despacho de jobs al worker GPU (Modal, región UE) con un JobDispatch.
// El worker no recibe credenciales: solo URLs firmadas de vida corta.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type DrapeJobInput,
  type GarmentJobInput,
  type JobDispatch,
  type JobType,
  type SignedUpload,
  validate,
} from "./contracts.ts";
import { env, optionalEnv } from "./env.ts";
import { ASSETS_BUCKET, splitPath } from "./storage.ts";

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

/**
 * Las URLs firmadas se generan contra SUPABASE_URL. En local esa URL es la red
 * interna de Docker (http://kong:8000); PUBLIC_SUPABASE_URL la sustituye por
 * una que el worker pueda alcanzar.
 */
function publicUrl(url: string): string {
  const pub = optionalEnv("PUBLIC_SUPABASE_URL");
  const internal = env.supabaseUrl();
  return pub && url.startsWith(internal) ? pub + url.slice(internal.length) : url;
}

/** Artefactos que cada tipo de job sube, con su ruta en el bucket assets. */
export function planOutputs(job: ClaimedJob): Array<{ name: string; path: string }> {
  const owner = job.user_id ?? "catalog";
  const stem = `${job.id}-a${job.attempt}`;
  switch (job.type) {
    case "avatar":
      return [{ name: "glb", path: `${ASSETS_BUCKET}/${owner}/avatars/${stem}.glb` }];
    case "garment": {
      const gid = (job.input as unknown as GarmentJobInput).garment_id;
      return [
        { name: "glb", path: `${ASSETS_BUCKET}/${owner}/garments/${gid}/${stem}.glb` },
        { name: "image", path: `${ASSETS_BUCKET}/${owner}/garments/${gid}/${stem}-cutout.png` },
      ];
    }
    case "drape":
      return [{ name: "glb", path: `${ASSETS_BUCKET}/${owner}/drapes/${stem}.glb` }];
    case "color":
      return [];
  }
}

/**
 * Rutas que el worker necesita leer. Para avatar/color/garment son las fotos de
 * raw-uploads. El drapeado no tiene rutas en su entrada (solo ids): se le dan
 * los GLB del avatar y de la prenda (ver discrepancias en supabase/README.md).
 */
async function inputPathsFor(admin: SupabaseClient, job: ClaimedJob): Promise<string[]> {
  if (job.type !== "drape") return job.input_paths;
  const input = job.input as unknown as DrapeJobInput;
  const [{ data: avatar }, { data: garment }] = await Promise.all([
    admin.from("avatars").select("glb_path").eq("id", input.avatar_id).maybeSingle(),
    admin.from("garments").select("glb_path").eq("id", input.garment_id).maybeSingle(),
  ]);
  return [avatar?.glb_path, garment?.glb_path].filter((p): p is string => typeof p === "string");
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

  try {
    // URLs de subida de los artefactos de salida.
    const outputs = planOutputs(job);
    const output_uploads: SignedUpload[] = [];
    for (const o of outputs) {
      const { bucket, name } = splitPath(o.path);
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(name, { upsert: true });
      if (error || !data) throw new Error(`signed upload url: ${error?.message}`);
      output_uploads.push({ name: o.name, path: o.path, upload_url: publicUrl(data.signedUrl) });
    }

    // URLs de descarga de las entradas, indexadas por ruta.
    const input_urls: Record<string, string> = {};
    for (const path of await inputPathsFor(admin, job)) {
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

    const dispatch: JobDispatch = {
      job_id: job.id,
      type: job.type,
      input: job.input as unknown as JobDispatch["input"],
      input_urls,
      output_uploads,
      callback_url: env.jobCallbackUrl(),
      attempt: job.attempt,
    };
    const check = validate.jobDispatch(dispatch);
    if (!check.ok) throw new Error(`JobDispatch does not match contract: ${JSON.stringify(check.errors)}`);

    const token = env.workerDispatchToken();
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(dispatch),
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
