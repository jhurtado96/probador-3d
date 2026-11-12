import Ionicons from '@expo/vector-icons/Ionicons';
import type { BodyMeasurements, Job } from '@probador/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AvatarViewer } from '@/components/avatar/AvatarViewer';
import { JobStatusCard } from '@/components/JobStatusCard';
import { PhotoPicker } from '@/components/PhotoPicker';
import { Screen } from '@/components/Screen';
import { Banner, Body, Button, Card, Field, Loading, Muted } from '@/components/ui';
import { errorMessage } from '@/lib/apiErrors';
import { effectiveMeasurements, fetchAvatar, fetchLatestAvatar, signedAssetUrl, type AvatarRow } from '@/lib/avatars';
import { MAX_HEIGHT_CM, MIN_HEIGHT_CM, validateHeightCm, validateWeightKg } from '@/lib/height';
import { createAvatarJob, fetchLatestJob, useJob, type UploadStep } from '@/lib/jobs';
import { isTerminal } from '@/lib/jobStatus';
import { discardLocalFile, type LocalPhoto } from '@/lib/photo';
import { requireUserId } from '@/lib/supabase';
import { rawUploadPath } from '@/lib/uploadPaths';
import { useConsents } from '@/lib/useConsents';
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

const STEP_LABEL: Record<UploadStep, string> = {
  creating: 'Preparando el trabajo…',
  uploading: 'Subiendo la foto cifrada…',
  dispatching: 'Enviando a procesar…',
};

const MEASUREMENT_LABELS: [keyof BodyMeasurements, string][] = [
  ['height_cm', 'Altura'],
  ['chest_cm', 'Pecho'],
  ['waist_cm', 'Cintura'],
  ['hip_cm', 'Cadera'],
  ['shoulder_width_cm', 'Hombros'],
  ['arm_length_cm', 'Brazo'],
  ['inseam_cm', 'Entrepierna'],
];

export default function EscanearScreen() {
  const { colors } = useAppTheme();
  const consents = useConsents();
  const bodyConsent = consents.active.body_scan;

  const [avatar, setAvatar] = useState<AvatarRow | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [initialJob, setInitialJob] = useState<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJob(jobId, initialJob);

  const [photo, setPhoto] = useState<LocalPhoto | null>(null);
  const [heightText, setHeightText] = useState('');
  const [weightText, setWeightText] = useState('');
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<UploadStep | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const height = validateHeightCm(heightText);
  const weight = validateWeightKg(weightText);
  const heightError = !height.ok && (touched || heightText !== '') ? height.error : null;
  const weightError = !weight.ok ? weight.error : null;

  const showAvatar = useCallback(async (row: AvatarRow | null) => {
    setAvatar(row);
    setGlbUrl(null);
    setAvatarError(null);
    if (!row) return;
    try {
      setGlbUrl(await signedAssetUrl(row.glb_path));
    } catch (err) {
      setAvatarError(errorMessage(err));
    }
  }, []);

  // Al entrar: último avatar y último job de avatar (para retomar uno en curso).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const [latestAvatar, latestJob] = await Promise.all([fetchLatestAvatar(), fetchLatestJob('avatar')]);
          if (!active) return;
          await showAvatar(latestAvatar);
          if (latestJob) {
            setInitialJob(latestJob);
            setJobId((current) => current ?? latestJob.id);
          }
        } catch (err) {
          if (active) setAvatarError(errorMessage(err));
        }
      })();
      return () => {
        active = false;
      };
    }, [showAvatar]),
  );

  // Cuando el job termina con avatar, se carga en el visor.
  const finishedAvatarId =
    job?.status === 'succeeded' && job.type === 'avatar' && job.output && 'avatar_id' in job.output
      ? job.output.avatar_id
      : null;
  useEffect(() => {
    if (!finishedAvatarId || avatar?.id === finishedAvatarId) return;
    fetchAvatar(finishedAvatarId)
      .then(showAvatar)
      .catch((err) => setAvatarError(errorMessage(err)));
  }, [finishedAvatarId, avatar?.id, showAvatar]);

  const jobInProgress = !!job && !isTerminal(job.status);
  const canSubmit = !!bodyConsent && !!photo && height.ok && weight.ok && !step && !jobInProgress;

  const submit = async () => {
    setTouched(true);
    setSubmitError(null);
    if (!bodyConsent || !photo || !height.ok || !weight.ok) return;
    const localUri = photo.uri;
    try {
      const userId = await requireUserId();
      const created = await createAvatarJob(
        {
          photo_path: rawUploadPath(userId, 'jpg'),
          height_cm: height.valueCm,
          ...(weight.valueKg !== undefined ? { weight_kg: weight.valueKg } : {}),
          consent_id: bodyConsent.id,
        },
        localUri,
        setStep,
      );
      setInitialJob(created);
      setJobId(created.id);
      // La foto ya está en el servidor (y se borrará allí al procesarla): fuera la copia local.
      await discardLocalFile(localUri);
      setPhoto(null);
    } catch (err) {
      setSubmitError(errorMessage(err));
      if ((err as { code?: string }).code === 'consent_missing') consents.reload();
    } finally {
      setStep(null);
    }
  };

  const measurements = avatar ? effectiveMeasurements(avatar) : null;
  const fakeOrUnmeasured = avatar && (avatar.model_version.startsWith('fake/') || avatar.measurements_source === 'unmeasured');

  return (
    <Screen
      title="Escanear"
      subtitle="Crea tu avatar 3D con tus medidas reales a partir de una foto de cuerpo entero."
    >
      <AvatarViewer height={380} glbUrl={glbUrl} />
      {avatar ? (
        <Card title="Tus medidas">
          {fakeOrUnmeasured ? (
            <Banner tone="warning">Estas medidas son de prueba y no se usan para recomendar tallas.</Banner>
          ) : null}
          <View style={styles.measures}>
            {MEASUREMENT_LABELS.map(([key, label]) =>
              measurements && typeof measurements[key] === 'number' ? (
                <View key={key} style={[styles.measure, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
                    {Math.round(measurements[key] as number)} cm
                  </Text>
                </View>
              ) : null,
            )}
          </View>
        </Card>
      ) : (
        <Muted>Aún no tienes avatar: el visor muestra un maniquí de ejemplo.</Muted>
      )}
      {avatarError ? <Banner tone="error">{avatarError}</Banner> : null}

      {job ? <JobStatusCard job={job} title="Tu último escaneo" /> : null}

      {consents.loading ? (
        <Loading label="Comprobando tus consentimientos…" />
      ) : consents.error ? (
        <Banner tone="error" title="No se pudieron comprobar tus consentimientos">
          {errorMessage(consents.error)}
        </Banner>
      ) : !bodyConsent ? (
        <Card title="Antes de escanear">
          <Body>
            Para procesar una foto de tu cuerpo necesitamos tu consentimiento expreso. Léelo y acéptalo: puedes retirarlo
            cuando quieras desde Perfil.
          </Body>
          <Button
            label="Leer y aceptar el consentimiento"
            icon="shield-checkmark-outline"
            onPress={() => router.push('/consentimientos')}
          />
        </Card>
      ) : null}

      <Card title="Guía de captura">
        {STEPS.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <View style={[styles.stepIcon, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name={s.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.stepText}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>
                {i + 1}. {s.title}
              </Text>
              <Text style={[styles.stepBody, { color: colors.textMuted }]}>{s.body}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card title="Tu foto de cuerpo entero">
        <PhotoPicker photo={photo} onChange={setPhoto} disabled={!!step} previewAspect={4 / 3} />
      </Card>

      <Card title="Tus datos">
        <Field
          label="Altura (cm) *"
          value={heightText}
          onChangeText={setHeightText}
          onBlur={() => setTouched(true)}
          placeholder={`Entre ${MIN_HEIGHT_CM} y ${MAX_HEIGHT_CM}, p. ej. 172`}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={5}
          error={heightError}
        />
        <Field
          label="Peso (kg, opcional)"
          value={weightText}
          onChangeText={setWeightText}
          placeholder="Mejora la estimación de la forma, p. ej. 68"
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={5}
          error={weightError}
        />
      </Card>

      <View style={[styles.notice, { borderColor: colors.border }]}>
        <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
        <Text style={[styles.noticeText, { color: colors.textMuted }]}>
          La foto viaja cifrada a servidores de la UE, solo se usa para calcular tu avatar y se borra en cuanto termina
          el procesamiento (como máximo en una hora). No se guarda en tu galería y la copia temporal de este dispositivo
          se elimina al subirla.
        </Text>
      </View>

      {submitError ? <Banner tone="error">{submitError}</Banner> : null}
      {jobInProgress ? <Muted>Espera a que termine el escaneo en curso para empezar otro.</Muted> : null}
      <Button
        label={step ? STEP_LABEL[step] : 'Crear mi avatar'}
        icon="sparkles-outline"
        onPress={submit}
        loading={!!step}
        disabled={!canSubmit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 15, fontWeight: '600' },
  stepBody: { fontSize: 14, lineHeight: 20 },
  measures: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  measure: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, minWidth: 96 },
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
