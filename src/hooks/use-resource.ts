import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { useCache } from '@/lib/cache/provider';
import type { ReadOptions, ResourceState } from '@/lib/cache/types';

export type UseResourceOptions = ReadOptions & {
  /** Background refresh interval. Omit to fetch once. */
  pollMs?: number;
};

/**
 * Binds a cache key to a component.
 *
 * The cache owns all fetching, dedup and lifecycle; this hook only subscribes.
 * `useSyncExternalStore` is the correct primitive here — it keeps the render
 * consistent with the external store under concurrent rendering, which a
 * useState/useEffect mirror does not.
 */
export function useResource<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  { pollMs, staleMs, ttlMs }: UseResourceOptions = {},
): ResourceState<T> & { refresh: () => Promise<void> } {
  const cache = useCache();

  const state = useSyncExternalStore(
    useCallback((cb) => cache.subscribe(key, cb), [cache, key]),
    useCallback(() => cache.getState<T>(key), [cache, key]),
  );

  // Held in a ref so a fetcher defined inline doesn't restart the poll loop.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const read = useCallback(
    (force: boolean) =>
      cache.read(key, (signal) => fetcherRef.current(signal), { staleMs, ttlMs, force }),
    [cache, key, staleMs, ttlMs],
  );

  useEffect(() => {
    void read(false);
    if (!pollMs) return;
    const id = setInterval(() => void read(false), pollMs);
    return () => clearInterval(id);
  }, [read, pollMs]);

  // Awaitable so callers can drive a pull-to-refresh spinner for user-initiated
  // refreshes only. Binding the spinner to `status` instead would flash it on
  // every background poll.
  const refresh = useCallback(() => read(true), [read]);

  return { ...state, refresh };
}
