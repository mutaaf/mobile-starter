import {
  ecefToEnu,
  frameToMatrix,
  norm,
  normalize,
  orbitalFrame,
  sunDirectionEcef,
  type Fix,
} from '@/lib/sky/orientation';

const fix = (latitude: number, longitude: number, at: number): Fix => ({
  latitude,
  longitude,
  altitudeKm: 420,
  at,
});

describe('orbitalFrame', () => {
  it('builds an orthonormal basis', () => {
    const f = orbitalFrame(fix(0, 0, 0), fix(0, 1, 4000))!;
    expect(f).not.toBeNull();

    for (const v of [f.forward, f.up, f.right]) {
      expect(norm(v)).toBeCloseTo(1, 9);
    }

    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(f.forward, f.up)).toBeCloseTo(0, 9);
    expect(dot(f.forward, f.right)).toBeCloseTo(0, 9);
    expect(dot(f.up, f.right)).toBeCloseTo(0, 9);
  });

  it('points up away from the earth centre', () => {
    // Over the equator at longitude 0, "up" is the +x ECEF axis.
    const f = orbitalFrame(fix(0, -0.5, 0), fix(0, 0, 4000))!;
    expect(f.up[0]).toBeCloseTo(1, 3);
    expect(f.up[1]).toBeCloseTo(0, 3);
    expect(f.up[2]).toBeCloseTo(0, 3);
  });

  it('points forward along the direction of travel', () => {
    // Moving east along the equator: ECEF +y.
    const f = orbitalFrame(fix(0, 0, 0), fix(0, 2, 4000))!;
    expect(f.forward[1]).toBeGreaterThan(0.99);
  });

  it('flips forward when the pass reverses', () => {
    const east = orbitalFrame(fix(0, 0, 0), fix(0, 2, 4000))!;
    const west = orbitalFrame(fix(0, 2, 0), fix(0, 0, 4000))!;
    expect(Math.sign(east.forward[1])).toBe(-Math.sign(west.forward[1]));
  });

  it('tracks a northbound pass', () => {
    const f = orbitalFrame(fix(0, 0, 0), fix(3, 0, 4000))!;
    // Heading north over the equator at longitude 0 is ECEF +z.
    expect(f.forward[2]).toBeGreaterThan(0.99);
  });

  it('returns null rather than a random orientation for two identical fixes', () => {
    // A stale feed would otherwise make the model jitter through arbitrary angles.
    expect(orbitalFrame(fix(10, 20, 0), fix(10, 20, 1000))).toBeNull();
  });
});

describe('ecefToEnu', () => {
  it('maps the local vertical onto up for an equatorial observer', () => {
    const enu = ecefToEnu([1, 0, 0], { latitude: 0, longitude: 0 });
    expect(enu[2]).toBeCloseTo(1, 9);
    expect(enu[0]).toBeCloseTo(0, 9);
    expect(enu[1]).toBeCloseTo(0, 9);
  });

  it('maps ECEF +y onto east at longitude zero', () => {
    const enu = ecefToEnu([0, 1, 0], { latitude: 0, longitude: 0 });
    expect(enu[0]).toBeCloseTo(1, 9);
  });

  it('maps ECEF +z onto north on the equator', () => {
    const enu = ecefToEnu([0, 0, 1], { latitude: 0, longitude: 0 });
    expect(enu[1]).toBeCloseTo(1, 9);
  });

  it('preserves vector length', () => {
    const v: [number, number, number] = [3, -4, 12];
    expect(norm(ecefToEnu(v, { latitude: 37, longitude: -122 }))).toBeCloseTo(13, 9);
  });
});

describe('frameToMatrix', () => {
  it('produces 16 finite numbers with a homogeneous bottom row', () => {
    const frame = orbitalFrame(fix(0, 0, 0), fix(0, 2, 4000))!;
    const m = frameToMatrix(frame, { latitude: 10, longitude: 20 });

    expect(m).toHaveLength(16);
    expect(m.every(Number.isFinite)).toBe(true);
    expect(m.slice(12)).toEqual([0, 0, 0, 1]);
  });

  it('stays orthonormal after the frame change', () => {
    const frame = orbitalFrame(fix(30, 40, 0), fix(31, 41, 4000))!;
    const m = frameToMatrix(frame, { latitude: -12, longitude: 77 });

    // Columns of the upper 3x3 must remain unit length.
    for (const col of [0, 1, 2]) {
      const c = [m[col], m[col + 4], m[col + 8]];
      expect(Math.hypot(c[0], c[1], c[2])).toBeCloseTo(1, 6);
    }
  });
});

describe('sunDirectionEcef', () => {
  it('returns a unit vector', () => {
    expect(norm(sunDirectionEcef(new Date('2026-06-21T12:00:00Z')))).toBeCloseTo(1, 9);
  });

  it('swings the sun to the other side of the sky over half a year', () => {
    const june = sunDirectionEcef(new Date('2026-06-21T12:00:00Z'));
    const december = sunDirectionEcef(new Date('2026-12-21T12:00:00Z'));
    const dot = june[0] * december[0] + june[1] * december[1] + june[2] * december[2];
    expect(dot).toBeLessThan(-0.9);
  });

  it('puts the sun north of the equator at the June solstice', () => {
    // Declination is +23.4 degrees then, so the z component must be positive.
    expect(sunDirectionEcef(new Date('2026-06-21T12:00:00Z'))[2]).toBeGreaterThan(0.35);
  });
});

describe('normalize', () => {
  it('collapses a zero vector instead of producing NaN', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
