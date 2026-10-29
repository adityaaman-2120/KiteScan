import type { TextStyle } from 'react-native';

type Variant = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing'>;

export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 },
} satisfies Record<string, Variant>;
