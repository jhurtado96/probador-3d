// POST /functions/v1/maintenance   (la llama pg_cron vía pg_net; no la app)
//
// Cabecera x-maintenance-secret = MAINTENANCE_SECRET (guardado también en Vault).
// Cuerpo: { "tasks": ["dispatch", "delete_job_inputs", "sweep_raw_uploads", "gc_assets"] }
//
//   dispatch           despacha jobs en cola con todas sus fotos subidas (y los
//                      que pg_cron devolvió a la cola tras un timeout).
//   delete_job_inputs  borra las fotos de jobs ya terminados que aún constan
//                      sin borrar (timeouts, cancelados, callback que falló).
//   sweep_raw_uploads  RED DE SEGURIDAD: borra todo objeto de raw-uploads con
//                      más de 60 minutos, haya terminado su job o no.
//   gc_assets          borra GLB y recortes de assets que ya no referencia
//                      ninguna fila (avatar borrado, consentimiento retirado,
//                      caché purgada).

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchQueued } from "../_shared/dispatch.ts";
import { env } from "../_shared/env.ts";
import { safeEqual } from "../_shared/hmac.ts";
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { ASSETS_BUCKET, RAW_BUCKET, removeObjects, removePaths } from "../_shared/storage.ts";
import { adminClient } from "../_shared/supabase.ts";

const RAW_MAX_AGE = "60 minutes";

type Task = "dispatch" | "delete_job_inputs" | "sweep_raw_uploads" | "gc_assets";

const tasks: Record<Task, (admin: SupabaseClient) => Promise<unknown>> = {
  async dispatch(admin) {
    const outcomes = await dispatchQueued(admin, { limit: 20 });
    return { dispatched: outcomes.filter((o) => o.ok).length, failed: outcomes.filter((o) => !o.ok).length };
  },

  async delete_job_inputs(admin) {
    const { data, error } = await admin.rpc("jobs_with_pending_input_deletion", { p_limit: 200 });
    if (error) throw error;
    const rows = (data ?? []) as Array<{ job_id: string; input_paths: string[] }>;
    if (rows.length === 0) return { jobs: 0 };
    await removePaths(admin, rows.flatMap((r) => r.input_paths));
    const { error: markErr } = await admin.rpc("mark_job_inputs_deleted", {
      p_job_ids: rows.map((r) => r.job_id),
    });
    if (markErr) throw markErr;
    return { jobs: rows.length };
  },

  async sweep_raw_uploads(admin) {
    const { data, error } = await admin.rpc("expired_raw_uploads", { p_max_age: RAW_MAX_AGE, p_limit: 1000 });
    if (error) throw error;
    const names = ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
    const removed = names.length ? await removeObjects(admin, RAW_BUCKET, names) : 0;
    if (removed > 0) console.warn("raw-uploads sweep removed expired photos", { count: removed });
    return { removed };
  },

  async gc_assets(admin) {
    const { data, error } = await admin.rpc("orphaned_assets", { p_limit: 1000 });
    if (error) throw error;
    const names = ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
    return { removed: names.length ? await removeObjects(admin, ASSETS_BUCKET, names) : 0 };
  },
};

Deno.serve(handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "use POST");
  const given = req.headers.get("x-maintenance-secret") ?? "";
  if (!given || !(await safeEqual(given, env.maintenanceSecret()))) {
    throw new HttpError(401, "unauthorized", "invalid maintenance secret");
  }

  const body = await readJson(req) as { tasks?: unknown };
  const requested = Array.isArray(body?.tasks) ? body.tasks : [];
  const unknown = requested.filter((t) => typeof t !== "string" || !(t in tasks));
  if (requested.length === 0 || unknown.length > 0) {
    throw new HttpError(400, "invalid_input", `tasks must be a non-empty subset of ${Object.keys(tasks).join(", ")}`);
  }

  const admin = adminClient();
  const report: Record<string, unknown> = {};
  // Cada tarea es independiente: un fallo no impide el barrido de fotos.
  for (const t of requested as Task[]) {
    try {
      report[t] = await tasks[t](admin);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? String(err);
      console.error("maintenance task failed", { task: t, error: message });
      report[t] = { error: message };
    }
  }
  return json(report);
}));
