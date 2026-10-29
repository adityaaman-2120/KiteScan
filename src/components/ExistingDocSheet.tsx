import { useEffect, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverUri, formatDocDate, listDocs, type Doc } from '../store/docs';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';

type Props = {
  visible: boolean;
  onPick: (doc: Doc) => void;
  onClose: () => void;
};

/** Pick a saved scan to add the new pages to, instead of creating a new one. */
export function ExistingDocSheet({ visible, onPick, onClose }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const [docs, setDocs] = useState<Doc[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setDocs(null);
    void listDocs().then((r) => alive && setDocs(r.ok ? r.value : []));
    return () => {
      alive = false;
    };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: insets.bottom + spacing.lg }]}
        >
          <Text style={[typography.title, { color: colors.text, padding: spacing.xl, paddingBottom: spacing.sm }]}>Add to an existing scan</Text>
          {docs === null ? (
            <View style={{ padding: spacing.xl, gap: spacing.md }}>
              <Skeleton height={64} radius={radius.md} />
              <Skeleton height={64} radius={radius.md} />
            </View>
          ) : docs.length === 0 ? (
            <Text style={[typography.body, { color: colors.textMuted, padding: spacing.xl }]}>You have no saved scans yet. Save these pages first, then you can add to them later.</Text>
          ) : (
            <FlatList
              data={docs}
              keyExtractor={(d) => d.id}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.lg }}
              renderItem={({ item }) => {
                const cover = coverUri(item);
                return (
                  <Pressable
                    onPress={() => onPick(item)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.row, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, opacity: pressed ? 0.85 : 1 }]}
                  >
                    <View style={[styles.cover, { backgroundColor: colors.border, borderRadius: radius.sm }]}>
                      {cover ? <Image source={{ uri: cover }} style={styles.coverImg} resizeMode="cover" /> : <Icon name="image" size={20} color={colors.textMuted} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={[typography.heading, { color: colors.text, fontSize: 15 }]}>{item.name}</Text>
                      <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
                        {item.pages.length} {item.pages.length === 1 ? 'page' : 'pages'} · {formatDocDate(item.updatedAt)}
                      </Text>
                    </View>
                    <Icon name="plus" size={20} color={colors.primaryText} />
                  </Pressable>
                );
              }}
            />
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '75%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  cover: { width: 44, height: 58, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  coverImg: { width: '100%', height: '100%' },
});
