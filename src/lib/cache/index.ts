import { ResourceCache } from './resource-cache';
import { AsyncStorageStore, MemoryStore, TieredStore } from './stores';

export * from './types';
export { ResourceCache } from './resource-cache';
export { AsyncStorageStore, MemoryStore, TieredStore } from './stores';

/**
 * The app's cache: memory in front of disk, so a cold start paints from the last
 * session's data while the network catches up.
 *
 * Composed here and injected through context rather than imported directly by
 * screens, so tests can substitute a memory-only instance.
 */
export function createAppCache() {
  return new ResourceCache(new TieredStore(new MemoryStore(), new AsyncStorageStore()));
}

/** Keys live in one place so devtools and screens can't disagree about them. */
export const CacheKeys = {
  iss: 'iss:position',
  quakes: 'usgs:quakes:2.5_day',
  spaceWeather: 'noaa:kp:1m',
  launches: 'll2:launches:upcoming',
} as const;
