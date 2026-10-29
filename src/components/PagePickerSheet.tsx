import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pageThumbUri, type PageMeta } from '../store/docs';
import { useTheme } from '../theme';

type Props = {
  visible: boolean;
  docId: string;
  pages: PageMeta[];
  title?: string;
  onPick: (index: number) => void;
  onClose: () => void;
};

/** Bottom sheet with a thumbnail per page; tapping one picks it. Used because sharing handles one file at a time. */
export function PagePickerSheet({ visible, docId, pages, title = 'Share which page?', onPick, onClose }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingTop: spacing.xl,
              paddingBottom: insets.bottom + spacing.xl,
            },
          ]}
        >
          <Text style={[typography.title, { color: colors.text, paddingHorizontal: spacing.xl }]}>{title}</Text>
          <Text style={[typography.caption, { color: colors.textMuted, paddingHorizontal: spacing.xl }]}>
            Apps receive one image at a time. Use Export PDF to send every page together.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md, paddingTop: spacing.lg }}>
            {pages.map((page, i) => (
              <Pressable key={page.file} onPress={() => onPick(i)} accessibilityRole="button" accessibilityLabel={`Share page ${i + 1}`} style={styles.item}>
                <View style={[styles.thumb, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.md }]}>
                  <Image source={{ uri: pageThumbUri(docId, page) }} style={styles.img} resizeMode="contain" />
                </View>
                <Text style={[typography.caption, { color: colors.text, textAlign: 'center', marginTop: 6 }]}>Page {i + 1}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { gap: 6 },
  item: { width: 96 },
  thumb: { width: 96, height: 128, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', height: '100%' },
});
