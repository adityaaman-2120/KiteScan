import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { coverUri, type Doc } from '../store/docs';
import { useTheme } from '../theme';
import { Icon } from './Icon';

type Props = {
  doc: Doc;
  onPress: () => void;
  onLongPress: () => void;
};

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One library grid cell: thumbnail, name, page count and date. */
export function DocCard({ doc, onPress, onLongPress }: Props) {
  const { colors, radius, typography } = useTheme();
  const cover = coverUri(doc);
  const pages = `${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'}`;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityLabel={`${doc.name}, ${pages}. Long press for options.`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.thumbWrap, { backgroundColor: colors.surfaceAlt, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <Icon name="image" size={32} color={colors.textMuted} />
        )}
        {doc.pages.length > 1 && (
          <View style={[styles.stack, { backgroundColor: colors.scrim, borderRadius: radius.pill }]}>
            <Text style={[typography.label, { color: '#fff' }]}>{doc.pages.length}</Text>
          </View>
        )}
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[typography.heading, { color: colors.text, fontSize: 15, lineHeight: 20 }]}>
          {doc.name}
        </Text>
        <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
          {pages} · {formatDate(doc.updatedAt)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderWidth: 1, overflow: 'hidden' },
  thumbWrap: { aspectRatio: 3 / 4, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  stack: { position: 'absolute', top: 8, right: 8, minWidth: 24, paddingHorizontal: 7, paddingVertical: 3, alignItems: 'center' },
  meta: { padding: 12, gap: 2 },
});
