// POST /functions/v1/job-callback   (lo llama el worker GPU, no la app)
//
//   1. Verifica la firma HMAC-SHA256 (x-probador-timestamp + x-probador-signature,
//      PROBADOR_CALLBACK_SECRET) y que el timestamp no tenga más de 5 minutos.
//   2. Valida el cuerpo contra JobCallback y, si trae `output`, contra la salida
//      del tipo de job (AvatarJobOutput, GarmentJobOutput…).
//   3. Descarta callbacks de intentos anteriores (`attempt`) y de jobs ya terminados.
//   4. Si el job termina (succeeded o failed): BORRA las fotos originales de
//      raw-uploads por la API de Storage y solo entonces persiste el resultado
//      (public.complete_job, una transacción) y anota jobs.input_deleted_at. El
//      worker no declara el borrado: es propiedad de la API.
//   5. `fake: true` (worker en modo fake) solo se acepta con
//      PROBADOR_ALLOW_FAKE_WORKERS=1; queda anotado en jobs.fake.
//      Si el borrado falla responde 503 para que el worker reintente; el
//      barrido de 60 min es la red de seguridad.
//
// Respuestas: 200 {result: applied|already_terminal}, 409 {result: stale_attempt},
// 400/401/404/422/503 con {error}.

import { validate } from "../_shared/contracts.ts";
import { env } from "../_shared/env.ts";
import { verifyRequest } from "../_shared/hmac.ts";
import { handler, HttpError, json } from "../_shared/http.ts";
import { removePaths } from "../_shared/storage.ts";
import { adminClient } from "../_shared/supabase.ts";

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

Deno.serve(handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "use POST");

  const raw = await req.text();
  if (!(await verifyRequest(env.callbackSecret(), raw, req.headers))) {
    throw new HttpError(401, "invalid_signature", "missing, invalid or expired signature");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "body is not valid JSON");
  }
  const parsed = validate.jobCallback(body);
  if (!parsed.ok) {
    console.warn("callback rejected by contract validation", { errors: parsed.errors.length });
    throw new HttpError(400, "invalid_callback", "body does not match JobCallback", parsed.errors);
  }
  const cb = parsed.value;
  if (cb.fake && !env.allowFakeWorkers()) {
    console.warn("fake worker callback rejected", { job_id: cb.job_id });
    throw new HttpError(422, "fake_not_allowed", "callbacks from fake workers are not accepted here");
  }

  const admin = adminClient();
  const { data: job, error } = await admin
    .from("jobs")
    .select("id, type, status, attempts, job_runs(input_paths)")
    .eq("id", cb.job_id)
    .maybeSingle();
  if (error) throw error;
  if (!job) throw new HttpError(404, "not_found", "job not found");
  if (TERMINAL.has(job.status)) return json({ result: "already_terminal", status: job.status });
  if (cb.attempt !== job.attempts) return json({ result: "stale_attempt" }, 409);

  // Coherencia estado ↔ carga útil.
  if (cb.status === "succeeded") {
    if (!cb.output) throw new HttpError(422, "invalid_callback", "succeeded callback without output");
    const out = validate.output(job.type, cb.output);
    if (!out.ok) {
      console.warn("callback output rejected", { job_id: job.id, type: job.type, errors: out.errors.length });
      throw new HttpError(422, "invalid_callback", `output does not match ${job.type} output`, out.errors);
    }
  }
  if (cb.status === "failed" && !cb.error) {
    throw new HttpError(422, "invalid_callback", "failed callback without error");
  }

  // Borrado de las fotos originales (RGPD) antes de cerrar el job.
  let inputDeletedAt: string | null = null;
  if (cb.status !== "running") {
    const runs = job.job_runs as unknown as { input_paths: string[] } | { input_paths: string[] }[] | null;
    const paths = (Array.isArray(runs) ? runs[0]?.input_paths : runs?.input_paths) ?? [];
    try {
      await removePaths(admin, paths);
    } catch (err) {
      console.error("input deletion failed", { job_id: job.id, error: (err as Error).message });
      throw new HttpError(503, "input_deletion_failed", "could not delete input photos; retry the callback");
    }
    // Sin fotos de entrada (drapeado) no hay borrado que anotar.
    if (paths.length > 0) inputDeletedAt = new Date().toISOString();
  }

  const { data: result, error: rpcErr } = await admin.rpc("complete_job", {
    p_job_id: cb.job_id,
    p_attempt: cb.attempt,
    p_status: cb.status,
    p_progress: cb.progress ?? null,
    p_stage: cb.stage ?? null,
    p_output: cb.output ?? null,
    p_error: cb.error ?? null,
    p_worker_version: cb.worker_version,
    p_input_deleted_at: inputDeletedAt,
    p_fake: cb.fake === true,
  });
  if (rpcErr) {
    if (rpcErr.code === "P0002") throw new HttpError(404, "not_found", "job not found");
    if (rpcErr.code === "22023" || rpcErr.code === "23503" || rpcErr.code === "23514") {
      console.warn("callback output inconsistent with job", { job_id: job.id, code: rpcErr.code });
      throw new HttpError(422, "invalid_callback", rpcErr.message);
    }
    throw rpcErr;
  }
  const r = result as { result: string };
  return json(r, r.result === "stale_attempt" ? 409 : 200);
}));
