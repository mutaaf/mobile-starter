import {
  ApiError,
  fetchIss,
  fetchLaunches,
  fetchQuakes,
  fetchSpaceWeather,
} from '@/lib/api';

const originalFetch = global.fetch;

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fn = jest.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('fetchIss', () => {
  it('returns the parsed position', async () => {
    mockFetch({
      latitude: -45.4,
      longitude: -162.4,
      altitude: 437.8,
      velocity: 27530.4,
      visibility: 'daylight',
      footprint: 4597.2,
      timestamp: 1788301106,
    });

    await expect(fetchIss()).resolves.toMatchObject({
      latitude: -45.4,
      velocity: 27530.4,
      visibility: 'daylight',
    });
  });

  it('surfaces a readable error for a non-2xx response', async () => {
    mockFetch({}, { ok: false, status: 503 });
    await expect(fetchIss()).rejects.toThrow(ApiError);
    await expect(fetchIss()).rejects.toThrow('Upstream returned 503');
  });

  it('reports a network failure rather than leaking the raw error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never;
    await expect(fetchIss()).rejects.toThrow('Network unreachable');
  });
});

describe('fetchQuakes', () => {
  const feature = (id: string, mag: number | null, time: number, place: string | null = 'Alaska') => ({
    id,
    properties: { mag, place, time },
    geometry: { coordinates: [-150.1, 58.2, 42.7] as [number, number, number] },
  });

  it('maps the GeoJSON feed onto a flat shape', async () => {
    mockFetch({ features: [feature('a', 4.2, 1000)] });

    const [quake] = await fetchQuakes();
    expect(quake).toEqual({
      id: 'a',
      magnitude: 4.2,
      place: 'Alaska',
      time: 1000,
      longitude: -150.1,
      latitude: 58.2,
      depthKm: 42.7,
    });
  });

  it('drops events with no magnitude', async () => {
    mockFetch({ features: [feature('a', null, 1000), feature('b', 3.1, 2000)] });

    const quakes = await fetchQuakes();
    expect(quakes.map((q) => q.id)).toEqual(['b']);
  });

  it('sorts most recent first', async () => {
    mockFetch({
      features: [feature('old', 3, 1000), feature('new', 3, 3000), feature('mid', 3, 2000)],
    });

    expect((await fetchQuakes()).map((q) => q.id)).toEqual(['new', 'mid', 'old']);
  });

  it('falls back when the feed omits a place name', async () => {
    mockFetch({ features: [feature('a', 3, 1000, null)] });
    expect((await fetchQuakes())[0].place).toBe('Unknown region');
  });
});

describe('fetchSpaceWeather', () => {
  const row = (minute: number, kp: number) => ({
    time_tag: `2026-09-01T0${minute}:00:00`,
    estimated_kp: kp,
  });

  it('parses NOAA timestamps as UTC', async () => {
    mockFetch([row(1, 2.3)]);
    const { samples } = await fetchSpaceWeather();
    // Without the appended Z these parse as local time and the chart slides by
    // the machine's UTC offset.
    expect(samples[0].at).toBe(Date.parse('2026-09-01T01:00:00Z'));
  });

  it('reports the newest sample as current and the highest as peak', async () => {
    mockFetch([row(1, 2), row(2, 7.1), row(3, 3.4)]);
    const { current, peak } = await fetchSpaceWeather();
    expect(current).toBe(3.4);
    expect(peak).toBe(7.1);
  });

  it('maps Kp onto the NOAA G storm scale', async () => {
    mockFetch([row(1, 4.9)]);
    expect((await fetchSpaceWeather()).stormLevel).toBe(0);

    mockFetch([row(1, 5.2)]);
    expect((await fetchSpaceWeather()).stormLevel).toBe(1);

    mockFetch([row(1, 9)]);
    expect((await fetchSpaceWeather()).stormLevel).toBe(5);
  });

  it('downsamples long feeds but keeps the newest reading', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({
      time_tag: '2026-09-01T01:00:00',
      estimated_kp: i,
    }));
    const { samples, current } = await (mockFetch(rows), fetchSpaceWeather());

    expect(samples.length).toBeLessThanOrEqual(72);
    expect(current).toBe(399);
  });
});

describe('fetchLaunches', () => {
  const HOUR = 3600_000;
  const launch = (id: string, offsetMs: number) => ({
    id,
    name: `Rocket ${id}`,
    net: new Date(Date.now() + offsetMs).toISOString(),
    probability: 80,
    status: { name: 'Go for Launch', abbrev: 'Go' },
    mission: { name: `Mission ${id}` },
    launch_service_provider: { name: 'SpaceX' },
    rocket: { configuration: { full_name: 'Falcon 9 Block 5' } },
    pad: { location: { name: 'Cape Canaveral' } },
  });

  it('drops launches that have already flown', async () => {
    mockFetch({ results: [launch('past', -2 * HOUR), launch('future', 2 * HOUR)] });
    expect((await fetchLaunches()).map((l) => l.id)).toEqual(['future']);
  });

  it('sorts soonest first', async () => {
    mockFetch({
      results: [launch('later', 8 * HOUR), launch('soon', 1 * HOUR), launch('mid', 4 * HOUR)],
    });
    expect((await fetchLaunches()).map((l) => l.id)).toEqual(['soon', 'mid', 'later']);
  });

  it('flattens the nested payload', async () => {
    mockFetch({ results: [launch('a', HOUR)] });
    expect((await fetchLaunches())[0]).toMatchObject({
      provider: 'SpaceX',
      rocket: 'Falcon 9 Block 5',
      location: 'Cape Canaveral',
      mission: 'Mission a',
      statusAbbrev: 'Go',
      probability: 80,
    });
  });

  it('tolerates missing nested fields', async () => {
    mockFetch({
      results: [
        {
          id: 'sparse',
          name: 'Unknown rocket',
          net: new Date(Date.now() + HOUR).toISOString(),
          probability: null,
          status: null,
          mission: null,
          launch_service_provider: null,
          rocket: null,
          pad: null,
        },
      ],
    });
    expect((await fetchLaunches())[0]).toMatchObject({
      provider: 'Unknown',
      rocket: 'Unknown vehicle',
      location: 'Unknown site',
      mission: null,
      probability: null,
    });
  });
});
