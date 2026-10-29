import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, KiteScanLogo } from '../src/components';
import { motion, useTheme } from '../src/theme';
import { ABOUT, DIP_STAGES } from '../src/utils';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function AboutScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const card = { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}>
      {/* Identity */}
      <View style={styles.hero}>
        <KiteScanLogo size={128} animated />
        <Text style={[typography.display, { color: colors.text, marginTop: spacing.md }]}>{ABOUT.appName}</Text>
        <Text style={[typography.label, { color: colors.accentText, letterSpacing: 2 }]}>BY {ABOUT.brand.toUpperCase()}</Text>
        <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm }]}>{ABOUT.tagline}</Text>
        <View style={[styles.version, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
          <Text style={[typography.label, { color: colors.textMuted }]}>VERSION {VERSION}</Text>
        </View>
      </View>

      {/* How it works */}
      <View style={{ gap: spacing.xs }}>
        <Text style={[typography.title, { color: colors.text }]}>How KiteScan works</Text>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Every scan goes through six classical image-processing stages. They run with OpenCV on your phone, no AI service involved.
        </Text>
      </View>

      {DIP_STAGES.map((stage, i) => (
        <Animated.View key={stage.id} entering={motion.enter(i)} style={[styles.card, card]}>
          <View style={styles.stageHead}>
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[typography.caption, { color: colors.onPrimary, fontWeight: '800' }]}>{i + 1}</Text>
            </View>
            <Text style={[typography.heading, { color: colors.text, flex: 1 }]}>{stage.title}</Text>
          </View>
          <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm }]}>{stage.summary}</Text>
          <View style={styles.fns}>
            {stage.functions.map((fn) => (
              <View key={fn} style={[styles.fn, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}>
                <Text style={[styles.fnText, { color: colors.text }]}>{fn}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      ))}

      <Pressable
        onPress={() => router.push('/lab')}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.card,
          styles.lab,
          { backgroundColor: colors.surface, borderColor: colors.accentText, borderRadius: radius.lg, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Icon name="lab" size={26} color={colors.accentText} />
        <View style={{ flex: 1 }}>
          <Text style={[typography.heading, { color: colors.text }]}>See every stage live</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>Open the Pipeline Lab and watch your own photo go through all of them.</Text>
        </View>
        <Icon name="arrow-right" size={20} color={colors.textMuted} />
      </Pressable>

      {/* Privacy */}
      <View style={[styles.card, card, styles.privacy]}>
        <View style={[styles.privacyIcon, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md }]}>
          <Icon name="wifi-off" size={24} color={colors.accentText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[typography.heading, { color: colors.text }]}>Private by design</Text>
          <Text style={[typography.body, { color: colors.textMuted, marginTop: 2 }]}>{ABOUT.privacy}</Text>
        </View>
      </View>

      {/* Credit */}
      <View style={styles.credit}>
        <Text style={[typography.label, { color: colors.textMuted }]}>DEVELOPED BY</Text>
        <Text style={[typography.heading, { color: colors.text }]}>{ABOUT.developer}</Text>
        <Text style={[typography.body, { color: colors.textMuted }]}>{ABOUT.institute}</Text>
        <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.md }]}>
          Image processing by OpenCV.js. KiteScan is a {ABOUT.brand} product.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 8, paddingBottom: 8 },
  version: { marginTop: 14, paddingHorizontal: 12, paddingVertical: 6 },
  card: { borderWidth: 1 },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  fns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  fn: { paddingHorizontal: 9, paddingVertical: 5 },
  fnText: { fontFamily: MONO, fontSize: 12 },
  lab: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  privacyIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  credit: { alignItems: 'center', gap: 2, paddingTop: 8 },
});
