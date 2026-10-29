import { useEffect } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { ExportProgress } from '../utils/exportDoc';
import { useTheme } from '../theme';

type Props = {
  /** null hides the modal. */
  progress: ExportProgress | null;
  title: string;
  onCancel: () => void;
};

function describe(p: ExportProgress): { line: string; fraction: number; note?: string } {
  switch (p.phase) {
    case 'preparing':
      return { line: `Preparing page ${p.current} of ${p.total}`, fraction: Math.max(0, (p.current - 1) / p.total) * 0.85 };
    case 'creating':
      return { line: 'Creating the PDF...', fraction: 0.9, note: 'Big documents can take a minute. Everything happens on this phone.' };
    case 'sharing':
      return { line: 'Opening the share sheet...', fraction: 1 };
  }
}

/** Blocking progress card shown while a document is turned into a PDF. */
export function ExportProgressModal({ progress, title, onCancel }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const fraction = useSharedValue(0);
  const info = progress ? describe(progress) : null;

  useEffect(() => {
    fraction.value = withTiming(info?.fraction ?? 0, { duration: 250 });
  }, [info?.fraction, fraction]);

  const barStyle = useAnimatedStyle(() => ({ width: `${Math.round(fraction.value * 100)}%` }));

  return (
    <Modal visible={progress !== null} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl }]}>
          <Text style={[typography.title, { color: colors.text }]}>{title}</Text>

          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typography.body, { color: colors.text, flex: 1 }]}>{info?.line}</Text>
          </View>

          <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
            <Animated.View style={[styles.fill, { backgroundColor: colors.accentText }, barStyle]} />
          </View>

          {info?.note && <Text style={[typography.caption, { color: colors.textMuted }]}>{info.note}</Text>}

          {progress?.phase !== 'sharing' && (
            <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel}>
              <Text style={[typography.heading, { color: colors.textMuted }]}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  cancel: { alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 6 },
});
