import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SkyCanvas, turnHint, type SkyTarget } from '@/components/sky/sky-canvas';
import { Iss3D } from '@/components/sky/iss-3d';
import { SkyLabels, type SkyObject } from '@/components/sky/sky-labels';
import { Label } from '@/components/telemetry';
import { Palette, Radius, Space, Type } from '@/constants/theme';
import { useObserver, useSkyAttitude } from '@/hooks/use-sky-attitude';
import type { IssPosition, SpaceWeather } from '@/lib/api';
import {
  bearingTo,
  compassPoint,
  GEOMAGNETIC_NORTH,
  normalizeDegrees,
  satelliteLookAngle,
  type Horizontal,
} from '@/lib/sky/astro';
import type { Fix } from '@/lib/sky/orientation';
import { project } from '@/lib/sky/projection';
import { CacheKeys } from '@/lib/cache';
import { useCache } from '@/lib/cache/provider';

/** Roughly a phone's main camera, so the overlay lines up with the passthrough. */
const FOV_X = 62;
/** The sky rotates 15°/hour; a 20s recompute is far finer than anyone can see. */
const SKY_TICK_MS = 20_000;

type Mode = 'orbit' | 'aurora';

export default function SkyScreen() {
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = rawMode === 'aurora' ? 'aurora' : 'orbit';

  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const cache = useCache();

  const [permission, requestPermission] = useCameraPermissions();
  const attitude = useSkyAttitude(true);
  const observerState = useObserver(true);

  const [showCamera, setShowCamera] = useState(true);
  const [showFigures, setShowFigures] = useState(true);
  const [at, setAt] = useState(() => new Date());
  const [phase, setPhase] = useState(0);
  // Two consecutive fixes: the station's attitude comes from the velocity
  // between them, so one position on its own cannot orient the model.
  const [fixes, setFixes] = useState<{ previous: Fix | null; current: Fix | null }>({
    previous: null,
    current: null,
  });

  // Manual look direction, used when the device has no usable attitude — which
  // is every simulator. Without it this screen would be a dead end in testing.
  const [manual, setManual] = useState({ heading: 0, elevation: 20 });
  const sensorsUsable = attitude.available === true && attitude.hasHeading;

  // Memoised: a fresh object each render would invalidate every projection
  // memo downstream, recomputing the whole star field on every sensor tick.
  const view = useMemo(
    () =>
      sensorsUsable ? { heading: attitude.heading, elevation: attitude.elevation } : manual,
    [sensorsUsable, attitude.heading, attitude.elevation, manual],
  );

  useEffect(() => {
    const sky = setInterval(() => setAt(new Date()), SKY_TICK_MS);
    // Drives the aurora sway. Slow enough to be cheap, fast enough to look alive.
    const anim = setInterval(() => setPhase((p) => (p + 0.012) % 1), 60);
    return () => {
      clearInterval(sky);
      clearInterval(anim);
    };
  }, []);

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  /**
   * All the arithmetic stays on the JS thread. `normalizeDegrees` is a plain
   * function, and calling one from inside a worklet throws "Tried to
   * synchronously call a Remote Function" — the worklet only forwards deltas.
   * The functional update also makes the drag accumulate, which reading
   * `view.heading` from the render closure would not.
   */
  const applyDrag = useCallback(
    (dx: number, dy: number) => {
      setManual((m) => ({
        heading: normalizeDegrees(m.heading - (dx / width) * FOV_X),
        elevation: Math.max(-89, Math.min(89, m.elevation + (dy / height) * 90)),
      }));
    },
    [width, height],
  );

  const pan = Gesture.Pan()
    .enabled(!sensorsUsable)
    // Without a threshold every tap on a label also drags the sky a few degrees,
    // so tapping a target both selects it and moves it off centre.
    .minDistance(12)
    .onChange((e) => {
      'worklet';
      runOnJS(applyDrag)(e.changeX, e.changeY);
    });

  const observer = useMemo(
    () =>
      observerState.ready
        ? {
            latitude: observerState.latitude,
            longitude: observerState.longitude,
            elevationM: observerState.elevationM,
          }
        : // Greenwich: a real place, and an obvious one — better than pretending
          // to know where the user is.
          { latitude: 51.4779, longitude: 0, elevationM: 0 },
    [observerState],
  );

  const iss = cache.getState<IssPosition>(CacheKeys.iss).data;
  const space = cache.getState<SpaceWeather>(CacheKeys.spaceWeather).data;

  useEffect(() => {
    if (!iss) return;
    const next: Fix = {
      latitude: iss.latitude,
      longitude: iss.longitude,
      altitudeKm: iss.altitude,
      at: iss.timestamp * 1000,
    };
    // Recording a fix is exactly what this effect exists to do, and the guard
    // below makes it idempotent, so it cannot cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFixes((prev) => {
      // The feed can repeat a timestamp between polls; keeping it would zero the
      // velocity and drop the orientation.
      if (prev.current && prev.current.at === next.at) return prev;
      return { previous: prev.current, current: next };
    });
  }, [iss]);

  const issLook = useMemo(
    () =>
      iss
        ? satelliteLookAngle(observer, {
            latitude: iss.latitude,
            longitude: iss.longitude,
            altitudeKm: iss.altitude,
          })
        : null,
    [iss, observer],
  );

  const auroraDirection: Horizontal | null = useMemo(() => {
    if (mode !== 'aurora') return null;
    return { altitude: 12, azimuth: bearingTo(observer, GEOMAGNETIC_NORTH) };
  }, [mode, observer]);

  const targets = useMemo<SkyTarget[]>(() => {
    const list: SkyTarget[] = [];
    if (mode === 'orbit' && issLook) {
      list.push({
        id: 'iss',
        label: 'ISS',
        direction: { altitude: issLook.altitude, azimuth: issLook.azimuth },
        color: Palette.signal,
      });
    }
    if (auroraDirection) {
      list.push({
        id: 'aurora',
        label: 'Magnetic pole',
        color: '#3BE08A',
        direction: auroraDirection,
      });
    }
    return list;
  }, [mode, issLook, auroraDirection]);

  const viewport = useMemo(() => ({ width, height, fovX: FOV_X }), [width, height]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const labelTargets = useMemo<SkyObject[]>(
    () => targets.map((t) => ({ ...t, priority: 'target' as const })),
    [targets],
  );

  /**
   * Tapping an object centres it. With live sensors the phone is the camera, so
   * the view cannot be moved in software — there the tap selects instead, and
   * the card below turns into a turn-by-turn instruction.
   */
  const onSelectObject = useCallback(
    (o: SkyObject) => {
      Haptics.selectionAsync().catch(() => {});
      setSelectedId(o.id);
      if (!sensorsUsable) {
        setManual({
          heading: o.direction.azimuth,
          elevation: Math.max(-89, Math.min(89, o.direction.altitude)),
        });
      }
    },
    [sensorsUsable],
  );

  const selected = useMemo(
    () => labelTargets.find((t) => t.id === selectedId) ?? null,
    [labelTargets, selectedId],
  );

  const issScreen = useMemo(
    () =>
      issLook
        ? project({ altitude: issLook.altitude, azimuth: issLook.azimuth }, view, viewport)
        : null,
    [issLook, view, viewport],
  );

  // Without a compass the initial view is arbitrary, and the thing you opened
  // the screen for is usually off-frame. Point at it once, on first fix.
  const aimed = useRef(false);
  useEffect(() => {
    if (aimed.current || sensorsUsable || targets.length === 0) return;
    aimed.current = true;
    const t = targets[0];
    setManual({
      heading: t.direction.azimuth,
      elevation: Math.max(-89, Math.min(89, t.direction.altitude)),
    });
  }, [sensorsUsable, targets]);

  const primary = selected ?? (targets[0] ? { ...targets[0], priority: 'target' as const } : null);
  const hint = primary ? turnHint(primary.direction, view) : null;

  const close = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    router.back();
  }, []);

  return (
    <View style={styles.root} testID="sky-view">
      {showCamera && permission?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.syntheticSky]} />
      )}

      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <SkyCanvas
            width={width}
            height={height}
            view={view}
            observer={observer}
            at={at}
            fovX={viewport.fovX}
            targets={targets}
            kp={space?.current ?? null}
            phase={phase}
            showConstellations={showFigures}
          />
        </View>
      </GestureDetector>

      {issLook && issScreen?.onScreen ? (
        <View
          style={[styles.model, { left: issScreen.x - 80, top: issScreen.y - 80 }]}
          pointerEvents="none"
        >
          <Iss3D
            direction={{ altitude: issLook.altitude, azimuth: issLook.azimuth }}
            observer={observer}
            previousFix={fixes.previous}
            currentFix={fixes.current}
            size={160}
            at={at}
          />
        </View>
      ) : null}

      <SkyLabels
        view={view}
        viewport={viewport}
        observer={observer}
        at={at}
        targets={labelTargets}
        selectedId={selectedId}
        onSelect={onSelectObject}
      />

      {/* ---------------------------------------------------------------- HUD */}
      <View style={[styles.top, { paddingTop: insets.top + Space.md }]} pointerEvents="box-none">
        <View style={styles.readout}>
          <Label tone="signal">{mode === 'aurora' ? 'Aurora sky' : 'Orbit sky'}</Label>
          <Text style={styles.heading}>
            {compassPoint(view.heading)} {Math.round(view.heading)}°
            <Text style={styles.headingDim}>
              {'  '}
              {view.elevation >= 0 ? '+' : ''}
              {Math.round(view.elevation)}° alt
            </Text>
          </Text>
        </View>

        <Pressable onPress={close} hitSlop={14} testID="sky-close" accessibilityLabel="Close sky view">
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + Space.lg }]} pointerEvents="box-none">
        {primary ? (
          <View style={styles.card} testID="sky-target">
            <Label>{primary.label}</Label>
            <Text style={[styles.cardValue, { color: primary.color }]}>
              {compassPoint(primary.direction.azimuth)} {Math.round(primary.direction.azimuth)}° ·{' '}
              {Math.round(primary.direction.altitude)}° alt
            </Text>
            {mode === 'orbit' && issLook ? (
              <Text style={styles.cardMeta}>
                {issLook.visible
                  ? `Above your horizon · ${Math.round(issLook.rangeKm).toLocaleString()} km away`
                  : `Below your horizon · ${Math.round(issLook.rangeKm).toLocaleString()} km through the earth`}
              </Text>
            ) : null}
            {mode === 'aurora' ? (
              <Text style={styles.cardMeta}>
                {space
                  ? `Kp ${space.current.toFixed(1)} · ${space.current >= 2.5 ? 'curtains drawn toward the magnetic pole' : 'too quiet to draw'}`
                  : 'No geomagnetic reading cached'}
              </Text>
            ) : null}
            {hint ? <Text style={styles.hint}>{hint}</Text> : <Text style={styles.onTarget}>On target</Text>}
          </View>
        ) : null}

        {!sensorsUsable ? (
          <View style={styles.notice} testID="sky-manual-notice">
            <Text style={styles.noticeText}>
              {attitude.available === false
                ? 'No motion sensor on this device — drag to look around.'
                : attitude.reason ?? 'Waiting for a compass fix — drag to look around.'}
            </Text>
          </View>
        ) : null}

        <View style={styles.controls}>
          <Pressable
            onPress={() => setShowFigures((v) => !v)}
            style={[styles.chip, showFigures && styles.chipOn]}
            testID="sky-toggle-figures"
          >
            <Text style={[styles.chipText, showFigures && styles.chipTextOn]}>Constellations</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowCamera((v) => !v)}
            style={[styles.chip, showCamera && styles.chipOn]}
            testID="sky-toggle-camera"
          >
            <Text style={[styles.chipText, showCamera && styles.chipTextOn]}>Passthrough</Text>
          </Pressable>
        </View>

        {!observerState.ready ? (
          <Text style={styles.footnote}>
            {observerState.reason ?? 'Locating…'} Showing the sky over Greenwich until then.
          </Text>
        ) : (
          <Text style={styles.footnote}>
            Observer {observer.latitude.toFixed(2)}°, {observer.longitude.toFixed(2)}°
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Palette.void },
  /** Used when the camera is off or denied: a night sky, not a black hole. */
  syntheticSky: { backgroundColor: '#04060B' },
  model: { position: 'absolute', width: 160, height: 160 },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  readout: {
    backgroundColor: 'rgba(8,9,11,0.62)',
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    gap: 2,
  },
  heading: {
    fontFamily: Type.monoBold,
    fontSize: 18,
    color: Palette.text,
    fontVariant: ['tabular-nums'],
  },
  headingDim: { fontFamily: Type.mono, fontSize: 12, color: Palette.dim },
  close: {
    fontFamily: Type.mono,
    fontSize: 20,
    color: Palette.text,
    paddingHorizontal: Space.sm,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Space.lg,
    gap: Space.sm,
  },
  card: {
    backgroundColor: 'rgba(8,9,11,0.72)',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.rule,
    padding: Space.md,
    gap: 3,
  },
  cardValue: {
    fontFamily: Type.monoBold,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  cardMeta: { fontFamily: Type.mono, fontSize: 10, color: Palette.dim, lineHeight: 15 },
  hint: { fontFamily: Type.monoMedium, fontSize: 11, color: Palette.cool, marginTop: 3 },
  onTarget: { fontFamily: Type.monoMedium, fontSize: 11, color: Palette.signal, marginTop: 3 },
  notice: {
    backgroundColor: 'rgba(255,107,74,0.14)',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#FF6B4A55',
    padding: Space.sm,
  },
  noticeText: { fontFamily: Type.mono, fontSize: 10, color: '#FFB4A0', lineHeight: 15 },
  controls: { flexDirection: 'row', gap: Space.sm },
  chip: {
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(8,9,11,0.6)',
  },
  chipOn: { borderColor: Palette.signal, backgroundColor: '#C6F24E1A' },
  chipText: { fontFamily: Type.mono, fontSize: 10, letterSpacing: 1, color: Palette.dim },
  chipTextOn: { color: Palette.signal },
  footnote: { fontFamily: Type.mono, fontSize: 9, color: Palette.faint },
});
