import { Stack, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ExistingDocSheet,
  Filmstrip,
  Icon,
  ImageViewer,
  InsightsSheet,
  LookBar,
  PagePager,
  ToolButton,
  useToast,
  type LookId,
} from '../../src/components';
import { EngineError, useEngine } from '../../src/engine';
import {
  clearScanSession,
  getDoc,
  savePages,
  setCaptureBatch,
  setLabSource,
  setScanSession,
  updateScanSession,
  useScanSession,
  type Doc,
  type Look,
} from '../../src/store';
import { motion, useTheme } from '../../src/theme';
import {
  alertPickError,
  applyLookToPages,
  findDuplicates,
  haptic,
  pageQuality,
  pickImages,
  popToBase,
  removePage,
  replacePage,
  rotatePage,
  type CaptureSource,
} from '../../src/utils';

/** expo-router's navigation type leaves out the stack's `beforeRemove` event, so type just what is used. */
type BeforeRemoveEvent = { preventDefault: () => void; data: { action: unknown } };
type StackNavigation = {
  addListener: (type: 'beforeRemove', cb: (e: BeforeRemoveEvent) => void) => () => void;
  dispatch: (action: unknown) => void;
};

type Busy = { kind: 'look' | 'rotate' | 'save'; indices: number[]; done: number; total: number } | null;
type Banner = { key: string; text: string; action?: { label: string; onPress: () => void } };

/**
 * Review: every scanned page in one place. Swipe or tap the filmstrip to move between pages, press and hold a
 * page to compare it with the original, change the look of ONE page or ALL pages, crop / adjust / rotate / retake
 * / delete per page, spot blurry or duplicate pages, then save everything as one scan.
 */
export default function ReviewScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation() as unknown as StackNavigation;
  const engine = useEngine();
  const toast = useToast();
  const session = useScanSession();

  const engineRef = useRef(engine);
  engineRef.current = engine;
  const alive = useRef(true);
  const allowLeave = useRef(false);
  const cancel = useRef(false);

  const items = useMemo(() => session?.items ?? [], [session]);
  const index = Math.min(session?.index ?? 0, Math.max(0, items.length - 1));
  const page = items[index];
  const scope = session?.scope ?? 'one';

  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [insights, setInsights] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [existing, setExisting] = useState(false);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancel.current = true;
    };
  }, []);

  // ------------------------------------------------------------- derived
  const qualities = useMemo(() => items.map((p) => pageQuality(p)), [items]);
  const duplicates = useMemo(() => findDuplicates(items.map((p) => p.fingerprint)), [items]);
  const duplicateOf = useMemo(() => {
    const out: (number | undefined)[] = items.map(() => undefined);
    duplicates.forEach((d) => (out[d.index] = d.of));
    return out;
  }, [items, duplicates]);
  const busySet = useMemo(() => new Set(busy?.indices ?? []), [busy]);

  // Name of the saved scan these pages are headed for (when they came from a document's "Add page").
  const docId = session?.docId;
  useEffect(() => {
    if (!docId) {
      setTargetName(null);
      return;
    }
    let live = true;
    void getDoc(docId).then((r) => live && setTargetName(r.ok ? r.value.name : null));
    return () => {
      live = false;
    };
  }, [docId]);

  // ------------------------------------------------- never lose pages by accident
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (allowLeave.current || !session || items.length === 0) return;
      e.preventDefault();
      Alert.alert(
        'Discard this scan?',
        `${items.length} scanned ${items.length === 1 ? 'page' : 'pages'} will be lost.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              allowLeave.current = true;
              clearScanSession();
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
  }, [navigation, session, items.length]);

  // ------------------------------------------------------------- actions
  const setIndex = useCallback((i: number) => updateScanSession((s) => (s.index === i ? s : { ...s, index: i })), []);
  const setScope = useCallback((sc: 'one' | 'all') => updateScanSession((s) => ({ ...s, scope: sc })), []);
  const targetIndices = () => (scope === 'all' ? items.map((_, i) => i) : [index]);

  const progressTo = (done: number) => alive.current && setBusy((b) => (b ? { ...b, done } : b));

  const applyLook = async (id: LookId) => {
    if (!session || busy || !page) return;
    const look: Look = { mode: id, params: {} };
    const indices = targetIndices();
    haptic.tap();
    cancel.current = false;
    setBusy({ kind: 'look', indices, done: 0, total: indices.length });
    try {
      const res = await applyLookToPages(engineRef.current.run, items, indices, look, {
        onProgress: progressTo,
        shouldCancel: () => cancel.current,
      });
      updateScanSession((s) => (s.items.length === res.items.length ? { ...s, items: res.items } : s));
      if (res.failed.length > 0) toast.error(`${res.failed.length} ${res.failed.length === 1 ? 'page' : 'pages'} could not be updated`);
      else if (res.cancelled) toast.info('Stopped. The remaining pages were left as they were.');
      else if (indices.length > 1) toast.success(`Applied to ${indices.length} pages`);
    } catch (e) {
      toast.error(e instanceof EngineError ? e.userMessage : 'That look could not be applied.');
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const rotate = async () => {
    if (!session || busy || !page) return;
    const indices = targetIndices();
    haptic.tap();
    cancel.current = false;
    setBusy({ kind: 'rotate', indices, done: 0, total: indices.length });
    let failed = 0;
    try {
      for (let n = 0; n < indices.length; n++) {
        if (cancel.current || !alive.current) break;
        const source = items[indices[n]];
        try {
          const turned = await rotatePage(engineRef.current.run, source);
          updateScanSession((s) => {
            const at = s.items.findIndex((p) => p.id === turned.id);
            return at < 0 ? s : replacePage(s, at, turned);
          });
        } catch {
          failed += 1;
        }
        progressTo(n + 1);
      }
      if (failed > 0) toast.error(`${failed} ${failed === 1 ? 'page' : 'pages'} could not be rotated`);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const goCrop = () => {
    if (busy) return;
    router.push('/scan/crop');
  };
  const goAdjust = () => {
    if (busy) return;
    router.push('/scan/enhance');
  };

  const pickFor = async (source: CaptureSource, target: { kind: 'append' } | { kind: 'replace'; index: number }) => {
    const picked = await pickImages(source);
    if (picked.kind === 'error') await alertPickError(picked);
    if (picked.kind !== 'ok') return;
    setCaptureBatch({ source, picks: picked.picks, target, docId: session?.docId });
    router.push('/scan/process');
  };

  const addMore = () => {
    if (busy) return;
    Alert.alert('Add more pages', 'Where should they come from?', [
      { text: 'Camera', onPress: () => void pickFor('camera', { kind: 'append' }) },
      { text: 'Gallery', onPress: () => void pickFor('gallery', { kind: 'append' }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const retake = (at = index) => {
    if (busy || !session) return;
    void pickFor(session.source, { kind: 'replace', index: at });
  };

  const deletePageAt = (at: number, message: string) => {
    if (!session) return;
    Alert.alert(`Delete page ${at + 1}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          haptic.warning();
          const next = removePage(session, at);
          if (next) {
            setScanSession(next);
            return;
          }
          // That was the last page: the scan is empty, so leave.
          allowLeave.current = true;
          clearScanSession();
          router.back();
        },
      },
    ]);
  };

  const deleteCurrent = () => {
    if (busy) return;
    deletePageAt(
      index,
      items.length === 1 ? 'This is the only page, so the whole scan will be discarded.' : 'The page will be removed from this scan.',
    );
  };

  const openLab = () => {
    if (!page) return;
    setInsights(false);
    // The original 1600 px photo: the Lab shows what every stage did to it.
    setLabSource({ base64: page.base64, width: page.width, height: page.height, name: `Page ${index + 1}` });
    router.push('/lab');
  };

  const save = async () => {
    if (!session || busy || items.length === 0) return;
    haptic.light();
    setBusy({ kind: 'save', indices: [], done: 0, total: 0 });
    const pages = items.map((p) => ({ base64: p.final.base64, width: p.final.width, height: p.final.height }));
    const res = await savePages(session.docId, pages);
    if (!res.ok) {
      if (alive.current) setBusy(null);
      toast.error(res.message);
      return;
    }
    allowLeave.current = true;
    const n = items.length;
    const savedId = res.value.id;
    const target = session.docId;
    clearScanSession();
    if (target) popToBase(router, target);
    else {
      router.dismissAll();
      router.push({ pathname: '/doc/[id]', params: { id: savedId } });
    }
    toast.success(target ? `Added ${n} ${n === 1 ? 'page' : 'pages'}` : `Saved ${n} ${n === 1 ? 'page' : 'pages'}`);
  };

  const moreOptions = () => {
    if (busy || !session) return;
    const discard = {
      text: 'Discard scan',
      style: 'destructive' as const,
      onPress: () => {
        allowLeave.current = true;
        clearScanSession();
        router.back();
      },
    };
    if (session.docId) {
      Alert.alert('More options', undefined, [
        { text: 'Save as a new scan instead', onPress: () => updateScanSession((s) => ({ ...s, docId: undefined })) },
        discard,
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      Alert.alert('More options', undefined, [{ text: 'Add to an existing scan...', onPress: () => setExisting(true) }, discard, { text: 'Cancel', style: 'cancel' }]);
    }
  };

  const chooseDoc = (doc: Doc) => {
    setExisting(false);
    setTargetName(doc.name);
    updateScanSession((s) => ({ ...s, docId: doc.id }));
    haptic.tap();
    toast.info(`These pages will be added to "${doc.name}"`);
  };

  // -------------------------------------------------------------- banners
  const banners: Banner[] = useMemo(() => {
    const out: Banner[] = [];
    const dup = duplicates[0];
    if (dup) {
      const key = `dup:${items[dup.index].id}`;
      if (!dismissed.has(key)) {
        out.push({
          key,
          text: `Page ${dup.index + 1} looks like a duplicate of page ${dup.of + 1}.`,
          action: { label: 'Review', onPress: () => setIndex(dup.index) },
        });
      }
    }
    const missing = qualities.map((q, i) => (q.issues.some((x) => x.id === 'no_page') ? i : -1)).filter((i) => i >= 0);
    if (missing.length > 0) {
      const key = `nopage:${missing.map((i) => items[i].id).join(',')}`;
      if (!dismissed.has(key)) {
        out.push({
          key,
          text: missing.length === 1 ? `Page ${missing[0] + 1}: no page edges found. Adjust the crop.` : `${missing.length} pages have no edges found. Adjust their crops.`,
          action: { label: 'Go', onPress: () => setIndex(missing[0]) },
        });
      }
    }
    const blurry = qualities.map((q, i) => (q.issues.some((x) => x.id === 'blurry') ? i : -1)).filter((i) => i >= 0);
    if (blurry.length > 0) {
      const key = `blur:${blurry.map((i) => items[i].id).join(',')}`;
      if (!dismissed.has(key)) {
        out.push({
          key,
          text: blurry.length === 1 ? `Page ${blurry[0] + 1} looks blurry.` : `${blurry.length} pages look blurry.`,
          action: { label: 'Show', onPress: () => setIndex(blurry[0]) },
        });
      }
    }
    return out.slice(0, 2);
  }, [duplicates, qualities, items, dismissed, setIndex]);

  // ---------------------------------------------------------------- render
  if (!session || !page) {
    if (allowLeave.current) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Review' }} />
        <Text style={[typography.heading, { color: colors.text }]}>Nothing to review</Text>
        <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
          Scan a page or import photos from Home to get started.
        </Text>
        <Pressable onPress={() => router.replace('/')} style={[styles.pill, { backgroundColor: colors.primary, borderRadius: radius.pill, marginTop: spacing.xl }]}>
          <Text style={[typography.heading, { color: colors.onPrimary }]}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  const n = items.length;
  const looksAll = items.every((p) => p.look.mode === items[0].look.mode) ? items[0].look.mode : null;
  const selectedLook: LookId | null = scope === 'all' ? looksAll : page.look.mode;
  const working = busy !== null;
  const saveLabel = session.docId ? `Add ${n} ${n === 1 ? 'page' : 'pages'}${targetName ? ` to ${targetName}` : ''}` : `Save ${n} ${n === 1 ? 'page' : 'pages'}`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: `${n} ${n === 1 ? 'page' : 'pages'}`,
          headerRight: () => (
            <Pressable onPress={addMore} hitSlop={10} accessibilityLabel="Add more pages" style={styles.headerBtn}>
              <Icon name="plus" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      {/* Things worth a look */}
      {banners.map((b) => (
        <Animated.View
          key={b.key}
          entering={FadeInDown.duration(motion.base)}
          exiting={FadeOutUp.duration(motion.fast)}
          style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.md }]}
        >
          <Icon name="info" size={18} color={colors.warning} />
          <Text style={[typography.caption, { color: colors.text, flex: 1 }]}>{b.text}</Text>
          {b.action && (
            <Pressable onPress={b.action.onPress} hitSlop={8}>
              <Text style={[typography.caption, { color: colors.primaryText, fontWeight: '800' }]}>{b.action.label}</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setDismissed((d) => new Set(d).add(b.key))} hitSlop={10} accessibilityLabel="Dismiss">
            <Icon name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </Animated.View>
      ))}

      <PagePager
        pages={items}
        index={index}
        onIndexChange={setIndex}
        comparing={comparing}
        onCompare={setComparing}
        qualities={qualities}
        duplicateOf={duplicateOf}
        busy={busySet}
        onOpenInsights={() => setInsights(true)}
        onOpenViewer={() => setViewer(true)}
      />

      {working && busy.kind !== 'save' && busy.total > 1 && (
        <View style={[styles.progress, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.pill }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[typography.caption, { color: colors.text, fontWeight: '700' }]}>
            {busy.kind === 'rotate' ? 'Rotating' : 'Applying'} {busy.done} of {busy.total}
          </Text>
          <Pressable onPress={() => (cancel.current = true)} hitSlop={10}>
            <Text style={[typography.caption, { color: colors.primaryText, fontWeight: '800' }]}>Stop</Text>
          </Pressable>
        </View>
      )}

      <Filmstrip pages={items} index={index} onSelect={setIndex} onAdd={addMore} qualities={qualities} duplicateOf={duplicateOf} busy={busySet} />

      <LookBar pageCount={n} scope={scope} onScope={setScope} selected={selectedLook} onPick={applyLook} disabled={working} />

      <View style={styles.tools}>
        <ToolButton icon="frame" label="Crop" onPress={goCrop} disabled={working} />
        <ToolButton icon="auto" label="Adjust" onPress={goAdjust} disabled={working} />
        <ToolButton icon="rotate" label={scope === 'all' && n > 1 ? 'Rotate all' : 'Rotate'} onPress={() => void rotate()} disabled={working} />
        <ToolButton icon="camera" label="Retake" onPress={() => retake()} disabled={working} />
        <ToolButton icon="trash" label="Delete" onPress={deleteCurrent} disabled={working} />
      </View>

      <View style={[styles.saveBar, { paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.border }]}>
        <Pressable
          onPress={moreOptions}
          disabled={working}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="More options"
          style={[styles.more, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, opacity: working ? 0.5 : 1 }]}
        >
          <Icon name="dots" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => void save()}
          disabled={working}
          accessibilityRole="button"
          style={[styles.save, { backgroundColor: colors.primary, borderRadius: radius.pill, opacity: working ? 0.6 : 1 }]}
        >
          {busy?.kind === 'save' ? <ActivityIndicator color={colors.onPrimary} /> : <Icon name="check" size={20} color={colors.onPrimary} />}
          <Text numberOfLines={1} style={[typography.heading, { color: colors.onPrimary, flexShrink: 1 }]}>
            {saveLabel}
          </Text>
        </Pressable>
      </View>

      <InsightsSheet
        visible={insights}
        page={page}
        position={index}
        quality={qualities[index]}
        onClose={() => setInsights(false)}
        onOpenLab={openLab}
        onRetake={() => {
          setInsights(false);
          retake();
        }}
      />
      <ImageViewer
        uri={viewer ? `data:image/jpeg;base64,${page.final.base64}` : null}
        aspect={page.final.width / page.final.height}
        title={`Page ${index + 1} of ${n}`}
        caption={`${page.appliedMode.replace('_', ' ')}`}
        onClose={() => setViewer(false)}
      />
      <ExistingDocSheet visible={existing} onPick={chooseDoc} onClose={() => setExisting(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  pill: { paddingHorizontal: 24, paddingVertical: 14 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1 },
  progress: { position: 'absolute', alignSelf: 'center', top: 120, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, zIndex: 5, elevation: 6 },
  tools: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 6, paddingTop: 10 },
  saveBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  more: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  save: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16 },
});
