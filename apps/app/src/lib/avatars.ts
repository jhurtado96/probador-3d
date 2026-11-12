/**
 * Avatares del usuario. En Postgres el GLB es una ruta (`glb_path`,
 * `assets/<uid>/avatars/…`); la app la firma para mostrarla (URL temporal que
 * no se guarda). Ver la cabecera de `@probador/contracts`.
 */
import type { BodyMeasurements, MeasurementSource } from '@probador/contracts';

import { supabase } from './supabase';
import { splitStoragePath } from './uploadPaths';

export type AvatarRow = {
  id: string;
  glb_path: string;
  model_version: string;
  measurements: BodyMeasurements;
  measurements_override: Partial<BodyMeasurements> | null;
  measurements_source: MeasurementSource;
  created_at: string;
};

const COLUMNS = 'id, glb_path, model_version, measurements, measurements_override, measurements_source, created_at';

export async function fetchAvatar(id: string): Promise<AvatarRow | null> {
  const { data, error } = await supabase.from('avatars').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as AvatarRow | null;
}

export async function fetchLatestAvatar(): Promise<AvatarRow | null> {
  const { data, error } = await supabase
    .from('avatars')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AvatarRow | null;
}

/** URL firmada (1 h) de un objeto de `assets`. */
export async function signedAssetUrl(path: string, ttlSeconds = 3600): Promise<string> {
  const { bucket, name } = splitStoragePath(path);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(name, ttlSeconds);
  if (error || !data) throw error ?? new Error('No se pudo firmar la URL del fichero.');
  return data.signedUrl;
}

/** Medidas efectivas: las corregidas a mano prevalecen. */
export function effectiveMeasurements(a: AvatarRow): BodyMeasurements {
  return { ...a.measurements, ...(a.measurements_override ?? {}) } as BodyMeasurements;
}
