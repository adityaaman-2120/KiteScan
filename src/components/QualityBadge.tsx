import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';
import type { PageQuality } from '../utils/pages';

type Props = { quality: PageQuality; onPress?: () => void; compact?: boolean };

const WORD = { great: 'Great', good: 'Good', check: 'Check' } as const;

/** A scan-quality pill built from real measurements (sharpness, exposure, edge confidence). Tap for the details. */
export function QualityBadge({ quality, onPress, compact }: Props) {
  const { colors, typography } = useTheme();
  const tone = quality.grade === 'great' ? colors.success : quality.grade === 'good' ? colors.accentText : colors.warning;

  const body = (
    <View style={[styles.pill, { backgroundColor: colors.scrim }]}>
      <View style={[styles.dot, { backgroundColor: quality.grade === 'great' ? '#4ADE80' : quality.grade === 'good' ? '#22D3EE' : '#FBBF24' }]} />
      <Text style={[typography.label, { color: '#fff' }]}>
        {compact ? quality.score : `${WORD[quality.grade]} ${quality.score}`}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Scan quality ${WORD[quality.grade]}, ${quality.score} out of 100. Tap for details.`}
      accessibilityHint={tone}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
