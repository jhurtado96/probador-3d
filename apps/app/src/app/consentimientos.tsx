import type { ConsentPurpose } from '@probador/contracts';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Banner, Body, Button, Card, Loading, Muted } from '@/components/ui';
import { errorMessage } from '@/lib/apiErrors';
import { confirmAge, grantConsent, withdrawConsent } from '@/lib/consents';
import { formatDateTime } from '@/lib/format';
import { PHOTO_PURPOSES, PURPOSE_INFO, PURPOSE_ORDER, useConsents } from '@/lib/useConsents';
import { useAppTheme } from '@/theme/useAppTheme';

/**
 * Consentimientos (RGPD). Muestra el texto vigente de cada tratamiento tal como
 * está publicado en `consent_texts` y permite aceptarlo o retirarlo. La fecha y
 * la versión las fija el servidor; la app envía la versión que mostró para
 * que, si el texto cambió mientras tanto, el servidor lo rechace.
 */
export default function ConsentimientosScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { texts, active, profile, loading, error, reload } = useConsents();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState<ConsentPurpose | null>(null);

  if (!session) return <Redirect href="/login" />;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const ageConfirmed = !!profile?.age_confirmed_at;

  return (
    <Screen
      title="Tus consentimientos"
      subtitle="Cada tratamiento de datos necesita tu permiso expreso. Puedes retirarlo cuando quieras."
    >
      {loading ? <Loading /> : null}
      {error ? (
        <Banner tone="error" title="No se pudieron cargar los textos">
          {errorMessage(error)}
        </Banner>
      ) : null}
      {actionError ? <Banner tone="error">{actionError}</Banner> : null}

      {!loading && !error ? (
        <Card title="Mayoría de edad">
          {ageConfirmed ? (
            <Muted>Declaraste ser mayor de edad el {formatDateTime(profile?.age_confirmed_at)}.</Muted>
          ) : (
            <>
              <Body>
                Para procesar fotos de tu cuerpo o de tu cara tienes que ser mayor de edad (18 años o más). No guardamos
                tu fecha de nacimiento, solo cuándo lo declaraste.
              </Body>
              <Button
                label="Confirmo que soy mayor de edad"
                icon="checkmark-outline"
                variant="secondary"
                loading={busy === 'age'}
                onPress={() => run('age', () => confirmAge(session.user.id))}
              />
            </>
          )}
        </Card>
      ) : null}

      {!loading && !error
        ? PURPOSE_ORDER.map((purpose) => {
            const text = texts[purpose];
            const consent = active[purpose];
            const info = PURPOSE_INFO[purpose];
            const needsAge = PHOTO_PURPOSES.includes(purpose) && !ageConfirmed;
            return (
              <Card key={purpose} title={info.title}>
                <View style={styles.statusRow}>
                  <View
                    style={[styles.dot, { backgroundColor: consent ? colors.success : colors.textMuted }]}
                  />
                  <Text style={{ color: colors.text, flex: 1 }}>
                    {consent ? `Aceptado el ${formatDateTime(consent.granted_at)}` : 'No aceptado'}
                  </Text>
                </View>
                {text ? (
                  <>
                    <Text style={[styles.legal, { color: colors.text, borderColor: colors.border }]}>{text.body}</Text>
                    <Muted>Versión del texto: {text.version}</Muted>
                  </>
                ) : (
                  <Muted>No hay texto publicado para este tratamiento.</Muted>
                )}
                {consent ? (
                  confirmWithdraw === purpose ? (
                    <View style={styles.confirm}>
                      <Banner tone="warning" title="¿Retirar el consentimiento?">
                        {info.onWithdraw}
                      </Banner>
                      <View style={styles.row}>
                        <Button label="Cancelar" variant="secondary" onPress={() => setConfirmWithdraw(null)} />
                        <Button
                          label="Sí, retirarlo"
                          variant="danger"
                          loading={busy === purpose}
                          onPress={() =>
                            run(purpose, async () => {
                              await withdrawConsent(consent.id);
                              setConfirmWithdraw(null);
                            })
                          }
                        />
                      </View>
                    </View>
                  ) : (
                    <Button
                      label="Retirar consentimiento"
                      variant="secondary"
                      icon="close-circle-outline"
                      onPress={() => setConfirmWithdraw(purpose)}
                    />
                  )
                ) : text ? (
                  <>
                    {needsAge ? <Muted>Primero confirma que eres mayor de edad.</Muted> : null}
                    <Button
                      label="He leído el texto y acepto"
                      icon="checkmark-circle-outline"
                      disabled={needsAge}
                      loading={busy === purpose}
                      onPress={() => run(purpose, () => grantConsent(purpose, text.version))}
                    />
                  </>
                ) : null}
              </Card>
            );
          })
        : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legal: { fontSize: 14, lineHeight: 21, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
  confirm: { gap: 10 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
});
