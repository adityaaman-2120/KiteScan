import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { ScannedImage } from '../store/session';
import { useTheme } from '../theme';
import type { PageQuality } from '../utils/pages';
import { Icon } from './Icon';
import { QualityBadge } from './QualityBadge';

type Props = {
  pages: ScannedImage[];
  index: number;
  onIndexChange: (index: number) => void;
  /** While true the CURRENT page shows its flattened original instead of the enhanced result. */
  comparing: boolean;
  onCompare: (on: boolean) => void;
  qualities: PageQuality[];
  /** For each page: the earlier page it duplicates, if any. */
  duplicateOf: (number | undefined)[];
  /** Pages currently being re-processed (shown with a spinner). */
  busy: ReadonlySet<number>;
  onOpenInsights: () => void;
  onOpenViewer: () => void;
};

/**
 * Swipeable preview of every page. Tap for full screen, press and hold to see the page before enhancement
 * (the instant before/after every filter should have). Badges show the page number, its quality and duplicates.
 */
export function PagePager({ pages, index, onIndexChange, comparing, onCompare, qualities, duplicateOf, busy, onOpenInsights, onOpenViewer }: Props) {
  const [width, setWidth] = useState(0);
  const listRef = useRef<FlatList<ScannedImage>>(null);
  const shown = useRef(index); // the page the list is currently scrolled to

  // The filmstrip (or a delete) changed the page: scroll to it.
  useEffect(() => {
    if (width <= 0 || index === shown.current || index >= pages.length) return;
    shown.current = index;
    listRef.current?.scrollToOffset({ offset: index * width, animated: true });
  }, [index, width, pages.length]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== width) setWidth(w);
  };

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const i = Math.max(0, Math.min(pages.length - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
    shown.current = i;
    if (i !== index) onIndexChange(i);
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      {width > 0 && (
        <FlatList
          ref={listRef}
          data={pages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => p.id}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          initialScrollIndex={Math.min(index, Math.max(0, pages.length - 1))}
          onMomentumScrollEnd={onEnd}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          extraData={`${comparing}|${index}|${busy.size}`}
          renderItem={({ item, index: i }) => (
            <Slide
              page={item}
              position={i}
              total={pages.length}
              width={width}
              showOriginal={comparing && i === index}
              quality={qualities[i]}
              duplicateOf={duplicateOf[i]}
              busy={busy.has(i)}
              onCompare={onCompare}
              onOpenInsights={onOpenInsights}
              onOpenViewer={onOpenViewer}
            />
          )}
        />
      )}
    </View>
  );
}

type SlideProps = {
  page: ScannedImage;
  position: number;
  total: number;
  width: number;
  showOriginal: boolean;
  quality: PageQuality | undefined;
  duplicateOf: number | undefined;
  busy: boolean;
  onCompare: (on: boolean) => void;
  onOpenInsights: () => void;
  onOpenViewer: () => void;
};

const Slide = memo(function Slide({ page, position, total, width, showOriginal, quality, duplicateOf, busy, onCompare, onOpenInsights, onOpenViewer }: SlideProps) {
  const { colors, radius, typography } = useTheme();
  const finalUri = useMemo(() => `data:image/jpeg;base64,${page.final.base64}`, [page.final.base64]);
  const originalUri = useMemo(() => `data:image/jpeg;base64,${page.warped.base64}`, [page.warped.base64]);

  return (
    <View style={[styles.slide, { width }]}>
      <Pressable
        onPress={onOpenViewer}
        onLongPress={() => onCompare(true)}
        onPressOut={() => onCompare(false)}
        delayLongPress={260}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Page ${position + 1} of ${total}. Tap to view full screen, press and hold to compare with the original.`}
        style={[styles.frame, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.lg }]}
      >
        <Image source={{ uri: showOriginal ? originalUri : finalUri }} style={styles.image} resizeMode="contain" />

        <View pointerEvents="none" style={[styles.pageNo, { backgroundColor: colors.scrim }]}>
          <Text style={[typography.label, { color: '#fff' }]}>
            {position + 1} / {total}
          </Text>
        </View>

        {showOriginal && (
          <View pointerEvents="none" style={[styles.original, { backgroundColor: colors.scrim }]}>
            <Text style={[typography.label, { color: '#fff' }]}>ORIGINAL</Text>
          </View>
        )}

        {duplicateOf !== undefined && !showOriginal && (
          <View pointerEvents="none" style={[styles.dup, { backgroundColor: colors.scrim }]}>
            <Icon name="info" size={14} color="#FBBF24" />
            <Text style={[typography.label, { color: '#fff' }]}>Looks like page {duplicateOf + 1}</Text>
          </View>
        )}

        {!showOriginal && (
          <View pointerEvents="none" style={[styles.hint, { backgroundColor: colors.scrim }]}>
            <Text style={[typography.label, { color: 'rgba(255,255,255,0.9)' }]}>HOLD TO COMPARE</Text>
          </View>
        )}

        {busy && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.busy, { backgroundColor: colors.overlay, borderRadius: radius.lg }]}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        )}
      </Pressable>

      {quality && (
        <View style={styles.quality}>
          <QualityBadge quality={quality} onPress={onOpenInsights} />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  slide: { flex: 1, paddingHorizontal: 14, paddingVertical: 8 },
  frame: { flex: 1, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  pageNo: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  original: { position: 'absolute', top: 10, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  dup: { position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  hint: { position: 'absolute', bottom: 10, right: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  busy: { alignItems: 'center', justifyContent: 'center' },
  quality: { position: 'absolute', top: 18, right: 24 },
});
