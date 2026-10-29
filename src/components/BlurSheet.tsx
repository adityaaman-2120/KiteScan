import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { useTheme } from '../theme';

type Props = {
  visible: boolean;
  /** Sharpness score (variance of the Laplacian). */
  sharpness: number;
  /** Small preview of the flagged photo. */
  previewUri?: string;
  onRetake: () => void;
  onUseAnyway: () => void;
};

/** Bottom sheet shown when a photo looks blurry. Android back counts as Retake. */
export function BlurSheet({ visible, sharpness, previewUri, onRetake, onUseAnyway }: Props) {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onRetake} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(180)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.head}>
            {previewUri && <Image source={{ uri: previewUri }} style={[styles.thumb, { borderRadius: radius.md }]} />}
            <View style={{ flex: 1 }}>
              <Text style={[typography.title, { color: colors.text }]}>Looks blurry</Text>
              <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}>
                This photo looks blurry (sharpness {Math.round(sharpness)}). Retake for a cleaner scan?
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={onUseAnyway}
              style={[styles.btn, { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill }]}
            >
              <Text style={[typography.heading, { color: colors.text }]}>Use anyway</Text>
            </Pressable>
            <Pressable onPress={onRetake} style={[styles.btn, { backgroundColor: colors.primary, borderRadius: radius.pill }]}>
              <Text style={[typography.heading, { color: colors.onPrimary }]}>Retake</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { gap: 20 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: -8 },
  head: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  thumb: { width: 72, height: 96, backgroundColor: '#00000020' },
  actions: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
});
