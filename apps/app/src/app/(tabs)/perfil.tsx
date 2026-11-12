import { CONTRACTS_VERSION } from '@probador/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Banner, Body, Button, Card, Field, Loading, Muted } from '@/components/ui';
import { deleteMyAccount, exportMyData, type ExportSummary } from '@/lib/account';
import { errorMessage } from '@/lib/apiErrors';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { PURPOSE_INFO, PURPOSE_ORDER, useConsents } from '@/lib/useConsents';
import { useAppTheme } from '@/theme/useAppTheme';

const DELETE_WORD = 'BORRAR';

export default function PerfilScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const consents = useConsents();

  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportSummary | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const doExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      setExportResult(await exportMyData());
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount();
      router.replace('/login');
    } catch (err) {
      setDeleteError(errorMessage(err));
      setDeleting(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut().catch(() => supabase.auth.signOut({ scope: 'local' }));
    setSigningOut(false);
  };

  return (
    <Screen title="Perfil" subtitle="Tu cuenta, tus consentimientos y tus datos.">
      <Card title="Cuenta">
        <Body>{session?.user.email ?? 'Sin email'}</Body>
        <Muted>Cuenta creada el {formatDateTime(session?.user.created_at)}</Muted>
        <Button label="Cerrar sesión" icon="log-out-outline" variant="secondary" onPress={signOut} loading={signingOut} />
      </Card>

      <Card title="Consentimientos">
        {consents.loading ? <Loading /> : null}
        {consents.error ? <Banner tone="error">{errorMessage(consents.error)}</Banner> : null}
        {!consents.loading && !consents.error
          ? PURPOSE_ORDER.map((purpose) => {
              const c = consents.active[purpose];
              return (
                <View key={purpose} style={styles.consentRow}>
                  <View style={[styles.dot, { backgroundColor: c ? colors.success : colors.textMuted }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{PURPOSE_INFO[purpose].title}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                      {c ? `Aceptado el ${formatDateTime(c.granted_at)}` : 'No aceptado'}
                    </Text>
                  </View>
                </View>
              );
            })
          : null}
        <Button
          label="Ver, aceptar o retirar consentimientos"
          icon="shield-checkmark-outline"
          variant="secondary"
          onPress={() => router.push('/consentimientos')}
        />
      </Card>

      <Card title="Exportar mis datos">
        <Body>
          Descarga en un fichero JSON todo lo que guardamos sobre ti: cuenta, consentimientos, avatar y medidas, prendas,
          outfits y trabajos. Las fotos originales no se incluyen porque no se conservan.
        </Body>
        <Button label="Exportar mis datos" icon="download-outline" variant="secondary" onPress={doExport} loading={exporting} />
        {exportError ? <Banner tone="error">{exportError}</Banner> : null}
        {exportResult ? (
          <Banner tone="success" title={`Exportado: ${exportResult.fileName}`}>
            <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
              {exportResult.counts.map((c) => `${c.label}: ${c.value}`).join(' · ')}
              {'\n'}Los enlaces a tus ficheros 3D del JSON caducan el {formatDateTime(exportResult.expiresAt)}.
            </Text>
          </Banner>
        ) : null}
        <Muted>Máximo 5 exportaciones al día.</Muted>
      </Card>

      <Card title="Borrar mi cuenta">
        <Body>
          Borra tu cuenta y todos tus datos: avatar, medidas, prendas, outfits y ficheros. No se puede deshacer. Solo
          conservamos, seudonimizado y bloqueado durante 3 años, el registro de qué consentimientos diste (obligación
          legal).
        </Body>
        {!confirmingDelete ? (
          <Button label="Borrar mi cuenta" icon="trash-outline" variant="danger" onPress={() => setConfirmingDelete(true)} />
        ) : (
          <View style={styles.confirm}>
            <Field
              label={`Para confirmar, escribe ${DELETE_WORD}`}
              value={deleteWord}
              onChangeText={setDeleteWord}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={DELETE_WORD}
            />
            <View style={styles.row}>
              <Button
                label="Cancelar"
                variant="secondary"
                onPress={() => {
                  setConfirmingDelete(false);
                  setDeleteWord('');
                  setDeleteError(null);
                }}
                disabled={deleting}
              />
              <Button
                label="Borrar definitivamente"
                variant="danger"
                onPress={doDelete}
                loading={deleting}
                disabled={deleteWord.trim().toUpperCase() !== DELETE_WORD}
              />
            </View>
          </View>
        )}
        {deleteError ? <Banner tone="error">{deleteError}</Banner> : null}
      </Card>

      <Text style={[styles.footer, { color: colors.textMuted }]}>Contrato de datos v{CONTRACTS_VERSION}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  confirm: { gap: 10 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  footer: { fontSize: 12, textAlign: 'center' },
});
