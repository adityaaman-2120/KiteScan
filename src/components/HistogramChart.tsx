import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { useTheme } from '../theme';

type Props = {
  /** 256 bin counts. */
  data: number[];
  color: string;
  width: number;
  height: number;
  /** Colour of the baseline. */
  axisColor?: string;
};

/** Closed area path of a 256-bin histogram, log-scaled so both ink and paper peaks stay visible. */
function areaPath(data: number[], max: number, width: number, height: number, top = 2): string {
  const step = width / Math.max(1, data.length - 1);
  let d = `M0 ${height}`;
  data.forEach((v, i) => {
    d += ` L${(i * step).toFixed(1)} ${(height - (Math.log1p(v) / max) * (height - top)).toFixed(1)}`;
  });
  return `${d} L${width} ${height} Z`;
}

/** Filled area chart of a single 256-bin histogram. */
export function HistogramChart({ data, color, width, height, axisColor = '#8884' }: Props) {
  const max = Math.max(1, ...data.map((v) => Math.log1p(v)));
  return (
    <Svg width={width} height={height}>
      <Path d={areaPath(data, max, width, height)} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1} />
      <Line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={axisColor} strokeWidth={1} />
    </Svg>
  );
}

type CompareProps = {
  original: number[];
  final: number[];
  height?: number;
};

/** Original vs Final grayscale histograms on one shared chart (same vertical scale), with a legend and axis. */
export function HistogramCompare({ original, final, height = 150 }: CompareProps) {
  const { colors, typography } = useTheme();
  const [width, setWidth] = useState(0);

  // One shared scale, so heights are comparable between the two curves.
  const max = Math.max(1, ...original.map((v) => Math.log1p(v)), ...final.map((v) => Math.log1p(v)));
  const ticks = [0, 64, 128, 192, 255];

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.legend}>
        <LegendItem color={colors.primaryText} label="Original" />
        <LegendItem color={colors.accentText} label="Final" />
      </View>
      {width > 0 && (
        <Svg width={width} height={height}>
          {[0.25, 0.5, 0.75].map((f) => (
            <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={colors.border} strokeWidth={StyleSheet.hairlineWidth} />
          ))}
          <Path d={areaPath(original, max, width, height)} fill={colors.primaryText} fillOpacity={0.35} stroke={colors.primaryText} strokeWidth={1.5} />
          <Path d={areaPath(final, max, width, height)} fill={colors.accentText} fillOpacity={0.4} stroke={colors.accentText} strokeWidth={1.5} />
          <Line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={colors.textMuted} strokeWidth={1} />
        </Svg>
      )}
      <View style={styles.axis}>
        {ticks.map((t) => (
          <Text key={t} style={[typography.label, { color: colors.textMuted }]}>
            {t}
          </Text>
        ))}
      </View>
      <Text style={[typography.caption, { color: colors.textMuted, marginTop: 6 }]}>
        Grayscale level (0 black to 255 white) against pixel count, log scale.
      </Text>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={[typography.caption, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 4, borderRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
