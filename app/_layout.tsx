import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplash, KiteScanLogo, ToastProvider } from '../src/components';
import { EngineProvider } from '../src/engine';
import { useTheme } from '../src/theme';
import { useAppReady } from '../src/utils';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Shown instead of a red screen if any screen throws while rendering. It needs nothing from the app's
 * providers, so it works even when the failure is in one of them.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <StatusBar style="auto" />
      <KiteScanLogo size={96} />
      <Text style={[typography.title, { color: colors.text, marginTop: spacing.lg, textAlign: 'center' }]}>Something went wrong</Text>
      <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
        KiteScan hit an unexpected problem. Your scans are safe on this phone.
      </Text>
      {__DEV__ && (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.md, textAlign: 'center' }]}>{String(error?.message ?? error)}</Text>
      )}
      <Pressable
        onPress={() => {
          void retry();
        }}
        accessibilityRole="button"
        style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 28, paddingVertical: 14, marginTop: spacing.xl }}
      >
        <Text style={[typography.heading, { color: colors.onPrimary }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const { colors, isDark, typography } = useTheme();
  const ready = useAppReady();
  const [splashDone, setSplashDone] = useState(false);
  const onDone = useCallback(() => setSplashDone(true), []);

  // Hide the native splash only once our animated one is laid out on top of it.
  const onLayout = useCallback(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  // Whatever happens, never leave the user staring at the native splash.
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => undefined), 8000);
    return () => clearTimeout(t);
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <EngineProvider>
        <ToastProvider>
          <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={onLayout}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: typography.heading.fontWeight },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="scan/process" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
              <Stack.Screen name="scan/review" options={{ title: 'Review', animation: 'fade' }} />
              <Stack.Screen name="scan/crop" options={{ title: 'Crop' }} />
              <Stack.Screen name="scan/enhance" options={{ title: 'Adjust' }} />
              <Stack.Screen name="lab" options={{ title: 'Lab' }} />
              <Stack.Screen name="doc/[id]" options={{ title: 'Document' }} />
              <Stack.Screen name="about" options={{ title: 'About' }} />
            </Stack>
            {!splashDone && <AnimatedSplash onDone={onDone} />}
          </View>
        </ToastProvider>
      </EngineProvider>
    </GestureHandlerRootView>
  );
}
