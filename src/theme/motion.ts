import { Easing, FadeIn, FadeInDown } from 'react-native-reanimated';

/**
 * One set of timings and entrance animations for the whole app, so every screen moves the same way.
 * (The splash and the scanning line are deliberate set pieces and keep their own choreography.)
 */
export const motion = {
  /** Small state changes: chips, panels, toggles. */
  fast: 140,
  /** Cards and sheets appearing. */
  base: 240,
  /** Larger moves: progress, reveals. */
  slow: 380,
  /** Delay between neighbours in a staggered entrance, and the most items that stagger. */
  stagger: 55,
  maxStagger: 8,
  /** Opacity of a pressed button. */
  pressedOpacity: 0.85,

  easeOut: Easing.out(Easing.cubic),
  easeInOut: Easing.inOut(Easing.quad),

  /** Card entrance for the i-th item of a list. */
  enter: (index = 0) => FadeInDown.delay(Math.min(index, 8) * 55).duration(240),
  /** Quick entrance for content inside an already visible card (collapsible panels). */
  panel: () => FadeInDown.duration(140),
  fade: () => FadeIn.duration(180),
} as const;
