import { useMemo, useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { brand } from '../theme';
import { clamp01, dimPath, edgeLength, quadPath, quadValid } from '../utils/geometry';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const MARGIN = 28; // room around the image so corner handles and the loupe stay reachable
const CORNER_HIT = 52;
const EDGE_HIT = 44;
const LOUPE = 124;
const ZOOM = 3;
const LOUPE_GAP = 40;
const AMBER = '#F59E0B';

type Props = {
  uri: string;
  imageWidth: number;
  imageHeight: number;
  /** Normalized quad [x0,y0,...,x3,y3] (TL,TR,BR,BL). Owned by the parent, which may animate it. */
  quad: SharedValue<number[]>;
  /** Called (on the JS thread) when a handle is grabbed. */
  onGrab: () => void;
};

type Stage = { dispW: number; dispH: number; offX: number; offY: number; areaW: number; areaH: number };

/**
 * The photo fitted on screen with an editable quad: four corner handles, four mid-edge handles
 * (move both corners of an edge) and a magnifier loupe that follows the active handle.
 */
export function CropEditor({ uri, imageWidth, imageHeight, quad, onGrab }: Props) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  // Index of the handle being dragged: 0-3 corners, 4-7 edges (edge e sits between corners e and e+1).
  const active = useSharedValue(0);
  const down = useSharedValue(0);

  const stage = useMemo<Stage | null>(() => {
    if (area.w <= 0 || area.h <= 0) return null;
    const scale = Math.min((area.w - MARGIN * 2) / imageWidth, (area.h - MARGIN * 2) / imageHeight);
    const dispW = imageWidth * scale;
    const dispH = imageHeight * scale;
    return { dispW, dispH, offX: (area.w - dispW) / 2, offY: (area.h - dispH) / 2, areaW: area.w, areaH: area.h };
  }, [area, imageWidth, imageHeight]);

  const onLayout = (e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={styles.area} onLayout={onLayout}>
      {stage && (
        <>
          <View style={{ position: 'absolute', left: stage.offX, top: stage.offY, width: stage.dispW, height: stage.dispH }}>
            <Image source={{ uri }} style={{ width: stage.dispW, height: stage.dispH }} />
            <Svg width={stage.dispW} height={stage.dispH} style={StyleSheet.absoluteFill} pointerEvents="none">
              <QuadShapes quad={quad} w={stage.dispW} h={stage.dispH} strokeWidth={2.5} dim />
            </Svg>

            {/* Edge handles first so a corner wins when they overlap on a short edge. */}
            {[0, 1, 2, 3].map((e) => (
              <EdgeHandle key={`e${e}`} edge={e} quad={quad} w={stage.dispW} h={stage.dispH} active={active} down={down} onGrab={onGrab} />
            ))}
            {[0, 1, 2, 3].map((c) => (
              <CornerHandle key={`c${c}`} index={c} quad={quad} w={stage.dispW} h={stage.dispH} active={active} down={down} onGrab={onGrab} />
            ))}
          </View>

          <Loupe uri={uri} quad={quad} stage={stage} active={active} down={down} />
        </>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ shapes

/** Dimmed outside + outline of the quad. Cyan when valid, amber when the corners cross over. */
function QuadShapes({ quad, w, h, strokeWidth, dim }: { quad: SharedValue<number[]>; w: number; h: number; strokeWidth: number; dim?: boolean }) {
  const dimProps = useAnimatedProps(() => ({ d: dimPath(quad.value, w, h) }));
  const lineProps = useAnimatedProps(() => ({
    d: quadPath(quad.value, w, h),
    stroke: quadValid(quad.value, w, h) ? brand.accent : AMBER,
  }));
  return (
    <>
      {dim && <AnimatedPath animatedProps={dimProps} fill="rgba(5,10,20,0.5)" fillRule="evenodd" />}
      <AnimatedPath animatedProps={lineProps} fill="rgba(34,211,238,0.14)" strokeWidth={strokeWidth} strokeLinejoin="round" />
    </>
  );
}

// ----------------------------------------------------------------- handles

type HandleProps = {
  quad: SharedValue<number[]>;
  w: number;
  h: number;
  active: SharedValue<number>;
  down: SharedValue<number>;
  onGrab: () => void;
};

function CornerHandle({ index, quad, w, h, active, down, onGrab }: HandleProps & { index: number }) {
  const start = useSharedValue([0, 0]);

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: () => {
      'worklet';
      start.value = [quad.value[index * 2], quad.value[index * 2 + 1]];
      active.value = index;
      down.value = 1;
      scheduleOnRN(onGrab);
    },
    onUpdate: (e) => {
      'worklet';
      const next = quad.value.slice();
      next[index * 2] = clamp01(start.value[0] + e.translationX / w);
      next[index * 2 + 1] = clamp01(start.value[1] + e.translationY / h);
      quad.value = next;
    },
    onFinalize: () => {
      'worklet';
      if (active.value === index) down.value = 0;
    },
  });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: quad.value[index * 2] * w - CORNER_HIT / 2 },
      { translateY: quad.value[index * 2 + 1] * h - CORNER_HIT / 2 },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.cornerHit, style]}>
        <View style={styles.cornerDot} />
      </Animated.View>
    </GestureDetector>
  );
}

function EdgeHandle({ edge, quad, w, h, active, down, onGrab }: HandleProps & { edge: number }) {
  const a = edge;
  const b = (edge + 1) % 4;
  const start = useSharedValue([0, 0, 0, 0]);

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: () => {
      'worklet';
      const q = quad.value;
      start.value = [q[a * 2], q[a * 2 + 1], q[b * 2], q[b * 2 + 1]];
      active.value = 4 + edge;
      down.value = 1;
      scheduleOnRN(onGrab);
    },
    onUpdate: (e) => {
      'worklet';
      const s = start.value;
      // Move both corners by the same amount, stopping when either would leave the image.
      const minX = Math.min(s[0], s[2]);
      const maxX = Math.max(s[0], s[2]);
      const minY = Math.min(s[1], s[3]);
      const maxY = Math.max(s[1], s[3]);
      const dx = Math.max(-minX, Math.min(1 - maxX, e.translationX / w));
      const dy = Math.max(-minY, Math.min(1 - maxY, e.translationY / h));
      const next = quad.value.slice();
      next[a * 2] = s[0] + dx;
      next[a * 2 + 1] = s[1] + dy;
      next[b * 2] = s[2] + dx;
      next[b * 2 + 1] = s[3] + dy;
      quad.value = next;
    },
    onFinalize: () => {
      'worklet';
      if (active.value === 4 + edge) down.value = 0;
    },
  });

  const style = useAnimatedStyle(() => {
    const q = quad.value;
    const mx = ((q[a * 2] + q[b * 2]) / 2) * w;
    const my = ((q[a * 2 + 1] + q[b * 2 + 1]) / 2) * h;
    // Fade out on very short edges where it would sit on top of the corner handles.
    const visible = edgeLength(q, edge, w, h) > 70 ? 1 : 0;
    return {
      opacity: visible,
      transform: [{ translateX: mx - EDGE_HIT / 2 }, { translateY: my - EDGE_HIT / 2 }],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.edgeHit, style]}>
        <View style={styles.edgeDot} />
      </Animated.View>
    </GestureDetector>
  );
}

// ------------------------------------------------------------------ loupe

function Loupe({ uri, quad, stage, active, down }: { uri: string; quad: SharedValue<number[]>; stage: Stage; active: SharedValue<number>; down: SharedValue<number> }) {
  const { dispW, dispH, offX, offY, areaW } = stage;

  /** Display-space position of the handle being dragged (a corner, or an edge midpoint). */
  const point = () => {
    'worklet';
    const q = quad.value;
    const i = active.value;
    if (i < 4) return { x: q[i * 2] * dispW, y: q[i * 2 + 1] * dispH };
    const a = i - 4;
    const b = (a + 1) % 4;
    return { x: ((q[a * 2] + q[b * 2]) / 2) * dispW, y: ((q[a * 2 + 1] + q[b * 2 + 1]) / 2) * dispH };
  };

  // Floats near the finger: above it, or below when there is no room at the top.
  const frameStyle = useAnimatedStyle(() => {
    const p = point();
    const px = offX + p.x;
    const py = offY + p.y;
    const above = py - LOUPE / 2 - LOUPE_GAP;
    const cy = above - LOUPE / 2 < 6 ? py + LOUPE / 2 + LOUPE_GAP : above;
    const cx = Math.max(LOUPE / 2 + 6, Math.min(areaW - LOUPE / 2 - 6, px));
    return {
      opacity: withTiming(down.value, { duration: 110 }),
      transform: [{ translateX: cx - LOUPE / 2 }, { translateY: cy - LOUPE / 2 }, { scale: withTiming(down.value ? 1 : 0.85, { duration: 110 }) }],
    };
  });

  // Same image and outline, scaled about its centre and shifted so the handle sits in the loupe's centre.
  const contentStyle = useAnimatedStyle(() => {
    const p = point();
    return {
      transform: [
        { translateX: LOUPE / 2 - dispW / 2 - ZOOM * (p.x - dispW / 2) },
        { translateY: LOUPE / 2 - dispH / 2 - ZOOM * (p.y - dispH / 2) },
        { scale: ZOOM },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.loupe, frameStyle]}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: dispW, height: dispH }, contentStyle]}>
        <Image source={{ uri }} style={{ width: dispW, height: dispH }} />
        <Svg width={dispW} height={dispH} style={StyleSheet.absoluteFill}>
          <QuadShapes quad={quad} w={dispW} h={dispH} strokeWidth={1.2} />
        </Svg>
      </Animated.View>
      {/* Crosshair: the pixel under it is where the corner will land. */}
      <View style={styles.crossH} />
      <View style={styles.crossV} />
      <View style={styles.crossRing} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1 },
  cornerHit: { position: 'absolute', left: 0, top: 0, width: CORNER_HIT, height: CORNER_HIT, alignItems: 'center', justifyContent: 'center' },
  cornerDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: brand.accent,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  edgeHit: { position: 'absolute', left: 0, top: 0, width: EDGE_HIT, height: EDGE_HIT, alignItems: 'center', justifyContent: 'center' },
  edgeDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: brand.accent,
    borderWidth: 3,
    borderColor: '#fff',
    elevation: 3,
  },
  loupe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: LOUPE,
    height: LOUPE,
    borderRadius: LOUPE / 2,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#fff',
    elevation: 8,
  },
  crossH: { position: 'absolute', left: LOUPE / 2 - 12, top: LOUPE / 2 - 0.5, width: 24, height: 1, backgroundColor: 'rgba(255,255,255,0.9)' },
  crossV: { position: 'absolute', top: LOUPE / 2 - 12, left: LOUPE / 2 - 0.5, height: 24, width: 1, backgroundColor: 'rgba(255,255,255,0.9)' },
  crossRing: { position: 'absolute', left: LOUPE / 2 - 5, top: LOUPE / 2 - 5, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: brand.accent },
});
