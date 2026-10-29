import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { brand, useTheme } from '../theme';
import { Icon } from './Icon';

type Props = {
  /** The warped page before enhancement (shown left of the divider). */
  beforeUri: string;
  /** The enhanced page (shown right of the divider). */
  afterUri: string;
  /** Width / height of both images. */
  aspect: number;
  afterLabel: string;
  /** Shows a small "Enhancing..." pill while a new result is being computed. */
  loading: boolean;
};

const PAD = 12;
const HIT = 48;

/** Before/after viewer with a draggable vertical divider: left = original, right = enhanced. */
export function CompareView({ beforeUri, afterUri, aspect, afterLabel, loading }: Props) {
  const { colors, radius, typography } = useTheme();
  const [area, setArea] = useState({ w: 0, h: 0 });
  const divider = useSharedValue(0.5); // 0..1 across the image
  const start = useSharedValue(0.5);

  const box = useMemo(() => {
    if (area.w <= 0 || area.h <= 0) return null;
    const maxW = area.w - PAD * 2;
    const maxH = area.h - PAD * 2;
    const w = Math.min(maxW, maxH * aspect);
    return { w, h: w / aspect, x: (area.w - w) / 2, y: (area.h - w / aspect) / 2 };
  }, [area, aspect]);

  const w = box?.w ?? 1;

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: () => {
      'worklet';
      start.value = divider.value;
    },
    onUpdate: (e) => {
      'worklet';
      divider.value = Math.max(0, Math.min(1, start.value + e.translationX / w));
    },
  });

  const clipStyle = useAnimatedStyle(() => ({ left: divider.value * w, width: (1 - divider.value) * w }));
  const innerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -divider.value * w }] }));
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateX: divider.value * w - HIT / 2 }] }));

  return (
    <View style={styles.area} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box && (
        <View style={[styles.stage, { left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: radius.md }]}>
          <Image source={{ uri: beforeUri }} style={{ width: box.w, height: box.h }} />
          <Animated.View style={[styles.clip, { height: box.h }, clipStyle]}>
            <Animated.View style={[{ width: box.w, height: box.h }, innerStyle]}>
              <Image source={{ uri: afterUri }} style={{ width: box.w, height: box.h }} />
            </Animated.View>
          </Animated.View>

          <View pointerEvents="none" style={[styles.tag, { left: 8, backgroundColor: colors.scrim }]}>
            <Text style={[typography.label, { color: '#fff' }]}>ORIGINAL</Text>
          </View>
          <View pointerEvents="none" style={[styles.tag, { right: 8, backgroundColor: colors.scrim }]}>
            <Text style={[typography.label, { color: '#fff' }]}>{afterLabel.toUpperCase()}</Text>
          </View>

          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.hit, { height: box.h }, lineStyle]}>
              <View style={[styles.line, { height: box.h }]} />
              <View style={styles.knob}>
                <Icon name="compare" size={20} color={brand.navy} />
              </View>
            </Animated.View>
          </GestureDetector>

          {loading && (
            <View pointerEvents="none" style={[styles.loading, { backgroundColor: colors.scrim, borderRadius: radius.pill }]}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={[typography.caption, { color: '#fff' }]}>Enhancing...</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1 },
  stage: { position: 'absolute', overflow: 'hidden', backgroundColor: '#fff' },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  tag: { position: 'absolute', top: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  hit: { position: 'absolute', left: 0, top: 0, width: HIT, alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', width: 2, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 2, elevation: 3 },
  knob: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  loading: { position: 'absolute', alignSelf: 'center', bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
});
