/**
 * Errores de las Edge Functions (`ApiErrorBody` de `@probador/contracts`) y su
 * traducción para la interfaz. Sin dependencias de React Native: se prueba con
 * `node --test` (tests/apiErrors.test.ts).
 */
import type { ApiErrorBody, ApiErrorCode } from '@probador/contracts';

/** Códigos propios de la app para fallos que no llegan a ser respuesta de la API. */
export type ClientErrorCode = 'network' | 'unknown';

export class ApiError extends Error {
  // Sin «parameter properties»: el fichero se ejecuta con el strip-types de Node en los tests.
  readonly status: number;
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode | ClientErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * URL de una Edge Function con la región fijada por parámetro
 * (`forceFunctionRegion`). Se usa el parámetro y no la cabecera `x-region`
 * porque las funciones no la admiten en CORS (`docs/integration-issues.md`).
 */
export function functionUrl(baseUrl: string, name: string, region: string): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/functions/v1/${name.replace(/^\/+/, '')}`);
  if (region && region !== 'any') url.searchParams.set('forceFunctionRegion', region);
  return url.toString();
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  const error = (value as { error?: unknown } | null)?.error as { code?: unknown } | undefined;
  return typeof error === 'object' && error !== null && typeof error.code === 'string';
}

/** Convierte una respuesta de error (status + texto del cuerpo) en `ApiError`. */
export function parseApiError(status: number, bodyText: string): ApiError {
  let parsed: unknown = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }
  if (isApiErrorBody(parsed)) {
    return new ApiError(status, parsed.error.code, parsed.error.message, parsed.error.details);
  }
  // Respuestas de la pasarela de Supabase (p. ej. 401 por JWT caducado) no siguen ApiErrorBody.
  if (status === 401) return new ApiError(status, 'unauthorized', 'unauthorized');
  return new ApiError(status, 'unknown', `HTTP ${status}`);
}

const MESSAGES: Record<ApiErrorCode | ClientErrorCode, string> = {
  invalid_json: 'La app envió una petición mal formada. Actualiza la app e inténtalo de nuevo.',
  invalid_input: 'Algún dato no es válido. Revisa la altura, el peso y la foto.',
  unauthorized: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  invalid_signature: 'La petición no se pudo verificar.',
  consent_missing: 'Necesitamos tu consentimiento antes de procesar la foto.',
  quota_exceeded: 'Has alcanzado el límite diario. Inténtalo de nuevo mañana.',
  not_found: 'No se ha encontrado lo que buscabas.',
  conflict: 'Esta acción ya no se puede hacer (el elemento cambió de estado).',
  method_not_allowed: 'La app hizo una petición no admitida. Actualiza la app.',
  invalid_callback: 'Error interno del procesamiento.',
  fake_not_allowed: 'Error interno del procesamiento.',
  input_deletion_failed: 'No se pudo confirmar el borrado de la foto. Lo reintentaremos automáticamente.',
  confirmation_required: 'Falta confirmar la acción.',
  storage_not_empty: 'No se pudieron borrar todos tus ficheros. Vuelve a intentarlo.',
  auth_delete_failed: 'No se pudo borrar la cuenta. Vuelve a intentarlo.',
  scans_paused:
    'El procesamiento de fotos está en pausa por una revisión de privacidad. Inténtalo más tarde.',
  internal: 'Ha fallado algo en el servidor. Inténtalo de nuevo en unos minutos.',
  network: 'No hay conexión con el servidor. Comprueba tu conexión a internet.',
  unknown: 'Ha ocurrido un error inesperado. Inténtalo de nuevo.',
};

export function apiErrorMessage(code: ApiErrorCode | ClientErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.unknown;
}

/** Mensaje legible para cualquier error capturado en la interfaz. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return apiErrorMessage(err.code);
  const e = err as { code?: unknown; message?: unknown; name?: unknown } | null;
  const msg = typeof e?.message === 'string' ? e.message : '';
  if (/failed to fetch|network request failed|networkerror/i.test(msg)) return MESSAGES.network;
  // Errores de supabase-js (PostgREST, Storage, Auth): mensaje técnico en inglés → genérico.
  if (e && (typeof e.code === 'string' || /^(Postgrest|Storage|Auth)/.test(String(e.name ?? '')))) {
    if (e.code === 'PGRST301' || /JWT/i.test(msg)) return MESSAGES.unauthorized;
    return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }
  // Errores propios de la app: ya vienen en español.
  if (err instanceof Error && msg) return msg;
  return MESSAGES.unknown;
}
