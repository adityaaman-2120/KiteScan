import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { HistogramCompare, Icon, ImageViewer, KiteScanLogo, Slider, StepCardSkeleton } from '../src/components';
import { EngineError, useEngine, type EnhanceMode, type PipelineResult, type PipelineStep } from '../src/engine';
import { takeLabSource } from '../src/store';
import { brand, motion, useTheme } from '../src/theme';
import { TUNE_RANGES, haptic, modeLabel, prepareForEngine, type PreparedImage } from '../src/utils';

/* eslint-disable @typescript-eslint/no-require-imports */
const SAMPLES = [
  { key: 'whiteboard', label: 'Whiteboard', module: require('../assets/samples/sample-whiteboard.jpg') as number },
  { key: 'blackboard', label: 'Blackboard', module: require('../assets/samples/sample-blackboard.jpg') as number },
  { key: 'notebook', label: 'Notebook', module: require('../assets/samples/sample-notebook.jpg') as number },
] as const;

type SourceKey = (typeof SAMPLES)[number]['key'] | 'photo';
type Source = PreparedImage & { key: SourceKey; name: string };

const MODES: { mode: EnhanceMode | 'auto'; label: string }[] = [
  { mode: 'document_bw', label: 'B&W Document' },
  { mode: 'whiteboard', label: 'Whiteboard' },
  { mode: 'blackboard', label: 'Blackboard' },
  { mode: 'magic', label: 'Magic Color' },
  { mode: 'auto', label: 'Auto' },
];

type Params = { manualCanny: boolean; cannyLow: number; cannyHigh: number; blurKernel: number; blockSize: number; C: number };
const DEFAULTS: Params = { manualCanny: false, cannyLow: 50, cannyHigh: 130, blurKernel: 5, blockSize: 31, C: 10 };

const DEBOUNCE_MS = 400;
const PLAY_STEP_MS = 2400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uri = (b64: string) => `data:image/jpeg;base64,${b64}`;
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export default function LabScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const engine = useEngine();
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const [source, setSource] = useState<Source | null>(null);
  const [mode, setMode] = useState<EnhanceMode | 'auto'>('document_bw');
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [viewer, setViewer] = useState<{ uri: string; aspect: number; title: string; caption: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<number | 'hist' | null>(null);

  const scrollRef = useRef<ScrollViewInstance>(null);
  const alive = useRef(true);
  const token = useRef(0);
  const lastSource = useRef<Source | null>(null);
  const playToken = useRef(0);
  const layout = useRef({ stepsTop: 0, histTop: 0, cards: {} as Record<number, number> });

  useEffect(
    () => () => {
      alive.current = false;
      playToken.current++;
    },
    [],
  );

  // ----------------------------------------------------------------- source
  const useSource = (s: Source) => {
    playToken.current++;
    setPlaying(false);
    setActive(null);
    setResult(null);
    setMessage(null);
    setSource(s);
  };

  const loadSample = useCallback(async (key: (typeof SAMPLES)[number]['key']) => {
    const sample = SAMPLES.find((s) => s.key === key);
    if (!sample) return;
    try {
      const asset = Asset.fromModule(sample.module);
      await asset.downloadAsync();
      const prepared = await prepareForEngine(asset.localUri ?? asset.uri, asset.width ?? 1200, asset.height ?? 900);
      if (!prepared.ok) return setMessage(prepared.message);
      useSource({ ...prepared.image, key, name: sample.label });
    } catch {
      setMessage('The sample image could not be loaded.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPhoto = async () => {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (picked.canceled) return;
      const a = picked.assets[0];
      const prepared = await prepareForEngine(a.uri, a.width, a.height);
      if (!prepared.ok) return setMessage(prepared.message);
      useSource({ ...prepared.image, key: 'photo', name: 'Your photo' });
    } catch {
      setMessage('That photo could not be opened. Please try another one.');
    }
  };

  // Open on the page handed over from the review screen, or else on the whiteboard sample so it is never empty.
  useEffect(() => {
    const given = takeLabSource();
    if (given) useSource({ base64: given.base64, width: given.width, height: given.height, key: 'photo', name: given.name });
    else void loadSample('whiteboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSample]);

  // --------------------------------------------------------------- pipeline
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    if (!source || !engine.ready) return;
    const sourceChanged = lastSource.current !== source;
    lastSource.current = source;
    const mine = ++token.current;
    setRunning(true);

    // First run for a new image starts at once; slider changes wait until the finger rests.
    const timer = setTimeout(
      async () => {
        try {
          const r = await engineRef.current.run(
            'pipeline',
            {
              imageBase64: source.base64,
              mode,
              blurKernel: params.blurKernel,
              blockSize: params.blockSize,
              C: params.C,
              ...(params.manualCanny ? { cannyLow: params.cannyLow, cannyHigh: params.cannyHigh } : {}),
              stepMaxSide: 900,
            },
            60_000,
          );
          if (!alive.current || token.current !== mine) return; // a newer run superseded this one
          setResult(r);
          setMessage(null);
          setRunning(false);
        } catch (e) {
          if (!alive.current || token.current !== mine) return;
          setRunning(false);
          setMessage(e instanceof EngineError ? e.userMessage : 'The pipeline could not run. Please try again.');
        }
      },
      sourceChanged ? 0 : DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, engine.ready, mode, paramsKey]);

  // ----------------------------------------------------------------- params
  const autoLow = result?.params.cannyLow ?? DEFAULTS.cannyLow;
  const autoHigh = result?.params.cannyHigh ?? DEFAULTS.cannyHigh;
  const shownLow = params.manualCanny ? params.cannyLow : autoLow;
  const shownHigh = params.manualCanny ? params.cannyHigh : autoHigh;

  const setCanny = (which: 'low' | 'high', v: number) =>
    setParams((p) => {
      let lo = p.manualCanny ? p.cannyLow : autoLow;
      let hi = p.manualCanny ? p.cannyHigh : autoHigh;
      if (which === 'low') {
        lo = v;
        if (hi <= lo) hi = Math.min(255, lo + 1);
      } else {
        hi = v;
        if (lo >= hi) lo = Math.max(0, hi - 1);
      }
      return { ...p, manualCanny: true, cannyLow: lo, cannyHigh: hi };
    });

  // ------------------------------------------------------------------- play
  const play = async () => {
    if (playing) {
      playToken.current++;
      setPlaying(false);
      setActive(null);
      return;
    }
    if (!result) return;
    const mine = ++playToken.current;
    const live = () => alive.current && playToken.current === mine;
    setPlaying(true);
    setPanelOpen(false); // a stable layout while scrolling
    await sleep(300);

    const scrollTo = (y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 96), animated: true });
    for (let i = 0; i < result.steps.length; i++) {
      if (!live()) return;
      setActive(i);
      scrollTo(layout.current.stepsTop + (layout.current.cards[i] ?? 0));
      await sleep(PLAY_STEP_MS);
    }
    if (!live()) return;
    setActive('hist');
    scrollTo(layout.current.histTop);
    await sleep(PLAY_STEP_MS);
    if (!live()) return;
    setActive(null);
    setPlaying(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  // ----------------------------------------------------------------- render
  const card = { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg };
  const blurRange = { min: 3, max: 15, step: 2 };
  const bwActive = (result?.mode ?? (mode === 'auto' ? 'document_bw' : mode)) === 'document_bw';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        {!engine.ready && (
          <View style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md }]}>
            <KiteScanLogo size={22} animated />
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {engine.status === 'error' ? engine.errorMessage : 'Warming up the engine...'}
            </Text>
          </View>
        )}

        {/* Source */}
        <View style={[styles.card, card]}>
          <Text style={[typography.label, { color: colors.textMuted }]}>IMAGE</Text>
          <View style={styles.chips}>
            {SAMPLES.map((s) => (
              <Chip key={s.key} label={s.label} selected={source?.key === s.key} onPress={() => loadSample(s.key)} />
            ))}
            <Chip label="Your photo..." selected={source?.key === 'photo'} onPress={pickPhoto} />
          </View>
        </View>

        {/* Live parameters */}
        <View style={[styles.card, card]}>
          <Pressable onPress={() => setPanelOpen((o) => !o)} style={styles.panelHead} accessibilityRole="button" accessibilityState={{ expanded: panelOpen }}>
            <Text style={[typography.heading, { color: colors.text, flex: 1 }]}>Live parameters</Text>
            {running && <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />}
            <View style={{ transform: [{ rotate: panelOpen ? '180deg' : '0deg' }] }}>
              <Icon name="chevron-down" size={22} color={colors.textMuted} />
            </View>
          </Pressable>
          {panelOpen && (
            <Animated.View entering={motion.panel()} style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                Move a slider and the whole pipeline re-runs on this phone.
              </Text>

              <View style={styles.sectionHead}>
                <Text style={[typography.label, { color: colors.textMuted }]}>EDGE DETECTION</Text>
                <Pressable
                  onPress={() => setParams((p) => ({ ...p, manualCanny: !p.manualCanny, cannyLow: autoLow, cannyHigh: autoHigh }))}
                  hitSlop={8}
                  style={[styles.autoPill, { backgroundColor: params.manualCanny ? colors.surfaceAlt : colors.primary, borderRadius: radius.pill }]}
                >
                  <Text style={[typography.label, { color: params.manualCanny ? colors.text : colors.onPrimary }]}>
                    {params.manualCanny ? 'MANUAL (tap for auto)' : 'AUTO THRESHOLDS'}
                  </Text>
                </Pressable>
              </View>
              <Slider label="Canny low" value={shownLow} min={0} max={254} step={1} onChange={(v) => setCanny('low', v)} />
              <Slider label="Canny high" value={shownHigh} min={1} max={255} step={1} onChange={(v) => setCanny('high', v)} />
              <Slider label="Blur kernel" value={params.blurKernel} min={blurRange.min} max={blurRange.max} step={blurRange.step} onChange={(v) => setParams((p) => ({ ...p, blurKernel: v }))} />

              <View style={styles.sectionHead}>
                <Text style={[typography.label, { color: colors.textMuted }]}>ADAPTIVE THRESHOLD</Text>
                {!bwActive && <Text style={[typography.label, { color: colors.warning }]}>B&amp;W DOCUMENT ONLY</Text>}
              </View>
              <View style={{ opacity: bwActive ? 1 : 0.45, gap: spacing.sm }}>
                <Slider label="Block size" value={params.blockSize} min={TUNE_RANGES.blockSize.min} max={TUNE_RANGES.blockSize.max} step={TUNE_RANGES.blockSize.step} onChange={(v) => setParams((p) => ({ ...p, blockSize: v }))} />
                <Slider label="C" value={params.C} min={TUNE_RANGES.C.min} max={TUNE_RANGES.C.max} step={TUNE_RANGES.C.step} onChange={(v) => setParams((p) => ({ ...p, C: v }))} />
              </View>

              <Text style={[typography.label, { color: colors.textMuted, marginTop: spacing.xs }]}>ENHANCE MODE</Text>
              <View style={styles.chips}>
                {MODES.map((m) => (
                  <Chip key={m.mode} label={m.label} selected={mode === m.mode} onPress={() => setMode(m.mode)} />
                ))}
              </View>

              <Pressable onPress={() => setParams(DEFAULTS)} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: spacing.xs }}>
                <Text style={[typography.caption, { color: colors.primaryText, fontWeight: '700' }]}>Reset all</Text>
              </Pressable>
            </Animated.View>
          )}
        </View>

        {message && <Text style={[typography.body, { color: colors.danger }]}>{message}</Text>}

        {/* Summary + play */}
        {result && (
          <View style={[styles.card, card]}>
            <View style={styles.summaryHead}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.heading, { color: colors.text }]}>{source?.name}</Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {result.steps.length} steps, {Math.round(result.ms)} ms in OpenCV
                </Text>
              </View>
              <Pressable
                onPress={play}
                accessibilityRole="button"
                style={[styles.play, { backgroundColor: playing ? colors.surfaceAlt : colors.primary, borderRadius: radius.pill }]}
              >
                <Icon name={playing ? 'pause' : 'play'} size={18} color={playing ? colors.text : colors.onPrimary} />
                <Text style={[typography.heading, { color: playing ? colors.text : colors.onPrimary }]}>{playing ? 'Stop' : 'Play'}</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              <Stat label="Board" value={result.analysis.boardType} />
              <Stat label="Sharpness" value={`${Math.round(result.analysis.blurScore)}`} />
              <Stat label="Page" value={result.detection.found ? `found (${result.detection.strategy})` : 'not found'} />
              <Stat label="Mode" value={modeLabel(result.mode)} />
            </View>
            <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>
              {Object.entries(result.timings)
                .filter(([k]) => k !== 'total')
                .map(([k, v]) => `${k} ${Math.round(v)} ms`)
                .join('  |  ')}
            </Text>
          </View>
        )}

        {/* Stepper */}
        {result && (
          <View
            style={{ opacity: running ? 0.6 : 1 }}
            onLayout={(e) => (layout.current.stepsTop = e.nativeEvent.layout.y)}
          >
            {result.steps.map((step, i) => (
              <View key={step.key} onLayout={(e) => (layout.current.cards[i] = e.nativeEvent.layout.y)}>
                <StepCard
                  index={i}
                  step={step}
                  last={i === result.steps.length - 1}
                  active={active === i}
                  playing={playing}
                  onOpen={() =>
                    setViewer({ uri: uri(step.imageBase64), aspect: step.width / step.height, title: `${i + 1}. ${step.title}`, caption: step.fn })
                  }
                />
              </View>
            ))}
          </View>
        )}

        {/* Histogram */}
        {result && (
          <View
            onLayout={(e) => (layout.current.histTop = e.nativeEvent.layout.y)}
            style={[styles.card, card, active === 'hist' && { borderColor: brand.accent, borderWidth: 2 }]}
          >
            <Text style={[typography.heading, { color: colors.text }]}>Histogram: Original vs Final</Text>
            <Text style={[typography.caption, { color: colors.textMuted, marginBottom: spacing.md }]}>
              A clean scan pushes pixels to the two ends: ink near 0, paper near 255.
            </Text>
            <HistogramCompare original={result.histograms.original} final={result.histograms.final} />
            <Text style={[styles.fn, { color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, marginTop: spacing.md }]}>
              counts of gray values 0 to 255 over the Original and the Final image
            </Text>
          </View>
        )}

        {!result && source && engine.ready && !message && (
          <View style={{ gap: spacing.lg }}>
            {/* Placeholders in the shape of the real step cards while the first run finishes. */}
            <StepCardSkeleton />
            <StepCardSkeleton />
            <StepCardSkeleton />
          </View>
        )}
      </ScrollView>

      <ImageViewer
        uri={viewer?.uri ?? null}
        aspect={viewer?.aspect ?? 1}
        title={viewer?.title}
        caption={viewer?.caption}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

// ------------------------------------------------------------------- pieces

function StepCard({
  index,
  step,
  last,
  active,
  playing,
  onOpen,
}: {
  index: number;
  step: PipelineStep;
  last: boolean;
  active: boolean;
  playing: boolean;
  onOpen: () => void;
}) {
  const { colors, spacing, radius, typography } = useTheme();
  const [imgH, setImgH] = useState(0);
  const glow = useSharedValue(0);
  const sweep = useSharedValue(0);
  const idle = colors.border;

  useEffect(() => {
    glow.value = withTiming(active ? 1 : 0, { duration: 250 });
    sweep.value = 0;
    if (active && playing) sweep.value = withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) });
  }, [active, playing, glow, sweep]);

  const cardStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(glow.value, [0, 1], [idle, brand.accent]),
    borderWidth: 1 + glow.value,
    transform: [{ scale: 1 + glow.value * 0.012 }],
  }));
  const lineStyle = useAnimatedStyle(() => ({
    opacity: sweep.value > 0 && sweep.value < 1 ? 1 : 0,
    transform: [{ translateY: sweep.value * Math.max(0, imgH - 3) }],
  }));

  return (
    <View style={styles.stepRow}>
      <View style={styles.rail}>
        <View style={[styles.badge, { backgroundColor: active ? brand.accent : colors.primary }]}>
          <Text style={[typography.caption, { color: active ? brand.navy : colors.onPrimary, fontWeight: '800' }]}>{index + 1}</Text>
        </View>
        {!last && <View style={[styles.connector, { backgroundColor: colors.border }]} />}
      </View>

      <Animated.View
        style={[
          styles.stepCard,
          { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: last ? 0 : spacing.lg },
          cardStyle,
        ]}
      >
        <View style={styles.stepHead}>
          <Text style={[typography.heading, { color: colors.text, flex: 1 }]}>{step.title}</Text>
          <Text style={[typography.caption, { color: colors.accentText, fontWeight: '700' }]}>{step.ms < 10 ? step.ms.toFixed(1) : Math.round(step.ms)} ms</Text>
        </View>

        <Pressable onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={`${step.title}, tap to view full screen`}>
          <View
            onLayout={(e) => setImgH(e.nativeEvent.layout.height)}
            style={[styles.imgBox, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md }]}
          >
            <Image
              source={{ uri: uri(step.imageBase64) }}
              style={{ width: '100%', aspectRatio: step.width / step.height, maxHeight: 340 }}
              resizeMode="contain"
            />
            <Animated.View pointerEvents="none" style={[styles.scanLine, lineStyle]} />
            <View style={[styles.zoomHint, { backgroundColor: colors.scrim }]}>
              <Text style={styles.zoomHintText}>tap to zoom</Text>
            </View>
          </View>
        </Pressable>

        <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>{step.description}</Text>
        <Text style={[styles.fn, { color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}>{step.fn}</Text>
      </Animated.View>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors, radius, typography } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surfaceAlt, borderRadius: radius.pill }]}
    >
      <Text style={[typography.caption, { color: selected ? colors.onPrimary : colors.text, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md }]}>
      <Text style={[typography.label, { color: colors.textMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[typography.caption, { color: colors.text, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  card: { borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 14, paddingVertical: 10 },
  panelHead: { flexDirection: 'row', alignItems: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  autoPill: { paddingHorizontal: 10, paddingVertical: 5 },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 11 },
  stat: { paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  stepRow: { flexDirection: 'row', gap: 12 },
  rail: { width: 32, alignItems: 'center' },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  connector: { width: 2, flex: 1, marginVertical: 4 },
  stepCard: { flex: 1 },
  stepHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  imgBox: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  scanLine: { position: 'absolute', left: 0, right: 0, top: 0, height: 3, backgroundColor: brand.accent, shadowColor: brand.accent, shadowOpacity: 0.9, shadowRadius: 6, elevation: 4 },
  zoomHint: { position: 'absolute', right: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  zoomHintText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  fn: { fontFamily: MONO, fontSize: 11, lineHeight: 16, marginTop: 8, paddingHorizontal: 10, paddingVertical: 7, overflow: 'hidden' },
  empty: { alignItems: 'center', paddingVertical: 32 },
});
