import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Palette, Radius, Space, Type } from '@/constants/theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export type SparklinePoint = { at: number; value: number };

type Props = {
  points: SparklinePoint[];
  height?: number;
  color?: string;
  /** Fixed upper bound; without one the plot rescales on every refresh. */
  max?: number;
  unit?: string;
  /** Decimal places shown while scrubbing. */
  precision?: number;
};

/**
 * A scrubbable sparkline.
 *
 * The crosshair and the value readout are both driven from shared values, so
 * dragging never crosses onto the JS thread — the readout writes into a
 * TextInput's `text` prop, which Reanimated can set from a worklet (React cannot
 * re-render a Text node at gesture frequency without dropping frames).
 */
export function Sparkline({
  points,
  height = 120,
  color = Palette.signal,
  max,
  unit = '',
  precision = 1,
}: Props) {
  const [width, setWidth] = useState(0);

  const scrubX = useSharedValue(0);
  const active = useSharedValue(0);

  const { line, area, bounds } = useMemo(() => {
    if (points.length < 2 || width === 0) {
      return { line: '', area: '', bounds: { min: 0, max: 1 } };
    }
    const values = points.map((p) => p.value);
    const hi = max ?? Math.max(...values);
    const lo = Math.min(...values, 0);
    const span = hi - lo || 1;

    const xy = points.map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p.value - lo) / span) * height;
      return [x, y] as const;
    });

    const d = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return {
      line: d,
      area: `${d} L${width.toFixed(1)} ${height} L0 ${height} Z`,
      bounds: { min: lo, max: hi },
    };
  }, [points, width, height, max]);

  // Captured by value so the worklet can index it without touching JS.
  const values = useMemo(() => points.map((p) => p.value), [points]);

  const pan = Gesture.Pan()
    .onBegin((e) => {
      active.value = withTiming(1, { duration: 120 });
      scrubX.value = e.x;
    })
    .onChange((e) => {
      scrubX.value = Math.max(0, Math.min(width, e.x));
    })
    .onFinalize(() => {
      active.value = withTiming(0, { duration: 220 });
    });

  const crosshair = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ translateX: scrubX.value }],
  }));

  const readout = useAnimatedProps(() => {
    if (!values.length || width === 0) return { text: '', defaultValue: '' };
    const i = Math.round((scrubX.value / width) * (values.length - 1));
    const v = values[Math.max(0, Math.min(values.length - 1, i))];
    const text = `${v.toFixed(precision)}${unit}`;
    return { text, defaultValue: text };
  });

  const readoutBox = useAnimatedStyle(() => ({ opacity: active.value }));

  return (
    <View>
      <View
        style={[styles.frame, { height }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <GestureDetector gesture={pan}>
          <View style={StyleSheet.absoluteFill}>
            {width > 0 && line ? (
              <Svg width={width} height={height}>
                <Defs>
                  <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={color} stopOpacity={0.28} />
                    <Stop offset="1" stopColor={color} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Path d={area} fill="url(#fill)" />
                <Path
                  d={line}
                  stroke={color}
                  strokeWidth={1.8}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}

            <Animated.View style={[styles.crosshair, crosshair]} pointerEvents="none">
              <View style={[styles.crosshairLine, { backgroundColor: color }]} />
            </Animated.View>
          </View>
        </GestureDetector>

        <Animated.View style={[styles.readout, readoutBox]} pointerEvents="none">
          <AnimatedTextInput
            editable={false}
            animatedProps={readout}
            style={[styles.readoutText, { color }]}
          />
        </Animated.View>
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisText}>{bounds.min.toFixed(0)}</Text>
        <Text style={styles.axisHint}>drag to scrub</Text>
        <Text style={styles.axisText}>{bounds.max.toFixed(0)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: Palette.panelHi,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  crosshair: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  crosshairLine: { flex: 1, width: 1, opacity: 0.9 },
  readout: {
    position: 'absolute',
    top: Space.sm,
    right: Space.sm,
    backgroundColor: 'rgba(8,9,11,0.85)',
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
  },
  readoutText: {
    fontFamily: Type.monoBold,
    fontSize: 15,
    padding: 0,
    minWidth: 52,
    textAlign: 'right',
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Space.xs,
  },
  axisText: { fontFamily: Type.mono, fontSize: 9, color: Palette.faint },
  axisHint: { fontFamily: Type.mono, fontSize: 9, color: Palette.dim, letterSpacing: 1 },
});
