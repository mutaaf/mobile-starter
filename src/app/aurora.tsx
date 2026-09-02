import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Reveal } from '@/components/reveal';
import { Sparkline } from '@/components/sparkline';
import { Label, Panel, Readout, ScreenTitle, Status } from '@/components/telemetry';
import { BottomTabInset, MaxContentWidth, Palette, Space, Type } from '@/constants/theme';
import { useResource } from '@/hooks/use-resource';
import { fetchSpaceWeather } from '@/lib/api';
import { CacheKeys } from '@/lib/cache';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The Kp scale tops out at 9. */
const KP_MAX = 9;
const GAUGE_R = 92;
const GAUGE_LEN = Math.PI * GAUGE_R;

function toneFor(kp: number) {
  if (kp >= 7) return Palette.alert;
  if (kp >= 5) return '#F2C94E';
  if (kp >= 3) return Palette.signal;
  return Palette.cool;
}

function auroraOutlook(kp: number) {
  if (kp >= 7) return 'Visible at mid-latitudes';
  if (kp >= 5) return 'Visible at high latitudes';
  if (kp >= 4) return 'Active — polar regions';
  return 'Quiet — polar only';
}

/**
 * Half-dial gauge. The arc is stroked with a dash the length of the whole path
 * and animated by its offset, which is the standard way to grow an SVG stroke —
 * and it runs as a worklet, so the needle springs on the UI thread.
 */
function KpGauge({ kp }: { kp: number }) {
  const progress = useDerivedValue(
    () => withSpring(Math.min(1, kp / KP_MAX), { damping: 15, stiffness: 90 }),
    [kp],
  );

  const arc = useAnimatedProps(() => ({
    strokeDashoffset: GAUGE_LEN * (1 - progress.value),
  }));

  const tone = toneFor(kp);
  const cx = GAUGE_R + 12;
  const cy = GAUGE_R + 12;
  const d = `M ${cx - GAUGE_R} ${cy} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${cx + GAUGE_R} ${cy}`;

  return (
    <View style={styles.gauge} testID="aurora-gauge">
      <Svg width={(GAUGE_R + 12) * 2} height={GAUGE_R + 24}>
        <Path d={d} stroke={Palette.rule} strokeWidth={14} fill="none" strokeLinecap="round" />
        <AnimatedPath
          d={d}
          stroke={tone}
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={GAUGE_LEN}
          animatedProps={arc}
        />
        {/* Storm threshold tick at Kp 5, where the G-scale begins. */}
        <Circle
          cx={cx + GAUGE_R * Math.cos(Math.PI * (1 - 5 / KP_MAX))}
          cy={cy - GAUGE_R * Math.sin(Math.PI * (1 - 5 / KP_MAX))}
          r={3}
          fill={Palette.void}
        />
      </Svg>

      <View style={styles.gaugeCenter}>
        <Text style={[styles.gaugeValue, { color: tone }]}>{kp.toFixed(1)}</Text>
        <Text style={styles.gaugeUnit}>Kp INDEX</Text>
      </View>
    </View>
  );
}

export default function AuroraScreen() {
  const insets = useSafeAreaInsets();
  const fetcher = useCallback((signal: AbortSignal) => fetchSpaceWeather(signal), []);
  // NOAA publishes once a minute; anything fresher than that is a wasted request.
  const { data, error, status, source, refresh } = useResource(CacheKeys.spaceWeather, fetcher, {
    pollMs: 60_000,
    staleMs: 55_000,
  });

  const wasStorm = useRef(false);
  const storming = (data?.stormLevel ?? 0) > 0;

  useEffect(() => {
    if (storming && !wasStorm.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    wasStorm.current = storming;
  }, [storming]);

  const [pulling, setPulling] = useState(false);
  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const loading = status === 'loading' && !data;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.huge },
      ]}
      refreshControl={
        <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Palette.signal} />
      }>
      <Reveal duration={380}>
        <ScreenTitle sub="Planetary K index · NOAA Space Weather Prediction Center">
          Aurora
        </ScreenTitle>
      </Reveal>

      <Reveal delay={60} duration={380}>
        <Panel
          title="Geomagnetic activity"
          right={
            <Status
              state={error && !data ? 'error' : data ? 'live' : 'idle'}
              label={
                error && !data
                  ? 'feed down'
                  : storming
                    ? `G${data?.stormLevel} storm`
                    : data
                      ? 'quiet'
                      : 'loading'
              }
            />
          }
          testID="aurora-panel">
          {loading ? (
            <Text style={styles.placeholder}>Reading magnetometers…</Text>
          ) : data ? (
            <>
              <KpGauge kp={data.current} />
              <View style={styles.row}>
                <Readout
                  label="Now"
                  value={data.current.toFixed(2)}
                  tone={storming ? 'alert' : 'signal'}
                  testID="aurora-current"
                />
                <Readout label="6h peak" value={data.peak.toFixed(2)} />
                <Readout
                  label="Storm"
                  value={data.stormLevel ? `G${data.stormLevel}` : 'NONE'}
                  tone={storming ? 'alert' : 'text'}
                />
              </View>
              <Label tone={storming ? 'signal' : 'dim'}>{auroraOutlook(data.current)}</Label>
            </>
          ) : (
            <Text style={styles.error} testID="aurora-error">
              {error?.message ?? 'No data'}. Pull to retry.
            </Text>
          )}
        </Panel>
      </Reveal>

      {data && data.samples.length > 1 ? (
        <Reveal delay={140} duration={380}>
          <Panel title="Last 6 hours" testID="aurora-history">
            <Sparkline
              points={data.samples.map((s) => ({ at: s.at, value: s.kp }))}
              max={KP_MAX}
              color={toneFor(data.peak)}
              precision={2}
            />
            <Label>{`${data.samples.length} samples · one per minute, downsampled`}</Label>
          </Panel>
        </Reveal>
      ) : null}

      <View style={styles.footer}>
        <Label tone={source === 'network' ? 'signal' : 'dim'}>
          {source ? `via ${source}` : 'polling 60s'}
        </Label>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.lg,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', gap: Space.lg },
  gauge: { alignItems: 'center', justifyContent: 'center' },
  gaugeCenter: { position: 'absolute', bottom: 6, alignItems: 'center' },
  gaugeValue: {
    fontFamily: Type.monoBold,
    fontSize: 38,
    fontVariant: ['tabular-nums'],
  },
  gaugeUnit: {
    fontFamily: Type.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: Palette.dim,
  },
  error: { fontFamily: Type.mono, fontSize: 13, color: Palette.alert, lineHeight: 20 },
  placeholder: { fontFamily: Type.mono, fontSize: 13, color: Palette.dim },
  footer: { flexDirection: 'row', justifyContent: 'flex-end' },
});
