/**
 * Almacenamiento de la sesión de Supabase en WEB: `localStorage` del navegador
 * (lo que usa supabase-js por defecto). Protegido para entornos sin `window`
 * (exportación estática).
 *
 * En iOS/Android Metro usa `sessionStorage.native.ts` (llavero / Keystore).
 */
export type SessionStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const sessionStorage: SessionStorage = {
  getItem: async (key) => store()?.getItem(key) ?? null,
  setItem: async (key, value) => {
    store()?.setItem(key, value);
  },
  removeItem: async (key) => {
    store()?.removeItem(key);
  },
};
