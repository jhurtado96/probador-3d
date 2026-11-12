import Ionicons from '@expo/vector-icons/Ionicons';
import type { Job } from '@probador/contracts';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Banner, Card, Muted } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { describeJob } from '@/lib/jobStatus';
import { useAppTheme } from '@/theme/useAppTheme';

/** Estado de un job: en cola / procesando (con barra) / listo / fallido, y qué pasó con la foto. */
export function JobStatusCard({ job, title = 'Estado del procesamiento' }: { job: Job; title?: string }) {
  const { colors } = useAppTheme();
  const view = describeJob(job);
  const tone =
    view.phase === 'failed'
      ? job.error?.code === 'not_implemented'
        ? 'warning'
        : 'error'
      : view.phase === 'succeeded'
        ? 'success'
        : 'info';

  return (
    <Card title={title}>
      <View style={styles.row}>
        {!view.terminal ? <ActivityIndicator color={colors.primary} /> : null}
        <Text style={[styles.phase, { color: colors.text }]}>{view.title}</Text>
      </View>
      {view.terminal ? (
        <Banner tone={tone}>{view.message}</Banner>
      ) : (
        <Text style={{ color: colors.textMuted }}>{view.message}</Text>
      )}
      {view.progress !== null && !view.terminal ? (
        <View
          style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(view.progress * 100) }}
        >
          <View style={[styles.bar, { backgroundColor: colors.primary, width: `${Math.round(view.progress * 100)}%` }]} />
        </View>
      ) : null}
      {view.photoNote ? (
        <View style={styles.row}>
          <Ionicons
            name={job.input_deleted_at ? 'trash-outline' : 'time-outline'}
            size={18}
            color={job.input_deleted_at ? colors.success : colors.textMuted}
          />
          <Text style={{ flex: 1, color: job.input_deleted_at ? colors.success : colors.textMuted }}>
            {view.photoNote}
          </Text>
        </View>
      ) : null}
      {view.retryable ? <Muted>Puedes volver a intentarlo con la misma foto o con otra.</Muted> : null}
      <Muted>Iniciado el {formatDateTime(job.created_at)}</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phase: { fontSize: 16, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
});
