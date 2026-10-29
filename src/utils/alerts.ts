import { Alert, Linking } from 'react-native';

import type { PickResult } from './capture';

type PickError = Extract<PickResult, { kind: 'error' }>;

/**
 * Explains why the camera or gallery could not open. When the cause is a refused permission the alert
 * offers "Open settings", because the system will not ask a second time. Resolves when it is dismissed.
 */
export function alertPickError(err: PickError): Promise<void> {
  return new Promise((resolve) => {
    const buttons = err.openSettings
      ? [
          { text: 'Not now', style: 'cancel' as const, onPress: () => resolve() },
          {
            text: 'Open settings',
            onPress: () => {
              Linking.openSettings().catch(() => undefined);
              resolve();
            },
          },
        ]
      : [{ text: 'OK', onPress: () => resolve() }];
    Alert.alert(err.title, err.message, buttons, { onDismiss: () => resolve() });
  });
}
