import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '../theme';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Called on the JS thread whenever the stepped value changes while dragging. */
  onChange: (value: number) => void;
};

const THUMB = 26;

/** Touch slider (tap or drag) with stepped values, built on gesture-handler. */
export function Slider({ label, value, min, max, step, onChange }: Props) {
  const { colors, typography } = useTheme();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue((value - min) / (max - min));
  const dragging = useSharedValue(0);
  const lastValue = useSharedValue(value);

  // Follow the value when it changes from outside (e.g. Reset), but never while the finger is down.
  useEffect(() => {
    lastValue.value = value;
    if (!dragging.value) progress.value = (value - min) / (max - min);
  }, [value, min, max, progress, dragging, lastValue]);

  const usable = Math.max(1, width - THUMB);

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: (e) => {
      'worklet';
      dragging.value = 1;
      const p = Math.max(0, Math.min(1, (e.x - THUMB / 2) / usable));
      progress.value = p;
      const stepped = Math.round((Math.min(max, Math.round((p * (max - min)) / step) * step + min)) * 1e4) / 1e4;
      if (stepped !== lastValue.value) {
        lastValue.value = stepped;
        scheduleOnRN(onChange, stepped);
      }
    },
    onUpdate: (e) => {
      'worklet';
      const p = Math.max(0, Math.min(1, (e.x - THUMB / 2) / usable));
      progress.value = p;
      const stepped = Math.round((Math.min(max, Math.round((p * (max - min)) / step) * step + min)) * 1e4) / 1e4;
      if (stepped !== lastValue.value) {
        lastValue.value = stepped;
        scheduleOnRN(onChange, stepped);
      }
    },
    onFinalize: () => {
      'worklet';
      dragging.value = 0;
      // Settle the thumb on the stepped value.
      progress.value = (lastValue.value - min) / (max - min);
    },
  });

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * usable }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: progress.value * usable + THUMB / 2 }));

  const shown = Number.isInteger(step) ? String(Math.round(value)) : value.toFixed(1);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
        <Text style={[typography.heading, { color: colors.accentText }]}>{shown}</Text>
      </View>
      <GestureDetector gesture={pan}>
        <View style={styles.hit} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]} />
          <Animated.View style={[styles.fill, { backgroundColor: colors.primary }, fillStyle]} />
          <Animated.View style={[styles.thumb, { backgroundColor: '#fff', borderColor: colors.primary }, thumbStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  hit: { height: 40, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3 },
  fill: { position: 'absolute', left: 0, height: 6, borderRadius: 3 },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 4,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
});
