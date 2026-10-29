import { useCallback, useEffect, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { scheduleOnRN } from 'react-native-worklets';

import { pageThumbUri, type PageMeta } from '../store/docs';
import { useTheme } from '../theme';
import {
  gridHeight,
  keysFromSlots,
  moveSlot,
  sameOrder,
  slotAtPoint,
  slotX,
  slotY,
  slotsFromKeys,
  type SlotMap,
} from '../utils/reorder';
import { Icon } from './Icon';

const GAP = 12;
const LABEL_H = 36;
const LONG_PRESS_MS = 280;
const EDGE = 110; // distance from the viewport edge where auto-scroll starts
const MAX_SCROLL_SPEED = 16; // px per frame

type Props = {
  docId: string;
  pages: PageMeta[];
  /** Width available to the grid. */
  width: number;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  /** Current scroll offset of the surrounding ScrollView. */
  scrollY: SharedValue<number>;
  /** Window position and height of the ScrollView, for edge auto-scrolling. */
  viewport: SharedValue<{ top: number; height: number }>;
  /** Total content height of the ScrollView. */
  contentHeight: SharedValue<number>;
  onOpen: (page: PageMeta, index: number) => void;
  onDelete: (page: PageMeta) => void;
  /** Called once after a drag ends with the new page order (file names). */
  onReorder: (files: string[]) => void;
};

/**
 * Two-column grid of page thumbnails. Tap opens a page; long-press then drag reorders: the other
 * pages slide into place while you drag, and the list scrolls when you hold near its edge.
 */
export function PageGrid({ docId, pages, width, scrollRef, scrollY, viewport, contentHeight, onOpen, onDelete, onReorder }: Props) {
  const cellW = (width - GAP) / 2;
  const cellH = (cellW * 4) / 3 + LABEL_H;
  const files = useMemo(() => pages.map((p) => p.file), [pages]);
  const count = files.length;

  const slotOf = useSharedValue<SlotMap>(slotsFromKeys(files));
  const activeKey = useSharedValue('');
  const dragging = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScroll = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const fingerY = useSharedValue(0);

  // Follow the committed order (after a drop, a delete, an added page).
  const filesKey = files.join('|');
  useEffect(() => {
    if (!dragging.value) slotOf.value = slotsFromKeys(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  const tick = useCallback(() => {
    Haptics.selectionAsync().catch(() => undefined);
  }, []);
  const pickUp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  }, []);
  const commit = useCallback(
    (order: string[]) => {
      if (!sameOrder(order, files)) onReorder(order);
    },
    [files, onReorder],
  );

  // While a page is held, work out which slot it hovers over and shift the others out of the way.
  useAnimatedReaction(
    () => ({ key: activeKey.value, x: dragX.value, y: dragY.value, s: scrollY.value }),
    (cur) => {
      'worklet';
      if (!cur.key) return;
      const from = slotOf.value[cur.key];
      if (from === undefined) return;
      const cx = startX.value + cur.x + cellW / 2;
      const cy = startY.value + cur.y + (cur.s - startScroll.value) + cellH / 2;
      const to = slotAtPoint(cx, cy, cellW, cellH, GAP, count);
      if (to !== from) {
        slotOf.value = moveSlot(slotOf.value, cur.key, to);
        scheduleOnRN(tick);
      }
    },
    [cellW, cellH, count],
  );

  // Scroll the list while the finger rests near its top or bottom edge.
  useFrameCallback(() => {
    'worklet';
    if (!dragging.value) return;
    const { top, height } = viewport.value;
    const y = fingerY.value;
    let v = 0;
    if (y < top + EDGE) v = -Math.min(1, (top + EDGE - y) / EDGE) * MAX_SCROLL_SPEED;
    else if (y > top + height - EDGE) v = Math.min(1, (y - (top + height - EDGE)) / EDGE) * MAX_SCROLL_SPEED;
    if (v === 0) return;
    const max = Math.max(0, contentHeight.value - height);
    const next = Math.max(0, Math.min(max, scrollY.value + v));
    if (next !== scrollY.value) scrollTo(scrollRef, 0, next, false);
  });

  return (
    <View style={{ height: gridHeight(count, cellH, GAP) }}>
      {pages.map((page, index) => (
        <GridCell
          key={page.file}
          docId={docId}
          page={page}
          index={index}
          cellW={cellW}
          cellH={cellH}
          slotOf={slotOf}
          activeKey={activeKey}
          dragging={dragging}
          startX={startX}
          startY={startY}
          startScroll={startScroll}
          dragX={dragX}
          dragY={dragY}
          fingerY={fingerY}
          scrollY={scrollY}
          onPickUp={pickUp}
          onCommit={commit}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </View>
  );
}

type CellProps = {
  docId: string;
  page: PageMeta;
  index: number;
  cellW: number;
  cellH: number;
  slotOf: SharedValue<SlotMap>;
  activeKey: SharedValue<string>;
  dragging: SharedValue<number>;
  startX: SharedValue<number>;
  startY: SharedValue<number>;
  startScroll: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  fingerY: SharedValue<number>;
  scrollY: SharedValue<number>;
  onPickUp: () => void;
  onCommit: (order: string[]) => void;
  onOpen: (page: PageMeta, index: number) => void;
  onDelete: (page: PageMeta) => void;
};

function GridCell(props: CellProps) {
  const { docId, page, index, cellW, cellH, slotOf, activeKey, dragging, startX, startY, startScroll, dragX, dragY, fingerY, scrollY } = props;
  const { onPickUp, onCommit, onOpen, onDelete } = props;
  const { colors, radius, typography } = useTheme();
  const file = page.file;

  const pan = usePanGesture({
    activateAfterLongPress: LONG_PRESS_MS,
    onActivate: (e) => {
      'worklet';
      const slot = slotOf.value[file] ?? index;
      startX.value = slotX(slot, cellW, GAP);
      startY.value = slotY(slot, cellH, GAP);
      startScroll.value = scrollY.value;
      dragX.value = 0;
      dragY.value = 0;
      fingerY.value = e.absoluteY;
      activeKey.value = file;
      dragging.value = 1;
      scheduleOnRN(onPickUp);
    },
    onUpdate: (e) => {
      'worklet';
      if (activeKey.value !== file) return;
      dragX.value = e.translationX;
      dragY.value = e.translationY;
      fingerY.value = e.absoluteY;
    },
    onFinalize: () => {
      'worklet';
      if (activeKey.value !== file) return;
      activeKey.value = '';
      dragging.value = 0;
      scheduleOnRN(onCommit, keysFromSlots(slotOf.value));
    },
  });

  const style = useAnimatedStyle(() => {
    const held = activeKey.value === file;
    if (held) {
      return {
        zIndex: 20,
        transform: [
          { translateX: startX.value + dragX.value },
          { translateY: startY.value + dragY.value + (scrollY.value - startScroll.value) },
          { scale: withTiming(1.05, { duration: 120 }) },
        ],
        shadowOpacity: 0.35,
        elevation: 12,
      };
    }
    const slot = slotOf.value[file] ?? index;
    return {
      zIndex: 1,
      transform: [
        { translateX: withTiming(slotX(slot, cellW, GAP), { duration: 200 }) },
        { translateY: withTiming(slotY(slot, cellH, GAP), { duration: 200 }) },
        { scale: withTiming(1, { duration: 120 }) },
      ],
      shadowOpacity: 0,
      elevation: 0,
    };
  });

  return (
    <Animated.View style={[styles.cell, { width: cellW, height: cellH }, style]}>
      <GestureDetector gesture={pan}>
        <View>
          <Pressable
            onPress={() => onOpen(page, index)}
            accessibilityRole="button"
            accessibilityLabel={`Page ${index + 1}. Tap to open, long press and drag to reorder.`}
            style={[styles.thumbBox, { height: cellH - LABEL_H, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.md }]}
          >
            <Image source={{ uri: pageThumbUri(docId, page) }} style={styles.thumb} resizeMode="contain" />
            <View style={[styles.number, { backgroundColor: colors.scrim, borderRadius: radius.pill }]}>
              <Text style={[typography.label, { color: '#fff' }]}>{index + 1}</Text>
            </View>
          </Pressable>
          <Text style={[typography.caption, styles.label, { color: colors.textMuted }]}>Page {index + 1}</Text>
        </View>
      </GestureDetector>
      <Pressable
        onPress={() => onDelete(page)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Delete page ${index + 1}`}
        style={[styles.delete, { backgroundColor: colors.scrim }]}
      >
        <Icon name="trash" size={16} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cell: { position: 'absolute', left: 0, top: 0, shadowColor: '#000', shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  thumbBox: { borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  number: { position: 'absolute', left: 8, top: 8, minWidth: 24, paddingHorizontal: 7, paddingVertical: 3, alignItems: 'center' },
  label: { textAlign: 'center', marginTop: 8 },
  delete: { position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
