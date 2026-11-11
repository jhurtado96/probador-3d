import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type AppColors } from './colors';

export type ColorSchemeName = 'light' | 'dark';

/** Esquema de color del sistema (claro/oscuro) y su paleta. */
export function useAppTheme(): { scheme: ColorSchemeName; colors: AppColors } {
  const scheme: ColorSchemeName = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: scheme === 'dark' ? darkColors : lightColors };
}
