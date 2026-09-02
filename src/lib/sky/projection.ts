import type { Horizontal } from './astro';

/**
 * Gnomonic (rectilinear) projection of the sky onto the screen.
 *
 * Kept separate from the renderer and free of Skia so it can be tested: "is the
 * star in the right place" is a question with a numeric answer, and it is the
 * one thing most likely to be subtly wrong.
 *
 * Rectilinear rather than a simple linear map of angles, because it is what a
 * camera lens actually does — with a linear map the overlay and the passthrough
 * image drift apart toward the edges of frame, which is exactly where a user
 * notices misalignment.
 */

const DEG = Math.PI / 180;

export type ViewDirection = {
  /** Degrees clockwise from true north. */
  heading: number;
  /** Degrees above the horizon. */
  elevation: number;
};

export type Viewport = {
  width: number;
  height: number;
  /** Horizontal field of view in degrees. ~62° approximates a phone's main camera. */
  fovX: number;
};

export type Projected = {
  x: number;
  y: number;
  /** False when the target is behind the camera or outside the frame. */
  onScreen: boolean;
  /** Angular distance from the centre of frame, degrees. */
  offAxis: number;
};

type Vec3 = [number, number, number];

/** East/north/up unit vector for a horizontal direction. */
export function toUnitVector({ altitude, azimuth }: Horizontal): Vec3 {
  const alt = altitude * DEG;
  const az = azimuth * DEG;
  const cosAlt = Math.cos(alt);
  return [cosAlt * Math.sin(az), cosAlt * Math.cos(az), Math.sin(alt)];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Camera basis in east/north/up.
 *
 * `right` stays in the horizontal plane, so the horizon is level on screen and
 * the overlay does not tilt with the phone; device roll is applied separately by
 * the renderer, which keeps the two concerns independent.
 */
export function cameraBasis({ heading, elevation }: ViewDirection): {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
} {
  const h = heading * DEG;
  const e = elevation * DEG;
  const cosE = Math.cos(e);
  const sinE = Math.sin(e);
  const sinH = Math.sin(h);
  const cosH = Math.cos(h);

  return {
    forward: [cosE * sinH, cosE * cosH, sinE],
    right: [cosH, -sinH, 0],
    up: [-sinH * sinE, -cosH * sinE, cosE],
  };
}

export function project(
  target: Horizontal,
  view: ViewDirection,
  viewport: Viewport,
): Projected {
  const { width, height, fovX } = viewport;
  const s = toUnitVector(target);
  const { right, up, forward } = cameraBasis(view);

  const z = dot(s, forward);
  const offAxis = Math.acos(Math.max(-1, Math.min(1, z))) / DEG;

  // Behind the camera. Projecting anyway would mirror it into frame, which looks
  // like a ghost star in the wrong place.
  if (z <= 1e-6) {
    return { x: 0, y: 0, onScreen: false, offAxis };
  }

  const focal = width / 2 / Math.tan((fovX * DEG) / 2);
  const x = width / 2 + (dot(s, right) / z) * focal;
  const y = height / 2 - (dot(s, up) / z) * focal;

  const margin = 24;
  const onScreen =
    x >= -margin && x <= width + margin && y >= -margin && y <= height + margin;

  return { x, y, onScreen, offAxis };
}

/**
 * Apparent radius for a star of a given magnitude.
 *
 * The scale is deliberately compressed rather than following the true
 * logarithmic flux ratio: at true scale Sirius would swamp everything around it
 * and the third-magnitude stars that carry the constellation shapes would vanish.
 */
export function starRadius(magnitude: number): number {
  return Math.max(0.7, 3.4 - magnitude * 0.62);
}

/** Opacity for a star, dimmer with magnitude but never fully invisible. */
export function starOpacity(magnitude: number): number {
  return Math.max(0.35, Math.min(1, 1.05 - magnitude * 0.16));
}

export type EdgeIndicator = {
  x: number;
  y: number;
  /** Degrees to rotate a right-pointing chevron so it aims at the target. */
  rotation: number;
};

/**
 * Places a marker on the frame border pointing toward an off-screen target.
 *
 * Deliberately driven by the angular deltas rather than by the projected point:
 * a target behind the camera has no meaningful projection, and using one would
 * send the arrow to the opposite edge — the single most confusing thing an
 * off-screen indicator can do.
 *
 * @param deltaAzimuth  signed degrees from view heading to the target, (-180,180]
 * @param deltaAltitude signed degrees from view elevation to the target
 */
export function edgeIndicator(
  deltaAzimuth: number,
  deltaAltitude: number,
  width: number,
  height: number,
  inset = 34,
): EdgeIndicator {
  // Screen space: x grows right with azimuth, y grows *down*, so altitude flips.
  const dirX = deltaAzimuth;
  const dirY = -deltaAltitude;

  const angle = Math.atan2(dirY, dirX);
  const cx = width / 2;
  const cy = height / 2;

  const halfW = Math.max(1, cx - inset);
  const halfH = Math.max(1, cy - inset);

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Scale the unit direction until it meets whichever border it reaches first.
  const tx = Math.abs(cos) < 1e-6 ? Infinity : halfW / Math.abs(cos);
  const ty = Math.abs(sin) < 1e-6 ? Infinity : halfH / Math.abs(sin);
  const t = Math.min(tx, ty);

  return {
    x: cx + cos * t,
    y: cy + sin * t,
    rotation: (angle * 180) / Math.PI,
  };
}

/**
 * Spreads edge indicators that land on top of each other.
 *
 * Objects in similar directions produce nearly identical border points, and two
 * overlapping chevrons are worse than one — neither label is readable and the
 * touch targets fight. Each border side is treated as a 1-D track and its
 * markers are pushed apart to a minimum gap, preserving their order so the
 * arrangement still reflects the sky.
 */
export function separateEdgeIndicators<T extends EdgeIndicator>(
  markers: T[],
  width: number,
  height: number,
  minGap = 56,
  inset = 34,
): T[] {
  const side = (m: EdgeIndicator): 'top' | 'bottom' | 'left' | 'right' => {
    if (Math.abs(m.y - inset) < 0.5) return 'top';
    if (Math.abs(m.y - (height - inset)) < 0.5) return 'bottom';
    return m.x < width / 2 ? 'left' : 'right';
  };

  const out = markers.map((m) => ({ ...m }));
  const groups = new Map<string, (T & EdgeIndicator)[]>();

  for (const m of out) {
    const key = side(m);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  for (const [key, list] of groups) {
    const horizontal = key === 'top' || key === 'bottom';
    const axis = horizontal ? ('x' as const) : ('y' as const);
    const limit = horizontal ? width : height;

    list.sort((a, b) => a[axis] - b[axis]);

    // Forward pass opens gaps, backward pass pulls the tail back inside frame.
    for (let i = 1; i < list.length; i++) {
      const gap = list[i][axis] - list[i - 1][axis];
      if (gap < minGap) list[i][axis] = list[i - 1][axis] + minGap;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const max = limit - inset;
      if (list[i][axis] > max) list[i][axis] = max;
      if (i > 0 && list[i][axis] - list[i - 1][axis] < minGap) {
        list[i - 1][axis] = list[i][axis] - minGap;
      }
    }
    for (const m of list) {
      if (m[axis] < inset) m[axis] = inset;
    }
  }

  return out;
}
