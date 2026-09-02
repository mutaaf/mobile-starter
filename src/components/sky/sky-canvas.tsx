import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import {
  angularDelta,
  auroraOvalLatitude,
  bearingTo,
  equatorialToHorizontal,
  GEOMAGNETIC_NORTH,
  normalizeDegrees,
  type Horizontal,
  type Observer,
} from '@/lib/sky/astro';
import { CONSTELLATIONS, STARS, starColor } from '@/lib/sky/catalogue';
import { project, starOpacity, starRadius, type ViewDirection } from '@/lib/sky/projection';

export type SkyTarget = {
  id: string;
  label: string;
  direction: Horizontal;
  color: string;
};

type Props = {
  width: number;
  height: number;
  view: ViewDirection;
  observer: Observer;
  /** Recomputed on a slow cadence; the stars move 15° an hour, not per frame. */
  at: Date;
  fovX: number;
  /** Extra markers — the ISS, the aurora bearing. */
  targets: SkyTarget[];
  /** Planetary Kp. Above ~3 an aurora band is drawn toward the magnetic pole. */
  kp: number | null;
  /** Slow-moving value in [0,1) used to animate the aurora curtains. */
  phase: number;
  showConstellations: boolean;
};

/** Compass ticks every 30°, so the user can orient without leaving the view. */
const COMPASS_MARKS = [
  { azimuth: 0, label: 'N' },
  { azimuth: 45, label: 'NE' },
  { azimuth: 90, label: 'E' },
  { azimuth: 135, label: 'SE' },
  { azimuth: 180, label: 'S' },
  { azimuth: 225, label: 'SW' },
  { azimuth: 270, label: 'W' },
  { azimuth: 315, label: 'NW' },
];

export const SkyCanvas = memo(function SkyCanvas({
  width,
  height,
  view,
  observer,
  at,
  fovX,
  targets,
  kp,
  phase,
  showConstellations,
}: Props) {
  const viewport = useMemo(() => ({ width, height, fovX }), [width, height, fovX]);

  // Horizontal coordinates depend on time and place, not on where the phone is
  // pointing — so they are recomputed only when `at` ticks, not per frame.
  const sky = useMemo(() => {
    const positions = new Map<string, Horizontal>();
    for (const s of STARS) {
      positions.set(s.name, equatorialToHorizontal(s.ra, s.dec, observer, at));
    }
    return positions;
  }, [observer, at]);

  const visibleStars = useMemo(() => {
    return STARS.map((s) => {
      const horizontal = sky.get(s.name)!;
      // Below the horizon means behind the earth; drawing it would be a lie.
      if (horizontal.altitude < -2) return null;
      const p = project(horizontal, view, viewport);
      if (!p.onScreen) return null;
      return { s, p, horizontal };
    }).filter((v): v is NonNullable<typeof v> => v !== null);
  }, [sky, view, viewport]);

  const figures = useMemo(() => {
    if (!showConstellations) return [];

    return CONSTELLATIONS.flatMap((c) =>
      c.lines.flatMap(([aName, bName]) => {
        const a = sky.get(aName);
        const b = sky.get(bName);
        if (!a || !b || a.altitude < 0 || b.altitude < 0) return [];

        const pa = project(a, view, viewport);
        const pb = project(b, view, viewport);
        if (!pa.onScreen && !pb.onScreen) return [];
        // A segment spanning the back of the sky would draw straight across frame.
        if (pa.offAxis > 89 || pb.offAxis > 89) return [];

        return [{ key: `${c.name}-${aName}-${bName}`, pa, pb }];
      }),
    );
  }, [sky, view, viewport, showConstellations]);

  /**
   * The aurora is drawn as vertical curtains standing on the horizon in the
   * direction of the geomagnetic pole, brightening with Kp. It is an impression
   * of the real thing rather than a forecast: the oval's true shape needs a
   * model this app does not carry, so the honest part is the *direction* and the
   * *intensity*, both of which come from real data.
   */
  const aurora = useMemo(() => {
    if (kp == null || kp < 2.5) return null;

    const poleBearing = bearingTo(observer, GEOMAGNETIC_NORTH);
    const strength = Math.min(1, (kp - 2.5) / 5.5);
    // Higher Kp pushes the oval equatorward, so it appears higher in the sky.
    const bandAltitude = Math.max(4, Math.min(40, (observer.latitude > 0 ? 1 : -1) *
      (Math.abs(observer.latitude) - auroraOvalLatitude(kp)) + 12));

    const curtains: { path: ReturnType<typeof Skia.Path.Make>; opacity: number }[] = [];

    for (let i = -4; i <= 4; i++) {
      const sway = Math.sin(phase * Math.PI * 2 + i * 0.7) * 3.5;
      const azimuth = normalizeDegrees(poleBearing + i * 7 + sway);

      const base = project({ altitude: 0, azimuth }, view, viewport);
      const top = project({ altitude: bandAltitude, azimuth }, view, viewport);
      if (base.offAxis > 88 && top.offAxis > 88) continue;

      const widthPx = 26 + Math.abs(Math.cos(phase * Math.PI * 2 + i)) * 16;
      const p = Skia.Path.Make();
      p.moveTo(base.x - widthPx / 2, base.y);
      p.lineTo(top.x - widthPx / 2, top.y);
      p.lineTo(top.x + widthPx / 2, top.y);
      p.lineTo(base.x + widthPx / 2, base.y);
      p.close();

      curtains.push({
        path: p,
        opacity: strength * (0.55 - Math.abs(i) * 0.06),
      });
    }

    return { curtains, strength };
  }, [kp, observer, view, viewport, phase]);

  const horizon = useMemo(() => {
    // Sample the horizon across the field so it curves correctly with elevation.
    const path = Skia.Path.Make();
    let started = false;

    for (let d = -70; d <= 70; d += 2) {
      const p = project(
        { altitude: 0, azimuth: normalizeDegrees(view.heading + d) },
        view,
        viewport,
      );
      if (p.offAxis > 100) continue;
      if (!started) {
        path.moveTo(p.x, p.y);
        started = true;
      } else {
        path.lineTo(p.x, p.y);
      }
    }
    return started ? path : null;
  }, [view, viewport]);

  const compass = useMemo(
    () =>
      COMPASS_MARKS.map((m) => {
        const p = project({ altitude: 0, azimuth: m.azimuth }, view, viewport);
        if (!p.onScreen || p.offAxis > 80) return null;
        return { ...m, p };
      }).filter((v): v is NonNullable<typeof v> => v !== null),
    [view, viewport],
  );

  const projectedTargets = useMemo(
    () =>
      targets
        .map((t) => ({ t, p: project(t.direction, view, viewport) }))
        .filter(({ p }) => p.offAxis < 100),
    [targets, view, viewport],
  );

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {/* Aurora sits behind the stars — it is atmospheric, they are not. */}
      {aurora?.curtains.map((c, i) => (
        <Path key={`aurora-${i}`} path={c.path} opacity={c.opacity}>
          <LinearGradient
            start={vec(0, height)}
            end={vec(0, 0)}
            colors={['#00000000', '#3BE08A', '#8CF7C0', '#00000000']}
            positions={[0, 0.25, 0.7, 1]}
          />
          <BlurMask blur={14} style="normal" />
        </Path>
      ))}

      {horizon ? (
        <Path path={horizon} style="stroke" strokeWidth={1} color="#4EC8F2" opacity={0.35} />
      ) : null}

      {compass.map((c) => (
        <Group key={`compass-${c.label}`}>
          <Circle cx={c.p.x} cy={c.p.y} r={2.5} color="#4EC8F2" opacity={0.8} />
        </Group>
      ))}

      {figures.map((f) => (
        <Line
          key={f.key}
          p1={vec(f.pa.x, f.pa.y)}
          p2={vec(f.pb.x, f.pb.y)}
          color="#7FA8C9"
          strokeWidth={0.8}
          opacity={0.32}
        />
      ))}

      {visibleStars.map(({ s, p }) => {
        const r = starRadius(s.mag);
        const color = starColor(s.bv);
        return (
          <Group key={s.name}>
            {/* Bright stars get a bloom; faint ones would just look smudged. */}
            {s.mag < 1.6 ? (
              <Circle cx={p.x} cy={p.y} r={r * 3.4} color={color} opacity={0.16}>
                <BlurMask blur={r * 2.6} style="normal" />
              </Circle>
            ) : null}
            <Circle cx={p.x} cy={p.y} r={r} color={color} opacity={starOpacity(s.mag)} />
          </Group>
        );
      })}

      {projectedTargets.map(({ t, p }) => (
        <Group key={t.id}>
          <Circle cx={p.x} cy={p.y} r={26} color={t.color} opacity={0.14}>
            <BlurMask blur={18} style="normal" />
          </Circle>
          <Circle cx={p.x} cy={p.y} r={13} color={t.color} opacity={0.9} style="stroke" strokeWidth={2} />
          <Circle cx={p.x} cy={p.y} r={3.5} color={t.color} />
        </Group>
      ))}
    </Canvas>
  );
});

/** Exported for the HUD: which way to turn to bring a target into frame. */
export function turnHint(target: Horizontal, view: ViewDirection): string | null {
  const dAz = angularDelta(view.heading, target.azimuth);
  const dAlt = target.altitude - view.elevation;

  if (Math.abs(dAz) < 12 && Math.abs(dAlt) < 12) return null;

  const parts: string[] = [];
  if (Math.abs(dAz) >= 12) parts.push(dAz > 0 ? `turn right ${Math.round(dAz)}°` : `turn left ${Math.round(-dAz)}°`);
  if (Math.abs(dAlt) >= 12) parts.push(dAlt > 0 ? `raise ${Math.round(dAlt)}°` : `lower ${Math.round(-dAlt)}°`);
  return parts.join(' · ');
}
