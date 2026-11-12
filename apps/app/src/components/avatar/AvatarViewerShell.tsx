import type { ReactNode } from 'react';
import type { Object3D } from 'three';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme/useAppTheme';

import { useDragRotation } from './useDragRotation';
import { useGlbModel } from './useGlbModel';

export type AvatarViewerProps = {
  /** Alto del visor en px. Por defecto 420. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * URL (firmada, temporal) del GLB del avatar: metros, Y arriba, pies en el
   * origen. Sin URL, o si no se puede cargar, se muestra el maniquí.
   */
  glbUrl?: string | null;
};

export type RenderCanvasArgs = {
  rotationY: number;
  mannequinColor: string;
  background: string;
  /** Escena del GLB ya cargada; null = maniquí. */
  model: Object3D | null;
};

/**
 * Marco común del visor (tamaño, fondo, gesto de giro, ayuda y botón de
 * reinicio). Cada plataforma solo aporta su <Canvas>.
 */
export function AvatarViewerShell({
  height = 420,
  style,
  glbUrl,
  renderCanvas,
}: AvatarViewerProps & {
  renderCanvas: (args: RenderCanvasArgs) => ReactNode;
}) {
  const { colors } = useAppTheme();
  const { rotationY, panHandlers, reset } = useDragRotation(0);
  const glb = useGlbModel(glbUrl);
  const label =
    glb.status === 'ready'
      ? 'Visor 3D de tu avatar. Arrastra horizontalmente para girarlo.'
      : 'Visor 3D del maniquí. Arrastra horizontalmente para girarlo.';

  return (
    <View
      style={[styles.frame, { height, backgroundColor: colors.canvas, borderColor: colors.border }, style]}
      accessibilityLabel={label}
    >
      <View style={styles.fill} {...panHandlers}>
        {renderCanvas({ rotationY, mannequinColor: colors.mannequin, background: colors.canvas, model: glb.model })}
      </View>
      {glb.status === 'loading' || glb.status === 'error' ? (
        <View style={styles.status} pointerEvents="none">
          {glb.status === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {glb.status === 'loading' ? 'Cargando tu avatar…' : 'No se pudo cargar tu avatar; se muestra el maniquí.'}
          </Text>
        </View>
      ) : null}
      <View style={styles.footer} pointerEvents="box-none">
        <Text style={[styles.hint, { color: colors.textMuted }]}>Arrastra para girar</Text>
        <Pressable
          onPress={reset}
          accessibilityRole="button"
          accessibilityLabel="Restablecer la vista"
          style={({ pressed }) => [
            styles.reset,
            { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontSize: 13 }}>Restablecer</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fill: { flex: 1 },
  status: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footer: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: { fontSize: 13 },
  reset: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
