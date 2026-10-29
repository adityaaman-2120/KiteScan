import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ScannedImage } from '../store/session';
import { useTheme } from '../theme';
import { modeLabel } from '../utils/enhanceModes';
import type { PageQuality } from '../utils/pages';
import { HistogramCompare } from './HistogramChart';
import { Icon } from './Icon';
import { QualityBadge } from './QualityBadge';

type Props = {
  visible: boolean;
  page: ScannedImage | undefined;
  position: number;
  quality: PageQuality | undefined;
  onClose: () => void;
  onOpenLab: () => void;
  onRetake: () => void;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The measurements behind a page's quality badge: this is the image processing, laid open. */
export function InsightsSheet({ visible, page, position, quality, onClose, onOpenLab, onRetake }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        {page && quality && (
          <Animated.View
            entering={SlideInDown.springify().damping(18)}
            style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: insets.bottom + spacing.lg }]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
              <View style={styles.head}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.title, { color: colors.text }]}>Page {position + 1} insights</Text>
                  <Text style={[typography.caption, { color: colors.textMuted }]}>Measured on this phone from the photo itself.</Text>
                </View>
                <View style={[styles.score, { backgroundColor: colors.scrim, borderRadius: radius.md }]}>
                  <QualityBadge quality={quality} />
                </View>
              </View>

              {quality.issues.length === 0 ? (
                <Text style={[typography.body, { color: colors.success }]}>No problems found with this page.</Text>
              ) : (
                <View style={styles.issues}>
                  {quality.issues.map((i) => (
                    <View key={i.id} style={[styles.issue, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
                      <Icon name="info" size={14} color={colors.warning} />
                      <Text style={[typography.caption, { color: colors.text, fontWeight: '700' }]}>{i.label}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg }]}>
                <Row label="Sharpness" value={`${Math.round(page.analysis.blurScore)}`} note={`variance of the Laplacian; blurry below ${page.analysis.blurThreshold}`} />
                <Row label="Brightness" value={`${Math.round(page.analysis.brightness)} / 255`} note={`${pct(page.analysis.clipLow)} crushed to black, ${pct(page.analysis.clipHigh)} blown to white`} />
                <Row
                  label="Page edges"
                  value={page.edited ? 'adjusted by you' : page.detection.found ? `confidence ${page.detection.score.toFixed(2)}` : 'not found'}
                  note={page.detection.found ? `found via ${page.detection.strategy}` : 'the default frame was used'}
                />
                <Row label="Looks like" value={page.analysis.boardType} note="judged on the flattened page, not the desk around it" />
                <Row label="Look applied" value={modeLabel(page.appliedMode)} note={page.look.mode === 'auto' ? 'chosen by Smart' : 'chosen by you'} last />
              </View>

              <View>
                <Text style={[typography.heading, { color: colors.text, marginBottom: spacing.sm }]}>Before and after</Text>
                <HistogramCompare original={page.histograms.original} final={page.histograms.final} height={120} />
              </View>

              <View style={{ gap: spacing.sm }}>
                <Pressable onPress={onOpenLab} accessibilityRole="button" style={[styles.btn, { backgroundColor: colors.primary, borderRadius: radius.pill }]}>
                  <Icon name="lab" size={20} color={colors.onPrimary} />
                  <Text style={[typography.heading, { color: colors.onPrimary }]}>See every step in the Pipeline Lab</Text>
                </Pressable>
                <Pressable onPress={onRetake} accessibilityRole="button" style={[styles.btn, { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill }]}>
                  <Icon name="camera" size={20} color={colors.text} />
                  <Text style={[typography.heading, { color: colors.text }]}>Retake this page</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Animated.View>
        )}
      </Animated.View>
    </Modal>
  );
}

function Row({ label, value, note, last }: { label: string; value: string; note: string; last?: boolean }) {
  const { colors, typography } = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={{ flex: 1 }}>
        <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.textMuted, fontSize: 11 }]}>{note}</Text>
      </View>
      <Text style={[typography.heading, { color: colors.text, fontSize: 15 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  score: { padding: 6 },
  issues: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  issue: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7 },
  card: { paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
});
