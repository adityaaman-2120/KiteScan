import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DocGridSkeleton,
  ExportProgressModal,
  Icon,
  ImageViewer,
  PageGrid,
  PagePickerSheet,
  RenameModal,
  Skeleton,
  useToast,
  type IconName,
} from '../../src/components';
import {
  deleteDoc,
  deletePage,
  formatDocDate,
  getDoc,
  pageUri,
  renameDoc,
  reorderPages,
  setCaptureBatch,
  type Doc,
  type PageMeta,
} from '../../src/store';
import { motion, useTheme } from '../../src/theme';
import {
  BIG_EXPORT_BYTES,
  alertPickError,
  estimateExportBytes,
  exportPdf,
  haptic,
  pickImages,
  shareImage,
  type CaptureSource,
  type ExportProgress,
} from '../../src/utils';

const PADDING = 16;

/** A document: page thumbnails (drag to reorder, tap to open, delete), add a page, rename. */
export default function DocScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState<ExportProgress | null>(null);
  const [sharing, setSharing] = useState(false);
  const [picker, setPicker] = useState(false);
  const cancelExport = useRef(false);

  // Scroll state shared with the grid so a dragged page can auto-scroll the list.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewport = useSharedValue({ top: 0, height: 0 });
  const contentHeight = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const load = useCallback(async () => {
    const res = await getDoc(String(id));
    setDoc(res.ok ? res.value : null);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ---------------------------------------------------------------- actions
  const saveName = async (name: string) => {
    setRenaming(false);
    if (!doc) return;
    const res = await renameDoc(doc.id, name);
    if (res.ok) {
      setDoc(res.value);
      toast.success('Renamed');
    } else toast.error(res.message);
  };

  const onReorder = async (files: string[]) => {
    if (!doc) return;
    const byFile = new Map(doc.pages.map((p) => [p.file, p]));
    // Show the new order at once, then persist it; reload if the store refuses.
    setDoc({ ...doc, pages: files.map((f) => byFile.get(f)).filter((p): p is PageMeta => !!p) });
    const res = await reorderPages(doc.id, files);
    if (res.ok) setDoc(res.value);
    else {
      toast.error(res.message);
      void load();
    }
  };

  const confirmDeletePage = (page: PageMeta) => {
    if (!doc) return;
    const index = doc.pages.findIndex((p) => p.file === page.file);
    const last = doc.pages.length === 1;
    Alert.alert(
      last ? 'Delete this scan?' : `Delete page ${index + 1}?`,
      last ? 'This is the only page, so the whole scan will be removed from this phone.' : 'The page will be removed from this phone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const res = await deletePage(doc.id, page.file);
            if (!res.ok) return toast.error(res.message);
            if (res.value === null) {
              router.back();
              toast.success('Scan deleted');
            } else {
              setDoc(res.value);
              toast.success('Page deleted');
            }
          },
        },
      ],
    );
  };

  const confirmDeleteDoc = () => {
    if (!doc) return;
    Alert.alert('Delete this scan?', `"${doc.name}" and all its pages will be removed from this phone. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const res = await deleteDoc(doc.id);
          if (res.ok) {
            router.back();
            toast.success('Scan deleted');
          } else toast.error(res.message);
        },
      },
    ]);
  };

  const addFrom = async (source: CaptureSource) => {
    if (!doc) return;
    const picked = await pickImages(source);
    if (picked.kind === 'error') await alertPickError(picked);
    if (picked.kind !== 'ok') return;
    // The scan flow ends by appending the saved pages to this document.
    setCaptureBatch({ source, picks: picked.picks, target: { kind: 'new' }, docId: doc.id });
    router.push('/scan/process');
  };

  const onAddPage = () => {
    haptic.light();
    Alert.alert('Add a page', 'Where should the new page come from?', [
      { text: 'Camera', onPress: () => void addFrom('camera') },
      { text: 'Gallery', onPress: () => void addFrom('gallery') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ----------------------------------------------------------------- export
  const exportBusy = exporting !== null || sharing;

  const onExportPdf = async () => {
    if (!doc || exportBusy) return;
    const bytes = await estimateExportBytes(doc).catch(() => 0);
    if (bytes > BIG_EXPORT_BYTES) {
      const go = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Big document',
          `This scan will be about ${Math.round(bytes / 1048576)} MB as a PDF. Creating it can be slow, and very large files may fail on older phones. Continue?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ],
          { onDismiss: () => resolve(false) },
        ),
      );
      if (!go) return;
    }
    haptic.light();
    cancelExport.current = false;
    setExporting({ phase: 'preparing', current: 0, total: doc.pages.length });
    const out = await exportPdf(doc, { onProgress: setExporting, shouldCancel: () => cancelExport.current });
    setExporting(null);
    if (out.ok) toast.success('PDF ready');
    else if (!out.cancelled) toast.error(out.message);
  };

  const runShareImage = async (index: number) => {
    if (!doc || exportBusy) return;
    haptic.light();
    setPicker(false);
    setSharing(true);
    const out = await shareImage(doc, index);
    setSharing(false);
    if (!out.ok) toast.error(out.message);
  };

  /** Apps accept one image at a time: a single page shares at once, otherwise pick the page first. */
  const onShareImage = () => {
    if (!doc || exportBusy) return;
    if (doc.pages.length === 1) void runShareImage(0);
    else setPicker(true);
  };

  // ----------------------------------------------------------------- render
  if (!doc && loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: PADDING, gap: spacing.lg }}>
        <Stack.Screen options={{ title: 'Scan' }} />
        <Skeleton height={92} radius={radius.lg} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Skeleton height={50} radius={radius.lg} style={{ flex: 1, width: undefined }} />
          <Skeleton height={50} radius={radius.lg} style={{ flex: 1, width: undefined }} />
        </View>
        <DocGridSkeleton cardWidth={(width - PADDING * 2 - 12) / 2} count={4} />
      </View>
    );
  }

  if (!doc) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Scan' }} />
        <Text style={[typography.heading, { color: colors.text }]}>This scan is gone</Text>
        {(
          <>
            <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
              It may have been deleted. Your other scans are safe on Home.
            </Text>
            <Pressable onPress={() => router.replace('/')} style={[styles.pill, { backgroundColor: colors.primary, borderRadius: radius.pill, marginTop: spacing.xl }]}>
              <Text style={[typography.heading, { color: colors.onPrimary }]}>Back to Home</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const pageCount = doc.pages.length;
  const open = openIndex !== null ? doc.pages[openIndex] : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: doc.name,
          headerRight: () => (
            <Pressable onPress={() => setRenaming(true)} hitSlop={10} accessibilityLabel="Rename scan" style={styles.headerBtn}>
              <Icon name="edit" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={() => {
          // The grid needs the list's window position to know when the finger is near its edge.
          scrollRef.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
            viewport.value = { top: y, height: h };
          });
        }}
        onContentSizeChange={(_w, h) => {
          contentHeight.value = h;
        }}
        contentContainerStyle={{ padding: PADDING, gap: spacing.lg, paddingBottom: insets.bottom + 110 }}
      >
        <Animated.View entering={motion.enter(0)} style={[styles.info, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg }]}>
          <Pressable onPress={() => setRenaming(true)} accessibilityRole="button" accessibilityLabel="Rename scan" style={styles.nameRow}>
            <Text numberOfLines={2} style={[typography.title, { color: colors.text, flex: 1 }]}>{doc.name}</Text>
            <Icon name="edit" size={18} color={colors.textMuted} />
          </Pressable>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {pageCount} {pageCount === 1 ? 'page' : 'pages'} · Created {formatDocDate(doc.createdAt, true)}
          </Text>
          {pageCount > 1 && (
            <Text style={[typography.caption, { color: colors.accentText, marginTop: spacing.xs }]}>
              Long-press a page, then drag it to reorder.
            </Text>
          )}
        </Animated.View>

        <View style={styles.exportRow}>
          <ExportButton icon="file" label="Export PDF" primary busy={exporting !== null} disabled={exportBusy} onPress={onExportPdf} />
          <ExportButton icon="share" label="Share image" busy={sharing} disabled={exportBusy} onPress={onShareImage} />
        </View>

        <PageGrid
          docId={doc.id}
          pages={doc.pages}
          width={width - PADDING * 2}
          scrollRef={scrollRef}
          scrollY={scrollY}
          viewport={viewport}
          contentHeight={contentHeight}
          onOpen={(_page, index) => setOpenIndex(index)}
          onDelete={confirmDeletePage}
          onReorder={onReorder}
        />

        <Pressable onPress={confirmDeleteDoc} hitSlop={8} style={styles.deleteDoc} accessibilityRole="button">
          <Icon name="trash" size={16} color={colors.danger} />
          <Text style={[typography.caption, { color: colors.danger, fontWeight: '700' }]}>Delete this scan</Text>
        </Pressable>
      </Animated.ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <Pressable
          onPress={onAddPage}
          accessibilityRole="button"
          style={[styles.add, { backgroundColor: colors.primary, borderRadius: radius.pill }]}
        >
          <Icon name="plus" size={20} color={colors.onPrimary} />
          <Text style={[typography.heading, { color: colors.onPrimary }]}>Add page</Text>
        </Pressable>
      </View>

      <ImageViewer
        uri={open ? pageUri(doc.id, open) : null}
        aspect={open ? open.width / open.height : 1}
        title={open ? `Page ${(openIndex ?? 0) + 1} of ${pageCount}` : undefined}
        caption={doc.name}
        onClose={() => setOpenIndex(null)}
        onShare={() => openIndex !== null && void runShareImage(openIndex)}
        shareBusy={exportBusy}
      />

      <PagePickerSheet
        visible={picker}
        docId={doc.id}
        pages={doc.pages}
        onPick={(i) => void runShareImage(i)}
        onClose={() => setPicker(false)}
      />

      <ExportProgressModal
        progress={exporting}
        title="Exporting PDF"
        onCancel={() => {
          cancelExport.current = true;
        }}
      />

      <RenameModal visible={renaming} initialName={doc.name} onCancel={() => setRenaming(false)} onSave={saveName} />
    </View>
  );
}

function ExportButton(props: { icon: IconName; label: string; primary?: boolean; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors, radius, typography } = useTheme();
  const fg = props.primary ? colors.onPrimary : colors.text;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.exportBtn,
        {
          backgroundColor: props.primary ? colors.primary : colors.surface,
          borderColor: props.primary ? colors.primary : colors.border,
          borderRadius: radius.lg,
          opacity: props.disabled && !props.busy ? 0.5 : pressed ? motion.pressedOpacity : 1,
        },
      ]}
    >
      <Icon name={props.icon} size={20} color={fg} />
      <Text style={[typography.heading, { color: fg, fontSize: 15 }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  exportRow: { flexDirection: 'row', gap: 12 },
  exportBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  pill: { paddingHorizontal: 24, paddingVertical: 14 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  info: { borderWidth: 1, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deleteDoc: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 },
});
