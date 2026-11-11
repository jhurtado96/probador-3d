// POST /functions/v1/job-dispatch   (lo llama el contenedor del worker GPU, no la app)
//
// A3 (revisión de la fase 0): el aviso que pasa por la cola del proveedor de GPU
// (JobDispatchNotice) solo lleva identificadores. Con él, el contenedor pide
// aquí el JobDispatch completo (entrada, URLs firmadas y contexto), que viaja
// directamente de la API al contenedor por HTTPS y no se guarda en el proveedor.
//
//   1. Verifica la firma HMAC (PROBADOR_CALLBACK_SECRET: sentido worker → API) y
//      que el timestamp no tenga más de 5 minutos.
//   2. Valida el cuerpo contra JobDispatchFetch ({ job_id, attempt }).
//   3. claim_job_dispatch_fetch: solo el intento vigente, despachado, dentro de
//      plazo y una sola vez (B4: un aviso reenviado no vuelve a obtener la URL
//      de la foto). Si no, 409.
//   4. Construye el JobDispatch (buildDispatch), lo valida y lo devuelve.
//
// Respuestas: 200 JobDispatch; 400/401/409 con {error}. Cache-Control: no-store.

import { validate } from "../_shared/contracts.ts";
import { buildDispatch, type ClaimedJob } from "../_shared/dispatch.ts";
import { env } from "../_shared/env.ts";
import { verifyRequest } from "../_shared/hmac.ts";
import { handler, HttpError, json } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

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
  const parsed = validate.jobDispatchFetch(body);
  if (!parsed.ok) throw new HttpError(400, "invalid_input", "body does not match JobDispatchFetch", parsed.errors);

  const admin = adminClient();
  const { data, error } = await admin.rpc("claim_job_dispatch_fetch", {
    p_job_id: parsed.value.job_id,
    p_attempt: parsed.value.attempt,
  });
  if (error) throw error;
  const job = ((data ?? []) as ClaimedJob[])[0];
  if (!job) {
    console.warn("dispatch fetch refused", { job_id: parsed.value.job_id, attempt: parsed.value.attempt });
    throw new HttpError(409, "conflict", "no dispatch available for this job and attempt");
  }

  const dispatch = await buildDispatch(admin, job);
  return json(dispatch, 200, { "Cache-Control": "no-store" });
}));
