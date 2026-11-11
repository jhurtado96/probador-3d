// POST /functions/v1/create-job
//   Cuerpo: CreateJobRequest (packages/contracts).
//   1. Valida el cuerpo contra el JSON Schema del contrato.
//   2. Comprueba dueño de las rutas y de los ids, consentimiento vigente y cuota.
//   3. Inserta el job (`queued`) y sus datos internos (job_runs).
//   4. Devuelve el Job y una URL firmada de subida por cada foto que aún no
//      está en raw-uploads. Si no falta ninguna, despacha ya.
//   Drapeado: si la combinación está en drape_cache, responde el job ya
//   `succeeded` con `cache_hit: true`, sin GPU.
//
// POST /functions/v1/create-job/uploaded   { "job_id": "<uuid>" }
//   La app avisa de que terminó de subir las fotos; se despacha en el acto.
//   (Si la app no avisa, pg_cron lo despacha en menos de un minuto.)
//
// Revisión de la fase 0:
//   · B8: cuota e inserción en una sola transacción (RPC enqueue_job).
//   · M4: la clave de caché del drapeado incluye las medidas efectivas del
//     avatar (con measurements_override) y la versión real de la prenda.
//   · M6: si hay fotos que superan el plazo de borrado (alerta abierta), no se
//     aceptan jobs con fotos nuevas: 503 scans_paused.
//   · M5: los jobs de prenda no piden consentimiento propio (base: ejecución
//     del contrato); a cambio, la captura pide la prenda sin la persona y el
//     worker rechaza las fotos con una persona (person_detected). Ver §7, D12.
//   · A1: un acierto de caché guarda en jobs.output solo ids.
//
// Respuesta 201: CreateJobResponse = { job: Job, uploads: UploadTicket[] }
// Errores: ApiErrorBody = { error: { code, message, details? } }; `consent_missing`
// y `quota_exceeded` usan el mismo código que JobErrorCode.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CreateJobRequest,
  type CreateJobResponse,
  type DrapeJobInput,
  type GarmentJobInput,
  type Job,
  type UploadTicket,
  validate,
} from "../_shared/contracts.ts";
import { dispatchQueued } from "../_shared/dispatch.ts";
import { env } from "../_shared/env.ts";
import { sha256Hex } from "../_shared/hmac.ts";
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { isOwnRawUploadPath, RAW_BUCKET, splitPath } from "../_shared/storage.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

const CONSENT_PURPOSE = { avatar: "body_scan", color: "color_analysis" } as const;

function inputPaths(req: CreateJobRequest): string[] {
  switch (req.type) {
    case "avatar":
      return [req.input.photo_path];
    case "color":
      return [req.input.selfie_path];
    case "garment":
      return req.input.image_paths;
    case "drape":
      return [];
  }
}

async function assertConsent(admin: SupabaseClient, userId: string, req: CreateJobRequest) {
  if (req.type !== "avatar" && req.type !== "color") return;
  const { data, error } = await admin
    .from("consents")
    .select("id")
    .eq("id", req.input.consent_id)
    .eq("user_id", userId)
    .eq("purpose", CONSENT_PURPOSE[req.type])
    .is("withdrawn_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(403, "consent_missing", `no active ${CONSENT_PURPOSE[req.type]} consent with that id`);
  }
}

/** M6: con fotos pendientes de borrar fuera de plazo no entran fotos nuevas. */
async function assertScansAllowed(admin: SupabaseClient, req: CreateJobRequest) {
  if (req.type === "drape") return;
  const { data, error } = await admin.rpc("scans_paused");
  if (error) throw error;
  if (data === true) {
    throw new HttpError(503, "scans_paused", "photo processing is paused by a privacy alert; try again later");
  }
}

/** Cuota no atómica: solo para el acierto de caché, que no gasta GPU. Los demás pasan por enqueue_job (B8). */
async function assertQuota(admin: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) throw error;
  if ((count ?? 0) >= env.jobDailyQuota()) {
    throw new HttpError(429, "quota_exceeded", "daily job quota exceeded");
  }
}

async function assertGarmentOwned(admin: SupabaseClient, userId: string, input: GarmentJobInput) {
  const { data, error } = await admin
    .from("garments")
    .select("id, user_id, status")
    .eq("id", input.garment_id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== userId) throw new HttpError(404, "not_found", "garment not found");
  if (data.status === "ready") {
    throw new HttpError(409, "conflict", "garment is already processed");
  }
  if (data.status === "failed") {
    const { error: upd } = await admin.from("garments").update({ status: "processing" }).eq("id", data.id);
    if (upd) throw upd;
  }
}

/** JSON con las claves ordenadas: el mismo objeto da siempre el mismo hash. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Comprueba avatar y prenda y calcula la clave de caché del drapeado. */
async function drapeCacheKey(admin: SupabaseClient, userId: string, input: DrapeJobInput): Promise<string> {
  const [{ data: avatar, error: e1 }, { data: garment, error: e2 }, { data: sizes, error: e3 }] = await Promise.all([
    admin.from("avatars").select("id, user_id, shape_hash, measurements, measurements_override")
      .eq("id", input.avatar_id).maybeSingle(),
    admin.from("garments")
      .select("id, user_id, status, glb_path, sewing_pattern_path, attributes, pipeline_version")
      .eq("id", input.garment_id)
      .maybeSingle(),
    admin.from("garment_measurements").select("zones, source")
      .eq("garment_id", input.garment_id).eq("size_label", input.size_label).maybeSingle(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (!avatar || avatar.user_id !== userId) throw new HttpError(404, "not_found", "avatar not found");
  if (!garment || (garment.user_id !== null && garment.user_id !== userId)) {
    throw new HttpError(404, "not_found", "garment not found");
  }
  if (garment.status !== "ready" || !(garment.sewing_pattern_path || garment.glb_path)) {
    throw new HttpError(409, "conflict", "garment is not ready");
  }
  // hash(forma y medidas efectivas, prenda y su versión, talla, pose, calidad, tejido, versión del simulador).
  // M4: las medidas efectivas (con measurements_override) entran en la clave: corregir la cintura cambia la clave
  // (y además el trigger avatars_invalidate_drape_cache borra la caché del avatar).
  const effectiveMeasurements = { ...(avatar.measurements ?? {}), ...(avatar.measurements_override ?? {}) };
  // Versión de la prenda: lo que cambia el resultado de la simulación, no `updated_at` (renombrarla no invalida).
  const garmentVersion = canonicalJson({
    pipeline_version: garment.pipeline_version,
    glb_path: garment.glb_path,
    sewing_pattern_path: garment.sewing_pattern_path,
    attributes: garment.attributes ?? {},
    measurements: sizes ?? null,
  });
  const material = [
    avatar.shape_hash,
    await sha256Hex(canonicalJson(effectiveMeasurements)),
    garment.id,
    await sha256Hex(garmentVersion),
    input.size_label,
    input.pose,
    input.quality,
    (garment.attributes as { fabric?: string } | null)?.fabric ?? "",
    env.drapeSimulatorVersion(),
  ].join("|");
  return `sha256:${await sha256Hex(material)}`;
}

/** Acierto de caché: job terminado al instante, sin GPU. */
async function tryDrapeCacheHit(
  admin: SupabaseClient,
  userId: string,
  req: Extract<CreateJobRequest, { type: "drape" }>,
  cacheKey: string,
): Promise<Job | null> {
  const { data: hit, error } = await admin
    .from("drape_cache")
    .select("id, glb_path, fit_result_id, hit_count")
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error) throw error;
  if (!hit) return null;

  const now = new Date().toISOString();
  const { data: job, error: insErr } = await admin
    .from("jobs")
    .insert({
      user_id: userId,
      type: "drape",
      status: "succeeded",
      progress: 1,
      input: req.input,
      // A1: solo referencias; el GLB y el FitResult se leen de sus tablas.
      output: { drape_cache_id: hit.id, fit_result_id: hit.fit_result_id ?? null, cache_hit: true },
      started_at: now,
      finished_at: now,
    })
    .select("*")
    .single();
  if (insErr) throw insErr;
  await admin.from("job_runs").insert({ job_id: job.id, cache_key: cacheKey, input_paths: [] });
  await admin
    .from("drape_cache")
    .update({ hit_count: hit.hit_count + 1, last_used_at: now })
    .eq("id", hit.id);
  return job as Job;
}

async function uploadTickets(admin: SupabaseClient, paths: string[]): Promise<UploadTicket[]> {
  const tickets: UploadTicket[] = [];
  for (const path of paths) {
    const { name } = splitPath(path);
    const bucket = admin.storage.from(RAW_BUCKET);
    const { data: exists } = await bucket.exists(name);
    if (exists) continue;
    const { data, error } = await bucket.createSignedUploadUrl(name);
    if (error || !data) throw new Error(`signed upload url: ${error?.message}`);
    tickets.push({ path, signed_url: data.signedUrl, token: data.token });
  }
  return tickets;
}

async function createJob(req: Request): Promise<Response> {
  const admin = adminClient();
  const user = await requireUser(req, admin);

  const parsed = validate.createJobRequest(await readJson(req));
  if (!parsed.ok) throw new HttpError(400, "invalid_input", "body does not match CreateJobRequest", parsed.errors);
  const body = parsed.value;

  const paths = inputPaths(body);
  if (new Set(paths).size !== paths.length) throw new HttpError(400, "invalid_input", "duplicate input paths");
  for (const p of paths) {
    if (!isOwnRawUploadPath(p, user.id)) {
      throw new HttpError(
        400,
        "invalid_input",
        `input paths must look like ${RAW_BUCKET}/<your user id>/<name>.jpg|png|webp`,
      );
    }
  }

  await assertConsent(admin, user.id, body);
  await assertScansAllowed(admin, body);

  let cacheKey: string | null = null;
  if (body.type === "garment") await assertGarmentOwned(admin, user.id, body.input);
  if (body.type === "drape") {
    cacheKey = await drapeCacheKey(admin, user.id, body.input);
    await assertQuota(admin, user.id);
    const cached = await tryDrapeCacheHit(admin, user.id, body, cacheKey);
    if (cached) return json({ job: cached, uploads: [] } satisfies CreateJobResponse, 201);
  }

  // B8: cuota y alta del job (con su job_runs) en una transacción con bloqueo por usuario.
  const { data: rows, error } = await admin.rpc("enqueue_job", {
    p_user_id: user.id,
    p_type: body.type,
    p_input: body.input,
    p_input_paths: paths,
    p_cache_key: cacheKey,
    p_daily_limit: env.jobDailyQuota(),
  });
  if (error) throw error;
  const job = ((rows ?? []) as Job[])[0];
  if (!job) throw new HttpError(429, "quota_exceeded", "daily job quota exceeded");

  const uploads = await uploadTickets(admin, paths);
  if (uploads.length === 0) await dispatchQueued(admin, { jobId: job.id });

  const { data: fresh } = await admin.from("jobs").select("*").eq("id", job.id).single();
  return json({ job: (fresh ?? job) as Job, uploads } satisfies CreateJobResponse, 201);
}

async function markUploaded(req: Request): Promise<Response> {
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson(req) as { job_id?: unknown };
  if (typeof body?.job_id !== "string") throw new HttpError(400, "invalid_input", "job_id is required");

  const { data: job, error } = await admin.from("jobs").select("id, user_id").eq("id", body.job_id).maybeSingle();
  if (error) throw error;
  if (!job || job.user_id !== user.id) throw new HttpError(404, "not_found", "job not found");

  await dispatchQueued(admin, { jobId: job.id });
  const { data: fresh } = await admin.from("jobs").select("*").eq("id", job.id).single();
  return json({ job: fresh as Job });
}

Deno.serve(handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "use POST");
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/create-job/uploaded")) return await markUploaded(req);
  if (path.endsWith("/create-job")) return await createJob(req);
  throw new HttpError(404, "not_found", "unknown route");
}));
