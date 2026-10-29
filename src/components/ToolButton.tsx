import { Pressable, StyleSheet, Text } from 'react-native';

import { motion, useTheme } from '../theme';
import { haptic } from '../utils/haptics';
import { Icon, type IconName } from './Icon';

type Props = { icon: IconName; label: string; onPress: () => void; disabled?: boolean };

/** Icon over a small label, used in the crop and enhance toolbars. */
export function ToolButton({ icon, label, onPress, disabled }: Props) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tool, { opacity: disabled ? 0.5 : pressed ? motion.pressedOpacity : 1 }]}
    >
      <Icon name={icon} size={24} color={colors.text} />
      <Text style={[typography.label, { color: colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tool: { alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, minWidth: 64 },
});
