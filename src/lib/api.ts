/**
 * Live data sources. Both are public, keyless and HTTPS — no credentials to
 * manage and nothing to leak in a public repo.
 */

const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const QUAKE_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

/** Requests hang indefinitely on a flaky mobile connection without this. */
const TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  // Caller cancellation (unmount) and the timeout both need to abort the fetch.
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, { signal: composed, headers: { accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted) throw error; // deliberate cancellation, not a failure
    throw new ApiError('Network unreachable', error);
  }

  if (!response.ok) {
    throw new ApiError(`Upstream returned ${response.status}`);
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ApiError('Malformed response', error);
  }
}

export type IssPosition = {
  latitude: number;
  longitude: number;
  /** Kilometres above sea level. */
  altitude: number;
  /** Kilometres per hour. */
  velocity: number;
  visibility: 'daylight' | 'eclipsed' | string;
  /** Radius in km of the ground area the station can currently see. */
  footprint: number;
  /** Unix seconds. */
  timestamp: number;
};

export function fetchIss(signal?: AbortSignal): Promise<IssPosition> {
  return getJson<IssPosition>(ISS_URL, signal);
}

export type Quake = {
  id: string;
  magnitude: number;
  place: string;
  time: number;
  depthKm: number;
  longitude: number;
  latitude: number;
};

type QuakeFeed = {
  features: {
    id: string;
    properties: { mag: number | null; place: string | null; time: number };
    geometry: { coordinates: [number, number, number] };
  }[];
};

export async function fetchQuakes(signal?: AbortSignal): Promise<Quake[]> {
  const feed = await getJson<QuakeFeed>(QUAKE_URL, signal);

  return feed.features
    .filter((f) => f.properties.mag !== null)
    .map((f) => ({
      id: f.id,
      magnitude: f.properties.mag as number,
      place: f.properties.place ?? 'Unknown region',
      time: f.properties.time,
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1],
      depthKm: f.geometry.coordinates[2],
    }))
    .sort((a, b) => b.time - a.time);
}

// ---------------------------------------------------------------- space weather

const KP_URL = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';

/** Planetary K index: 0–9, where 5+ is a geomagnetic storm. */
export type KpSample = { at: number; kp: number };

export type SpaceWeather = {
  current: number;
  peak: number;
  /** Downsampled for plotting; the raw feed is one sample per minute. */
  samples: KpSample[];
  /** NOAA G-scale storm level, 0 when quiet. */
  stormLevel: number;
};

type KpRow = { time_tag: string; estimated_kp: number };

/** NOAA G-scale: G1 begins at Kp 5 and each further step is one Kp point. */
function stormLevelFor(kp: number) {
  return kp < 5 ? 0 : Math.min(5, Math.floor(kp) - 4);
}

/** Evenly samples down to `target` points, always keeping the newest. */
function downsample<T>(rows: T[], target: number): T[] {
  if (rows.length <= target) return rows;
  const step = rows.length / target;
  const out: T[] = [];
  for (let i = 0; i < target; i++) out.push(rows[Math.floor(i * step)]);
  out[out.length - 1] = rows[rows.length - 1];
  return out;
}

export async function fetchSpaceWeather(signal?: AbortSignal): Promise<SpaceWeather> {
  const rows = await getJson<KpRow[]>(KP_URL, signal);

  const samples = downsample(rows, 72)
    .map((r) => ({
      // NOAA stamps these UTC without a zone suffix; without the Z they would be
      // read as local time and the chart would slide by the offset.
      at: Date.parse(`${r.time_tag}Z`),
      kp: Number(r.estimated_kp),
    }))
    .filter((s) => Number.isFinite(s.at) && Number.isFinite(s.kp));

  const current = samples.at(-1)?.kp ?? 0;
  const peak = samples.reduce((m, s) => Math.max(m, s.kp), 0);

  return { current, peak, samples, stormLevel: stormLevelFor(current) };
}

// --------------------------------------------------------------------- launches

const LAUNCH_URL = 'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20';

export type Launch = {
  id: string;
  name: string;
  mission: string | null;
  provider: string;
  rocket: string;
  location: string;
  /** Unix ms of the No Earlier Than time. */
  net: number;
  status: string;
  statusAbbrev: string;
  /** Weather-and-readiness go probability, 0–100, or null when not published. */
  probability: number | null;
};

type LaunchRow = {
  id: string;
  name: string;
  net: string;
  probability: number | null;
  status: { name?: string; abbrev?: string } | null;
  mission: { name?: string } | null;
  launch_service_provider: { name?: string } | null;
  rocket: { configuration?: { full_name?: string } } | null;
  pad: { location?: { name?: string } } | null;
};

export async function fetchLaunches(signal?: AbortSignal): Promise<Launch[]> {
  const feed = await getJson<{ results: LaunchRow[] }>(LAUNCH_URL, signal);
  const now = Date.now();

  return feed.results
    .map((r) => ({
      id: r.id,
      name: r.name,
      mission: r.mission?.name ?? null,
      provider: r.launch_service_provider?.name ?? 'Unknown',
      rocket: r.rocket?.configuration?.full_name ?? 'Unknown vehicle',
      location: r.pad?.location?.name ?? 'Unknown site',
      net: Date.parse(r.net),
      status: r.status?.name ?? 'Unknown',
      statusAbbrev: r.status?.abbrev ?? '—',
      probability: r.probability ?? null,
    }))
    // The "upcoming" feed trails recently-flown launches, which would render as
    // negative countdowns.
    .filter((l) => Number.isFinite(l.net) && l.net > now)
    .sort((a, b) => a.net - b.net);
}
