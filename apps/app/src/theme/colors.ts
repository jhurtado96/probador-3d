import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

export type AppColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  danger: string;
  success: string;
  /** Fondo del lienzo 3D. */
  canvas: string;
  /** Color base del maniquí. */
  mannequin: string;
};

export const lightColors: AppColors = {
  background: '#F7F5F2',
  surface: '#FFFFFF',
  surfaceMuted: '#EFECE7',
  border: '#DDD8D0',
  text: '#1C1B1A',
  textMuted: '#6B665F',
  primary: '#5B4BDB',
  onPrimary: '#FFFFFF',
  danger: '#C62828',
  success: '#2E7D32',
  canvas: '#ECE8E2',
  mannequin: '#D9CBB8',
};

export const darkColors: AppColors = {
  background: '#121212',
  surface: '#1E1E1F',
  surfaceMuted: '#29292B',
  border: '#3A3A3D',
  text: '#F2F0ED',
  textMuted: '#A8A39C',
  primary: '#9D91FF',
  onPrimary: '#14112B',
  danger: '#FF8A80',
  success: '#81C784',
  canvas: '#1A1A1C',
  mannequin: '#BFB2A0',
};

export function navigationTheme(scheme: 'light' | 'dark'): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const c = scheme === 'dark' ? darkColors : lightColors;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.background,
      card: c.surface,
      text: c.text,
      border: c.border,
    },
  };
}
