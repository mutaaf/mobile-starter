import { memo, useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Reveal } from '@/components/reveal';
import { Label, Panel, Readout, ScreenTitle, Status } from '@/components/telemetry';
import { BottomTabInset, MaxContentWidth, Palette, Radius, Space, Type } from '@/constants/theme';
import { useCoarseNow } from '@/hooks/use-coarse-now';
import { useResource } from '@/hooks/use-resource';
import { fetchLaunches, type Launch } from '@/lib/api';
import { CacheKeys } from '@/lib/cache';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Below this, a launch is imminent enough to highlight. */
const IMMINENT_MS = 60 * 60 * 1000;

/**
 * Must be a module-scope worklet, not a closure inside useAnimatedProps: a
 * helper declared inside a worklet stays a JS function, and calling it from the
 * UI runtime throws "Tried to synchronously call a Remote Function".
 */
function pad(n: number) {
  'worklet';
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * One shared clock for the whole screen, ticking on the UI thread.
 *
 * Every countdown reads this same value, so twenty live timers cost zero React
 * renders. Throttled to 1Hz: the display only shows whole seconds, so anything
 * faster is pure waste — at 4Hz across twenty rows this measurably starved the
 * UI thread (11fps on an emulator).
 */
function useClock(): SharedValue<number> {
  // Seeded at 0 rather than Date.now(): reading the clock during render is
  // impure, and the first frame callback fills it in ~16ms later.
  const now = useSharedValue(0);
  useFrameCallback(() => {
    'worklet';
    const t = Date.now();
    if (t - now.value >= 1000) now.value = t;
  }, true);
  return now;
}

function Countdown({ net, clock }: { net: number; clock: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    // Before the first tick the clock is 0, which would render as a countdown of
    // decades.
    if (clock.value === 0) return { text: 'T-··:··:··', defaultValue: 'T-··:··:··' };

    const remaining = Math.max(0, net - clock.value);
    const total = Math.floor(remaining / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    const text = days
      ? `T-${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `T-${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    return { text, defaultValue: text };
  });

  return (
    <AnimatedTextInput editable={false} animatedProps={props} style={styles.countdown} />
  );
}

const LaunchRow = memo(function LaunchRow({
  launch,
  clock,
  index,
  imminent,
}: {
  launch: Launch;
  clock: SharedValue<number>;
  index: number;
  imminent: boolean;
}) {
  const go = launch.probability;

  return (
    <Reveal
      delay={Math.min(index, 8) * 45}
      duration={320}
      style={[styles.row, imminent && styles.rowImminent]}
      testID="launch-row">
      <View style={styles.rowHead}>
        <View style={styles.rowTitle}>
          <Text style={styles.vehicle} numberOfLines={1}>
            {launch.rocket}
          </Text>
          <Text style={styles.mission} numberOfLines={1}>
            {launch.mission ?? launch.name}
          </Text>
        </View>
        <Countdown net={launch.net} clock={clock} />
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {launch.provider} · {launch.location}
      </Text>

      <View style={styles.rowFoot}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{launch.statusAbbrev}</Text>
        </View>
        {go != null ? (
          <View style={styles.goWrap}>
            <View style={styles.goTrack}>
              <View
                style={[
                  styles.goFill,
                  { width: `${go}%`, backgroundColor: go >= 70 ? Palette.signal : '#F2C94E' },
                ]}
              />
            </View>
            <Text style={styles.goText}>{go}% GO</Text>
          </View>
        ) : (
          <Text style={styles.goText}>NET {new Date(launch.net).toLocaleDateString()}</Text>
        )}
      </View>
    </Reveal>
  );
});

export default function LaunchScreen() {
  const insets = useSafeAreaInsets();
  const clock = useClock();
  // Changes twice a minute, so highlighting costs one cheap render rather than
  // twenty animated style pushes per tick.
  const nowBucket = useCoarseNow(30_000);
  const fetcher = useCallback((signal: AbortSignal) => fetchLaunches(signal), []);
  // The manifest shifts by hours, not seconds — a long stale window keeps tab
  // switches instant and stays well inside the API's rate limit.
  const { data, error, status, source, refresh } = useResource(CacheKeys.launches, fetcher, {
    staleMs: 300_000,
  });

  const next = data?.[0];
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
    <FlatList
      style={styles.screen}
      data={data ?? []}
      keyExtractor={(l) => l.id}
      renderItem={({ item, index }) => (
        <LaunchRow
          launch={item}
          clock={clock}
          index={index}
          imminent={item.net - nowBucket * 30_000 < IMMINENT_MS}
        />
      )}
      // Keeps offscreen countdowns unmounted, so the UI thread only drives the
      // timers actually visible.
      windowSize={5}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      removeClippedSubviews
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.huge },
      ]}
      refreshControl={
        <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Palette.signal} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <ScreenTitle sub="Upcoming orbital launches · Launch Library 2">Launch</ScreenTitle>

          <Panel
            title="Next off the pad"
            right={
              <Status
                state={error && !data ? 'error' : data ? 'live' : 'idle'}
                label={error && !data ? 'manifest down' : data ? 'manifest live' : 'loading'}
              />
            }
            testID="launch-next">
            {loading ? (
              <Text style={styles.placeholder}>Pulling manifest…</Text>
            ) : next ? (
              <>
                <View style={styles.nextHead}>
                  <Text style={styles.nextVehicle} numberOfLines={1}>
                    {next.rocket}
                  </Text>
                  <Countdown net={next.net} clock={clock} />
                </View>
                <View style={styles.row2}>
                  <Readout
                    label="Window opens"
                    value={new Date(next.net).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    tone="signal"
                    testID="launch-next-time"
                  />
                  <Readout label="Manifest" value={String(data?.length ?? 0)} unit="upcoming" />
                </View>
                <Label>{next.location}</Label>
              </>
            ) : (
              <Text style={styles.error} testID="launch-error">
                {error?.message ?? 'No upcoming launches'}. Pull to retry.
              </Text>
            )}
          </Panel>

          <Label tone={source === 'network' ? 'signal' : 'dim'}>
            {source ? `via ${source}` : 'not loaded'}
          </Label>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.lg,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: { gap: Space.lg, marginBottom: Space.lg },
  nextHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  nextVehicle: { fontFamily: Type.monoMedium, fontSize: 15, color: Palette.text, flex: 1 },
  row2: { flexDirection: 'row', gap: Space.lg },
  rowImminent: { borderColor: Palette.signal },
  row: {
    backgroundColor: Palette.panel,
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: Radius.md,
    padding: Space.md,
    gap: Space.sm,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  rowTitle: { flex: 1, minWidth: 0, gap: 2 },
  vehicle: { fontFamily: Type.monoMedium, fontSize: 13, color: Palette.text },
  mission: { fontFamily: Type.mono, fontSize: 10, color: Palette.dim },
  countdown: {
    fontFamily: Type.monoBold,
    fontSize: 14,
    color: Palette.signal,
    padding: 0,
    minWidth: 118,
    textAlign: 'right',
  },
  meta: { fontFamily: Type.mono, fontSize: 9, color: Palette.faint, letterSpacing: 0.5 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  pill: {
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
  },
  pillText: { fontFamily: Type.mono, fontSize: 9, color: Palette.dim, letterSpacing: 1 },
  goWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  goTrack: { flex: 1, height: 3, backgroundColor: Palette.panelHi, borderRadius: 2, overflow: 'hidden' },
  goFill: { height: '100%', borderRadius: 2 },
  goText: { fontFamily: Type.mono, fontSize: 9, color: Palette.dim },
  separator: { height: Space.sm },
  error: { fontFamily: Type.mono, fontSize: 13, color: Palette.alert, lineHeight: 20 },
  placeholder: { fontFamily: Type.mono, fontSize: 13, color: Palette.dim },
});
