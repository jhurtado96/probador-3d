/**
 * Rutas de subida a `raw-uploads` y parseo de los tickets de `create-job`.
 * Sin dependencias de React Native: se prueba con `node --test`.
 *
 * El backend (`supabase/functions/_shared/storage.ts`) solo acepta
 * `raw-uploads/<user_id>/<nombre>.<jpg|jpeg|png|webp>` con un nombre de
 * 1–100 caracteres `[A-Za-z0-9_-]`.
 */
export const RAW_BUCKET = 'raw-uploads';
export const ASSETS_BUCKET = 'assets';

const NAME_RE = /^[A-Za-z0-9_-]{1,100}\.(jpe?g|png|webp)$/;

/** Identificador aleatorio de 32 hex (no hace falta que sea un UUID formal). */
export function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView>(a: T) => T } }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function rawUploadPath(userId: string, ext: 'jpg' | 'png' | 'webp' = 'jpg', id = randomId()): string {
  const name = `${id}.${ext}`;
  if (!NAME_RE.test(name)) throw new Error('nombre de fichero no válido');
  return `${RAW_BUCKET}/${userId}/${name}`;
}

export function isOwnRawUploadPath(path: string, userId: string): boolean {
  const prefix = `${RAW_BUCKET}/${userId}/`;
  return path.startsWith(prefix) && NAME_RE.test(path.slice(prefix.length));
}

/** `bucket/resto` → { bucket, name } (las rutas del contrato llevan el bucket delante). */
export function splitStoragePath(path: string): { bucket: string; name: string } {
  const i = path.indexOf('/');
  if (i <= 0 || i === path.length - 1) throw new Error(`ruta de Storage no válida: ${path}`);
  return { bucket: path.slice(0, i), name: path.slice(i + 1) };
}

/** Tipo MIME según la extensión de la ruta. */
export function contentTypeFor(path: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}

/** Lado mayor máximo de la foto que se sube (docs/architecture.md §3.4). */
export const MAX_PHOTO_SIDE = 2048;

/** Tamaño de reescalado para que el lado mayor no pase de `max`; null si no hace falta. */
export function resizeTarget(width: number, height: number, max = MAX_PHOTO_SIDE): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0)) return { width: max };
  if (Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}
