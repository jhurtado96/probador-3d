import type { ConsentPurpose, ConsentText } from '@probador/contracts';

/**
 * La versión vigente de cada tratamiento es la última publicada (mismo orden
 * que `current_consent_text_version` en Postgres: `published_at` y después
 * `version`, de mayor a menor). Sin dependencias: se prueba con `node --test`.
 */
export function latestTextPerPurpose(rows: ConsentText[]): Partial<Record<ConsentPurpose, ConsentText>> {
  const out: Partial<Record<ConsentPurpose, ConsentText>> = {};
  for (const row of rows) {
    const current = out[row.purpose];
    if (
      !current ||
      row.published_at > current.published_at ||
      (row.published_at === current.published_at && row.version > current.version)
    ) {
      out[row.purpose] = row;
    }
  }
  return out;
}
