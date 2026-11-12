import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * iOS/Android: escribe el JSON en la caché y abre el menú de compartir del
 * sistema para guardarlo donde quiera la persona (Archivos, Drive, correo…).
 * La copia de la caché se borra después.
 */
export async function saveExportFile(fileName: string, json: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(json);
  try {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Este dispositivo no permite compartir ficheros.');
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Guardar mis datos',
      UTI: 'public.json',
    });
  } finally {
    try {
      file.delete();
    } catch {
      // la caché la limpia el sistema
    }
  }
}
