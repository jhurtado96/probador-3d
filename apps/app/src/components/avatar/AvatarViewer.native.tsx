/**
 * Visor 3D del avatar — implementación NATIVA (iOS/Android) con
 * `@react-three/fiber/native`, que dibuja sobre un GLView de expo-gl.
 *
 * Debe mantener la misma firma que `AvatarViewer.tsx` (web).
 */
import { Canvas } from '@react-three/fiber/native';

import { AvatarViewerShell, type AvatarViewerProps } from './AvatarViewerShell';
import { CAMERA, MannequinScene } from './MannequinScene';

export type { AvatarViewerProps };

export function AvatarViewer(props: AvatarViewerProps) {
  return (
    <AvatarViewerShell
      {...props}
      renderCanvas={({ rotationY, mannequinColor, background, model }) => (
        <Canvas camera={CAMERA} style={{ flex: 1 }}>
          <color attach="background" args={[background]} />
          <MannequinScene rotationY={rotationY} color={mannequinColor} model={model} />
        </Canvas>
      )}
    />
  );
}
