import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { navigationTheme } from '@/theme/colors';
import { useAppTheme } from '@/theme/useAppTheme';

export default function RootLayout() {
  const { scheme } = useAppTheme();
  return (
    <ThemeProvider value={navigationTheme(scheme)}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
