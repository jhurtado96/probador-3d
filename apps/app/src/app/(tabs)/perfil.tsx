import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useAppTheme } from '@/theme/useAppTheme';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Medidas',
    body: 'Sin datos todavía. Se rellenarán con los valores calculados a partir de tu escaneo.',
  },
  {
    title: 'Fit preferido',
    body: 'Sin configurar. Podrás indicar si prefieres prendas ajustadas, regulares u holgadas.',
  },
  {
    title: 'Colorimetría',
    body: 'Sin analizar. Tu paleta de colores recomendada aparecerá aquí.',
  },
  {
    title: 'Privacidad y datos',
    body:
      'Las fotos de cuerpo y cara se borran tras procesarlas; solo guardamos los valores calculados, en servidores de la UE. Desde aquí podrás consultar tus consentimientos y borrar todos tus datos.',
  },
];

export default function PerfilScreen() {
  const { colors } = useAppTheme();
  return (
    <Screen title="Perfil" subtitle="Tus medidas, preferencias y privacidad.">
      {SECTIONS.map((s) => (
        <View
          key={s.title}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>{s.title}</Text>
          <Text style={[styles.cardBody, { color: colors.textMuted }]}>{s.body}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardBody: { fontSize: 14, lineHeight: 20 },
});
