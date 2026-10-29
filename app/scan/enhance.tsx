import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompareView, Icon, Slider, useToast } from '../../src/components';
import { EngineError, useEngine, type EnhanceMode, type EnhanceParams } from '../../src/engine';
import { updateScanSession, useScanSession, type Look } from '../../src/store';
import { motion, useTheme } from '../../src/theme';
import {
  DEFAULT_TUNE,
  ENHANCE_MODES,
  EnhanceCache,
  PAGE_JPEG_QUALITY,
  TUNE_RANGES,
  applyLookToPages,
  cacheKey,
  haptic,
  modeLabel,
  relevantParams,
  relook,
  replacePage,
  tunableKeys,
  type PreparedImage,
  type TuneKey,
} from '../../src/utils';

const SLIDER_DEBOUNCE_MS = 350;
const dataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;

/**
 * Fine tune: the detailed editor for ONE page of the scan. Compare before/after with the divider, pick a look,
 * adjust its parameters, and apply the result to this page or to every page. Returns to the review screen.
 */
export default function FineTuneScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const engine = useEngine();
  const toast = useToast();
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const session = useScanSession();
  const page = session?.items[session.index];
  const pageCount = session?.items.length ?? 0;

  // Start from the look the page has now; its parameters seed that mode's sliders.
  const initial = useRef<{ mode: EnhanceMode; params: Record<EnhanceMode, EnhanceParams> } | null>(null);
  if (!initial.current && page) {
    initial.current = {
      mode: page.appliedMode,
      params: { ...DEFAULT_TUNE, [page.appliedMode]: { ...DEFAULT_TUNE[page.appliedMode], ...page.look.params } },
    };
  }

  const [mode, setMode] = useState<EnhanceMode>(initial.current?.mode ?? 'document_bw');
  const [params, setParams] = useState<Record<EnhanceMode, EnhanceParams>>(() => initial.current?.params ?? { ...DEFAULT_TUNE });
  const [result, setResult] = useState<PreparedImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(true);
  const [applyAll, setApplyAll] = useState(() => (session ? session.scope === 'all' && pageCount > 1 : false));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const cache = useRef(new EnhanceCache<PreparedImage>()).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const cancel = useRef(false);
  const warped = page?.warped;
  const warpedRef = useRef(warped);
  warpedRef.current = warped;

  useEffect(
    () => () => {
      alive.current = false;
      cancel.current = true;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Shows the result for (mode, params): from the cache when it exists (instant), otherwise computed by the
   * engine after `delay` ms. The delay debounces slider drags into one re-processing.
   */
  const show = useCallback(
    (m: EnhanceMode, p: EnhanceParams, delay: number) => {
      const source = warpedRef.current;
      if (!source) return;
      if (timer.current) clearTimeout(timer.current);

      const key = cacheKey(cache.currentEpoch, m, p);
      const compute = async (): Promise<PreparedImage> => {
        if (m === 'original') return source; // nothing to compute
        const r = await engineRef.current.run(
          'enhance',
          { imageBase64: source.base64, mode: m, quality: PAGE_JPEG_QUALITY, ...relevantParams(m, p) },
          45_000,
        );
        return { base64: r.imageBase64, width: r.width, height: r.height };
      };
      const finish = async () => {
        try {
          const out = await cache.request(key, compute);
          if (!alive.current || !out.isLatest) return;
          setResult(out.value);
          setLoading(false);
        } catch (e) {
          if (!alive.current) return;
          setLoading(false);
          toast.error(e instanceof EngineError ? e.userMessage : 'Something went wrong. Please try another look.');
        }
      };

      if (cache.peek(key)) {
        void finish(); // resolves immediately from the cache
        return;
      }
      setLoading(true);
      if (delay > 0) timer.current = setTimeout(() => void finish(), delay);
      else void finish();
    },
    [cache, toast],
  );

  // Show the page's current look as soon as the screen opens.
  useEffect(() => {
    if (warped) show(mode, params[mode], 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warped?.base64]);

  const selectMode = (m: EnhanceMode) => {
    if (m === mode) return;
    haptic.tap();
    setMode(m);
    show(m, params[m], 0);
  };

  const changeParam = (key: TuneKey, value: number) => {
    const next = { ...params[mode], [key]: value };
    setParams((prev) => ({ ...prev, [mode]: next }));
    show(mode, next, SLIDER_DEBOUNCE_MS);
  };

  const resetParams = () => {
    setParams((prev) => ({ ...prev, [mode]: { ...DEFAULT_TUNE[mode] } }));
    show(mode, DEFAULT_TUNE[mode], 0);
  };

  // ------------------------------------------------------------------ done
  const onDone = async () => {
    if (!session || !page || saving) return;
    const look: Look = { mode, params: relevantParams(mode, params[mode]) };
    setSaving(true);
    cancel.current = false;
    try {
      if (applyAll && pageCount > 1) {
        const indices = session.items.map((_, i) => i);
        setProgress({ done: 0, total: indices.length });
        const res = await applyLookToPages(engineRef.current.run, session.items, indices, look, {
          onProgress: (done, total) => alive.current && setProgress({ done, total }),
          shouldCancel: () => cancel.current,
        });
        updateScanSession((s) => ({ ...s, items: res.items, scope: 'all' }));
        if (res.failed.length) toast.error(`${res.failed.length} ${res.failed.length === 1 ? 'page' : 'pages'} could not be updated`);
        else toast.success(`Applied to all ${pageCount} pages`);
      } else {
        const updated = await relook(engineRef.current.run, page, look);
        updateScanSession((s) => replacePage(s, s.index, updated));
        haptic.success();
      }
      router.back();
    } catch (e) {
      toast.error(e instanceof EngineError ? e.userMessage : 'Could not apply that look. Please try again.');
    } finally {
      if (alive.current) {
        setSaving(false);
        setProgress(null);
      }
    }
  };

  // ----------------------------------------------------------------- render
  const beforeUri = useMemo(() => (warped ? dataUri(warped.base64) : ''), [warped]);
  const afterUri = useMemo(() => (result ? dataUri(result.base64) : beforeUri), [result, beforeUri]);

  if (!session || !page || !warped) {
    return (
      <View style={styles.center}>
        <Text style={[typography.heading, { color: colors.text }]}>Nothing to edit</Text>
        <Pressable onPress={() => router.replace('/')} style={[styles.pill, { backgroundColor: colors.primary, borderRadius: radius.pill, marginTop: spacing.xl }]}>
          <Text style={[typography.heading, { color: colors.onPrimary }]}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  const keys = tunableKeys(mode);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CompareView beforeUri={beforeUri} afterUri={afterUri} aspect={warped.width / warped.height} afterLabel={modeLabel(mode)} loading={loading} />

      {/* Mode chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {ENHANCE_MODES.map(({ mode: m, label }) => {
          const selected = m === mode;
          const isSmart = m === page.appliedMode && page.look.mode === 'auto';
          return (
            <Pressable
              key={m}
              onPress={() => selectMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primary : colors.surfaceAlt,
                  borderColor: selected ? colors.primary : colors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <Text style={[typography.caption, { color: selected ? colors.onPrimary : colors.text, fontWeight: '700' }]}>{label}</Text>
              {isSmart && <Text style={[styles.autoTag, { color: selected ? '#fff' : colors.accentText }]}>SMART PICK</Text>}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Fine tune */}
      <View style={[styles.tune, { borderTopColor: colors.border, paddingHorizontal: spacing.lg }]}>
        <Pressable onPress={() => setTuneOpen((o) => !o)} style={styles.tuneHead} accessibilityRole="button" accessibilityState={{ expanded: tuneOpen }}>
          <Text style={[typography.heading, { color: colors.text, flex: 1 }]}>Adjust</Text>
          {loading && <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />}
          <View style={{ transform: [{ rotate: tuneOpen ? '180deg' : '0deg' }] }}>
            <Icon name="chevron-down" size={22} color={colors.textMuted} />
          </View>
        </Pressable>
        {tuneOpen && (
          <Animated.View entering={motion.panel()} style={{ paddingBottom: spacing.sm }}>
            {keys.length === 0 ? (
              <Text style={[typography.caption, { color: colors.textMuted, paddingBottom: spacing.sm }]}>{modeLabel(mode)} has no adjustable settings.</Text>
            ) : (
              <>
                {keys.map((k) => (
                  <Slider
                    key={`${mode}-${k}`}
                    label={TUNE_RANGES[k].label}
                    value={params[mode][k] ?? DEFAULT_TUNE[mode][k] ?? TUNE_RANGES[k].min}
                    min={TUNE_RANGES[k].min}
                    max={TUNE_RANGES[k].max}
                    step={TUNE_RANGES[k].step}
                    onChange={(v) => changeParam(k, v)}
                  />
                ))}
                <Pressable onPress={resetParams} hitSlop={8} style={{ alignSelf: 'flex-end' }}>
                  <Text style={[typography.caption, { color: colors.primaryText, fontWeight: '700' }]}>Reset</Text>
                </Pressable>
              </>
            )}
          </Animated.View>
        )}
      </View>

      {/* Scope + done */}
      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md, paddingHorizontal: spacing.lg, borderTopColor: colors.border }]}>
        {pageCount > 1 && (
          <View style={styles.allRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.heading, { color: colors.text, fontSize: 15 }]}>Apply to all {pageCount} pages</Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>{applyAll ? 'Every page gets this look.' : `Only page ${session.index + 1} changes.`}</Text>
            </View>
            <Switch
              value={applyAll}
              onValueChange={(v) => {
                haptic.tap();
                setApplyAll(v);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        )}
        <Pressable
          onPress={onDone}
          disabled={saving || loading || !result}
          accessibilityRole="button"
          style={[styles.save, { backgroundColor: colors.primary, borderRadius: radius.pill, opacity: saving || loading || !result ? 0.55 : 1 }]}
        >
          {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Icon name="check" size={20} color={colors.onPrimary} />}
          <Text style={[typography.heading, { color: colors.onPrimary }]}>
            {saving && progress ? `Applying ${progress.done} of ${progress.total}...` : applyAll && pageCount > 1 ? `Apply to all ${pageCount} pages` : 'Done'}
          </Text>
        </Pressable>
        {saving && progress && (
          <Pressable onPress={() => (cancel.current = true)} hitSlop={8} style={{ alignSelf: 'center', marginTop: spacing.sm }}>
            <Text style={[typography.caption, { color: colors.textMuted, fontWeight: '700' }]}>Stop</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  pill: { paddingHorizontal: 24, paddingVertical: 14 },
  chipScroll: { flexGrow: 0, paddingVertical: 10 },
  chip: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  autoTag: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 1 },
  tune: { borderTopWidth: StyleSheet.hairlineWidth },
  tuneHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  bar: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
});
