/**
 * Mensajes en español para los errores de Supabase Auth (campo `code` de
 * AuthError). Sin dependencias: se prueba con `node --test`.
 */
export function authErrorMessage(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  switch (code) {
    case 'invalid_credentials':
      return 'Email o contraseña incorrectos.';
    case 'email_not_confirmed':
      return 'Todavía no has confirmado tu email. Abre el enlace del correo que te enviamos y vuelve a intentarlo.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Ya existe una cuenta con ese email. Inicia sesión.';
    case 'weak_password':
      return 'La contraseña es demasiado débil. Usa al menos 8 caracteres combinando letras y números.';
    case 'email_address_invalid':
    case 'validation_failed':
      return 'Revisa el email: no parece válido.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'El registro con email está desactivado en el servidor.';
    case 'email_address_not_authorized':
      return 'El servidor de correo de pruebas de Supabase no puede enviar a este email. Pide que se desactive la confirmación por email o se configure un SMTP propio.';
    default:
      break;
  }
  if (/fetch|network/i.test(message)) return 'No hay conexión con el servidor. Comprueba tu conexión a internet.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(email: string, password: string, mode: 'signIn' | 'signUp'): string | null {
  if (!EMAIL_RE.test(email.trim())) return 'Escribe un email válido.';
  if (mode === 'signUp' && password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (password.length === 0) return 'Escribe tu contraseña.';
  return null;
}
