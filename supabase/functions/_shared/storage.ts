import type { SupabaseClient } from "@supabase/supabase-js";

export const RAW_BUCKET = "raw-uploads";
export const ASSETS_BUCKET = "assets";

/** Las rutas del contrato (StoragePath) llevan el bucket delante: `bucket/carpeta/fichero`. */
export function splitPath(path: string): { bucket: string; name: string } {
  const i = path.indexOf("/");
  if (i <= 0) throw new Error("storage path without bucket");
  return { bucket: path.slice(0, i), name: path.slice(i + 1) };
}

/** Ruta de raw-uploads válida para este usuario: `raw-uploads/<uid>/<fichero>.<jpg|jpeg|png|webp>`. */
export function isOwnRawUploadPath(path: string, userId: string): boolean {
  const prefix = `${RAW_BUCKET}/${userId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,100}\.(jpe?g|png|webp)$/.test(rest);
}

/**
 * Borra objetos por la API de Storage (no por SQL: eso dejaría el fichero).
 * Borrar un objeto que ya no existe no es un error.
 */
export async function removeObjects(
  admin: SupabaseClient,
  bucket: string,
  names: string[],
): Promise<number> {
  let removed = 0;
  for (let i = 0; i < names.length; i += 100) {
    const batch = names.slice(i, i + 100);
    const { data, error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`storage remove failed in ${bucket}: ${error.message}`);
    removed += data?.length ?? 0;
  }
  return removed;
}

/** Borra una lista de StoragePath (`bucket/…`) agrupando por bucket. */
export async function removePaths(admin: SupabaseClient, paths: string[]): Promise<number> {
  const byBucket = new Map<string, string[]>();
  for (const p of paths) {
    const { bucket, name } = splitPath(p);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), name]);
  }
  let removed = 0;
  for (const [bucket, names] of byBucket) removed += await removeObjects(admin, bucket, names);
  return removed;
}
