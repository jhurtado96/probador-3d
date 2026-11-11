import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme/useAppTheme';

import { useDragRotation } from './useDragRotation';

export type AvatarViewerProps = {
  /** Alto del visor en px. Por defecto 420. */
  height?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Marco común del visor (tamaño, fondo, gesto de giro, ayuda y botón de
 * reinicio). Cada plataforma solo aporta su <Canvas>.
 */
export function AvatarViewerShell({
  height = 420,
  style,
  renderCanvas,
}: AvatarViewerProps & {
  renderCanvas: (args: { rotationY: number; mannequinColor: string; background: string }) => ReactNode;
}) {
  const { colors } = useAppTheme();
  const { rotationY, panHandlers, reset } = useDragRotation(0);

  return (
    <View
      style={[styles.frame, { height, backgroundColor: colors.canvas, borderColor: colors.border }, style]}
      accessibilityLabel="Visor 3D del maniquí. Arrastra horizontalmente para girarlo."
    >
      <View style={styles.fill} {...panHandlers}>
        {renderCanvas({ rotationY, mannequinColor: colors.mannequin, background: colors.canvas })}
      </View>
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
