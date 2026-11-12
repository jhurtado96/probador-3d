import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Banner, Button, Card, Field, Loading, Muted } from '@/components/ui';
import { authErrorMessage, validateCredentials } from '@/lib/authErrors';
import { supabase } from '@/lib/supabase';
import { useAppTheme } from '@/theme/useAppTheme';

type Mode = 'signIn' | 'signUp';

/**
 * Acceso con email y contraseña (sin enlaces mágicos ni redirecciones, para no
 * depender de SMTP propio ni de URLs de retorno). Si el proyecto exige
 * confirmar el email, el alta avisa de que hay que abrir el correo.
 */
export default function LoginScreen() {
  const { colors } = useAppTheme();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading) return <Loading label="Comprobando tu sesión…" />;
  if (session) return <Redirect href="/" />;

  const submit = async () => {
    setError(null);
    setInfo(null);
    const invalid = validateCredentials(email, password, mode);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signIn') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password });
        if (err) throw err;
        if (!data.session) {
          // Confirmación por email activada en el proyecto (o el email ya existía).
          setInfo(
            'Te hemos enviado un correo para confirmar la cuenta. Ábrelo, pulsa el enlace y después vuelve aquí para iniciar sesión.',
          );
          setMode('signIn');
        }
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Probador 3D"
      subtitle="Tu avatar con tus medidas, tu armario y recomendaciones de talla y color."
    >
      <Card title={mode === 'signIn' ? 'Inicia sesión' : 'Crea tu cuenta'}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          textContentType="emailAddress"
          placeholder="tu@email.com"
        />
        <Field
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
          placeholder={mode === 'signUp' ? 'Mínimo 8 caracteres' : ''}
          onSubmitEditing={submit}
        />
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="success">{info}</Banner> : null}
        <Button label={mode === 'signIn' ? 'Entrar' : 'Crear cuenta'} onPress={submit} loading={busy} />
        <View style={styles.switchRow}>
          <Text style={{ color: colors.textMuted }}>
            {mode === 'signIn' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMode(mode === 'signIn' ? 'signUp' : 'signIn');
              setError(null);
              setInfo(null);
            }}
          >
            <Text style={[styles.link, { color: colors.primary }]}>
              {mode === 'signIn' ? 'Crear una cuenta' : 'Iniciar sesión'}
            </Text>
          </Pressable>
        </View>
      </Card>
      <Muted>
        Tus datos se guardan en servidores de la UE. Las fotos de cuerpo y de prendas se borran en cuanto se procesan;
        solo guardamos los valores calculados. Puedes exportar o borrar todos tus datos desde Perfil.
      </Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', flexWrap: 'wrap' },
  link: { fontWeight: '600' },
});
