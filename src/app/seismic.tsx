import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Reveal } from '@/components/reveal';
import { Panel, Readout, ScreenTitle, Status } from '@/components/telemetry';
import { BottomTabInset, MaxContentWidth, Palette, Radius, Space, Type } from '@/constants/theme';
import { useResource } from '@/hooks/use-resource';
import { CacheKeys } from '@/lib/cache';
import { fetchQuakes, type Quake } from '@/lib/api';

/** USGS reports M2.5+ globally; anything at or above this reads as significant. */
const NOTABLE = 5;
/** Bars are scaled against this rather than the observed max, so magnitudes stay
 *  comparable between refreshes instead of rescaling as the feed changes. */
const SCALE_MAX = 8;

function toneFor(magnitude: number) {
  if (magnitude >= NOTABLE) return Palette.alert;
  if (magnitude >= 4) return Palette.signal;
  return Palette.cool;
}

function timeAgo(ms: number) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function QuakeRow({ quake }: { quake: Quake }) {
  const tone = toneFor(quake.magnitude);
  const fill = Math.min(1, quake.magnitude / SCALE_MAX);

  return (
    <View style={styles.row} testID="quake-row">
      <View style={styles.rowHead}>
        <Text style={[styles.magnitude, { color: tone }]}>{quake.magnitude.toFixed(1)}</Text>
        <View style={styles.rowMeta}>
          <Text style={styles.place} numberOfLines={1}>
            {quake.place}
          </Text>
          <Text style={styles.meta}>
            {timeAgo(quake.time)} · {Math.round(quake.depthKm)} km deep
          </Text>
        </View>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${fill * 100}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}

export default function SeismicScreen() {
  const insets = useSafeAreaInsets();
  const fetcher = useCallback((signal: AbortSignal) => fetchQuakes(signal), []);
  // Quakes change slowly: a 2 minute stale window means tab switches are
  // instant and only a genuinely old value costs a request.
  const { data, error, status, source, refresh } = useResource(CacheKeys.quakes, fetcher, {
    staleMs: 120_000,
  });
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

  const summary = useMemo(() => {
    if (!data?.length) return null;
    return {
      count: data.length,
      strongest: data.reduce((max, q) => Math.max(max, q.magnitude), 0),
      notable: data.filter((q) => q.magnitude >= NOTABLE).length,
    };
  }, [data]);

  return (
    <FlatList
      style={styles.screen}
      data={data ?? []}
      keyExtractor={(q) => q.id}
      renderItem={({ item, index }) => (
        <Reveal delay={Math.min(index, 8) * 45} duration={320}>
          <QuakeRow quake={item} />
        </Reveal>
      )}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.xl },
      ]}
      refreshControl={
        <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Palette.signal} />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <ScreenTitle sub="Magnitude 2.5+ worldwide, past 24 hours · USGS live feed">
            Seismic
          </ScreenTitle>

          <Panel
            title="Survey"
            right={
              <Status
                state={error ? 'error' : data ? 'live' : 'idle'}
                label={error ? 'feed down' : data ? 'nominal' : 'loading'}
              />
            }
            testID="seismic-survey">
            {error && !summary ? (
              <Text style={styles.error} testID="seismic-error">
                {error.message}. Pull to retry.
              </Text>
            ) : summary ? (
              <View style={styles.summaryRow}>
                <Readout label="Events" value={summary.count.toString()} testID="seismic-count" />
                <Readout
                  label="Strongest"
                  value={summary.strongest.toFixed(1)}
                  unit="M"
                  tone={summary.strongest >= NOTABLE ? 'alert' : 'signal'}
                />
                <Readout label={`M${NOTABLE}+`} value={summary.notable.toString()} />
                <Readout label="Source" value={(source ?? '—').toUpperCase()} tone="cool" />
              </View>
            ) : (
              <Text style={styles.placeholder}>Reading feed…</Text>
            )}
          </Panel>
        </View>
      }
      ListEmptyComponent={
        loading || error ? null : (
          <Text style={styles.placeholder}>No qualifying events in the last 24 hours.</Text>
        )
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
  summaryRow: { flexDirection: 'row', gap: Space.lg },
  row: {
    backgroundColor: Palette.panel,
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: Radius.md,
    padding: Space.md,
    gap: Space.md,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  magnitude: {
    fontFamily: Type.monoBold,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    width: 52,
  },
  rowMeta: { flex: 1, gap: 2, minWidth: 0 },
  place: { fontFamily: Type.mono, fontSize: 13, color: Palette.text },
  meta: { fontFamily: Type.mono, fontSize: 10, color: Palette.dim, letterSpacing: 0.6 },
  barTrack: {
    height: 3,
    backgroundColor: Palette.panelHi,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
  separator: { height: Space.sm },
  error: { fontFamily: Type.mono, fontSize: 13, color: Palette.alert, lineHeight: 20 },
  placeholder: { fontFamily: Type.mono, fontSize: 13, color: Palette.dim },
});
