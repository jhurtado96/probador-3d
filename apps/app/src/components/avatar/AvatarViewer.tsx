/**
 * Visor 3D del avatar — implementación WEB (WebGL del navegador).
 *
 * Metro resuelve `AvatarViewer.native.tsx` en iOS/Android y este fichero en web,
 * así que en el resto de la app basta con `import { AvatarViewer } from
 * '@/components/avatar/AvatarViewer'`. TypeScript toma los tipos de este fichero;
 * la versión nativa debe mantener la misma firma.
 */
import { Canvas } from '@react-three/fiber';

import { AvatarViewerShell, type AvatarViewerProps } from './AvatarViewerShell';
import { CAMERA, MannequinScene } from './MannequinScene';

export type { AvatarViewerProps };

export function AvatarViewer(props: AvatarViewerProps) {
  return (
    <AvatarViewerShell
      {...props}
      renderCanvas={({ rotationY, mannequinColor, background, model }) => (
        <Canvas
          camera={CAMERA}
          dpr={[1, 2]}
          style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
        >
          <color attach="background" args={[background]} />
          <MannequinScene rotationY={rotationY} color={mannequinColor} model={model} />
        </Canvas>
      )}
    />
  );
}
