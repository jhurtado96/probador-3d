import type { GarmentCategory, Job } from '@probador/contracts';
import { GARMENT_CATEGORIES } from '@probador/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { JobStatusCard } from '@/components/JobStatusCard';
import { PhotoPicker } from '@/components/PhotoPicker';
import { Screen } from '@/components/Screen';
import { Banner, Button, Card, Field, Loading, Muted } from '@/components/ui';
import { errorMessage } from '@/lib/apiErrors';
import { signedAssetUrl } from '@/lib/avatars';
import {
  CATEGORY_LABEL,
  GARMENT_STATUS_LABEL,
  addGarment,
  deleteGarment,
  fetchMyGarments,
  type GarmentRow,
} from '@/lib/garments';
import { useJob, type UploadStep } from '@/lib/jobs';
import { isTerminal } from '@/lib/jobStatus';
import { discardLocalFile, type LocalPhoto } from '@/lib/photo';
import { useAppTheme } from '@/theme/useAppTheme';

const STEP_LABEL: Record<UploadStep, string> = {
  creating: 'Creando la prenda…',
  uploading: 'Subiendo la foto…',
  dispatching: 'Enviando a procesar…',
};

function GarmentItem({ garment, onDelete }: { garment: GarmentRow; onDelete: () => void }) {
  const { colors } = useAppTheme();
  const [thumb, setThumb] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!garment.image_path) return;
    let active = true;
    signedAssetUrl(garment.image_path)
      .then((u) => active && setThumb(u))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [garment.image_path]);

  const statusColor =
    garment.status === 'ready' ? colors.success : garment.status === 'failed' ? colors.danger : colors.textMuted;

  return (
    <View style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={[styles.thumb, { backgroundColor: colors.surfaceMuted }]}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.thumbImg} resizeMode="cover" /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>
          {garment.name || (garment.category ? CATEGORY_LABEL[garment.category] : 'Prenda sin nombre')}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>
          {[garment.brand, garment.size_label ? `Talla ${garment.size_label}` : null].filter(Boolean).join(' · ') || '—'}
        </Text>
        <Text style={{ color: statusColor, fontSize: 13 }}>{GARMENT_STATUS_LABEL[garment.status]}</Text>
      </View>
      {confirm ? (
        <View style={{ gap: 6 }}>
          <Pressable accessibilityRole="button" onPress={onDelete}>
            <Text style={{ color: colors.danger, fontWeight: '600' }}>Borrar</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirm(false)}>
            <Text style={{ color: colors.textMuted }}>Cancelar</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Borrar prenda" onPress={() => setConfirm(true)}>
          <Text style={{ color: colors.textMuted }}>Quitar</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function ArmarioScreen() {
  const { colors } = useAppTheme();
  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [photo, setPhoto] = useState<LocalPhoto | null>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [category, setCategory] = useState<GarmentCategory | null>(null);
  const [step, setStep] = useState<UploadStep | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [initialJob, setInitialJob] = useState<Job | null>(null);
  const { job } = useJob(jobId, initialJob);

  const load = useCallback(async () => {
    try {
      setGarments(await fetchMyGarments());
      setListError(null);
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Al terminar el job, refrescar el estado de la prenda.
  const jobDone = job ? isTerminal(job.status) : false;
  useEffect(() => {
    if (jobDone) load();
  }, [jobDone, load]);

  const resetForm = () => {
    setName('');
    setBrand('');
    setSize('');
    setCategory(null);
    setPhoto(null);
  };

  const submit = async () => {
    if (!photo) return;
    setSubmitError(null);
    const localUri = photo.uri;
    try {
      const { job: created } = await addGarment(
        { name: name.slice(0, 80), brand, sizeLabel: size, categoryHint: category ?? undefined },
        localUri,
        setStep,
      );
      setInitialJob(created);
      setJobId(created.id);
      await discardLocalFile(localUri);
      resetForm();
      setAdding(false);
      load();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setStep(null);
    }
  };

  return (
    <Screen title="Tu armario" subtitle="Tus prendas digitalizadas para combinarlas sobre tu avatar.">
      {job ? <JobStatusCard job={job} title="Última prenda subida" /> : null}

      {adding ? (
        <Card title="Añadir prenda">
          <Banner tone="info">
            Fotografía la prenda sola (extendida o en una percha), sin personas. Si aparece alguien, la foto se rechaza y se
            borra.
          </Banner>
          <PhotoPicker photo={photo} onChange={setPhoto} disabled={!!step} previewAspect={1} />
          <Field label="Nombre (opcional)" value={name} onChangeText={setName} maxLength={80} placeholder="Camisa azul" />
          <Field label="Marca (opcional)" value={brand} onChangeText={setBrand} maxLength={80} />
          <Field label="Talla (opcional)" value={size} onChangeText={setSize} maxLength={32} placeholder="M, 40, 32/34…" />
          <Text style={{ color: colors.text, fontWeight: '600' }}>Tipo de prenda (opcional)</Text>
          <View style={styles.chips}>
            {GARMENT_CATEGORIES.map((c) => {
              const selected = category === c;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCategory(selected ? null : c)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.surface },
                  ]}
                >
                  <Text style={{ color: selected ? colors.onPrimary : colors.text, fontSize: 13 }}>{CATEGORY_LABEL[c]}</Text>
                </Pressable>
              );
            })}
          </View>
          {submitError ? <Banner tone="error">{submitError}</Banner> : null}
          <View style={styles.row}>
            <Button
              label="Cancelar"
              variant="secondary"
              disabled={!!step}
              onPress={async () => {
                if (photo) await discardLocalFile(photo.uri);
                resetForm();
                setAdding(false);
              }}
            />
            <Button label={step ? STEP_LABEL[step] : 'Subir prenda'} onPress={submit} loading={!!step} disabled={!photo} />
          </View>
          <Muted>La foto original se borra en cuanto se procesa; solo guardamos el recorte de la prenda.</Muted>
        </Card>
      ) : (
        <Button label="Añadir prenda" icon="add-circle-outline" onPress={() => setAdding(true)} />
      )}

      {loading ? <Loading label="Cargando tu armario…" /> : null}
      {listError ? <Banner tone="error">{listError}</Banner> : null}
      {!loading && !listError && garments.length === 0 ? (
        <EmptyState
          icon="shirt-outline"
          title="Tu armario está vacío"
          description="Todavía no has añadido ninguna prenda."
          hint="Sube una foto de una prenda y la convertiremos en una prenda 3D con su talla y medidas (el procesado aún no está disponible)."
        />
      ) : null}
      {garments.map((g) => (
        <GarmentItem
          key={g.id}
          garment={g}
          onDelete={() =>
            deleteGarment(g.id)
              .then(load)
              .catch((err) => setListError(errorMessage(err)))
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden' },
  thumbImg: { width: 56, height: 56 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
});
