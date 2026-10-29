import * as Haptics from 'expo-haptics';

/** Haptic feedback that can never throw (some devices and emulators have no vibration motor). */
const quiet = (p: Promise<void>): void => {
  p.catch(() => undefined);
};

export const haptic = {
  /** A selection tick: chips, tools, toggles, grabbing a handle. */
  tap: () => quiet(Haptics.selectionAsync()),
  /** A light bump: pressing a big card or button. */
  light: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A firmer bump: picking something up, opening a menu with a long press. */
  medium: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;
