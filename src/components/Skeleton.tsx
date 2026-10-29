import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { motion, useTheme } from '../theme';

type BlockProps = {
  width?: DimensionValue;
  height: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** A softly pulsing placeholder block shown while real content loads. */
export function Skeleton({ width = '100%', height, radius, style }: BlockProps) {
  const { colors, radius: radii } = useTheme();
  const o = useSharedValue(0.5);

  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 900, easing: motion.easeInOut }), -1, true);
  }, [o]);

  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));

  return (
    <Animated.View
      // Placeholders carry no information for screen readers.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius ?? radii.md, backgroundColor: colors.border }, pulse, style]}
    />
  );
}

/** Same footprint as DocCard: thumbnail, a name line and a details line. */
export function DocCardSkeleton({ width }: { width: number }) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.card, { width, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
      <Skeleton height={(width * 4) / 3} radius={0} />
      <View style={styles.meta}>
        <Skeleton height={14} width="75%" radius={7} />
        <Skeleton height={11} width="50%" radius={6} />
      </View>
    </View>
  );
}

/** Two-column grid of DocCardSkeletons (the Home library while it loads). */
export function DocGridSkeleton({ cardWidth, count = 4 }: { cardWidth: number; count?: number }) {
  const rows = Math.ceil(count / 2);
  return (
    <View style={styles.grid}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={styles.row}>
          <DocCardSkeleton width={cardWidth} />
          {r * 2 + 1 < count && <DocCardSkeleton width={cardWidth} />}
        </View>
      ))}
    </View>
  );
}

/** A pipeline step card while the Lab runs: title, image area and two text lines. */
export function StepCardSkeleton() {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.step, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
      <Skeleton height={18} width="45%" radius={9} />
      <Skeleton height={170} radius={radius.md} />
      <Skeleton height={12} width="90%" radius={6} />
      <Skeleton height={12} width="60%" radius={6} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
  meta: { padding: 12, gap: 8 },
  grid: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  step: { borderWidth: 1, padding: 14, gap: 12 },
});
