import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { brand } from '../theme';

type Props = {
  uri: string;
  /** Width / height of the photo, used to size the frame without distortion. */
  aspect: number;
  maxWidth: number;
  maxHeight: number;
};

/** The photo with a cyan scan line sweeping top to bottom, shown while the engine works. */
export function ScanningPreview({ uri, aspect, maxWidth, maxHeight }: Props) {
  const width = Math.min(maxWidth, maxHeight * aspect);
  const height = width / aspect;

  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [p]);

  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: p.value * (height - 4) }] }));

  return (
    <View style={[styles.frame, { width, height }]}>
      <Image source={{ uri }} style={{ width, height }} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
      <Animated.View style={[styles.line, lineStyle]}>
        {/* Soft glow: faint wide bands above and below the core line. */}
        <View style={[styles.glow, { height: 28, top: -12, opacity: 0.1 }]} />
        <View style={[styles.glow, { height: 14, top: -5, opacity: 0.22 }]} />
        <View style={styles.core} />
      </Animated.View>
      {(['tl', 'tr', 'br', 'bl'] as const).map((c) => (
        <View key={c} style={[styles.corner, cornerStyles[c]]} />
      ))}
    </View>
  );
}

const CORNER = 22;
const cornerStyles = StyleSheet.create({
  tl: { top: 8, left: 8, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  tr: { top: 8, right: 8, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  br: { bottom: 8, right: 8, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  bl: { bottom: 8, left: 8, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
});

const styles = StyleSheet.create({
  frame: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' },
  dim: { backgroundColor: 'rgba(11,18,32,0.25)' },
  line: { position: 'absolute', left: 0, right: 0, top: 0, height: 4 },
  core: { height: 3, backgroundColor: brand.accent, borderRadius: 2 },
  glow: { position: 'absolute', left: 0, right: 0, backgroundColor: brand.accent },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff' },
});
