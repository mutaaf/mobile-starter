import { useCallback, useSyncExternalStore } from 'react';

/**
 * A clock that changes at most once per `intervalMs`, for state that depends on
 * the time but not on the second — "is this launch within the hour", say.
 *
 * Returns a bucket index rather than a timestamp so the snapshot is stable
 * between ticks; `useSyncExternalStore` would re-render on every call otherwise.
 * Reading time here is safe because it happens in the store, not during render.
 */
export function useCoarseNow(intervalMs = 30_000): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );

  const getSnapshot = useCallback(() => Math.floor(Date.now() / intervalMs), [intervalMs]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
