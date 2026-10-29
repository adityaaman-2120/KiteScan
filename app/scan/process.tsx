import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { ZoomIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlurSheet, ScanningPreview, useToast } from '../../src/components';
import { EngineError, useEngine } from '../../src/engine';
import { getScanSession, setScanSession, takeCaptureBatch, updateScanSession, type ScannedImage } from '../../src/store';
import { motion, useTheme } from '../../src/theme';
import { alertPickError, appendPages, haptic, pickImages, prepareForEngine, replacePage, scanPhoto, type RawPick } from '../../src/utils';

type Outcome = { kind: 'ok'; page: ScannedImage } | { kind: 'failed'; message: string } | { kind: 'cancelled' };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const notify = (title: string, message: string) =>
  new Promise<void>((resolve) => Alert.alert(title, message, [{ text: 'OK', onPress: () => resolve() }], { onDismiss: () => resolve() }));

/**
 * Scans every photo of a capture batch (one engine call each: quality report, page detection, flattening,
 * enhancement, thumbnail, fingerprint). Finished pages appear in a live filmstrip. Nothing interrupts a batch;
 * problems are flagged on the review screen instead. A single blurry photo still gets the retake sheet.
 */
export default function ProcessScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const engine = useEngine();
  const toast = useToast();

  const engineRef = useRef(engine);
  engineRef.current = engine;
  const alive = useRef(true);
  const started = useRef(false);
  const stop = useRef(false);
  const sheetResolver = useRef<((choice: 'retake' | 'use') => void) | null>(null);

  const [preview, setPreview] = useState<{ uri: string; aspect: number } | null>(null);
  const [step, setStep] = useState('Getting ready...');
  const [progress, setProgress] = useState({ index: 0, total: 0 });
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [sheet, setSheet] = useState<{ sharpness: number; uri: string } | null>(null);

  const bar = useSharedValue(0);
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.round(bar.value * 100)}%` }));
  useEffect(() => {
    bar.value = withTiming(progress.total > 0 ? progress.index / progress.total : 0, { duration: motion.base });
  }, [progress, bar]);

  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true; // run once even if React re-mounts the effect: a batch can only be taken one time
      void run();
    }
    return () => {
      alive.current = false;
      sheetResolver.current?.('retake'); // never leave the loop waiting on a sheet that is gone
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askBlurry = (sharpness: number, uri: string) =>
    new Promise<'retake' | 'use'>((resolve) => {
      sheetResolver.current = (choice) => {
        sheetResolver.current = null;
        setSheet(null);
        resolve(choice);
      };
      setSheet({ sharpness, uri });
    });

  /** The engine queues requests, but "warming up" beats a silent wait on the first launch. */
  async function waitForEngine(): Promise<string | null> {
    const start = Date.now();
    while (alive.current) {
      const status = engineRef.current.status;
      if (status === 'ready') return null;
      if (status === 'error') return engineRef.current.errorMessage ?? 'The scan engine could not start.';
      if (Date.now() - start > 120_000) return 'The scan engine took too long to start. Please try again.';
      setStep('Warming up the engine...');
      await sleep(200);
    }
    return null;
  }

  async function scanOne(pick: RawPick): Promise<Outcome> {
    try {
      setPreview({ uri: pick.uri, aspect: pick.width / pick.height });
      setStep('Resizing to 1600 px...');
      const prepared = await prepareForEngine(pick.uri, pick.width, pick.height);
      if (!alive.current) return { kind: 'cancelled' };
      if (!prepared.ok) return { kind: 'failed', message: prepared.message };
      setPreview({ uri: pick.uri, aspect: prepared.image.width / prepared.image.height });

      const problem = await waitForEngine();
      if (!alive.current) return { kind: 'cancelled' };
      if (problem) return { kind: 'failed', message: problem };

      setStep('Finding the page, flattening, enhancing...');
      const page = await scanPhoto(engineRef.current.run, prepared.image, pick);
      if (!alive.current) return { kind: 'cancelled' };
      return { kind: 'ok', page };
    } catch (e) {
      return { kind: 'failed', message: e instanceof EngineError ? e.userMessage : 'This photo could not be scanned. Please try another.' };
    }
  }

  async function run() {
    const batch = takeCaptureBatch();
    if (!batch) {
      router.replace('/');
      return;
    }
    let picks = batch.target.kind === 'replace' ? batch.picks.slice(0, 1) : batch.picks;
    const pages: ScannedImage[] = [];
    const failures: string[] = [];

    let i = 0;
    while (i < picks.length) {
      if (!alive.current) return;
      if (stop.current) break;
      setProgress({ index: i, total: picks.length });

      const out = await scanOne(picks[i]);
      if (!alive.current || out.kind === 'cancelled') return;
      if (out.kind === 'failed') {
        failures.push(out.message);
        i += 1;
        continue;
      }

      // One photo, and it is blurry: let the user retake it right away. (Batches are never interrupted.)
      if (picks.length === 1 && out.page.analysis.isBlurry) {
        haptic.warning();
        setStep('Waiting for your choice...');
        const choice = await askBlurry(out.page.analysis.blurScore, picks[0].uri);
        if (!alive.current) return;
        if (choice === 'retake') {
          const again = await pickImages(batch.source);
          if (!alive.current) return;
          if (again.kind === 'error') await alertPickError(again);
          if (again.kind === 'ok') {
            picks = again.picks;
            setThumbs([]);
            i = 0;
            continue;
          }
          break; // cancelled: nothing is added
        }
      }

      pages.push(out.page);
      setThumbs((t) => [...t, out.page.thumbBase64]);
      i += 1;
    }
    if (!alive.current) return;
    setProgress({ index: picks.length, total: picks.length });

    if (failures.length > 0) {
      const unique = Array.from(new Set(failures));
      await notify(failures.length === 1 ? 'One photo was skipped' : `${failures.length} photos were skipped`, unique.join('\n'));
      if (!alive.current) return;
    }
    if (pages.length === 0) {
      router.back();
      return;
    }

    const existing = getScanSession();
    const { target } = batch;
    if (target.kind === 'append' && existing) {
      updateScanSession((s) => appendPages(s, pages));
      toast.success(pages.length === 1 ? 'Page added' : `${pages.length} pages added`);
      router.back();
    } else if (target.kind === 'replace' && existing) {
      updateScanSession((s) => replacePage(s, target.index, { ...pages[0], id: s.items[target.index]?.id ?? pages[0].id }));
      toast.success('Page replaced');
      router.back();
    } else {
      setScanSession({ source: batch.source, items: pages, index: 0, docId: batch.docId, scope: 'one' });
      router.replace('/scan/review');
    }
  }

  const total = progress.total;
  const label = total > 1 ? `Scanning page ${Math.min(progress.index + 1, total)} of ${total}` : 'Scanning';
  const maxW = width - spacing.xl * 2;
  const maxH = Math.max(160, height - insets.top - insets.bottom - 380);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <Text style={[typography.label, { color: colors.textMuted, textAlign: 'center' }]}>{label.toUpperCase()}</Text>

      <View style={styles.center}>
        {preview ? <ScanningPreview uri={preview.uri} aspect={preview.aspect} maxWidth={maxW} maxHeight={maxH} /> : null}
        <Text style={[typography.heading, { color: colors.text, marginTop: spacing.lg, textAlign: 'center' }]}>{step}</Text>
        {total > 1 && (
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt, marginTop: spacing.md }]}>
            <Animated.View style={[styles.fill, { backgroundColor: colors.accentText }, barStyle]} />
          </View>
        )}
        <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>Everything happens on this phone.</Text>
      </View>

      {/* Pages that are already done appear here, one by one. */}
      {thumbs.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.xs }}>
          {thumbs.map((t, i) => (
            <Animated.View key={i} entering={ZoomIn.duration(motion.base)} style={[styles.thumb, { borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }]}>
              <Image source={{ uri: `data:image/jpeg;base64,${t}` }} style={styles.thumbImg} resizeMode="cover" />
              <View style={[styles.num, { backgroundColor: colors.scrim }]}>
                <Text style={styles.numText}>{i + 1}</Text>
              </View>
            </Animated.View>
          ))}
        </ScrollView>
      )}

      <Pressable
        onPress={() => {
          if (thumbs.length > 0) stop.current = true; // keep what is already scanned and go review it
          else router.back();
        }}
        hitSlop={12}
        style={styles.cancel}
      >
        <Text style={[typography.heading, { color: colors.textMuted }]}>{thumbs.length > 0 && total > 1 ? 'Stop and review' : 'Cancel'}</Text>
      </Pressable>

      <BlurSheet
        visible={sheet !== null}
        sharpness={sheet?.sharpness ?? 0}
        previewUri={sheet?.uri}
        onRetake={() => sheetResolver.current?.('retake')}
        onUseAnyway={() => sheetResolver.current?.('use')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  track: { width: '70%', height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  strip: { flexGrow: 0, marginBottom: 12 },
  thumb: { width: 54, height: 72, borderWidth: 1, overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  num: { position: 'absolute', left: 3, top: 3, minWidth: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center' },
  numText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  cancel: { alignSelf: 'center', padding: 8 },
});
