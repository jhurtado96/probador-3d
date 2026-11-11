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
// Respuesta 201: { job: Job, uploads: [{ path, signed_url, token }] }
// Errores: { error: { code, message, details? } }; `consent_missing` usa el
// mismo código que JobErrorCode.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CreateJobRequest,
  type DrapeJobInput,
  type GarmentJobInput,
  type Job,
  validate,
} from "../_shared/contracts.ts";
import { dispatchQueued } from "../_shared/dispatch.ts";
import { env } from "../_shared/env.ts";
import { sha256Hex } from "../_shared/hmac.ts";
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { isOwnRawUploadPath, RAW_BUCKET, splitPath } from "../_shared/storage.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

const CONSENT_PURPOSE = { avatar: "body_scan", color: "color_analysis" } as const;

interface UploadTicket {
  path: string;
  signed_url: string;
  token: string;
}

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

/** Comprueba avatar y prenda y calcula la clave de caché del drapeado. */
async function drapeCacheKey(admin: SupabaseClient, userId: string, input: DrapeJobInput): Promise<string> {
  const [{ data: avatar, error: e1 }, { data: garment, error: e2 }] = await Promise.all([
    admin.from("avatars").select("id, user_id, shape_hash").eq("id", input.avatar_id).maybeSingle(),
    admin.from("garments").select("id, user_id, status, glb_path, updated_at").eq("id", input.garment_id)
      .maybeSingle(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (!avatar || avatar.user_id !== userId) throw new HttpError(404, "not_found", "avatar not found");
  if (!garment || (garment.user_id !== null && garment.user_id !== userId)) {
    throw new HttpError(404, "not_found", "garment not found");
  }
  if (garment.status !== "ready" || !garment.glb_path) {
    throw new HttpError(409, "conflict", "garment is not ready");
  }
  // hash(shape_hash, prenda y su versión, talla, pose, calidad, versión del simulador)
  const material = [
    avatar.shape_hash,
    garment.id,
    garment.updated_at,
    input.size_label,
    input.pose,
    input.quality,
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

  let fit_result: Record<string, unknown> | undefined;
  if (hit.fit_result_id) {
    const { data } = await admin.from("fit_results").select("*").eq("id", hit.fit_result_id).maybeSingle();
    if (data) fit_result = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
  }
  const now = new Date().toISOString();
  const { data: job, error: insErr } = await admin
    .from("jobs")
    .insert({
      user_id: userId,
      type: "drape",
      status: "succeeded",
      progress: 1,
      input: req.input,
      output: {
        glb_url: `storage://${hit.glb_path}`,
        cache_key: cacheKey,
        cache_hit: true,
        ...(fit_result ? { fit_result } : {}),
      },
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
  await assertQuota(admin, user.id);

  let cacheKey: string | null = null;
  if (body.type === "garment") await assertGarmentOwned(admin, user.id, body.input);
  if (body.type === "drape") {
    cacheKey = await drapeCacheKey(admin, user.id, body.input);
    const cached = await tryDrapeCacheHit(admin, user.id, body, cacheKey);
    if (cached) return json({ job: cached, uploads: [] }, 201);
  }

  const { data: job, error } = await admin
    .from("jobs")
    .insert({ user_id: user.id, type: body.type, status: "queued", input: body.input })
    .select("*")
    .single();
  if (error) throw error;

  const { error: runErr } = await admin
    .from("job_runs")
    .insert({ job_id: job.id, input_paths: paths, cache_key: cacheKey });
  if (runErr) {
    await admin.from("jobs").delete().eq("id", job.id);
    throw runErr;
  }

  const uploads = await uploadTickets(admin, paths);
  if (uploads.length === 0) await dispatchQueued(admin, { jobId: job.id });

  const { data: fresh } = await admin.from("jobs").select("*").eq("id", job.id).single();
  return json({ job: (fresh ?? job) as Job, uploads }, 201);
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
