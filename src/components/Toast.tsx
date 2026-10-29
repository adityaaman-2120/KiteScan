import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { motion, useTheme } from '../theme';
import { haptic } from '../utils/haptics';
import { Icon } from './Icon';

type Kind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: Kind; message: string };

export type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const NOOP: ToastApi = { success: () => undefined, error: () => undefined, info: () => undefined };
const ToastContext = createContext<ToastApi | null>(null);

/** Short, non-blocking confirmations ("Saved to your library"). One at a time; a new one replaces the old. */
export function useToast(): ToastApi {
  // Falling back to a no-op means a missing provider can never crash a screen.
  return useContext(ToastContext) ?? NOOP;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((kind: Kind, message: string) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setToast({ id: seq.current, kind, message });
    if (kind === 'success') haptic.success();
    else if (kind === 'error') haptic.error();
    // Errors stay a little longer: they are the ones people want to read.
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 4200 : 2600);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => show('success', m),
      error: (m) => show('error', m),
      info: (m) => show('info', m),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  const { colors, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      {toast && (
        <Animated.View key={toast.id} entering={FadeInUp.duration(motion.base)} exiting={FadeOutUp.duration(motion.fast)}>
          <Pressable
            onPress={onDismiss}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.pill,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.lg,
                borderLeftColor: toast.kind === 'success' ? colors.success : toast.kind === 'error' ? colors.danger : colors.accentText,
              },
            ]}
          >
            <Icon
              name={toast.kind === 'success' ? 'check' : 'info'}
              size={20}
              color={toast.kind === 'success' ? colors.success : toast.kind === 'error' ? colors.danger : colors.accentText}
            />
            <Text style={[typography.body, { color: colors.text, flexShrink: 1 }]}>{toast.message}</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 1000, elevation: 1000 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    maxWidth: 520,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
