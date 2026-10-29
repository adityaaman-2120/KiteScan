import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { scheduleOnRN } from 'react-native-worklets';

import { APP_NAME, BRAND_NAME, TAGLINE, brand } from '../theme';
import { KiteScanLogo } from './KiteScanLogo';

const LOGO_SIZE = 168;

type Props = {
  /** Called once the ~1.8s animation has finished. */
  onDone: () => void;
};

/**
 * Timeline (ms): kite scales in 0-450, scan line sweeps down twice 300-1100,
 * text fades in 1000-1550, exit fade 1600-1800, then onDone.
 */
export function AnimatedSplash({ onDone }: Props) {
  const scale = useSharedValue(0.55);
  const kiteOpacity = useSharedValue(0);
  const scan = useSharedValue(0);
  const title = useSharedValue(0);
  const sub = useSharedValue(0);
  const exit = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.back(1.6)) });
    kiteOpacity.value = withTiming(1, { duration: 300 });

    // Two top-to-bottom sweeps, snapping back to the top between them.
    const sweep = withTiming(1, { duration: 400, easing: Easing.inOut(Easing.quad) });
    const sweep2 = withTiming(1, { duration: 400, easing: Easing.inOut(Easing.quad) });
    scan.value = withDelay(300, withSequence(sweep, withTiming(0, { duration: 0 }), sweep2));

    title.value = withDelay(1000, withTiming(1, { duration: 400 }));
    sub.value = withDelay(1150, withTiming(1, { duration: 400 }));
    exit.value = withDelay(
      1600,
      withTiming(0, { duration: 200 }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );
  }, [scale, kiteOpacity, scan, title, sub, exit, onDone]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: exit.value }));
  const kiteStyle = useAnimatedStyle(() => ({
    opacity: kiteOpacity.value,
    transform: [{ scale: scale.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: title.value,
    transform: [{ translateY: (1 - title.value) * 8 }],
  }));
  const subStyle = useAnimatedStyle(() => ({ opacity: sub.value }));

  return (
    <Animated.View style={[styles.root, rootStyle]}>
      <Animated.View style={kiteStyle}>
        <KiteScanLogo size={LOGO_SIZE} scanProgress={scan} />
      </Animated.View>
      <Animated.View style={[styles.textBlock, titleStyle]}>
        <Text style={styles.title}>{APP_NAME}</Text>
      </Animated.View>
      <Animated.View style={subStyle}>
        <Text style={styles.by}>by {BRAND_NAME}</Text>
        <Text style={styles.tagline}>{TAGLINE}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: brand.navy,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  textBlock: { marginTop: 20 },
  title: { color: '#F1F5FF', fontSize: 36, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  by: { color: brand.accent, fontSize: 14, fontWeight: '600', letterSpacing: 2, textAlign: 'center', marginTop: 4 },
  tagline: { color: '#9AA7C7', fontSize: 13, textAlign: 'center', marginTop: 14 },
});
