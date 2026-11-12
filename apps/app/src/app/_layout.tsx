import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '@/auth/AuthProvider';
import { navigationTheme } from '@/theme/colors';
import { useAppTheme } from '@/theme/useAppTheme';

export default function RootLayout() {
  const { scheme, colors } = useAppTheme();
  return (
    <AuthProvider>
      <ThemeProvider value={navigationTheme(scheme)}>
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen
            name="consentimientos"
            options={{ headerShown: true, title: 'Consentimientos', presentation: 'modal' }}
          />
        </Stack>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </AuthProvider>
  );
}
