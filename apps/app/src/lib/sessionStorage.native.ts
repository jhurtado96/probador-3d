/**
 * Almacenamiento de la sesión de Supabase en iOS/Android: el almacén seguro del
 * sistema (Keychain / Keystore) con `expo-secure-store`, como pide
 * `docs/architecture.md` §4 («la sesión se guarda en el almacén seguro del
 * sistema en nativo»).
 *
 * SecureStore no admite valores de más de 2048 bytes y una sesión de Supabase
 * los supera, así que el valor se parte en trozos (`<clave>.0`, `<clave>.1`…)
 * y `<clave>.n` guarda cuántos hay. Es la alternativa sin dependencias extra a
 * la `LargeSecureStore` (AES + AsyncStorage) de la guía de Supabase para Expo.
 */
import * as SecureStore from 'expo-secure-store';

import { joinChunks, splitIntoChunks } from './chunks';
import type { SessionStorage } from './sessionStorage';

export type { SessionStorage };

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** SecureStore solo admite claves con [A-Za-z0-9._-]. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(`${key}.n`, OPTIONS);
  const n = raw ? Number(raw) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

async function removeChunks(key: string, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i++) await SecureStore.deleteItemAsync(`${key}.${i}`, OPTIONS);
}

export const sessionStorage: SessionStorage = {
  async getItem(rawKey) {
    const key = safeKey(rawKey);
    const n = await readCount(key);
    if (n === 0) return null;
    const parts: (string | null)[] = [];
    for (let i = 0; i < n; i++) parts.push(await SecureStore.getItemAsync(`${key}.${i}`, OPTIONS));
    return joinChunks(parts);
  },
  async setItem(rawKey, value) {
    const key = safeKey(rawKey);
    const previous = await readCount(key);
    const chunks = splitIntoChunks(value);
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, chunks[i], OPTIONS);
    }
    await SecureStore.setItemAsync(`${key}.n`, String(chunks.length), OPTIONS);
    await removeChunks(key, chunks.length, previous);
  },
  async removeItem(rawKey) {
    const key = safeKey(rawKey);
    const n = await readCount(key);
    await SecureStore.deleteItemAsync(`${key}.n`, OPTIONS);
    await removeChunks(key, 0, n);
  },
};
