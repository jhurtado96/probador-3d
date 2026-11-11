import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/useAppTheme';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Desactiva el scroll (por ejemplo, si la pantalla contiene un lienzo 3D que usa gestos). */
  scroll?: boolean;
};

/** Contenedor común de pantalla con título, subtítulo y ancho máximo en web. */
export function Screen({ title, subtitle, children, scroll = true }: Props) {
  const { colors } = useAppTheme();
  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      ) : null}
    </View>
  );

  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <View style={[styles.content, styles.flex]}>
          {header}
          {children}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: 16,
    gap: 16,
  },
  header: { gap: 4 },
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 21 },
});
