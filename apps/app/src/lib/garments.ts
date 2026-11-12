/**
 * Armario: prendas propias (`garments` con RLS) y alta de una prenda nueva:
 * fila en `processing` → job `garment` con su foto (D12: sin consentimiento
 * propio, la foto debe ser de la prenda sola, sin personas).
 */
import type { GarmentCategory, GarmentStatus, Job } from '@probador/contracts';

import { createGarmentJob, type UploadStep } from './jobs';
import { requireUserId, supabase } from './supabase';
import { rawUploadPath } from './uploadPaths';

export type GarmentRow = {
  id: string;
  status: GarmentStatus;
  name: string | null;
  brand: string | null;
  category: GarmentCategory | null;
  size_label: string | null;
  image_path: string | null;
  pipeline_version: string;
  created_at: string;
};

export async function fetchMyGarments(): Promise<GarmentRow[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('garments')
    .select('id, status, name, brand, category, size_label, image_path, pipeline_version, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GarmentRow[];
}

export type NewGarment = { name?: string; brand?: string; sizeLabel?: string; categoryHint?: GarmentCategory };

export async function addGarment(
  details: NewGarment,
  photoUri: string,
  onStep?: (s: UploadStep) => void,
): Promise<{ garmentId: string; job: Job }> {
  const userId = await requireUserId();
  const name = details.name?.trim() || null;
  const brand = details.brand?.trim().slice(0, 80) || null;
  const sizeLabel = details.sizeLabel?.trim().slice(0, 32) || null;
  const { data, error } = await supabase
    .from('garments')
    .insert({ status: 'processing', name, brand, size_label: sizeLabel })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('No se pudo crear la prenda.');
  const garmentId = (data as { id: string }).id;
  const path = rawUploadPath(userId, 'jpg');
  try {
    const job = await createGarmentJob(
      {
        garment_id: garmentId,
        image_paths: [path],
        ...(details.categoryHint ? { category_hint: details.categoryHint } : {}),
        ...(sizeLabel ? { size_label: sizeLabel } : {}),
        ...(brand ? { brand } : {}),
      },
      [photoUri],
      onStep,
    );
    return { garmentId, job };
  } catch (err) {
    // Sin job la prenda quedaría «procesando» para siempre: se borra.
    await supabase.from('garments').delete().eq('id', garmentId);
    throw err;
  }
}

export async function deleteGarment(id: string): Promise<void> {
  const { error } = await supabase.from('garments').delete().eq('id', id);
  if (error) throw error;
}

export const GARMENT_STATUS_LABEL: Record<GarmentStatus, string> = {
  processing: 'Procesando',
  ready: 'Lista',
  failed: 'No se pudo procesar',
};

export const CATEGORY_LABEL: Record<GarmentCategory, string> = {
  tshirt: 'Camiseta',
  shirt: 'Camisa',
  sweater: 'Jersey',
  hoodie: 'Sudadera',
  jacket: 'Chaqueta',
  coat: 'Abrigo',
  dress: 'Vestido',
  skirt: 'Falda',
  pants: 'Pantalón',
  jeans: 'Vaqueros',
  shorts: 'Pantalón corto',
};
