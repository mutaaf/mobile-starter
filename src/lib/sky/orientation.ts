import { geodeticToEcef, type Observer } from './astro';

/**
 * Attitude of an orbiting body, and how it maps into the viewer's frame.
 *
 * Pure and tested for the same reason as the rest of `src/lib/sky`: whether a
 * model is pointing the right way is a numeric question, and eyeballing a 3D
 * render is the worst possible way to answer it.
 *
 * The ISS does not tumble. It flies in a local-vertical/local-horizontal
 * attitude: nose along the velocity vector, belly to the earth, solar arrays on
 * the port-starboard axis tracking the sun. That is a real, computable frame —
 * so the model is oriented from the orbit rather than spun for decoration.
 */

export type Vec3 = [number, number, number];

export type Fix = {
  latitude: number;
  longitude: number;
  altitudeKm: number;
  /** Unix ms. */
  at: number;
};

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const n = norm(v);
  if (n < 1e-12) return [0, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

function toVec(p: { x: number; y: number; z: number }): Vec3 {
  return [p.x, p.y, p.z];
}

/**
 * Local-vertical/local-horizontal basis in ECEF, built from two consecutive
 * fixes.
 *
 * - `up` points from the earth's centre outward (local vertical)
 * - `forward` is the along-track direction, made perpendicular to `up`
 * - `right` completes a right-handed set, along the solar-array axis
 *
 * Returns null when the two fixes are too close together to define a direction;
 * a near-zero velocity vector would otherwise produce a random orientation that
 * flickers frame to frame.
 */
export function orbitalFrame(
  previous: Fix,
  current: Fix,
): { forward: Vec3; up: Vec3; right: Vec3 } | null {
  const a = toVec(geodeticToEcef(previous.latitude, previous.longitude, previous.altitudeKm));
  const b = toVec(geodeticToEcef(current.latitude, current.longitude, current.altitudeKm));

  const velocity = sub(b, a);
  // ~1 metre of travel is the floor; below that the direction is numerical noise.
  if (norm(velocity) < 1e-3) return null;

  const up = normalize(b);

  // Gram-Schmidt: remove the radial component so forward is purely along-track.
  const vDotUp = velocity[0] * up[0] + velocity[1] * up[1] + velocity[2] * up[2];
  const alongTrack: Vec3 = [
    velocity[0] - vDotUp * up[0],
    velocity[1] - vDotUp * up[1],
    velocity[2] - vDotUp * up[2],
  ];
  if (norm(alongTrack) < 1e-9) return null;

  const forward = normalize(alongTrack);
  const right = normalize(cross(forward, up));

  return { forward, up, right };
}

/**
 * Rotates an ECEF vector into the observer's east/north/up frame, so the same
 * basis that positions the model on screen also orients it.
 */
export function ecefToEnu(v: Vec3, observer: Observer): Vec3 {
  const DEG = Math.PI / 180;
  const lat = observer.latitude * DEG;
  const lon = observer.longitude * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  return [
    -sinLon * v[0] + cosLon * v[1],
    -sinLat * cosLon * v[0] - sinLat * sinLon * v[1] + cosLat * v[2],
    cosLat * cosLon * v[0] + cosLat * sinLon * v[1] + sinLat * v[2],
  ];
}

/**
 * Rotation matrix (column-major, three.js order) taking model axes to the
 * observer's ENU frame.
 *
 * The model's own axes are declared by the caller, because a glTF from one
 * source is Y-up and from another is Z-up — guessing is how a station ends up
 * flying sideways.
 */
export function frameToMatrix(
  frame: { forward: Vec3; up: Vec3; right: Vec3 },
  observer: Observer,
): number[] {
  const f = ecefToEnu(frame.forward, observer);
  const u = ecefToEnu(frame.up, observer);
  const r = ecefToEnu(frame.right, observer);

  // three.js Matrix4.set takes row-major arguments; this returns the same 16
  // numbers in that order so the caller can spread them straight in.
  return [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    0, 0, 0, 1,
  ];
}

/**
 * Angle between the orbital plane's normal and the sun-ward direction, used to
 * feather the model's lighting. Approximate: the sun is treated as infinitely
 * far away, which at 1 AU is true to well under a pixel.
 */
export function sunDirectionEcef(at: Date): Vec3 {
  const DEG = Math.PI / 180;
  const jd = at.getTime() / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0;

  // Mean longitude and mean anomaly of the sun, low-precision series.
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const epsilon = 23.439 * DEG;

  // Ecliptic to equatorial. Earth rotation is ignored: callers use this only
  // for a lighting direction, where a few degrees is invisible.
  return normalize([
    Math.cos(lambda),
    Math.cos(epsilon) * Math.sin(lambda),
    Math.sin(epsilon) * Math.sin(lambda),
  ]);
}
