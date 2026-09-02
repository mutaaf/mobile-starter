import type { IssPosition, Launch, Quake, SpaceWeather } from '@/lib/api';

/**
 * Builds the fusion prompt.
 *
 * Kept out of the screen so the interesting part — what the model is actually
 * told — is testable without rendering anything, and so the wording can change
 * without touching UI code.
 */

export type DeviceContext = {
  platform: string;
  /** Accelerometer magnitude in G, or null when the device exposes no sensor. */
  tiltG: number | null;
  /** True when the device is lying flat. */
  level: boolean | null;
  localTime: string;
  timezone: string;
};

export type FusionInput = {
  iss: IssPosition | null;
  quakes: Quake[] | null;
  space: SpaceWeather | null;
  launches: Launch[] | null;
  device: DeviceContext;
};

export const BRIEF_SYSTEM = [
  'You are the duty officer of a small ground station.',
  'You receive live telemetry from several independent feeds plus the state of the handheld terminal itself.',
  'Write a briefing for the operator holding that terminal.',
  '',
  'Rules:',
  '- Open with a single ALL-CAPS status word: NOMINAL, ELEVATED, or NOTABLE.',
  '- Then at most four short bullets, each tying together at least two different feeds.',
  '- Close with one line headed OUTLOOK.',
  '- Use only the numbers given. Never invent a reading, and say so plainly if a feed is missing.',
  '- Be specific and dry. No filler, no pleasantries, no markdown headers.',
].join('\n');

/** Formats the reading, or says the feed is down — never silently omits it. */
function line(label: string, value: string | null): string {
  return `${label}: ${value ?? 'FEED UNAVAILABLE'}`;
}

export function buildFusionPrompt({ iss, quakes, space, launches, device }: FusionInput): string {
  const strongest = quakes?.reduce<Quake | null>(
    (max, q) => (!max || q.magnitude > max.magnitude ? q : max),
    null,
  );

  const next = launches?.[0];
  const hoursToLaunch = next ? (next.net - Date.now()) / 3_600_000 : null;

  return [
    '=== ORBITAL ===',
    line(
      'ISS position',
      iss
        ? `${iss.latitude.toFixed(2)}, ${iss.longitude.toFixed(2)} at ${iss.altitude.toFixed(0)} km, ${Math.round(iss.velocity)} km/h, currently in ${iss.visibility}`
        : null,
    ),

    '',
    '=== SEISMIC (USGS, M2.5+, last 24h) ===',
    line('Event count', quakes ? String(quakes.length) : null),
    line(
      'Strongest',
      strongest
        ? `M${strongest.magnitude.toFixed(1)} at ${strongest.place}, depth ${Math.round(strongest.depthKm)} km`
        : null,
    ),

    '',
    '=== SPACE WEATHER (NOAA) ===',
    line('Planetary Kp', space ? space.current.toFixed(2) : null),
    line('6h peak Kp', space ? space.peak.toFixed(2) : null),
    line('Geomagnetic storm level', space ? (space.stormLevel ? `G${space.stormLevel}` : 'none') : null),

    '',
    '=== LAUNCH MANIFEST ===',
    line('Upcoming count', launches ? String(launches.length) : null),
    line(
      'Next launch',
      next && hoursToLaunch != null
        ? `${next.rocket} — ${next.mission ?? next.name} from ${next.location}, T-${hoursToLaunch.toFixed(1)}h, status ${next.status}`
        : null,
    ),

    '',
    '=== TERMINAL ===',
    `Platform: ${device.platform}`,
    `Local time: ${device.localTime} (${device.timezone})`,
    line(
      'Handheld attitude',
      device.tiltG == null
        ? null
        : `${device.tiltG.toFixed(2)} G off level — device is ${device.level ? 'resting flat' : 'being held'}`,
    ),
  ].join('\n');
}
