/**
 * Positional astronomy.
 *
 * Deliberately pure functions with no React, no sensors and no I/O: this is the
 * part that has to be *correct*, and correctness here is checkable against
 * published values rather than by looking at the screen. The renderer on top can
 * then be judged purely on whether it looks right.
 *
 * Angles are degrees at every boundary; radians only ever live inside a function.
 * Longitude is east-positive, azimuth is measured from true north through east.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** WGS84. */
const EARTH_RADIUS_KM = 6378.137;
const FLATTENING = 1 / 298.257223563;
const E2 = FLATTENING * (2 - FLATTENING);

export type Horizontal = {
  /** Degrees above the horizon; negative means below it. */
  altitude: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
};

export type Observer = {
  latitude: number;
  longitude: number;
  /** Metres above the ellipsoid. Optional; matters only for satellite geometry. */
  elevationM?: number;
};

export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Julian Date from a JS Date. The Unix epoch is JD 2440587.5. */
export function julianDate(at: Date): number {
  return at.getTime() / 86_400_000 + 2440587.5;
}

/**
 * Greenwich Mean Sidereal Time in degrees.
 *
 * IAU 1982 series. Accurate to well under an arcsecond for any date this app
 * will ever see, which is far better than the pointing accuracy of a phone.
 */
export function greenwichMeanSiderealTime(at: Date): number {
  const jd = julianDate(at);
  const d = jd - 2451545.0;
  const t = d / 36525;

  const gmst =
    280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38_710_000;

  return normalizeDegrees(gmst);
}

/** Local Sidereal Time in degrees: the RA currently on the observer's meridian. */
export function localSiderealTime(at: Date, longitude: number): number {
  return normalizeDegrees(greenwichMeanSiderealTime(at) + longitude);
}

/**
 * Equatorial (RA/Dec, J2000) to horizontal (alt/az) for an observer.
 *
 * Precession is not applied. Over the couple of decades either side of J2000
 * it costs well under a degree — invisible next to the ~5° attitude error of a
 * handset's magnetometer.
 */
export function equatorialToHorizontal(
  rightAscension: number,
  declination: number,
  observer: Observer,
  at: Date,
): Horizontal {
  const lst = localSiderealTime(at, observer.longitude);
  const hourAngle = normalizeDegrees(lst - rightAscension) * DEG;

  const dec = declination * DEG;
  const lat = observer.latitude * DEG;

  const sinAlt =
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // atan2 form rather than acos: it is stable at the poles and gives the
  // quadrant directly, where acos would need a separate sign test.
  const azimuth = Math.atan2(
    -Math.cos(dec) * Math.sin(hourAngle),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle),
  );

  return {
    altitude: altitude * RAD,
    azimuth: normalizeDegrees(azimuth * RAD),
  };
}

type Ecef = { x: number; y: number; z: number };

/** Geodetic latitude/longitude/altitude to earth-centred, earth-fixed km. */
export function geodeticToEcef(latitude: number, longitude: number, altitudeKm: number): Ecef {
  const lat = latitude * DEG;
  const lon = longitude * DEG;
  const sinLat = Math.sin(lat);

  // Radius of curvature in the prime vertical.
  const n = EARTH_RADIUS_KM / Math.sqrt(1 - E2 * sinLat * sinLat);

  return {
    x: (n + altitudeKm) * Math.cos(lat) * Math.cos(lon),
    y: (n + altitudeKm) * Math.cos(lat) * Math.sin(lon),
    z: (n * (1 - E2) + altitudeKm) * sinLat,
  };
}

export type LookAngle = Horizontal & {
  /** Straight-line distance to the target, km. */
  rangeKm: number;
  /** True when the target is above the observer's horizon. */
  visible: boolean;
};

/**
 * Where to point to see a satellite, given its sub-point and altitude.
 *
 * The ISS feed gives geodetic lat/lon plus altitude, which is exactly this. Both
 * points go to ECEF, the difference is rotated into the observer's east/north/up
 * frame, and the look angle falls out of that.
 */
export function satelliteLookAngle(
  observer: Observer,
  satellite: { latitude: number; longitude: number; altitudeKm: number },
): LookAngle {
  const obs = geodeticToEcef(
    observer.latitude,
    observer.longitude,
    (observer.elevationM ?? 0) / 1000,
  );
  const sat = geodeticToEcef(satellite.latitude, satellite.longitude, satellite.altitudeKm);

  const dx = sat.x - obs.x;
  const dy = sat.y - obs.y;
  const dz = sat.z - obs.z;

  const lat = observer.latitude * DEG;
  const lon = observer.longitude * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  const rangeKm = Math.sqrt(east * east + north * north + up * up);
  const altitude = Math.asin(up / rangeKm) * RAD;

  return {
    altitude,
    azimuth: normalizeDegrees(Math.atan2(east, north) * RAD),
    rangeKm,
    visible: altitude > 0,
  };
}

/**
 * Signed smallest angle from `from` to `to`, in (-180, 180].
 *
 * Needed everywhere a heading is compared: 359° and 1° are two degrees apart,
 * not 358, and getting this wrong makes a compass arrow spin the long way round.
 */
export function angularDelta(from: number, to: number): number {
  let delta = normalizeDegrees(to - from);
  if (delta > 180) delta -= 360;
  return delta;
}

/** Great-circle separation between two horizontal directions, degrees. */
export function angularSeparation(a: Horizontal, b: Horizontal): number {
  const alt1 = a.altitude * DEG;
  const alt2 = b.altitude * DEG;
  const dAz = (b.azimuth - a.azimuth) * DEG;

  const cosSep =
    Math.sin(alt1) * Math.sin(alt2) + Math.cos(alt1) * Math.cos(alt2) * Math.cos(dAz);

  return Math.acos(Math.max(-1, Math.min(1, cosSep))) * RAD;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const;

/** Azimuth to a 16-point compass name. */
export function compassPoint(azimuth: number): string {
  return COMPASS[Math.round(normalizeDegrees(azimuth) / 22.5) % 16];
}

/**
 * Geomagnetic north pole (IGRF epoch 2025, drifting ~55 km/yr toward Siberia).
 *
 * The aurora oval is centred on the geomagnetic pole, not the geographic one —
 * pointing a user at true north would be wrong by up to 30° depending on where
 * they stand.
 */
export const GEOMAGNETIC_NORTH = { latitude: 86.2, longitude: 146.8 };

/**
 * Initial great-circle bearing from one point to another, degrees from true north.
 */
export function bearingTo(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const lat1 = from.latitude * DEG;
  const lat2 = to.latitude * DEG;
  const dLon = (to.longitude - from.longitude) * DEG;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDegrees(Math.atan2(y, x) * RAD);
}

/**
 * Rough equatorward edge of the aurora oval for a given Kp, as geomagnetic
 * latitude. The oval expands toward the equator as activity rises — the usual
 * rule of thumb is ~66° at Kp 0 falling ~2° per Kp step.
 */
export function auroraOvalLatitude(kp: number): number {
  return 66.5 - 2 * Math.max(0, Math.min(9, kp));
}
