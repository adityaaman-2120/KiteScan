import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme';

type Props = {
  visible: boolean;
  initialName: string;
  onCancel: () => void;
  onSave: (name: string) => void;
};

/** Cross-platform rename prompt (Alert.prompt is iOS only). */
export function RenameModal({ visible, initialName, onCancel, onSave }: Props) {
  const { colors, spacing, radius, typography, isDark } = useTheme();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  const canSave = name.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl }]}>
          <Text style={[typography.title, { color: colors.text }]}>Rename scan</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            selectTextOnFocus
            maxLength={80}
            returnKeyType="done"
            keyboardAppearance={isDark ? 'dark' : 'light'}
            onSubmitEditing={() => canSave && onSave(name)}
            placeholder="Scan name"
            placeholderTextColor={colors.textMuted}
            style={[
              typography.body,
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.md },
            ]}
          />
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={[styles.btn, { borderRadius: radius.pill }]}>
              <Text style={[typography.heading, { color: colors.textMuted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => canSave && onSave(name)}
              disabled={!canSave}
              style={[styles.btn, { backgroundColor: colors.primary, borderRadius: radius.pill, opacity: canSave ? 1 : 0.5 }]}
            >
              <Text style={[typography.heading, { color: colors.onPrimary }]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  sheet: { gap: 16 },
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { paddingHorizontal: 20, paddingVertical: 12 },
});
