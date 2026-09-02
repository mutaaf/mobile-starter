import LottieView from 'lottie-react-native';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Reveal } from '@/components/reveal';
import { Label, Panel, Readout, Rule, ScreenTitle, Status } from '@/components/telemetry';
import { BottomTabInset, MaxContentWidth, Palette, Space, Type } from '@/constants/theme';
import { useResource } from '@/hooks/use-resource';
import { CacheKeys } from '@/lib/cache';
import { fetchIss } from '@/lib/api';

const POLL_MS = 4000;
/** Below the poll interval, so each tick revalidates rather than serving a hit. */
const STALE_MS = 3000;

/** Equirectangular projection to 0..1 within the plot box. */
function project(latitude: number, longitude: number) {
  return { x: (longitude + 180) / 360, y: (90 - latitude) / 180 };
}

function formatCoord(value: number, axis: 'lat' | 'lon') {
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(3)}° ${hemisphere}`;
}

function TrackPlot({ latitude, longitude }: { latitude: number; longitude: number }) {
  const { x, y } = project(latitude, longitude);

  // Interpolating between fixes makes a 4s poll read as continuous motion. The
  // timing runs on the UI thread, so it stays smooth while JS is busy.
  const marker = useAnimatedStyle(() => ({
    left: withTiming(`${x * 100}%`, { duration: POLL_MS }),
    top: withTiming(`${y * 100}%`, { duration: POLL_MS }),
  }));

  return (
    <Reveal delay={120} duration={420} style={styles.plot} testID="orbit-plot">
      {[0.25, 0.5, 0.75].map((f) => (
        <View
          key={`h${f}`}
          style={[styles.gridH, { top: `${f * 100}%` }, f === 0.5 && styles.gridStrong]}
        />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <View
          key={`v${f}`}
          style={[styles.gridV, { left: `${f * 100}%` }, f === 0.5 && styles.gridStrong]}
        />
      ))}

      <Animated.View style={[styles.markerWrap, marker]}>
        <View style={styles.markerHalo} />
        <View style={styles.markerDot} />
      </Animated.View>

      <Text style={styles.plotCaption}>EQUIRECTANGULAR · LIVE GROUND TRACK</Text>
    </Reveal>
  );
}

export default function OrbitScreen() {
  const insets = useSafeAreaInsets();
  const fetcher = useCallback((signal: AbortSignal) => fetchIss(signal), []);
  const { data, error, status, updatedAt, source, pinned, refresh } = useResource(
    CacheKeys.iss,
    fetcher,
    { pollMs: POLL_MS, staleMs: STALE_MS },
  );

  const [pulling, setPulling] = useState(false);
  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const firstLoad = status === 'loading' && !data;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.xl },
      ]}
      refreshControl={
        <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={Palette.signal} />
      }>
      <Reveal duration={380} style={styles.header}>
        {/* flex:1 + minWidth:0 so the wrapping subtitle cannot push the pulse
            off the right edge. */}
        <View style={styles.headerTitle}>
          <ScreenTitle sub="International Space Station · telemetry relayed from wheretheiss.at">
            Orbit
          </ScreenTitle>
        </View>
        <View style={styles.pulse} pointerEvents="none">
          <LottieView
            source={require('@/../assets/lottie/signal-pulse.json')}
            autoPlay
            loop
            style={styles.lottie}
          />
        </View>
      </Reveal>

      <Reveal delay={60} duration={380}>
        <Panel
          title="Downlink"
          right={
            <Status
              state={error ? 'error' : data ? 'live' : 'idle'}
              label={error ? 'signal lost' : pinned ? 'pinned' : data ? 'acquired' : 'acquiring'}
            />
          }
          testID="orbit-downlink">
          {firstLoad ? (
            <Text style={styles.placeholder}>Establishing downlink…</Text>
          ) : data ? (
            <>
              {/* An error with data behind it is a degraded state, not an empty
                  one — the last good fix stays on screen. */}
              {error ? (
                <Text style={styles.error} testID="orbit-error">
                  {error.message} · showing last fix
                </Text>
              ) : null}
              <View style={styles.row}>
                <Readout
                  label="Latitude"
                  value={formatCoord(data.latitude, 'lat')}
                  testID="orbit-latitude"
                />
                <Readout label="Longitude" value={formatCoord(data.longitude, 'lon')} />
              </View>
              <Rule />
              <View style={styles.row}>
                <Readout
                  label="Velocity"
                  value={Math.round(data.velocity).toLocaleString()}
                  unit="km/h"
                  tone="signal"
                />
                <Readout label="Altitude" value={data.altitude.toFixed(1)} unit="km" />
              </View>
              <Rule />
              <View style={styles.row}>
                <Readout
                  label="Sunlight"
                  value={data.visibility === 'daylight' ? 'DAY' : 'ECLIPSE'}
                  tone={data.visibility === 'daylight' ? 'signal' : 'cool'}
                />
                <Readout
                  label="Footprint"
                  value={Math.round(data.footprint).toString()}
                  unit="km r"
                />
              </View>
            </>
          ) : (
            <Text style={styles.error} testID="orbit-error">
              {error?.message ?? 'No data'}. Pull to retry.
            </Text>
          )}
        </Panel>
      </Reveal>

      {data ? <TrackPlot latitude={data.latitude} longitude={data.longitude} /> : null}

      <Reveal delay={180} duration={380} style={styles.footer}>
        <Label>
          {updatedAt ? `Last fix ${new Date(updatedAt).toLocaleTimeString()}` : 'No fix yet'}
        </Label>
        {/* Surfacing where the value came from turns the cache from an
            invisible mechanism into something you can watch working. */}
        <Label tone={source === 'network' ? 'signal' : 'dim'}>
          {source ? `via ${source}` : `polling ${POLL_MS / 1000}s`}
        </Label>
      </Reveal>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  headerTitle: { flex: 1, minWidth: 0 },
  pulse: { width: 72, height: 72, marginTop: -Space.sm },
  lottie: { width: '100%', height: '100%' },
  row: { flexDirection: 'row', gap: Space.lg },
  error: { fontFamily: Type.mono, fontSize: 12, color: Palette.alert, lineHeight: 19 },
  placeholder: { fontFamily: Type.mono, fontSize: 13, color: Palette.dim },
  plot: {
    aspectRatio: 2,
    backgroundColor: Palette.panel,
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: 14,
    overflow: 'hidden',
  },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Palette.rule },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: Palette.rule },
  gridStrong: { backgroundColor: '#2C3542' },
  markerWrap: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerHalo: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Palette.signal,
    opacity: 0.16,
  },
  markerDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.signal,
  },
  plotCaption: {
    position: 'absolute',
    left: Space.md,
    bottom: Space.sm,
    fontFamily: Type.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    color: Palette.faint,
  },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
});
