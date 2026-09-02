/**
 * Cache contracts.
 *
 * Everything downstream depends on these interfaces rather than on a concrete
 * store or clock, so swapping AsyncStorage for MMKV — or freezing time in a test
 * — touches no consumer.
 */

export type EntrySource = 'network' | 'memory' | 'persisted' | 'override';

export type CacheEntry<T = unknown> = {
  data: T;
  /** When this value was produced. */
  createdAt: number;
  /** After this, the value is served but revalidated in the background. */
  staleAt: number;
  /** After this, the value is no longer served at all. */
  expiresAt: number;
  source: EntrySource;
  /** Wall time the producing request took, in ms. */
  durationMs?: number;
  /** Set when a human pinned this value; revalidation must not clobber it. */
  pinned?: boolean;
};

/**
 * Minimal persistence contract. Async by design so the same interface covers an
 * in-memory map and a disk-backed store.
 */
export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** Injected so tests and the devtools timeline can control "now". */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export type ResourceStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'stale'
  | 'revalidating'
  | 'error';

export type ResourceState<T> = {
  data: T | null;
  error: Error | null;
  status: ResourceStatus;
  /** Age of the served value in ms, or null when there is none. */
  updatedAt: number | null;
  source: EntrySource | null;
  pinned: boolean;
};

export type ReadOptions = {
  /** Serve-then-revalidate window. Default 30s. */
  staleMs?: number;
  /** Hard eviction. Default 10min. */
  ttlMs?: number;
};

/**
 * Hook point for the devtools to distort the network without any call site
 * knowing. Kept deliberately narrow.
 */
export interface NetworkPolicy {
  /** Rejects every request when true. */
  offline: boolean;
  /** Artificial delay applied before each request, in ms. */
  latencyMs: number;
  /** Fails the next request for this key, once. */
  failNext: boolean;
}

export type CacheEventKind =
  | 'hit'
  | 'stale-hit'
  | 'miss'
  | 'fetch'
  | 'fetch-ok'
  | 'fetch-error'
  | 'dedup'
  | 'invalidate'
  | 'override'
  | 'evict';

export type CacheEvent = {
  id: number;
  at: number;
  key: string;
  kind: CacheEventKind;
  durationMs?: number;
  detail?: string;
};
