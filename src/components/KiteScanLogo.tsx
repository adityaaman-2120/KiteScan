import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import geometry from '../../assets/logo/logo-geometry.json';

const AnimatedLine = Animated.createAnimatedComponent(Line);

const { scan, colors } = geometry;

// Soft glow = wider, fainter copies of the scan line stacked under the core line.
const GLOW_LAYERS = [
  { width: 9, opacity: 0.12 },
  { width: 5.5, opacity: 0.25 },
] as const;

type Props = {
  size?: number;
  /** Loop the scan line up and down continuously. */
  animated?: boolean;
  /** External 0..1 scan position (0 = top, 1 = bottom). Overrides `animated`. */
  scanProgress?: SharedValue<number>;
};

function ScanLine({ progress, width, opacity }: { progress: SharedValue<number>; width: number; opacity: number }) {
  const animatedProps = useAnimatedProps(() => {
    const y = scan.top + progress.value * (scan.bottom - scan.top);
    return { y1: y, y2: y };
  });
  const mid = (scan.top + scan.bottom) / 2;
  return (
    <AnimatedLine
      x1={scan.x1}
      x2={scan.x2}
      y1={mid}
      y2={mid}
      stroke={colors.scan}
      strokeWidth={width}
      strokeOpacity={opacity}
      strokeLinecap="round"
      animatedProps={animatedProps}
    />
  );
}

export function KiteScanLogo({ size = 120, animated = false, scanProgress }: Props) {
  const internal = useSharedValue(0.5);

  useEffect(() => {
    if (scanProgress || !animated) return;
    internal.value = 0;
    internal.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [animated, scanProgress, internal]);

  const progress = scanProgress ?? internal;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${geometry.viewBox} ${geometry.viewBox}`}>
      <Defs>
        <LinearGradient id="kiteFill" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor={colors.kiteFrom} />
          <Stop offset="1" stopColor={colors.kiteTo} />
        </LinearGradient>
      </Defs>
      <Path
        d={geometry.tail}
        stroke={colors.tail}
        strokeWidth={geometry.tailWidth}
        strokeLinecap="round"
        fill="none"
      />
      <Path d={geometry.kite} fill="url(#kiteFill)" strokeLinejoin="round" />
      <Path
        d={geometry.brackets}
        stroke={colors.bracket}
        strokeWidth={geometry.bracketWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <G>
        {GLOW_LAYERS.map((g) => (
          <ScanLine key={g.width} progress={progress} width={g.width} opacity={g.opacity} />
        ))}
        <ScanLine progress={progress} width={scan.width} opacity={1} />
      </G>
    </Svg>
  );
}
