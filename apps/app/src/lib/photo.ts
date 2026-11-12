/**
 * Captura y preparación de fotos (cuerpo entero o prenda).
 *
 * Privacidad: la foto no se guarda en la galería ni en logs. Se elige o se hace
 * con expo-image-picker (sin EXIF), se reescala a 2048 px como máximo y se
 * vuelve a codificar en JPEG con expo-image-manipulator, lo que elimina
 * cualquier metadato (GPS, modelo del móvil…). Las copias temporales se borran
 * en cuanto la subida termina o el usuario descarta la foto.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { discardLocalFile } from './bytes';
import { resizeTarget } from './uploadPaths';

export type LocalPhoto = { uri: string; width: number; height: number };

export type PickResult = { photo: LocalPhoto } | { canceled: true } | { denied: 'camera' | 'library' };

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  allowsMultipleSelection: false,
  exif: false,
  base64: false,
  quality: 1,
};

export async function pickPhoto(source: 'camera' | 'library'): Promise<PickResult> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { denied: 'camera' };
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
  if (result.canceled || !result.assets?.[0]) return { canceled: true };
  const a = result.assets[0];
  return { photo: { uri: a.uri, width: a.width, height: a.height } };
}

/** Reescala (lado mayor ≤ 2048 px) y recodifica en JPEG sin metadatos. Borra la copia del selector. */
export async function preparePhoto(photo: LocalPhoto): Promise<LocalPhoto> {
  const ctx = ImageManipulator.manipulate(photo.uri);
  const target = resizeTarget(photo.width, photo.height);
  if (target) ctx.resize(target);
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.88 });
  if (saved.uri !== photo.uri) await discardLocalFile(photo.uri);
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

export { discardLocalFile };
