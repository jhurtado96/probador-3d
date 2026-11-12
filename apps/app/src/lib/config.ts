/**
 * Configuración pública del backend. Prioridad: variables `EXPO_PUBLIC_*`
 * (fichero `.env`, ver `.env.example`; se incrustan al empaquetar) y, si no
 * hay, los valores del proyecto en la nube. Todo esto es público: la clave es
 * la publicable (`sb_publishable_…`), nunca la service_role ni una secreta.
 *
 * Los valores por defecto viven aquí y no en `app.json` → `extra` porque en la
 * exportación web `Constants.expoConfig.extra` llega vacío.
 */
const DEFAULT_SUPABASE_URL = 'https://jxynipwqucetmeayyupi.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_G1W1YqTg3YD66RvFvPMWng_Ny-HHFnD';

// Acceso literal a process.env.EXPO_PUBLIC_*: es lo que Metro sustituye al empaquetar.
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || DEFAULT_SUPABASE_KEY;

/**
 * Región en la que deben ejecutarse las Edge Functions (RGPD, revisión M3 de
 * `supabase/README.md`): el proyecto está en eu-west-3 (París).
 */
export const FUNCTIONS_REGION = 'eu-west-3';

if (/^sb_secret_/.test(SUPABASE_KEY)) {
  throw new Error('La app solo puede usar la clave publicable de Supabase, nunca una clave secreta.');
}
