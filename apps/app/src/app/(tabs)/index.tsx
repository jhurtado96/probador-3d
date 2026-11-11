import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { MAX_HEIGHT_CM, MIN_HEIGHT_CM, validateHeightCm } from '@/lib/height';
import { useAppTheme } from '@/theme/useAppTheme';

type Step = { icon: ComponentProps<typeof Ionicons>['name']; title: string; body: string };

const STEPS: Step[] = [
  {
    icon: 'body-outline',
    title: 'Ponte en pose A',
    body: 'De pie, mirando a la cámara, piernas ligeramente separadas y brazos estirados y separados del cuerpo unos 30°.',
  },
  {
    icon: 'shirt-outline',
    title: 'Usa ropa ajustada',
    body: 'Ropa ceñida (o deportiva) y pelo recogido para que se vea bien la silueta. Evita abrigos, faldas amplias y prendas sueltas.',
  },
  {
    icon: 'scan-outline',
    title: 'Cuerpo entero en el encuadre',
    body: 'Que se vea de la cabeza a los pies, con buena luz y un fondo despejado. Coloca el móvil a la altura de la cintura, a unos 2–3 m.',
  },
  {
    icon: 'resize-outline',
    title: 'Introduce tu altura',
    body: 'Tu altura real nos da la escala para calcular el resto de medidas en centímetros.',
  },
];

export default function EscanearScreen() {
  const { colors } = useAppTheme();
  const [heightText, setHeightText] = useState('');
  const [touched, setTouched] = useState(false);
  const validation = validateHeightCm(heightText);
  const error = !validation.ok && touched ? validation.error : null;

  return (
    <Screen
      title="Escanear"
      subtitle="Crea tu avatar 3D con tus medidas reales a partir de una foto de cuerpo entero."
    >
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Guía de captura</Text>
        {STEPS.map((step, i) => (
          <View key={step.title} style={styles.step}>
            <View style={[styles.stepIcon, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name={step.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.stepText}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>
                {i + 1}. {step.title}
              </Text>
              <Text style={[styles.stepBody, { color: colors.textMuted }]}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text nativeID="height-label" style={[styles.cardTitle, { color: colors.text }]}>
          Tu altura (cm)
        </Text>
        <TextInput
          value={heightText}
          onChangeText={setHeightText}
          onBlur={() => setTouched(true)}
          onSubmitEditing={() => setTouched(true)}
          placeholder={`Entre ${MIN_HEIGHT_CM} y ${MAX_HEIGHT_CM}, p. ej. 172`}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={5}
          accessibilityLabelledBy="height-label"
          accessibilityHint="Escribe tu altura en centímetros"
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.background,
              borderColor: error ? colors.danger : colors.border,
            },
          ]}
        />
        {error ? (
          <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: colors.danger }]}>
            {error}
          </Text>
        ) : validation.ok ? (
          <Text style={[styles.feedback, { color: colors.success }]}>
            Altura válida: {validation.valueCm} cm.
          </Text>
        ) : null}
      </View>

      <View style={[styles.notice, { borderColor: colors.border }]}>
        <Ionicons name="camera-outline" size={20} color={colors.textMuted} />
        <Text style={[styles.noticeText, { color: colors.textMuted }]}>
          La captura con cámara aún no está disponible en esta versión. Cuando lo esté, la foto se
          procesará en servidores de la UE y se borrará en cuanto calculemos tus medidas.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 14 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 15, fontWeight: '600' },
  stepBody: { fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  feedback: { fontSize: 14 },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
