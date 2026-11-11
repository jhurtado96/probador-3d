// DELETE /functions/v1/delete-account   (también POST)  — borrado total RGPD
//
// Cuerpo: { "confirm": "DELETE" }  (evita borrados por error).
//   0. Comprueba que el archivo de consentimientos está configurado (secreto
//      consent_pseudonym_secret en Vault); si no, no borra nada (500).
//   1. Borra TODOS los objetos de Storage del usuario (raw-uploads y assets,
//      carpeta <user_id>/ y cualquier objeto cuyo owner sea él) por la API de
//      Storage, y comprueba que no queda ninguno.
//   2. Borra el usuario de Auth. Las claves foráneas en cascada eliminan
//      profiles, consents, avatars, color_profiles, garments,
//      garment_measurements, fit_results, user_fit_preferences, outfits,
//      drape_cache, jobs, job_runs y data_export_requests. Antes de que cada
//      consentimiento desaparezca, el trigger consents_archive_before_delete
//      copia un registro mínimo seudonimizado (HMAC del user_id) a
//      consent_records_archive, bloqueado 3 años (docs/architecture.md §7, D6),
//      en la misma transacción: si el archivo falla, no se borra el usuario.
// Si algo falla en 1, no se borra el usuario: la petición se puede repetir.
// Las copias de seguridad del proveedor caducan según su retención (README).

import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { removeObjects } from "../_shared/storage.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(handler(async (req) => {
  if (req.method !== "DELETE" && req.method !== "POST") {
    throw new HttpError(405, "method_not_allowed", "use DELETE");
  }
  const admin = adminClient();
  const user = await requireUser(req, admin);

  const body = await readJson(req) as { confirm?: unknown };
  if (body?.confirm !== "DELETE") {
    throw new HttpError(400, "confirmation_required", 'send {"confirm": "DELETE"}');
  }

  // 0. Sin el secreto del seudónimo el trigger de archivo haría fallar la baja
  // DESPUÉS de vaciar Storage; se comprueba antes de tocar nada.
  const { data: archiveReady, error: archiveErr } = await admin.rpc("consent_archive_ready");
  if (archiveErr) throw archiveErr;
  if (archiveReady !== true) {
    console.error("account deletion blocked: vault secret consent_pseudonym_secret is not configured");
    throw new HttpError(500, "internal", "consent archive is not configured; nothing was deleted");
  }

  const listObjects = async () => {
    const { data, error } = await admin.rpc("user_storage_objects", { p_user_id: user.id });
    if (error) throw error;
    return (data ?? []) as Array<{ bucket_id: string; name: string }>;
  };

  // 1. Storage
  const objects = await listObjects();
  const byBucket = new Map<string, string[]>();
  for (const o of objects) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name]);
  let removed = 0;
  for (const [bucket, names] of byBucket) removed += await removeObjects(admin, bucket, names);

  const left = await listObjects();
  if (left.length > 0) {
    console.error("account deletion: storage objects remain", { user_id: user.id, left: left.length });
    throw new HttpError(500, "storage_not_empty", "some files could not be deleted; retry");
  }

  // 2. Auth + cascada en Postgres
  const { error } = await admin.auth.admin.deleteUser(user.id, false);
  if (error) throw new HttpError(500, "auth_delete_failed", error.message);

  console.info("account deleted", { user_id: user.id, storage_objects: removed });
  return json({ deleted: true, storage_objects_deleted: removed });
}));
