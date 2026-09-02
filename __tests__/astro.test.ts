import {
  angularDelta,
  angularSeparation,
  auroraOvalLatitude,
  bearingTo,
  compassPoint,
  equatorialToHorizontal,
  geodeticToEcef,
  greenwichMeanSiderealTime,
  julianDate,
  normalizeDegrees,
  satelliteLookAngle,
} from '@/lib/sky/astro';
import { star, STARS } from '@/lib/sky/catalogue';

describe('julianDate', () => {
  it('places the J2000 epoch at JD 2451545.0', () => {
    // J2000.0 is 2000-01-01 12:00:00 TT, close enough to UTC for our purposes.
    expect(julianDate(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(2451545.0, 5);
  });

  it('advances by exactly one per day', () => {
    const a = julianDate(new Date('2026-03-01T00:00:00Z'));
    const b = julianDate(new Date('2026-03-02T00:00:00Z'));
    expect(b - a).toBeCloseTo(1, 9);
  });
});

describe('greenwichMeanSiderealTime', () => {
  it('matches the published value at the J2000 epoch', () => {
    // GMST at J2000.0 is 280.46061837 degrees by definition of the series.
    expect(greenwichMeanSiderealTime(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(280.46, 1);
  });

  it('advances by roughly 360.986 degrees per solar day', () => {
    // A sidereal day is ~4 minutes shorter than a solar one, which is why the
    // stars rise earlier each night.
    const a = greenwichMeanSiderealTime(new Date('2026-03-01T00:00:00Z'));
    const b = greenwichMeanSiderealTime(new Date('2026-03-02T00:00:00Z'));
    expect(normalizeDegrees(b - a)).toBeCloseTo(0.986, 2);
  });
});

describe('equatorialToHorizontal', () => {
  it('puts Polaris due north at an altitude equal to the observer latitude', () => {
    // The classic field check: Polaris sits within a degree of the pole, so its
    // altitude *is* your latitude, at any time of night, anywhere north of the
    // equator. If this fails, the whole conversion is wrong.
    const polaris = star('Polaris');

    for (const latitude of [10, 35, 51.5, 68]) {
      const { altitude, azimuth } = equatorialToHorizontal(
        polaris.ra,
        polaris.dec,
        { latitude, longitude: 0 },
        new Date('2026-06-21T22:00:00Z'),
      );

      expect(Math.abs(altitude - latitude)).toBeLessThan(1.2);
      // Azimuth is near 0/360; compare on the circle, not on the number line.
      expect(Math.abs(angularDelta(0, azimuth))).toBeLessThan(2);
    }
  });

  it('places a star on the observer meridian at its transit altitude', () => {
    // A star transits due south (northern hemisphere) at altitude
    // 90 - latitude + declination. Pick the moment its RA equals the local
    // sidereal time by construction.
    const latitude = 40;
    const at = new Date('2026-09-21T03:00:00Z');
    const lstDeg = greenwichMeanSiderealTime(at); // longitude 0

    const declination = 10;
    const { altitude, azimuth } = equatorialToHorizontal(
      lstDeg,
      declination,
      { latitude, longitude: 0 },
      at,
    );

    expect(altitude).toBeCloseTo(90 - latitude + declination, 4);
    expect(Math.abs(angularDelta(180, azimuth))).toBeLessThan(0.5);
  });

  it('sends a star below the horizon when it is on the far side of the earth', () => {
    const at = new Date('2026-09-21T03:00:00Z');
    const lstDeg = greenwichMeanSiderealTime(at);

    // Anti-meridian, southern declination, northern observer.
    const { altitude } = equatorialToHorizontal(
      normalizeDegrees(lstDeg + 180),
      -40,
      { latitude: 50, longitude: 0 },
      at,
    );

    expect(altitude).toBeLessThan(0);
  });

  it('keeps the south celestial pole below the horizon for a northern observer', () => {
    const { altitude } = equatorialToHorizontal(
      0,
      -90,
      { latitude: 45, longitude: -75 },
      new Date('2026-01-15T04:00:00Z'),
    );
    expect(altitude).toBeCloseTo(-45, 1);
  });
});

describe('geodeticToEcef', () => {
  it('puts a point on the equator at the equatorial radius', () => {
    const { x, y, z } = geodeticToEcef(0, 0, 0);
    expect(x).toBeCloseTo(6378.137, 3);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('accounts for flattening at the pole', () => {
    const { z } = geodeticToEcef(90, 0, 0);
    // Polar radius is ~21.4 km shorter than equatorial — ignoring flattening
    // would put the pole 21 km out.
    expect(z).toBeCloseTo(6356.752, 2);
  });
});

describe('satelliteLookAngle', () => {
  const observer = { latitude: 40, longitude: -74 };

  it('reports the zenith when the satellite is directly overhead', () => {
    const look = satelliteLookAngle(observer, {
      latitude: 40,
      longitude: -74,
      altitudeKm: 420,
    });

    expect(look.altitude).toBeCloseTo(90, 3);
    expect(look.rangeKm).toBeCloseTo(420, 1);
    expect(look.visible).toBe(true);
  });

  it('marks a satellite over the antipode as not visible', () => {
    const look = satelliteLookAngle(observer, {
      latitude: -40,
      longitude: 106,
      altitudeKm: 420,
    });

    expect(look.visible).toBe(false);
    expect(look.altitude).toBeLessThan(0);
    // Range must exceed an earth diameter when looking straight through it.
    expect(look.rangeKm).toBeGreaterThan(12_000);
  });

  it('points north for a satellite due north of the observer', () => {
    const look = satelliteLookAngle(observer, {
      latitude: 48,
      longitude: -74,
      altitudeKm: 420,
    });

    expect(Math.abs(angularDelta(0, look.azimuth))).toBeLessThan(1);
    expect(look.visible).toBe(true);
  });

  it('points east for a satellite due east along the equator', () => {
    const look = satelliteLookAngle(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 8, altitudeKm: 420 },
    );

    expect(Math.abs(angularDelta(90, look.azimuth))).toBeLessThan(1);
  });

  it('drops altitude as the satellite moves away', () => {
    const near = satelliteLookAngle(observer, { latitude: 41, longitude: -74, altitudeKm: 420 });
    const far = satelliteLookAngle(observer, { latitude: 55, longitude: -74, altitudeKm: 420 });

    expect(near.altitude).toBeGreaterThan(far.altitude);
    expect(far.rangeKm).toBeGreaterThan(near.rangeKm);
  });
});

describe('angularDelta', () => {
  it('takes the short way round the circle', () => {
    expect(angularDelta(359, 1)).toBeCloseTo(2, 6);
    expect(angularDelta(1, 359)).toBeCloseTo(-2, 6);
    expect(angularDelta(10, 200)).toBeCloseTo(-170, 6);
  });
});

describe('angularSeparation', () => {
  it('is zero for identical directions and 180 for opposites', () => {
    expect(angularSeparation({ altitude: 30, azimuth: 90 }, { altitude: 30, azimuth: 90 }))
      .toBeCloseTo(0, 6);
    expect(angularSeparation({ altitude: 90, azimuth: 0 }, { altitude: -90, azimuth: 0 }))
      .toBeCloseTo(180, 4);
  });

  it('measures across the azimuth wrap correctly', () => {
    expect(angularSeparation({ altitude: 0, azimuth: 359 }, { altitude: 0, azimuth: 1 }))
      .toBeCloseTo(2, 4);
  });
});

describe('compassPoint', () => {
  it.each([
    [0, 'N'], [45, 'NE'], [90, 'E'], [180, 'S'], [270, 'W'], [337.5, 'NNW'], [359, 'N'],
  ])('%d° is %s', (azimuth, expected) => {
    expect(compassPoint(azimuth)).toBe(expected);
  });
});

describe('bearingTo', () => {
  it('reads due north when the target is at the same longitude, higher latitude', () => {
    expect(bearingTo({ latitude: 40, longitude: -74 }, { latitude: 50, longitude: -74 }))
      .toBeCloseTo(0, 4);
  });

  it('reads due east along the equator', () => {
    expect(bearingTo({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 20 }))
      .toBeCloseTo(90, 4);
  });
});

describe('auroraOvalLatitude', () => {
  it('expands equatorward as Kp rises', () => {
    expect(auroraOvalLatitude(0)).toBeCloseTo(66.5, 4);
    expect(auroraOvalLatitude(5)).toBeCloseTo(56.5, 4);
    expect(auroraOvalLatitude(9)).toBeCloseTo(48.5, 4);
  });

  it('clamps out-of-range input rather than extrapolating nonsense', () => {
    expect(auroraOvalLatitude(-3)).toBeCloseTo(66.5, 4);
    expect(auroraOvalLatitude(20)).toBeCloseTo(48.5, 4);
  });
});

describe('catalogue', () => {
  it('holds every star within valid coordinate ranges', () => {
    for (const s of STARS) {
      expect(s.ra).toBeGreaterThanOrEqual(0);
      expect(s.ra).toBeLessThan(360);
      expect(Math.abs(s.dec)).toBeLessThanOrEqual(90);
      expect(s.mag).toBeLessThan(4);
    }
  });

  it('has no duplicate names', () => {
    expect(new Set(STARS.map((s) => s.name)).size).toBe(STARS.length);
  });

  it('resolves every star referenced by a constellation figure', () => {
    // Guards against a typo in a figure silently dropping a line.
    const { CONSTELLATIONS } = jest.requireActual('@/lib/sky/catalogue');
    for (const c of CONSTELLATIONS) {
      for (const [a, b] of c.lines) {
        expect(() => star(a)).not.toThrow();
        expect(() => star(b)).not.toThrow();
      }
    }
  });
});
