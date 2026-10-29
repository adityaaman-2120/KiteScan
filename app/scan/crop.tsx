import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Easing, useAnimatedReaction, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CropEditor, Icon, ToolButton, useToast } from '../../src/components';
import { EngineError, useEngine } from '../../src/engine';
import { getScanSession, updateScanSession, type ScannedImage } from '../../src/store';
import { useTheme } from '../../src/theme';
import { FULL_FRAME, PAGE_JPEG_QUALITY, haptic, cornersToQuad, quadToCorners, quadValid, replacePage, rewarp, rotateQuadCW } from '../../src/utils';

type Hint = 'missing' | 'uncertain' | null;

/** Below this confidence the detected outline is shown with a "check the corners" nudge. */
const UNCERTAIN_BELOW = 0.7;
const hintFor = (found: boolean, score: number): Hint => (!found ? 'missing' : score < UNCERTAIN_BELOW ? 'uncertain' : null);

type Busy = 'auto' | 'rotate' | 'warp' | null;

const BUSY_TEXT: Record<Exclude<Busy, null>, string> = {
  auto: 'Looking for the page edges...',
  rotate: 'Rotating...',
  warp: 'Flattening and enhancing...',
};

/** Crop editor: adjust the detected page corners, then flatten the page with a perspective warp. */
export default function CropScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const engine = useEngine();
  const toast = useToast();

  const [session] = useState(getScanSession);
  const [item, setItem] = useState<ScannedImage | undefined>(() => session?.items[session.index]);
  // 'missing': nothing page-like was found. 'uncertain': something was found but the engine is not sure of it.
  const [hint, setHint] = useState<Hint>(() => (item ? hintFor(item.detection.found, item.detection.score) : null));
  const [busy, setBusy] = useState<Busy>(null);

  // Normalized corners; the editor reads and writes this directly on the UI thread.
  const quad = useSharedValue<number[]>(item ? cornersToQuad(item.corners, item.width, item.height) : FULL_FRAME);

  // Animating the quad: drive a 0..1 progress and lerp between two arrays (withTiming has no array support).
  const initialQuad = useMemo(() => quad.value, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fromQuad = useSharedValue<number[]>(initialQuad);
  const toQuad = useSharedValue<number[]>(initialQuad);
  const progress = useSharedValue(1);
  useAnimatedReaction(
    () => progress.value,
    (p) => {
      'worklet';
      const from = fromQuad.value;
      const to = toQuad.value;
      quad.value = from.map((v, i) => v + (to[i] - v) * p);
    },
  );
  const animateQuad = useCallback(
    (target: number[], ms = 280) => {
      fromQuad.value = quad.value;
      toQuad.value = target;
      progress.value = 0;
      progress.value = withTiming(1, { duration: ms, easing: Easing.out(Easing.cubic) });
    },
    [quad, fromQuad, toQuad, progress],
  );

  const uri = useMemo(() => (item ? `data:image/jpeg;base64,${item.base64}` : ''), [item?.base64]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves changes to the shared scan so the review screen (and a later visit here) sees them. */
  const index = session?.index ?? 0;
  const commit = useCallback(
    (patch: Partial<ScannedImage>) => {
      if (!item) return item;
      const next = { ...item, ...patch };
      updateScanSession((s) => replacePage(s, index, next));
      setItem(next);
      return next;
    },
    [item, index],
  );

  const onGrab = useCallback(() => {
    haptic.tap();
    setHint(null);
  }, []);

  const fail = (e: unknown, fallback: string) =>
    toast.error(e instanceof EngineError ? e.userMessage : fallback);

  // ---------------------------------------------------------------- actions
  const onAuto = async () => {
    if (!item || busy) return;
    setBusy('auto');
    try {
      const r = await engine.run('detect', { imageBase64: item.base64 });
      animateQuad(cornersToQuad(r.corners, item.width, item.height), 300);
      setHint(hintFor(r.found, r.score));
      const { ms: _ms, imageWidth: _w, imageHeight: _h, ...detection } = r;
      commit({ detection });
      if (r.found) haptic.success();
      else haptic.warning();
    } catch (e) {
      fail(e, 'The page edges could not be found. Please adjust the corners by hand.');
    } finally {
      setBusy(null);
    }
  };

  const onFull = () => {
    if (busy) return;
    animateQuad(FULL_FRAME, 250);
    setHint(null);
  };

  const onRotate = async () => {
    if (!item || busy) return;
    setBusy('rotate');
    try {
      const r = await engine.run('rotate', { imageBase64: item.base64, degrees: 90, quality: PAGE_JPEG_QUALITY });
      // The image and the quad turn together; in normalized space that is a fixed remap.
      quad.value = rotateQuadCW(quad.value);
      commit({
        base64: r.imageBase64,
        width: r.width,
        height: r.height,
        rotation: (item.rotation + 90) % 360,
        edited: true,
      });
    } catch (e) {
      fail(e, 'The photo could not be rotated. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const onNext = async () => {
    if (!item || busy) return;
    const q = quad.value;
    if (!quadValid(q, item.width, item.height)) {
      Alert.alert(
        'Check the corners',
        'The corners cross over or are too close together. Drag them so the outline surrounds the page.',
      );
      return;
    }
    setBusy('warp');
    try {
      const corners = quadToCorners(q, item.width, item.height);
      // Flatten and enhance again with the page's current look, then hand the page back to the review screen.
      const updated = await rewarp(engine.run, item, corners);
      updateScanSession((s) => replacePage(s, index, updated));
      haptic.success();
      router.back();
    } catch (e) {
      fail(e, 'The page could not be flattened. Please adjust the corners and try again.');
    } finally {
      setBusy(null);
    }
  };

  // ----------------------------------------------------------------- render
  if (!session || !item) {
    return (
      <View style={styles.center}>
        <Text style={[typography.heading, { color: colors.text }]}>Nothing to crop yet</Text>
        <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
          Scan a page or import a photo from Home to get started.
        </Text>
        <Pressable onPress={() => router.replace('/')} style={[styles.pill, { backgroundColor: colors.primary, borderRadius: radius.pill, marginTop: spacing.xl }]}>
          <Text style={[typography.heading, { color: colors.onPrimary }]}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.hintSlot, { paddingHorizontal: spacing.lg }]}>
        {hint && (
          <View style={[styles.hint, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md }]}>
            <Icon name="info" size={18} color={colors.warning} />
            <Text style={[typography.caption, { color: colors.text, flex: 1 }]}>
              {hint === 'missing' ? "Couldn't find edges, adjust the corners." : 'Edges look uncertain, check the corners.'}
            </Text>
          </View>
        )}
        {session.items.length > 1 && !hint && (
          <Text style={[typography.label, { color: colors.textMuted, textAlign: 'center' }]}>
            PHOTO {session.index + 1} OF {session.items.length}
          </Text>
        )}
      </View>

      <CropEditor uri={uri} imageWidth={item.width} imageHeight={item.height} quad={quad} onGrab={onGrab} />

      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md, paddingHorizontal: spacing.lg, borderTopColor: colors.border }]}>
        <ToolButton icon="auto" label="Auto" onPress={onAuto} disabled={busy !== null} />
        <ToolButton icon="frame" label="Full image" onPress={onFull} disabled={busy !== null} />
        <ToolButton icon="rotate" label="Rotate" onPress={onRotate} disabled={busy !== null} />
        <Pressable
          onPress={onNext}
          disabled={busy !== null}
          accessibilityRole="button"
          style={[styles.next, { backgroundColor: colors.primary, borderRadius: radius.pill, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[typography.heading, { color: colors.onPrimary }]}>Done</Text>
          <Icon name="check" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>

      {busy && (
        <View style={[StyleSheet.absoluteFill, styles.busy, { backgroundColor: colors.overlay }]}>
          <View style={[styles.busyCard, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typography.body, { color: colors.text }]}>{BUSY_TEXT[busy]}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  pill: { paddingHorizontal: 24, paddingVertical: 14 },
  hintSlot: { minHeight: 52, justifyContent: 'center', paddingTop: 8 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  next: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginLeft: 8 },
  busy: { alignItems: 'center', justifyContent: 'center' },
  busyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
});
