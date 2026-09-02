import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Palette, Radius, Space, Type } from '@/constants/theme';

/** Section heading: tiny, tracked-out, dim. The console's labelling voice. */
export function Label({ children, tone = 'dim' }: { children: ReactNode; tone?: 'dim' | 'signal' }) {
  return (
    <Text style={[styles.label, tone === 'signal' && { color: Palette.signal }]}>{children}</Text>
  );
}

export function Panel({
  title,
  right,
  children,
  style,
  testID,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.panel, style]} testID={testID}>
      {(title || right) && (
        <View style={styles.panelHead}>
          {title ? <Label>{title}</Label> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * A single instrument value. `mono` numerals keep the width stable as digits
 * change, so a live-updating readout doesn't jitter.
 */
export function Readout({
  label,
  value,
  unit,
  tone = 'text',
  testID,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'text' | 'signal' | 'alert' | 'cool';
  testID?: string;
}) {
  const color =
    tone === 'signal'
      ? Palette.signal
      : tone === 'alert'
        ? Palette.alert
        : tone === 'cool'
          ? Palette.cool
          : Palette.text;

  return (
    <View style={styles.readout} testID={testID}>
      <Label>{label}</Label>
      <View style={styles.readoutValueRow}>
        <Text style={[styles.readoutValue, { color }]} numberOfLines={1}>
          {value}
        </Text>
        {unit ? <Text style={styles.readoutUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

/** Live/stale/error indicator. Colour carries the state, text names it. */
export function Status({ state, label }: { state: 'live' | 'error' | 'idle'; label: string }) {
  const color =
    state === 'live' ? Palette.signal : state === 'error' ? Palette.alert : Palette.faint;
  return (
    <View style={styles.status}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.rule, style]} />;
}

/** Full-bleed screen title in the display face. */
export function ScreenTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.subtitle}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: Type.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Palette.dim,
  },
  panel: {
    backgroundColor: Palette.panel,
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: Radius.lg,
    padding: Space.lg,
    gap: Space.md,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  readout: { gap: Space.xs, flex: 1, minWidth: 0 },
  readoutValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.xs },
  readoutValue: {
    fontFamily: Type.monoMedium,
    fontSize: 26,
    // Tabular figures: without this, digits change width and the value jitters.
    fontVariant: ['tabular-nums'],
    color: Palette.text,
  },
  readoutUnit: {
    fontFamily: Type.mono,
    fontSize: 11,
    color: Palette.dim,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: {
    fontFamily: Type.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  rule: { height: 1, backgroundColor: Palette.rule },
  titleBlock: { gap: Space.xs },
  title: {
    fontFamily: Type.display,
    fontSize: 34,
    letterSpacing: -0.5,
    color: Palette.text,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontFamily: Type.mono,
    fontSize: 12,
    color: Palette.dim,
    lineHeight: 18,
  },
});
