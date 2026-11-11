import { StyleSheet, Text } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { AvatarViewer } from '@/components/avatar/AvatarViewer';
import { useAppTheme } from '@/theme/useAppTheme';

export default function OutfitsScreen() {
  const { colors } = useAppTheme();
  return (
    <Screen
      title="Outfits"
      subtitle="Combina prendas de tu armario sobre tu avatar y guarda tus looks."
    >
      <AvatarViewer height={420} />
      <Text style={[styles.note, { color: colors.textMuted }]}>
        Maniquí de referencia. Cuando completes el escaneo, aquí verás tu avatar 3D con tus
        medidas reales.
      </Text>
      <EmptyState
        icon="layers-outline"
        title="Sin outfits guardados"
        description="Añade prendas a tu armario para poder combinarlas y guardar outfits."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 18 },
});
