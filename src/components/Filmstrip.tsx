import { memo, useEffect, useMemo, useRef } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';

import type { ScannedImage } from '../store/session';
import { useTheme } from '../theme';
import { haptic } from '../utils/haptics';
import type { PageQuality } from '../utils/pages';
import { Icon } from './Icon';

const TILE_W = 54;
const TILE_H = 72;
const GAP = 8;

type Props = {
  pages: ScannedImage[];
  index: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  qualities: PageQuality[];
  duplicateOf: (number | undefined)[];
  busy: ReadonlySet<number>;
};

/** Thumbnail strip: jump to any page at a glance, with warnings on pages that need attention. */
export function Filmstrip({ pages, index, onSelect, onAdd, qualities, duplicateOf, busy }: Props) {
  const { colors, radius } = useTheme();
  const { width } = useWindowDimensions();
  const ref = useRef<ScrollViewInstance>(null);

  // Keep the selected tile centred.
  useEffect(() => {
    const x = index * (TILE_W + GAP) - (width / 2 - TILE_W / 2) + 16;
    ref.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [index, width]);

  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.content}>
      {pages.map((p, i) => (
        <Tile
          key={p.id}
          page={p}
          position={i}
          selected={i === index}
          warn={qualities[i]?.grade === 'check' || duplicateOf[i] !== undefined}
          duplicate={duplicateOf[i] !== undefined}
          busy={busy.has(i)}
          onSelect={onSelect}
        />
      ))}
      <Pressable
        onPress={() => {
          haptic.light();
          onAdd();
        }}
        accessibilityRole="button"
        accessibilityLabel="Add more pages"
        style={[styles.add, { borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }]}
      >
        <Icon name="plus" size={22} color={colors.textMuted} />
      </Pressable>
    </ScrollView>
  );
}

type TileProps = {
  page: ScannedImage;
  position: number;
  selected: boolean;
  warn: boolean;
  duplicate: boolean;
  busy: boolean;
  onSelect: (i: number) => void;
};

const Tile = memo(function Tile({ page, position, selected, warn, duplicate, busy, onSelect }: TileProps) {
  const { colors, radius } = useTheme();
  const uri = useMemo(() => `data:image/jpeg;base64,${page.thumbBase64}`, [page.thumbBase64]);
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onSelect(position);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Page ${position + 1}${warn ? ', needs attention' : ''}`}
      style={[
        styles.tile,
        {
          borderColor: selected ? colors.primaryText : colors.border,
          borderWidth: selected ? 2 : 1,
          borderRadius: radius.sm,
          backgroundColor: colors.surfaceAlt,
          opacity: selected ? 1 : 0.8,
        },
      ]}
    >
      <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
      <View style={[styles.num, { backgroundColor: colors.scrim }]}>
        <Text style={styles.numText}>{position + 1}</Text>
      </View>
      {warn && (
        <View style={[styles.warn, { backgroundColor: '#FBBF24' }]}>
          <Text style={styles.warnText}>{duplicate ? '2x' : '!'}</Text>
        </View>
      )}
      {page.edited && !warn && <View style={[styles.edited, { backgroundColor: '#22D3EE' }]} />}
      {busy && <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 16, paddingVertical: 8, gap: GAP, alignItems: 'center' },
  tile: { width: TILE_W, height: TILE_H, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  num: { position: 'absolute', left: 3, top: 3, minWidth: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center' },
  numText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  warn: { position: 'absolute', right: 3, bottom: 3, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  warnText: { color: '#1b1200', fontSize: 9, fontWeight: '900' },
  edited: { position: 'absolute', right: 4, bottom: 4, width: 8, height: 8, borderRadius: 4 },
  add: { width: TILE_W, height: TILE_H, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});
