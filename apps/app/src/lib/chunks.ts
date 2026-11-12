/**
 * Trocea un texto para guardarlo en SecureStore (máximo 2048 bytes por valor).
 * 600 caracteres UTF-16 ocupan como mucho 1800 bytes en UTF-8. No parte un par
 * suplente (emoji) entre dos trozos.
 */
export const CHUNK_CHARS = 600;

export function splitIntoChunks(value: string, size = CHUNK_CHARS): string[] {
  if (value === '') return [''];
  const chunks: string[] = [];
  let i = 0;
  while (i < value.length) {
    let end = Math.min(i + size, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(value.slice(i, end));
    i = end;
  }
  return chunks;
}

/** Une los trozos; si falta alguno, la sesión está corrupta y se descarta (null). */
export function joinChunks(parts: (string | null)[]): string | null {
  if (parts.length === 0 || parts.some((p) => p === null)) return null;
  return parts.join('');
}
