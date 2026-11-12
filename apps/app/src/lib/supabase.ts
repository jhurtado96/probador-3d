/**
 * Cliente único de Supabase para toda la app (web, iOS y Android).
 *
 * - Sesión: `localStorage` en web y almacén seguro del sistema en nativo
 *   (`sessionStorage.ts` / `sessionStorage.native.ts`).
 * - `processLock`: recomendación de Supabase para React Native (no hay
 *   `navigator.locks`); en web se deja el bloqueo por defecto.
 * - En nativo, el refresco automático del token se pausa en segundo plano
 *   y se reanuda al volver (patrón de la guía de Supabase para Expo).
 * - Las Edge Functions NO se llaman con `supabase.functions.invoke`, sino con
 *   `callFunction` de `api.ts`, que fija la región eu-west-3 (ver allí por qué).
 */
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { SUPABASE_KEY, SUPABASE_URL } from './config';
import { sessionStorage } from './sessionStorage';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    ...(Platform.OS === 'web' ? {} : { lock: processLock }),
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Id del usuario con sesión o error si no la hay. */
export async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const id = data.session?.user.id;
  if (!id) throw new Error('No has iniciado sesión.');
  return id;
}
