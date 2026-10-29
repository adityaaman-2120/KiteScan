import { useColorScheme } from 'react-native';

import { darkPalette, lightPalette } from './colors';
import { radius } from './radius';
import { spacing } from './spacing';
import { typography } from './typography';

export function useTheme() {
  const isDark = useColorScheme() !== 'light';
  return { isDark, colors: isDark ? darkPalette : lightPalette, spacing, radius, typography };
}

export type Theme = ReturnType<typeof useTheme>;
