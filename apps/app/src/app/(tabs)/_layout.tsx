import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Loading } from '@/components/ui';
import { useAppTheme } from '@/theme/useAppTheme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Escanear', icon: 'body-outline' },
  { name: 'armario', title: 'Armario', icon: 'shirt-outline' },
  { name: 'outfits', title: 'Outfits', icon: 'layers-outline' },
  { name: 'tienda', title: 'Tienda', icon: 'bag-handle-outline' },
  { name: 'perfil', title: 'Perfil', icon: 'person-circle-outline' },
];

export default function TabsLayout() {
  const { colors } = useAppTheme();
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <Loading label="Comprobando tu sesión…" />
      </View>
    );
  }
  // Toda la app necesita sesión: sin ella, a la pantalla de acceso.
  if (!session) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused, size }) => (
              <Ionicons
                name={icon}
                size={size}
                color={focused ? colors.primary : colors.textMuted}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
