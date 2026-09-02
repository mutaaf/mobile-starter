import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette, Radius, Space, Type } from '@/constants/theme';
import { useCache } from '@/lib/cache/provider';
import type { CacheEvent } from '@/lib/cache/types';

import { useJsFps, useWorkletTickRate } from './use-fps';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type Tab = 'cache' | 'events' | 'perf' | 'inject';
const TABS: Tab[] = ['cache', 'events', 'perf', 'inject'];

const EVENT_TONE: Record<CacheEvent['kind'], string> = {
  hit: Palette.signal,
  'stale-hit': '#F2C94E',
  miss: Palette.dim,
  fetch: Palette.cool,
  'fetch-ok': Palette.signal,
  'fetch-error': Palette.alert,
  dedup: '#B36BFF',
  invalidate: '#F2C94E',
  override: '#B36BFF',
  evict: Palette.alert,
};

/**
 * Worklet tick-rate readout, driven entirely from a shared value.
 *
 * Reanimated cannot set a Text node's children from the UI thread, but it can
 * drive a TextInput's `text` prop — so the number updates without ever
 * re-rendering React.
 */
function TickRateMeter() {
  const rate = useWorkletTickRate();
  const props = useAnimatedProps(() => ({ text: `${rate.value}`, defaultValue: `${rate.value}` }));

  // Thresholds reflect the callback's own cadence, not vsync; it collapses
  // toward zero when the UI thread is blocked.
  const tone = useAnimatedStyle(() => ({
    color: rate.value >= 6 ? Palette.signal : rate.value >= 3 ? '#F2C94E' : Palette.alert,
  }));

  return (
    <AnimatedTextInput editable={false} animatedProps={props} style={[styles.meterValue, tone]} />
  );
}

/** The JS thread is where RN jank actually originates, and rAF measures it honestly. */
function BadgeJsFps() {
  const fps = useJsFps();
  return (
    <Text
      style={[
        styles.meterValue,
        { color: fps >= 55 ? Palette.signal : fps >= 40 ? '#F2C94E' : Palette.alert },
      ]}>
      {fps}
    </Text>
  );
}

function Chip({
  label,
  onPress,
  tone = 'default',
  active,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'accent';
  active?: boolean;
}) {
  const color =
    tone === 'danger' ? Palette.alert : tone === 'accent' ? Palette.cool : Palette.signal;
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={[styles.chip, active && { borderColor: color, backgroundColor: `${color}1A` }]}>
      <Text style={[styles.chipText, active && { color }]}>{label}</Text>
    </Pressable>
  );
}

function CacheTab() {
  const cache = useCache();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof cache.snapshot>>>([]);

  const refresh = useCallback(() => {
    cache.snapshot().then(setRows);
  }, [cache]);

  useEffect(() => {
    refresh();
    return cache.subscribeAll(refresh);
  }, [cache, refresh]);

  if (!rows.length) return <Text style={styles.empty}>Cache is empty.</Text>;

  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <Animated.View
          key={row.key}
          layout={LinearTransition.springify()}
          entering={FadeInDown.duration(180)}
          style={styles.entry}>
          <View style={styles.entryHead}>
            <Text style={styles.entryKey} numberOfLines={1}>
              {row.key}
            </Text>
            <Text
              style={[
                styles.entryBadge,
                {
                  color: row.pinned
                    ? '#B36BFF'
                    : row.expired
                      ? Palette.alert
                      : row.stale
                        ? '#F2C94E'
                        : Palette.signal,
                },
              ]}>
              {row.pinned ? 'PINNED' : row.expired ? 'EXPIRED' : row.stale ? 'STALE' : 'FRESH'}
            </Text>
          </View>
          <Text style={styles.entryMeta}>
            {(row.ageMs / 1000).toFixed(1)}s old · {row.bytes}B · {row.source}
            {row.durationMs != null ? ` · ${row.durationMs}ms` : ''}
          </Text>
          <View style={styles.entryActions}>
            <Chip label="invalidate" onPress={() => cache.invalidate(row.key)} />
            {row.pinned ? (
              <Chip label="release" tone="accent" onPress={() => cache.release(row.key)} />
            ) : null}
            <Chip label="evict" tone="danger" onPress={() => cache.evict(row.key)} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

function EventsTab() {
  const cache = useCache();
  const [, force] = useState(0);

  useEffect(() => cache.subscribeAll(() => force((n) => n + 1)), [cache]);

  const events = cache.getEvents().slice(0, 40);
  if (!events.length) return <Text style={styles.empty}>No cache activity yet.</Text>;

  return (
    <View style={styles.list}>
      {events.map((e) => (
        <View key={e.id} style={styles.eventRow}>
          <View style={[styles.eventDot, { backgroundColor: EVENT_TONE[e.kind] }]} />
          <Text style={[styles.eventKind, { color: EVENT_TONE[e.kind] }]}>{e.kind}</Text>
          <Text style={styles.eventKey} numberOfLines={1}>
            {e.key}
          </Text>
          <Text style={styles.eventTime}>
            {e.durationMs != null ? `${e.durationMs}ms` : new Date(e.at).toLocaleTimeString()}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PerfTab() {
  const cache = useCache();
  const jsFps = useJsFps();
  const [, force] = useState(0);
  useEffect(() => cache.subscribeAll(() => force((n) => n + 1)), [cache]);

  const s = cache.stats;
  const total = s.hits + s.staleHits + s.misses;
  const hitRate = total ? Math.round(((s.hits + s.staleHits) / total) * 100) : 0;

  return (
    <View style={styles.list}>
      <View style={styles.meterRow}>
        <View style={styles.meter}>
          <Text style={styles.meterLabel}>UI WORKLET</Text>
          <TickRateMeter />
          <Text style={styles.meterUnit}>ticks/s</Text>
        </View>
        <View style={styles.meter}>
          <Text style={styles.meterLabel}>JS THREAD</Text>
          <Text
            style={[
              styles.meterValue,
              { color: jsFps >= 55 ? Palette.signal : jsFps >= 40 ? '#F2C94E' : Palette.alert },
            ]}>
            {jsFps}
          </Text>
          <Text style={styles.meterUnit}>fps</Text>
        </View>
      </View>

      <View style={styles.statGrid}>
        {[
          ['hit rate', `${hitRate}%`],
          ['hits', s.hits],
          ['stale', s.staleHits],
          ['misses', s.misses],
          ['fetches', s.fetches],
          ['dedups', s.dedups],
          ['errors', s.errors],
          ['avg fetch', `${s.avgFetchMs}ms`],
        ].map(([label, value]) => (
          <View key={String(label)} style={styles.stat}>
            <Text style={styles.statValue}>{String(value)}</Text>
            <Text style={styles.statLabel}>{String(label)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionNote}>
        Worklet ticks are not vsync frames. For real render statistics run{'\n'}
        adb shell dumpsys gfxinfo &lt;package&gt;
      </Text>

      <Chip label="reset stats" onPress={() => cache.resetStats()} />
    </View>
  );
}

function InjectTab() {
  const cache = useCache();
  const [, force] = useState(0);
  useEffect(() => cache.subscribeAll(() => force((n) => n + 1)), [cache]);

  const policy = cache.getPolicy();

  return (
    <View style={styles.list}>
      <Text style={styles.sectionNote}>
        Distort the network without touching a call site. Every screen reads through the same cache,
        so these apply everywhere at once.
      </Text>

      <View style={styles.chipRow}>
        <Chip
          label={policy.offline ? 'offline: ON' : 'offline: off'}
          tone="danger"
          active={policy.offline}
          onPress={() => cache.setPolicy({ offline: !policy.offline })}
        />
        <Chip
          label="fail next"
          tone="danger"
          active={policy.failNext}
          onPress={() => cache.setPolicy({ failNext: true })}
        />
      </View>

      <Text style={styles.sectionNote}>Injected latency</Text>
      <View style={styles.chipRow}>
        {[0, 400, 1200, 3000].map((ms) => (
          <Chip
            key={ms}
            label={ms === 0 ? 'none' : `${ms}ms`}
            tone="accent"
            active={policy.latencyMs === ms}
            onPress={() => cache.setPolicy({ latencyMs: ms })}
          />
        ))}
      </View>

      <Chip label="clear cache" tone="danger" onPress={() => cache.clear()} />
    </View>
  );
}

/**
 * The overlay itself: a draggable badge that expands into an inspector.
 *
 * Rendered above the navigator so it survives tab changes, and pointer-events
 * are scoped to its own subtree so it never eats touches meant for the app.
 */
export function DevTools() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('cache');

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const start = useSharedValue({ x: 0, y: 0 });

  const drag = Gesture.Pan()
    .onStart(() => {
      start.value = { x: x.value, y: y.value };
    })
    .onChange((e) => {
      x.value = start.value.x + e.translationX;
      y.value = start.value.y + e.translationY;
    })
    .onEnd(() => {
      // Keep it on screen; springing back beats clamping mid-drag.
      x.value = withSpring(0, { damping: 18 });
      y.value = withSpring(Math.max(-260, Math.min(0, y.value)), { damping: 18 });
    });

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  const panelStyle = useAnimatedStyle(() => ({
    opacity: withTiming(open ? 1 : 0, { duration: 160 }),
  }));

  const body = useMemo(() => {
    switch (tab) {
      case 'cache':
        return <CacheTab />;
      case 'events':
        return <EventsTab />;
      case 'perf':
        return <PerfTab />;
      case 'inject':
        return <InjectTab />;
    }
  }, [tab]);

  return (
    <View style={[styles.root, { bottom: insets.bottom + 76 }]} pointerEvents="box-none">
      {open ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={[styles.panel, panelStyle]}
          testID="devtools-panel">
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>DEVTOOLS</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Text style={styles.close}>CLOSE</Text>
            </Pressable>
          </View>

          <View style={styles.tabRow}>
            {TABS.map((t) => (
              <Pressable
                key={t}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setTab(t);
                }}
                style={[styles.tab, tab === t && styles.tabActive]}>
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={styles.panelBody} contentContainerStyle={{ paddingBottom: Space.lg }}>
            {body}
          </ScrollView>
        </Animated.View>
      ) : null}

      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.badgeWrap, badgeStyle]}>
          <Pressable
            testID="devtools-toggle"
            accessibilityLabel="Toggle developer tools"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setOpen((o) => !o);
            }}
            style={styles.badge}>
            <BadgeJsFps />
            <Text style={styles.badgeLabel}>JS FPS</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', right: Space.lg, alignItems: 'flex-end', zIndex: 50 },
  badgeWrap: { alignItems: 'flex-end' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.rule,
    backgroundColor: 'rgba(15,19,25,0.92)',
  },
  badgeLabel: {
    fontFamily: Type.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: Palette.dim,
  },
  panel: {
    width: 320,
    maxHeight: 420,
    marginBottom: Space.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.rule,
    backgroundColor: 'rgba(10,13,17,0.97)',
    overflow: 'hidden',
  },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: Palette.rule,
  },
  panelTitle: {
    fontFamily: Type.monoBold,
    fontSize: 11,
    letterSpacing: 2,
    color: Palette.signal,
  },
  close: { fontFamily: Type.mono, fontSize: 9, letterSpacing: 1.4, color: Palette.dim },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Palette.rule },
  tab: { flex: 1, paddingVertical: Space.sm, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Palette.signal },
  tabText: { fontFamily: Type.mono, fontSize: 9, letterSpacing: 1.2, color: Palette.faint },
  tabTextActive: { color: Palette.signal },
  panelBody: { padding: Space.md },
  list: { gap: Space.sm },
  empty: { fontFamily: Type.mono, fontSize: 11, color: Palette.dim },
  sectionNote: {
    fontFamily: Type.mono,
    fontSize: 10,
    color: Palette.dim,
    lineHeight: 16,
  },
  entry: {
    backgroundColor: Palette.panelHi,
    borderRadius: Radius.md,
    padding: Space.md,
    gap: Space.xs,
  },
  entryHead: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.sm },
  entryKey: { fontFamily: Type.mono, fontSize: 11, color: Palette.text, flex: 1 },
  entryBadge: { fontFamily: Type.monoBold, fontSize: 9, letterSpacing: 1 },
  entryMeta: { fontFamily: Type.mono, fontSize: 9, color: Palette.dim },
  entryActions: { flexDirection: 'row', gap: Space.xs, marginTop: Space.xs, flexWrap: 'wrap' },
  chipRow: { flexDirection: 'row', gap: Space.xs, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Space.sm,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Palette.rule,
  },
  chipText: { fontFamily: Type.mono, fontSize: 9, letterSpacing: 0.8, color: Palette.dim },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  eventDot: { width: 5, height: 5, borderRadius: 3 },
  eventKind: { fontFamily: Type.monoMedium, fontSize: 9, width: 74 },
  eventKey: { fontFamily: Type.mono, fontSize: 9, color: Palette.dim, flex: 1 },
  eventTime: { fontFamily: Type.mono, fontSize: 9, color: Palette.faint },
  meterRow: { flexDirection: 'row', gap: Space.sm },
  meter: {
    flex: 1,
    backgroundColor: Palette.panelHi,
    borderRadius: Radius.md,
    padding: Space.md,
    alignItems: 'center',
  },
  meterLabel: { fontFamily: Type.mono, fontSize: 8, letterSpacing: 1.4, color: Palette.dim },
  meterValue: {
    fontFamily: Type.monoBold,
    fontSize: 26,
    color: Palette.signal,
    padding: 0,
    margin: 0,
    textAlign: 'center',
    minWidth: 54,
  },
  meterUnit: { fontFamily: Type.mono, fontSize: 8, color: Palette.faint },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  stat: {
    width: '31%',
    backgroundColor: Palette.panelHi,
    borderRadius: Radius.sm,
    padding: Space.sm,
  },
  statValue: { fontFamily: Type.monoMedium, fontSize: 13, color: Palette.text },
  statLabel: { fontFamily: Type.mono, fontSize: 8, color: Palette.dim, letterSpacing: 0.8 },
});
