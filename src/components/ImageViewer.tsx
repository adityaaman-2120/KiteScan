import { useEffect } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';

type Props = {
  /** Image to show; null keeps the viewer closed. */
  uri: string | null;
  /** width / height of the image. */
  aspect: number;
  title?: string;
  caption?: string;
  onClose: () => void;
  /** When given, a Share button is shown under the image. */
  onShare?: () => void;
  shareBusy?: boolean;
};

const MAX_SCALE = 6;

/** Full-screen image viewer: pinch to zoom, drag to pan when zoomed, double-tap to zoom or reset. */
export function ImageViewer({ uri, aspect, title, caption, onClose, onShare, shareBusy }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Fit the image inside the screen at scale 1.
  const boxW = Math.min(width, height * aspect);
  const boxH = boxW / aspect;

  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const baseTx = useSharedValue(0);
  const baseTy = useSharedValue(0);

  useEffect(() => {
    // Every newly opened image starts unzoomed.
    scale.value = 1;
    baseScale.value = 1;
    tx.value = 0;
    ty.value = 0;
  }, [uri, scale, baseScale, tx, ty]);

  /** Keeps a zoomed image covering the screen: it can only pan as far as it overflows on that axis. */
  const limit = (v: number, s: number, box: number, screen: number) => {
    'worklet';
    const m = Math.max(0, (box * s - screen) / 2);
    return Math.max(-m, Math.min(m, v));
  };

  const pinch = usePinchGesture({
    onBegin: () => {
      'worklet';
      baseScale.value = scale.value;
    },
    onUpdate: (e) => {
      'worklet';
      scale.value = Math.max(1, Math.min(MAX_SCALE, baseScale.value * e.scale));
      tx.value = limit(tx.value, scale.value, boxW, width);
      ty.value = limit(ty.value, scale.value, boxH, height);
    },
    onFinalize: () => {
      'worklet';
      if (scale.value < 1.05) {
        scale.value = withSpring(1);
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    },
  });

  const pan = usePanGesture({
    minDistance: 4,
    onBegin: () => {
      'worklet';
      baseTx.value = tx.value;
      baseTy.value = ty.value;
    },
    onUpdate: (e) => {
      'worklet';
      if (scale.value <= 1.01) return;
      tx.value = limit(baseTx.value + e.translationX, scale.value, boxW, width);
      ty.value = limit(baseTy.value + e.translationY, scale.value, boxH, height);
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      'worklet';
      if (scale.value > 1.2) {
        scale.value = withTiming(1, { duration: 200 });
        tx.value = withTiming(0, { duration: 200 });
        ty.value = withTiming(0, { duration: 200 });
      } else {
        scale.value = withTiming(2.5, { duration: 200 });
      }
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A Modal is its own native window, so gestures need their own root view here. */}
      <GestureHandlerRootView style={styles.root}>
        {uri !== null && (
          <>
            <GestureDetector gesture={gesture}>
              <View style={styles.stage}>
                <Animated.View style={imageStyle}>
                  <Image source={{ uri }} style={{ width: boxW, height: boxH }} />
                </Animated.View>
              </View>
            </GestureDetector>

            <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 8 }]}>
              <View style={{ flex: 1 }}>
                {title ? <Text style={styles.title}>{title}</Text> : null}
                {caption ? <Text style={styles.caption}>{caption}</Text> : null}
              </View>
              <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10} style={styles.close}>
                <Icon name="close" size={22} color="#fff" />
              </Pressable>
            </View>
            {onShare && (
              <Pressable
                onPress={onShare}
                disabled={shareBusy}
                accessibilityRole="button"
                accessibilityLabel="Share this image"
                style={[styles.share, { bottom: insets.bottom + 48, opacity: shareBusy ? 0.5 : 1 }]}
              >
                <Icon name="share" size={18} color="#0B1220" />
                <Text style={styles.shareText}>Share image</Text>
              </Pressable>
            )}
            <Text pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + 16 }]}>
              Pinch to zoom, double-tap to zoom or reset
            </Text>
          </>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  caption: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2, fontFamily: undefined },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  share: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#22D3EE', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
  shareText: { color: '#0B1220', fontSize: 15, fontWeight: '700' },
  hint: { position: 'absolute', alignSelf: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 12 },
});
