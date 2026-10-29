export const brand = {
  primary: '#3B3FD8',
  primaryLight: '#6C70F5',
  accent: '#22D3EE',
  navy: '#0B1220',
} as const;

/**
 * Palette notes (WCAG contrast is verified for every text/background pair, see the colour audit test):
 * - `primary` is a FILL (buttons, badges): white `onPrimary` text must read on it.
 * - `primaryText` and `accentText` are for TEXT and ICONS on surfaces. The bright cyan `accent` is only
 *   readable on dark backgrounds, so light mode gets a deep teal for text and keeps cyan for fills and strokes.
 * - `scrim` is the dark veil behind white labels that sit on top of photos.
 */
export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  onPrimary: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
  overlay: string;
  scrim: string;
};

const SCRIM = 'rgba(11, 18, 32, 0.72)';

export const lightPalette: Palette = {
  background: '#F5F6FC',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEEFA',
  border: '#DDE0F2',
  text: '#0F1530',
  textMuted: '#5B6385',
  primary: brand.primary,
  primaryText: brand.primary,
  onPrimary: '#FFFFFF',
  accent: brand.accent,
  accentText: '#155E75',
  success: '#166534',
  warning: '#92400E',
  danger: '#B91C1C',
  overlay: 'rgba(11, 18, 32, 0.45)',
  scrim: SCRIM,
};

export const darkPalette: Palette = {
  background: brand.navy,
  surface: '#131B2E',
  surfaceAlt: '#1B2540',
  border: '#26324F',
  text: '#F1F5FF',
  textMuted: '#9AA7C7',
  primary: '#5559E6',
  primaryText: '#A5A9FF',
  onPrimary: '#FFFFFF',
  accent: brand.accent,
  accentText: brand.accent,
  success: '#4ADE80',
  warning: '#FBBF24',
  danger: '#F87171',
  overlay: 'rgba(0, 0, 0, 0.6)',
  scrim: SCRIM,
};
