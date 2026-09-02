import { MemoryStore, ResourceCache, type Clock } from '@/lib/cache';

/** Controllable clock, so staleness is asserted rather than waited for. */
class FakeClock implements Clock {
  constructor(private t = 1_000_000) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

const KEY = 'test:key';

/** Lets queued microtasks and background revalidation settle. */
const flush = () => new Promise((r) => setImmediate(r));

function setup() {
  const clock = new FakeClock();
  const cache = new ResourceCache(new MemoryStore(), clock);
  return { cache, clock };
}

describe('ResourceCache', () => {
  it('fetches on a miss and serves from cache while fresh', async () => {
    const { cache } = setup();
    const fetcher = jest.fn().mockResolvedValue('v1');

    await cache.read(KEY, fetcher, { staleMs: 1000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getState<string>(KEY).data).toBe('v1');

    await cache.read(KEY, fetcher, { staleMs: 1000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.stats.hits).toBe(1);
  });

  it('serves stale data immediately and revalidates behind it', async () => {
    const { cache, clock } = setup();
    const fetcher = jest.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    await cache.read(KEY, fetcher, { staleMs: 1000, ttlMs: 60_000 });
    clock.advance(2000); // stale, not expired

    await cache.read(KEY, fetcher, { staleMs: 1000, ttlMs: 60_000 });
    // The old value is still on screen at this point — that is the whole point
    // of stale-while-revalidate.
    expect(cache.stats.staleHits).toBe(1);

    await flush();
    expect(cache.getState<string>(KEY).data).toBe('v2');
  });

  it('refetches once the entry has fully expired', async () => {
    const { cache, clock } = setup();
    const fetcher = jest.fn().mockResolvedValue('v1');

    await cache.read(KEY, fetcher, { staleMs: 100, ttlMs: 1000 });
    clock.advance(5000);
    await cache.read(KEY, fetcher, { staleMs: 100, ttlMs: 1000 });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent reads into a single request', async () => {
    const { cache } = setup();
    let resolve!: (v: string) => void;
    const fetcher = jest.fn(() => new Promise<string>((r) => (resolve = r)));

    const a = cache.read(KEY, fetcher);
    const b = cache.read(KEY, fetcher);
    // Both reads await the store before reaching the fetcher, so the promise
    // captured above does not exist until the queue drains.
    await flush();
    resolve('once');
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.stats.dedups).toBe(1);
  });

  it('keeps the last good value when a refetch fails', async () => {
    const { cache, clock } = setup();
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce('good')
      .mockRejectedValueOnce(new Error('boom'));

    await cache.read(KEY, fetcher, { staleMs: 10, ttlMs: 60_000 });
    clock.advance(50);
    await cache.read(KEY, fetcher, { staleMs: 10, ttlMs: 60_000, force: true });

    const state = cache.getState<string>(KEY);
    expect(state.error?.message).toBe('boom');
    expect(state.data).toBe('good');
  });

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const { cache } = setup();
    const listener = jest.fn();
    const off = cache.subscribe(KEY, listener);

    await cache.read(KEY, jest.fn().mockResolvedValue('v1'));
    expect(listener).toHaveBeenCalled();

    off();
    const before = listener.mock.calls.length;
    await cache.read(KEY, jest.fn().mockResolvedValue('v2'), { force: true });
    expect(listener.mock.calls.length).toBe(before);
  });

  it('returns a referentially stable empty state', () => {
    const { cache } = setup();
    // useSyncExternalStore would loop forever if this allocated each call.
    expect(cache.getState('absent')).toBe(cache.getState('absent'));
  });

  describe('overrides', () => {
    it('pins a value against revalidation until released', async () => {
      const { cache } = setup();
      const fetcher = jest.fn().mockResolvedValue('network');

      await cache.override(KEY, 'pinned');
      await cache.read(KEY, fetcher);

      expect(fetcher).not.toHaveBeenCalled();
      expect(cache.getState<string>(KEY).data).toBe('pinned');
      expect(cache.getState<string>(KEY).pinned).toBe(true);

      await cache.release(KEY);
      // Release leaves the entry usable but stale, so this read serves the old
      // value and revalidates behind it rather than blocking.
      await cache.read(KEY, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cache.getState<string>(KEY).data).toBe('pinned');

      await flush();
      expect(cache.getState<string>(KEY).data).toBe('network');
      expect(cache.getState<string>(KEY).pinned).toBe(false);
    });

    it('invalidate forces the next read to revalidate', async () => {
      const { cache } = setup();
      const fetcher = jest.fn().mockResolvedValue('v1');

      await cache.read(KEY, fetcher, { staleMs: 60_000 });
      await cache.invalidate(KEY);
      await cache.read(KEY, fetcher, { staleMs: 60_000 });

      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('evict removes the entry entirely', async () => {
      const { cache } = setup();
      await cache.read(KEY, jest.fn().mockResolvedValue('v1'));
      await cache.evict(KEY);

      expect(await cache.snapshot()).toHaveLength(0);
      expect(cache.getState(KEY).data).toBeNull();
    });
  });

  describe('injected network policy', () => {
    it('fails every request while offline', async () => {
      const { cache } = setup();
      cache.setPolicy({ offline: true });

      await cache.read(KEY, jest.fn().mockResolvedValue('v1'));
      expect(cache.getState(KEY).error?.message).toMatch(/Offline/);
    });

    it('fails exactly one request with failNext', async () => {
      const { cache } = setup();
      const fetcher = jest.fn().mockResolvedValue('v1');
      cache.setPolicy({ failNext: true });

      await cache.read(KEY, fetcher);
      expect(cache.getState(KEY).error).toBeTruthy();

      await cache.read(KEY, fetcher, { force: true });
      expect(cache.getState<string>(KEY).data).toBe('v1');
      expect(cache.getPolicy().failNext).toBe(false);
    });
  });

  it('records an event trail for the devtools timeline', async () => {
    const { cache } = setup();
    await cache.read(KEY, jest.fn().mockResolvedValue('v1'));

    const kinds = cache.getEvents().map((e) => e.kind);
    expect(kinds).toContain('miss');
    expect(kinds).toContain('fetch');
    expect(kinds).toContain('fetch-ok');
  });
});
