import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/theme/useAppTheme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Tarjeta con título opcional. */
export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {title ? <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', icon, disabled, loading, accessibilityHint }: ButtonProps) {
  const { colors } = useAppTheme();
  const inactive = disabled || loading;
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.surface;
  const fg = variant === 'secondary' ? colors.text : colors.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? colors.border : bg,
          opacity: inactive ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={fg} />
      ) : null}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

type BannerTone = 'info' | 'success' | 'error' | 'warning';

/** Mensaje destacado (estado de error, éxito o aviso). */
export function Banner({ tone = 'info', title, children }: { tone?: BannerTone; title?: string; children?: ReactNode }) {
  const { colors } = useAppTheme();
  const color =
    tone === 'error' ? colors.danger : tone === 'success' ? colors.success : tone === 'warning' ? '#B26A00' : colors.primary;
  const icon: IconName =
    tone === 'error'
      ? 'alert-circle-outline'
      : tone === 'success'
        ? 'checkmark-circle-outline'
        : tone === 'warning'
          ? 'warning-outline'
          : 'information-circle-outline';
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { borderColor: color, backgroundColor: colors.surface }]}
    >
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.bannerBody}>
        {title ? <Text style={[styles.bannerTitle, { color: colors.text }]}>{title}</Text> : null}
        {typeof children === 'string' ? (
          <Text style={[styles.bannerText, { color: colors.textMuted }]}>{children}</Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.muted, { color: colors.textMuted }]}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.body, { color: colors.text }]}>{children}</Text>;
}

export function Field({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | null }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        {...input}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.background, borderColor: error ? colors.danger : colors.border },
        ]}
      />
      {error ? <Text style={[styles.fieldError, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 46,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  banner: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerBody: { flex: 1, gap: 4 },
  bannerTitle: { fontSize: 15, fontWeight: '600' },
  bannerText: { fontSize: 14, lineHeight: 20 },
  muted: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 21 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  fieldError: { fontSize: 14 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
});
