import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/useAppTheme';

type Props = {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  /** Qué hará posible esta sección cuando esté lista. */
  hint?: string;
};

/** Estado vacío: explica qué aparecerá aquí y qué necesita la persona usuaria. */
export function EmptyState({ icon, title, description, hint }: Props) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessible
      accessibilityLabel={`${title}. ${description}`}
    >
      <Ionicons name={icon} size={40} color={colors.textMuted} />
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.textMuted }]}>{description}</Text>
      {hint ? (
        <Text style={[styles.hint, { color: colors.textMuted, borderColor: colors.border }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: 8,
    padding: 24,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  description: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  hint: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
