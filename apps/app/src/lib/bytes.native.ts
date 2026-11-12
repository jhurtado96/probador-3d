import { File } from 'expo-file-system';

/** Lee un fichero local (file://) como ArrayBuffer. */
export async function readBytes(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/**
 * Borra la copia temporal de la foto (caché de la app). Solo se borran
 * ficheros de la caché propia, nunca un original de la galería.
 */
export async function discardLocalFile(uri: string): Promise<void> {
  try {
    if (!uri.startsWith('file://') || !/\/(Caches?|cache)\//.test(uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // si no se puede borrar, el sistema limpia la caché
  }
}
