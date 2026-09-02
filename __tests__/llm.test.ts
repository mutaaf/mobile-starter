import type { Quake } from '@/lib/api';
import { buildFusionPrompt, type DeviceContext } from '@/lib/llm/brief';
import { maskKey } from '@/lib/llm/key-store';
import { PROVIDERS } from '@/lib/llm/providers';
import { LlmError } from '@/lib/llm/types';

const originalFetch = global.fetch;

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fn = jest.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('key masking', () => {
  it('reveals only enough to recognise the key', () => {
    expect(maskKey('sk-ant-api03-ABCDEFGHIJKLMNOP')).toBe('sk-ant…MNOP');
  });

  it('collapses short strings entirely rather than leaking most of them', () => {
    // A 12-char secret masked as `abc…jkl` would expose half of itself.
    expect(maskKey('sk-abc123')).toBe('••••••••');
  });
});

describe('key shape checks', () => {
  it.each([
    ['anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwx', true],
    ['anthropic', 'sk-proj-abcdefghijklmnopqrstuvwx', false],
    ['openai', 'sk-proj-abcdefghijklmnopqrstuvwx', true],
    ['openai', 'AIzaSyAbcdefghijklmnopqrstuvwxyz123456', false],
    ['gemini', 'AIzaSyAbcdefghijklmnopqrstuvwxyz123456', true],
    ['gemini', 'sk-ant-api03-abcdefghijklmnopqrstuvwx', false],
  ] as const)('%s accepts its own format only', (id, key, expected) => {
    expect(PROVIDERS[id].looksLikeKey(key)).toBe(expected);
  });

  it('rejects an empty or whitespace key everywhere', () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.looksLikeKey('   ')).toBe(false);
    }
  });
});

describe('provider transport', () => {
  it('sends the Anthropic key as a header with the version header', async () => {
    const fetchMock = mockFetch({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'NOMINAL' }],
      usage: { input_tokens: 10, output_tokens: 3 },
    });

    const result = await PROVIDERS.anthropic.complete(
      { system: 's', user: 'u' },
      'sk-ant-test-key',
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(result).toMatchObject({ text: 'NOMINAL', inputTokens: 10, outputTokens: 3 });
  });

  it('treats an Anthropic refusal as an error even though it is HTTP 200', async () => {
    mockFetch({ model: 'claude-opus-5', stop_reason: 'refusal', content: [] });

    await expect(
      PROVIDERS.anthropic.complete({ system: 's', user: 'u' }, 'sk-ant-test-key'),
    ).rejects.toThrow(/declined/);
  });

  it('never puts the Gemini key in the URL', async () => {
    const fetchMock = mockFetch({
      candidates: [{ content: { parts: [{ text: 'NOMINAL' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    });

    await PROVIDERS.gemini.complete({ system: 's', user: 'u' }, 'AIza-secret');

    const [url, init] = fetchMock.mock.calls[0];
    // URLs leak into logs and crash reports; headers do not.
    expect(url).not.toContain('AIza-secret');
    expect(init.headers['x-goog-api-key']).toBe('AIza-secret');
  });

  it('classifies auth, rate-limit and server failures distinctly', async () => {
    for (const [status, kind] of [
      [401, 'auth'],
      [429, 'rate-limit'],
      [503, 'server'],
    ] as const) {
      mockFetch({ error: 'nope' }, { ok: false, status });
      await expect(
        PROVIDERS.openai.complete({ system: 's', user: 'u' }, 'sk-test'),
      ).rejects.toMatchObject({ kind });
    }
  });

  it('reports an unreachable network as such', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as never;
    await expect(
      PROVIDERS.openai.complete({ system: 's', user: 'u' }, 'sk-test'),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('does not echo the key back in an error message', async () => {
    mockFetch({ error: 'bad' }, { ok: false, status: 400 });
    const secret = 'sk-ant-super-secret-value';

    const error = await PROVIDERS.anthropic
      .complete({ system: 's', user: 'u' }, secret)
      .catch((e: LlmError) => e);

    expect((error as LlmError).message).not.toContain(secret);
  });
});

describe('fusion prompt', () => {
  const device: DeviceContext = {
    platform: 'ios 18.1',
    tiltG: 0.05,
    level: true,
    localTime: '18:00:00',
    timezone: 'UTC',
  };

  it('marks missing feeds explicitly rather than dropping them', () => {
    const prompt = buildFusionPrompt({
      iss: null,
      quakes: null,
      space: null,
      launches: null,
      device,
    });

    // The model must be able to tell "quiet" from "no data" — silently omitting
    // a feed invites it to invent one.
    expect(prompt.match(/FEED UNAVAILABLE/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('includes readings from every feed when present', () => {
    const prompt = buildFusionPrompt({
      iss: {
        latitude: -45.4,
        longitude: -162.4,
        altitude: 437.8,
        velocity: 27530,
        visibility: 'daylight',
        footprint: 4597,
        timestamp: 0,
      },
      quakes: [
        { id: 'a', magnitude: 5.8, place: 'Alaska', time: Date.now(), depthKm: 30, latitude: 0, longitude: 0 },
        { id: 'b', magnitude: 3.1, place: 'Chile', time: Date.now(), depthKm: 10, latitude: 0, longitude: 0 },
      ],
      space: { current: 5.2, peak: 6.1, samples: [], stormLevel: 1 },
      launches: [
        {
          id: 'l1',
          name: 'Falcon 9',
          mission: 'Starlink',
          provider: 'SpaceX',
          rocket: 'Falcon 9 Block 5',
          location: 'Cape Canaveral',
          net: Date.now() + 7_200_000,
          status: 'Go for Launch',
          statusAbbrev: 'Go',
          probability: 90,
        },
      ],
      device,
    });

    expect(prompt).toContain('27530 km/h');
    expect(prompt).toContain('M5.8 at Alaska'); // strongest, not merely first
    expect(prompt).toContain('G1');
    expect(prompt).toContain('Falcon 9 Block 5');
    expect(prompt).toContain('resting flat');
    expect(prompt).not.toContain('FEED UNAVAILABLE');
  });

  it('picks the strongest quake regardless of feed order', () => {
    const quake = (id: string, magnitude: number, place: string): Quake => ({
      id,
      magnitude,
      place,
      time: Date.now(),
      depthKm: 10,
      latitude: 0,
      longitude: 0,
    });

    const prompt = buildFusionPrompt({
      iss: null,
      space: null,
      launches: null,
      quakes: [quake('a', 2.6, 'Weak'), quake('b', 6.4, 'Strong'), quake('c', 4.0, 'Middle')],
      device,
    });

    expect(prompt).toContain('M6.4 at Strong');
  });
});
