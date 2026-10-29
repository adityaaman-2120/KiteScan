import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';
import { haptic } from '../utils/haptics';
import type { EnhanceMode } from '../engine/types';

export type LookId = EnhanceMode | 'auto';
export type Scope = 'one' | 'all';

const LOOKS: { id: LookId; label: string; sub?: string }[] = [
  { id: 'auto', label: 'Smart', sub: 'per page' },
  { id: 'document_bw', label: 'B&W Document' },
  { id: 'whiteboard', label: 'Whiteboard' },
  { id: 'magic', label: 'Magic Color' },
  { id: 'blackboard', label: 'Blackboard' },
  { id: 'original', label: 'Original' },
];

type Props = {
  pageCount: number;
  scope: Scope;
  onScope: (scope: Scope) => void;
  /** The look to highlight: the current page's, or the shared one when applying to all; null when pages differ. */
  selected: LookId | null;
  onPick: (look: LookId) => void;
  disabled?: boolean;
};

/**
 * Looks you can apply with one tap, to this page or to every page. "Smart" lets each page get the look that
 * suits what it is (a whiteboard, a blackboard, a paper page) instead of forcing one filter on a mixed batch.
 */
export function LookBar({ pageCount, scope, onScope, selected, onPick, disabled }: Props) {
  const { colors, radius, typography } = useTheme();

  return (
    <View style={styles.root}>
      {pageCount > 1 && (
        <View style={styles.scopeRow}>
          <Text style={[typography.label, { color: colors.textMuted }]}>APPLY LOOK TO</Text>
          <View style={[styles.seg, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }]}>
            {(['one', 'all'] as const).map((s) => {
              const active = scope === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => {
                    if (!active) haptic.tap();
                    onScope(s);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segItem, { backgroundColor: active ? colors.primary : 'transparent', borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: active ? colors.onPrimary : colors.text, fontWeight: '700' }]}>
                    {s === 'one' ? 'This page' : `All ${pageCount} pages`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {LOOKS.map((l) => {
          const active = selected === l.id;
          return (
            <Pressable
              key={l.id}
              onPress={() => onPick(l.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !!disabled }}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.surfaceAlt,
                  borderColor: active ? colors.primary : colors.border,
                  borderRadius: radius.lg,
                  opacity: disabled ? 0.5 : 1,
                },
              ]}
            >
              <Text style={[typography.caption, { color: active ? colors.onPrimary : colors.text, fontWeight: '700' }]}>{l.label}</Text>
              {l.sub && <Text style={[styles.sub, { color: active ? '#fff' : colors.accentText }]}>{l.sub.toUpperCase()}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  seg: { flexDirection: 'row', padding: 3 },
  segItem: { paddingHorizontal: 12, paddingVertical: 6 },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sub: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginTop: 1 },
});
