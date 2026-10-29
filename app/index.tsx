import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DocCard,
  DocGridSkeleton,
  EngineDebugPanel,
  Icon,
  KiteScanLogo,
  RenameModal,
  useToast,
  type IconName,
} from '../src/components';
import { useEngine } from '../src/engine';
import { setCaptureBatch, useDocs, type Doc } from '../src/store';
import { APP_NAME, TAGLINE, motion, useTheme } from '../src/theme';
import { alertPickError, haptic, pickImages, recoverPendingPick, type CaptureSource } from '../src/utils';

const GUTTER = 16;
const GAP = 12;

export default function HomeScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const engine = useEngine();
  const toast = useToast();
  const { docs, loading, refreshing, error, refresh, rename, remove } = useDocs();

  const [debug, setDebug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Doc | null>(null);

  const cardWidth = (width - GUTTER * 2 - GAP) / 2;

  // Android may kill the app while the camera is open (low memory). The photo is then delivered on the next
  // start: pick it up instead of silently losing it.
  const recovered = useRef(false);
  useEffect(() => {
    if (recovered.current) return;
    recovered.current = true;
    void (async () => {
      const picks = await recoverPendingPick();
      if (!picks) return;
      toast.info('Picked up the photo you just took');
      setCaptureBatch({ source: 'camera', picks, target: { kind: 'new' } });
      router.push('/scan/process');
    })();
  }, [router, toast]);

  // ------------------------------------------------------------ scanning
  const startScan = useCallback(
    async (source: CaptureSource) => {
      if (busy) return;
      setBusy(true);
      try {
        const picked = await pickImages(source);
        if (picked.kind === 'error') await alertPickError(picked);
        if (picked.kind !== 'ok') return;
        // Downscaling, analysis and detection happen on the processing screen.
        setCaptureBatch({ source, picks: picked.picks, target: { kind: 'new' } });
        router.push('/scan/process');
      } finally {
        setBusy(false);
      }
    },
    [busy, router],
  );

  // ------------------------------------------------------ library actions
  const confirmDelete = useCallback(
    (doc: Doc) => {
      Alert.alert('Delete this scan?', `"${doc.name}" will be removed from this phone. This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const err = await remove(doc.id);
            if (err) toast.error(err);
            else toast.success('Scan deleted');
          },
        },
      ]);
    },
    [remove, toast],
  );

  const openMenu = useCallback(
    (doc: Doc) => {
      haptic.medium();
      Alert.alert(doc.name, undefined, [
        { text: 'Rename', onPress: () => setRenaming(doc) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(doc) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [confirmDelete],
  );

  const saveRename = useCallback(
    async (name: string) => {
      const target = renaming;
      setRenaming(null);
      if (!target) return;
      const err = await rename(target.id, name);
      if (err) toast.error(err);
      else toast.success('Renamed');
    },
    [renaming, rename, toast],
  );

  // -------------------------------------------------------------- pieces
  const header = (
    <View style={{ paddingTop: insets.top + spacing.sm, gap: spacing.lg }}>
      <View style={styles.headerRow}>
        {/* Long-press the logo to reveal the engine debug panel. */}
        <Pressable onLongPress={() => setDebug((d) => !d)} delayLongPress={600} accessibilityLabel="KiteScan logo">
          <KiteScanLogo size={48} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typography.title, { color: colors.text }]}>{APP_NAME}</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>{TAGLINE}</Text>
        </View>
        <Pressable
          onPress={() => router.push('/about')}
          accessibilityLabel="About KiteScan"
          hitSlop={8}
          style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Icon name="info" size={22} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.badgeRow}>
        <View style={[styles.badge, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
          <Icon name="wifi-off" size={14} color={colors.accentText} />
          <Text style={[typography.label, { color: colors.text }]}>100% offline</Text>
        </View>
        <EngineChip />
      </View>

      {debug && <EngineDebugPanel onLibraryChanged={refresh} />}

      <Animated.View entering={motion.enter(0)} style={{ flexDirection: 'row', gap: GAP }}>
        <ActionCard
          icon="camera"
          title="Scan with camera"
          subtitle="Photograph a page or board"
          primary
          disabled={busy}
          onPress={() => startScan('camera')}
        />
        <ActionCard
          icon="image"
          title="Import from gallery"
          subtitle="Clean up an existing photo"
          disabled={busy}
          onPress={() => startScan('gallery')}
        />
      </Animated.View>

      <Pressable
        onPress={() => {
          haptic.light();
          router.push('/lab');
        }}
        style={({ pressed }) => [
          styles.lab,
          { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, opacity: pressed ? motion.pressedOpacity : 1 },
        ]}
      >
        <View style={[styles.labIcon, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md }]}>
          <Icon name="lab" size={26} color={colors.accentText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[typography.heading, { color: colors.text }]}>Pipeline Lab</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>See how every pixel gets cleaned</Text>
        </View>
        <Text style={[typography.title, { color: colors.textMuted }]}>›</Text>
      </Pressable>

      <View style={styles.libraryHeader}>
        <Text style={[typography.heading, { color: colors.text }]}>Library</Text>
        {docs.length > 0 && <Text style={[typography.caption, { color: colors.textMuted }]}>{docs.length}</Text>}
      </View>
      {error && <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text>}
    </View>
  );

  const empty = loading ? (
    <View style={{ paddingHorizontal: GUTTER }}>
      <DocGridSkeleton cardWidth={cardWidth} count={4} />
    </View>
  ) : (
    <View style={[styles.empty, { borderColor: colors.border, borderRadius: radius.xl }]}>
      <KiteScanLogo size={96} />
      <Text style={[typography.heading, { color: colors.text, marginTop: spacing.lg }]}>Your scans stay on this phone.</Text>
      <Text style={[typography.caption, styles.emptyHint, { color: colors.textMuted }]}>
        Scan a page or board, or import a photo, and it will show up here.
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        numColumns={2}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: GUTTER }}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl, gap: GAP }}
        // The header and empty state need their own side padding (the grid rows have theirs).
        ListHeaderComponentStyle={{ paddingHorizontal: GUTTER }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
        renderItem={({ item }) => (
          <View style={{ width: cardWidth }}>
            <DocCard doc={item} onPress={() => router.push(`/doc/${item.id}`)} onLongPress={() => openMenu(item)} />
          </View>
        )}
      />
      <RenameModal
        visible={renaming !== null}
        initialName={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onSave={saveRename}
      />
    </View>
  );
}

/** Non-blocking engine status: the library works while OpenCV warms up. */
function EngineChip() {
  const { colors, radius, typography } = useTheme();
  const engine = useEngine();

  if (engine.status === 'ready') return null;
  if (engine.status === 'error') {
    return (
      <Pressable onPress={engine.retry} style={[styles.badge, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
        <Text style={[typography.label, { color: colors.danger }]}>Engine stopped. Tap to retry</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.badge, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
      <KiteScanLogo size={18} animated />
      <Text style={[typography.label, { color: colors.textMuted }]}>Warming up the engine...</Text>
    </View>
  );
}

function ActionCard(props: {
  icon: IconName;
  title: string;
  subtitle: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, radius, typography } = useTheme();
  const fg = props.primary ? colors.onPrimary : colors.text;
  return (
    <Pressable
      onPress={() => {
        haptic.light();
        props.onPress();
      }}
      disabled={props.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: props.primary ? colors.primary : colors.surface,
          borderColor: props.primary ? colors.primary : colors.border,
          borderRadius: radius.xl,
          opacity: props.disabled ? 0.6 : pressed ? motion.pressedOpacity : 1,
        },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: props.primary ? 'rgba(255,255,255,0.18)' : colors.surfaceAlt, borderRadius: radius.md }]}>
        <Icon name={props.icon} size={26} color={props.primary ? colors.onPrimary : colors.accentText} />
      </View>
      <Text style={[typography.heading, { color: fg, marginTop: 16 }]}>{props.title}</Text>
      <Text style={[typography.caption, { color: props.primary ? 'rgba(255,255,255,0.92)' : colors.textMuted }]}>{props.subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7 },
  action: { flex: 1, borderWidth: 1, padding: 18, minHeight: 168 },
  actionIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  lab: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, padding: 16 },
  labIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  libraryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 },
  empty: { marginHorizontal: GUTTER, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', padding: 32, marginTop: 4 },
  emptyHint: { textAlign: 'center', marginTop: 6 },
});
