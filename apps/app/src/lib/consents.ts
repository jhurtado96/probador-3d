/**
 * Consentimientos (RGPD). Los textos se leen de `consent_texts` (lectura
 * pública por RLS) y el consentimiento se registra insertando en `consents`
 * con RLS: la app solo envía `purpose` y la `text_version` que mostró; el
 * servidor fija fechas y rechaza una versión que no sea la vigente (D13).
 * Retirar = poner `withdrawn_at` (la fecha real la pone el servidor); un
 * trigger borra lo derivado (avatar y medidas, perfil de color…).
 */
import type { Consent, ConsentPurpose, ConsentText, Profile } from '@probador/contracts';

import { latestTextPerPurpose } from './consentTexts';
import { supabase } from './supabase';

export { latestTextPerPurpose };

export async function fetchCurrentConsentTexts(): Promise<Partial<Record<ConsentPurpose, ConsentText>>> {
  const { data, error } = await supabase
    .from('consent_texts')
    .select('purpose, version, body, sha256, published_at')
    .order('published_at', { ascending: false })
    .order('version', { ascending: false });
  if (error) throw error;
  return latestTextPerPurpose((data ?? []) as ConsentText[]);
}

/** Consentimientos vigentes (sin retirar) del usuario, por tratamiento. */
export async function fetchActiveConsents(): Promise<Partial<Record<ConsentPurpose, Consent>>> {
  const { data, error } = await supabase
    .from('consents')
    .select('id, user_id, purpose, text_version, granted_at, withdrawn_at, created_at')
    .is('withdrawn_at', null)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  const out: Partial<Record<ConsentPurpose, Consent>> = {};
  for (const c of (data ?? []) as Consent[]) out[c.purpose] ??= c;
  return out;
}

export class ConsentTextChangedError extends Error {
  constructor() {
    super('El texto del consentimiento acaba de cambiar. Vuelve a leerlo antes de aceptarlo.');
  }
}

export async function grantConsent(purpose: ConsentPurpose, shownVersion: string): Promise<Consent> {
  const { data, error } = await supabase
    .from('consents')
    .insert({ purpose, text_version: shownVersion })
    .select('id, user_id, purpose, text_version, granted_at, withdrawn_at, created_at')
    .single();
  if (error) {
    if (error.code === '23514' || error.code === '23503') throw new ConsentTextChangedError();
    if (error.code === '23505') {
      // Ya había uno vigente (p. ej. aceptado desde otro dispositivo).
      const active = await fetchActiveConsents();
      const existing = active[purpose];
      if (existing) return existing;
    }
    throw error;
  }
  return data as Consent;
}

export async function withdrawConsent(consentId: string): Promise<void> {
  const { error } = await supabase
    .from('consents')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('id', consentId);
  if (error) throw error;
}

export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, locale, age_confirmed_at, created_at, updated_at')
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Profile | null;
}

export async function confirmAge(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ age_confirmed_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}
