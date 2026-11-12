/**
 * Descarga y parsea el GLB del avatar (URL firmada temporal) para web y nativo.
 *
 * Se descarga con `expo/fetch` (devuelve ArrayBuffer también en iOS/Android) y
 * se parsea con `GLTFLoader.parse`, sin `useLoader`/`FileLoader`, que en nativo
 * dependen de XHR. Limitación conocida: las texturas embebidas en el GLB pueden
 * no cargar en nativo; el avatar del MVP usa material neutro (sin textura).
 */
import { fetch } from 'expo/fetch';
import { useEffect, useState } from 'react';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type GlbState =
  | { status: 'idle'; model: null }
  | { status: 'loading'; model: null }
  | { status: 'ready'; model: Object3D }
  | { status: 'error'; model: null };

export function useGlbModel(url: string | null | undefined): GlbState {
  const [state, setState] = useState<GlbState>({ status: 'idle', model: null });

  useEffect(() => {
    if (!url) {
      setState({ status: 'idle', model: null });
      return;
    }
    let active = true;
    setState({ status: 'loading', model: null });
    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GLB HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      if (active) setState({ status: 'ready', model: gltf.scene });
    })().catch(() => {
      if (active) setState({ status: 'error', model: null });
    });
    return () => {
      active = false;
    };
  }, [url]);

  return state;
}
