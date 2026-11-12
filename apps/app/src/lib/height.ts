/** Rango aceptado para la altura introducida por la persona usuaria (cm). */
export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;

export type HeightValidation =
  | { ok: true; valueCm: number }
  | { ok: false; error: string | null };

/**
 * Valida la altura escrita en el campo de texto.
 * Acepta enteros o un decimal (coma o punto). Un campo vacío no es un error,
 * simplemente todavía no hay valor.
 */
export function validateHeightCm(raw: string): HeightValidation {
  const text = raw.trim().replace(',', '.');
  if (text === '') return { ok: false, error: null };
  if (!/^\d{2,3}(\.\d)?$/.test(text)) {
    return { ok: false, error: 'Escribe solo números, por ejemplo 172 o 172,5.' };
  }
  const value = Number(text);
  if (value < MIN_HEIGHT_CM || value > MAX_HEIGHT_CM) {
    return {
      ok: false,
      error: `La altura debe estar entre ${MIN_HEIGHT_CM} y ${MAX_HEIGHT_CM} cm.`,
    };
  }
  return { ok: true, valueCm: value };
}

/** Rango del peso opcional (kg), el de `AvatarJobInput.weight_kg` del contrato. */
export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 350;

export type WeightValidation =
  | { ok: true; valueKg: number | undefined }
  | { ok: false; error: string };

/** Valida el peso (opcional): vacío es válido y significa «sin peso». */
export function validateWeightKg(raw: string): WeightValidation {
  const text = raw.trim().replace(',', '.');
  if (text === '') return { ok: true, valueKg: undefined };
  if (!/^\d{2,3}(\.\d)?$/.test(text)) {
    return { ok: false, error: 'Escribe solo números, por ejemplo 68 o 68,5.' };
  }
  const value = Number(text);
  if (value < MIN_WEIGHT_KG || value > MAX_WEIGHT_KG) {
    return { ok: false, error: `El peso debe estar entre ${MIN_WEIGHT_KG} y ${MAX_WEIGHT_KG} kg.` };
  }
  return { ok: true, valueKg: value };
}
