/** Lee un fichero local (URI de blob/data en web) como ArrayBuffer. Nativo: `bytes.native.ts`. */
export async function readBytes(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  return res.arrayBuffer();
}

/** En web el fichero vive en memoria (blob:); se libera la URL si es de objeto. */
export async function discardLocalFile(uri: string): Promise<void> {
  if (uri.startsWith('blob:') && typeof URL !== 'undefined' && 'revokeObjectURL' in URL) {
    try {
      URL.revokeObjectURL(uri);
    } catch {
      // nada que liberar
    }
  }
}
