import type {
  CacheEntry,
  CacheEvent,
  CacheEventKind,
  CacheStore,
  Clock,
  NetworkPolicy,
  ReadOptions,
  ResourceState,
} from './types';
import { systemClock } from './types';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TTL_MS = 10 * 60_000;
const EVENT_LOG_LIMIT = 120;

export type CacheStats = {
  hits: number;
  staleHits: number;
  misses: number;
  fetches: number;
  errors: number;
  dedups: number;
  /** Rolling mean of successful fetch durations, ms. */
  avgFetchMs: number;
};

type Listener = () => void;

/**
 * A stale-while-revalidate resource cache.
 *
 * Responsibilities are deliberately narrow: it owns entry lifecycle, request
 * dedup and notification. It does not know what it is caching, how the data is
 * fetched, or how it is rendered — callers supply the fetcher, and the store and
 * clock are injected.
 */
export class ResourceCache {
  private states = new Map<string, ResourceState<unknown>>();
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();
  /** Single-flight: concurrent reads of one key share one request. */
  private inflight = new Map<string, Promise<void>>();
  private events: CacheEvent[] = [];
  private eventSeq = 0;
  private fetchDurations: number[] = [];

  stats: CacheStats = {
    hits: 0,
    staleHits: 0,
    misses: 0,
    fetches: 0,
    errors: 0,
    dedups: 0,
    avgFetchMs: 0,
  };

  private networkPolicy: NetworkPolicy = { offline: false, latencyMs: 0, failNext: false };

  constructor(
    private store: CacheStore,
    private clock: Clock = systemClock,
  ) {}

  // ---------------------------------------------------------------- subscribe

  subscribe(key: string, listener: Listener) {
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  /** Fires on any key's change. Used by the devtools panel. */
  subscribeAll(listener: Listener) {
    this.globalListeners.add(listener);
    // Braced: Set.delete returns a boolean, which is not a valid effect destructor.
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  getState<T>(key: string): ResourceState<T> {
    // Must be referentially stable: useSyncExternalStore re-renders forever if
    // getSnapshot returns a fresh object each call.
    return (this.states.get(key) as ResourceState<T>) ?? (EMPTY_STATE as ResourceState<T>);
  }

  // --------------------------------------------------------------------- read

  /**
   * Serves cache then revalidates when stale. Returns once a value is available
   * (cached or fetched); background revalidation resolves later via subscribers.
   */
  async read<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    options: ReadOptions & { force?: boolean } = {},
  ): Promise<void> {
    const { staleMs = DEFAULT_STALE_MS, ttlMs = DEFAULT_TTL_MS, force = false } = options;
    const now = this.clock.now();
    const entry = await this.store.get<T>(key);

    // A pinned override is authoritative until explicitly released.
    if (entry?.pinned && !force) {
      this.emit(key, 'hit', { detail: 'pinned' });
      this.publish(key, this.stateFromEntry(entry, 'success'));
      return;
    }

    const usable = entry && entry.expiresAt > now;
    const fresh = usable && entry.staleAt > now;

    if (fresh && !force) {
      this.stats.hits++;
      this.emit(key, 'hit');
      this.publish(key, this.stateFromEntry(entry, 'success'));
      return;
    }

    if (usable && !force) {
      // Stale-while-revalidate: show the old value immediately, refresh behind it.
      this.stats.staleHits++;
      this.emit(key, 'stale-hit');
      this.publish(key, this.stateFromEntry(entry, 'revalidating'));
      void this.fetch(key, fetcher, staleMs, ttlMs, entry);
      return;
    }

    if (!entry) {
      this.stats.misses++;
      this.emit(key, 'miss');
    } else if (!usable) {
      this.emit(key, 'evict', { detail: 'expired' });
    }

    this.publish(key, {
      ...this.getState<T>(key),
      status: this.getState<T>(key).data ? 'revalidating' : 'loading',
      error: null,
    });

    await this.fetch(key, fetcher, staleMs, ttlMs, entry);
  }

  private fetch<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    staleMs: number,
    ttlMs: number,
    previous?: CacheEntry<T>,
  ): Promise<void> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.stats.dedups++;
      this.emit(key, 'dedup');
      return existing;
    }

    const controller = new AbortController();
    const started = this.clock.now();
    this.stats.fetches++;
    this.emit(key, 'fetch');

    const run = (async () => {
      try {
        await this.applyPolicy(key);

        const data = await fetcher(controller.signal);
        const durationMs = this.clock.now() - started;
        this.recordDuration(durationMs);

        const now = this.clock.now();
        const entry: CacheEntry<T> = {
          data,
          createdAt: now,
          staleAt: now + staleMs,
          expiresAt: now + ttlMs,
          source: 'network',
          durationMs,
        };

        await this.store.set(key, entry);
        this.emit(key, 'fetch-ok', { durationMs });
        this.publish(key, this.stateFromEntry(entry, 'success'));
      } catch (error) {
        this.stats.errors++;
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit(key, 'fetch-error', { detail: err.message });

        // Keep serving the last good value on failure — an error must not blank
        // a screen that already had data.
        this.publish(key, {
          data: (previous?.data as T) ?? this.getState<T>(key).data,
          error: err,
          status: 'error',
          updatedAt: previous?.createdAt ?? this.getState<T>(key).updatedAt,
          source: previous?.source ?? null,
          pinned: false,
        });
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, run);
    return run;
  }

  /** Read-only view; mutate through setPolicy so subscribers are notified. */
  getPolicy(): Readonly<NetworkPolicy> {
    return { ...this.networkPolicy };
  }

  setPolicy(patch: Partial<NetworkPolicy>) {
    this.networkPolicy = { ...this.networkPolicy, ...patch };
    this.notifyAll();
  }

  /** Devtools-controlled distortion. No call site knows this exists. */
  private async applyPolicy(key: string) {
    const { offline, latencyMs, failNext } = this.networkPolicy;

    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }
    if (failNext) {
      this.networkPolicy = { ...this.networkPolicy, failNext: false };
      throw new Error(`Injected failure for ${key}`);
    }
    if (offline) {
      throw new Error('Offline (forced in devtools)');
    }
  }

  // ------------------------------------------------------------- mutation API

  /** Marks stale so the next read revalidates, keeping the value on screen. */
  async invalidate(key: string) {
    const entry = await this.store.get(key);
    if (!entry) return;
    await this.store.set(key, { ...entry, staleAt: 0, pinned: false });
    this.emit(key, 'invalidate');
    this.publish(key, { ...this.getState(key), status: 'stale' });
  }

  /** Pins an arbitrary value. Survives revalidation until released. */
  async override<T>(key: string, data: T) {
    const now = this.clock.now();
    const entry: CacheEntry<T> = {
      data,
      createdAt: now,
      staleAt: now + DEFAULT_TTL_MS,
      expiresAt: now + DEFAULT_TTL_MS,
      source: 'override',
      pinned: true,
    };
    await this.store.set(key, entry);
    this.emit(key, 'override');
    this.publish(key, this.stateFromEntry(entry, 'success'));
  }

  async release(key: string) {
    const entry = await this.store.get(key);
    if (!entry?.pinned) return;
    await this.store.set(key, { ...entry, pinned: false, staleAt: 0 });
    this.emit(key, 'invalidate', { detail: 'released' });
    this.publish(key, { ...this.getState(key), pinned: false, status: 'stale' });
  }

  async evict(key: string) {
    await this.store.delete(key);
    this.states.delete(key);
    this.emit(key, 'evict');
    this.notify(key);
  }

  async clear() {
    await this.store.clear();
    const keys = [...this.states.keys()];
    this.states.clear();
    keys.forEach((k) => this.notify(k));
  }

  // ------------------------------------------------------------- introspection

  async snapshot() {
    const keys = await this.store.keys();
    const now = this.clock.now();
    const entries = await Promise.all(
      keys.map(async (key) => {
        const entry = await this.store.get(key);
        if (!entry) return null;
        return {
          key,
          ageMs: now - entry.createdAt,
          stale: entry.staleAt <= now,
          expired: entry.expiresAt <= now,
          pinned: !!entry.pinned,
          source: entry.source,
          durationMs: entry.durationMs,
          bytes: JSON.stringify(entry.data).length,
        };
      }),
    );
    return entries.filter((e): e is NonNullable<typeof e> => e !== null);
  }

  getEvents() {
    return this.events;
  }

  resetStats() {
    this.stats = {
      hits: 0,
      staleHits: 0,
      misses: 0,
      fetches: 0,
      errors: 0,
      dedups: 0,
      avgFetchMs: 0,
    };
    this.fetchDurations = [];
    this.events = [];
    this.notifyAll();
  }

  // -------------------------------------------------------------------- internal

  private recordDuration(ms: number) {
    this.fetchDurations.push(ms);
    if (this.fetchDurations.length > 50) this.fetchDurations.shift();
    const total = this.fetchDurations.reduce((a, b) => a + b, 0);
    this.stats.avgFetchMs = Math.round(total / this.fetchDurations.length);
  }

  private stateFromEntry<T>(entry: CacheEntry<T>, status: ResourceState<T>['status']) {
    return {
      data: entry.data,
      error: null,
      status,
      updatedAt: entry.createdAt,
      source: entry.source,
      pinned: !!entry.pinned,
    } satisfies ResourceState<T>;
  }

  private publish<T>(key: string, state: ResourceState<T>) {
    this.states.set(key, state as ResourceState<unknown>);
    this.notify(key);
  }

  private notify(key: string) {
    this.listeners.get(key)?.forEach((l) => l());
    this.notifyAll();
  }

  private notifyAll() {
    this.globalListeners.forEach((l) => l());
  }

  private emit(key: string, kind: CacheEventKind, extra: Partial<CacheEvent> = {}) {
    this.events = [
      { id: ++this.eventSeq, at: this.clock.now(), key, kind, ...extra },
      ...this.events,
    ].slice(0, EVENT_LOG_LIMIT);
  }
}

const EMPTY_STATE: ResourceState<never> = Object.freeze({
  data: null,
  error: null,
  status: 'idle',
  updatedAt: null,
  source: null,
  pinned: false,
});
