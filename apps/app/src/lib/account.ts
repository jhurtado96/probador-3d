/**
 * Derechos del usuario: exportar sus datos (`GET export-data`, arts. 15 y 20
 * RGPD) y borrar la cuenta (`delete-account`, borrado total).
 */
import type { DataExport } from '@probador/contracts';

import { callFunction, callFunctionText } from './api';
import { saveExportFile } from './saveExport';
import { supabase } from './supabase';

export type ExportSummary = {
  fileName: string;
  counts: { label: string; value: number }[];
  expiresAt: string;
};

export async function exportMyData(): Promise<ExportSummary> {
  const text = await callFunctionText('export-data', { method: 'GET' });
  const data = JSON.parse(text) as DataExport;
  const fileName = `probador-datos-${data.exported_at.slice(0, 10)}.json`;
  await saveExportFile(fileName, text);
  return {
    fileName,
    expiresAt: data.signed_urls_expire_at,
    counts: [
      { label: 'Consentimientos', value: data.consents.length },
      { label: 'Avatares', value: data.avatars.length },
      { label: 'Perfiles de color', value: data.color_profiles.length },
      { label: 'Prendas', value: data.garments.length },
      { label: 'Outfits', value: data.outfits.length },
      { label: 'Trabajos', value: data.jobs.length },
    ],
  };
}

/** Borra la cuenta y todos sus datos; después cierra la sesión local. */
export async function deleteMyAccount(): Promise<void> {
  await callFunction<{ deleted: boolean }>('delete-account', { method: 'POST', body: { confirm: 'DELETE' } });
  // El usuario ya no existe en Auth: basta con olvidar la sesión en este dispositivo.
  await supabase.auth.signOut({ scope: 'local' });
}
