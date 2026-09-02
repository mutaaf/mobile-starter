import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CacheEntry, CacheStore } from './types';

/** Fast, volatile. The read path everything hits first. */
export class MemoryStore implements CacheStore {
  private map = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string) {
    return this.map.get(key) as CacheEntry<T> | undefined;
  }

  async set<T>(key: string, entry: CacheEntry<T>) {
    this.map.set(key, entry as CacheEntry<unknown>);
  }

  async delete(key: string) {
    this.map.delete(key);
  }

  async keys() {
    return [...this.map.keys()];
  }

  async clear() {
    this.map.clear();
  }
}

/** Survives process death. Slower, so it sits behind the memory tier. */
export class AsyncStorageStore implements CacheStore {
  constructor(private prefix = 'gs-cache:') {}

  private full(key: string) {
    return this.prefix + key;
  }

  async get<T>(key: string) {
    const raw = await AsyncStorage.getItem(this.full(key));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as CacheEntry<T>;
    } catch {
      // A corrupt row must never wedge reads; drop it and treat as a miss.
      await this.delete(key);
      return undefined;
    }
  }

  async set<T>(key: string, entry: CacheEntry<T>) {
    await AsyncStorage.setItem(this.full(key), JSON.stringify(entry));
  }

  async delete(key: string) {
    await AsyncStorage.removeItem(this.full(key));
  }

  async keys() {
    const all = await AsyncStorage.getAllKeys();
    return all.filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length));
  }

  async clear() {
    const keys = await this.keys();
    await AsyncStorage.multiRemove(keys.map((k) => this.full(k)));
  }
}

/**
 * Write-through tiering: reads hit memory first and fall back to disk, promoting
 * whatever they find; writes go to both.
 *
 * Composed from two `CacheStore`s rather than subclassing either, so the tiers
 * stay independently testable and a third tier costs nothing to add.
 */
export class TieredStore implements CacheStore {
  constructor(
    private fast: CacheStore,
    private slow: CacheStore,
  ) {}

  async get<T>(key: string) {
    const hot = await this.fast.get<T>(key);
    if (hot) return hot;

    const cold = await this.slow.get<T>(key);
    if (cold) {
      // Promote so the next read is synchronous-fast.
      await this.fast.set(key, { ...cold, source: 'persisted' });
      return cold;
    }
    return undefined;
  }

  async set<T>(key: string, entry: CacheEntry<T>) {
    await this.fast.set(key, entry);
    // Disk write is not awaited by callers' critical path but must not throw
    // unhandled: a full disk should degrade to memory-only, not crash.
    this.slow.set(key, entry).catch(() => {});
  }

  async delete(key: string) {
    await Promise.all([this.fast.delete(key), this.slow.delete(key)]);
  }

  async keys() {
    const [a, b] = await Promise.all([this.fast.keys(), this.slow.keys()]);
    return [...new Set([...a, ...b])];
  }

  async clear() {
    await Promise.all([this.fast.clear(), this.slow.clear()]);
  }
}
