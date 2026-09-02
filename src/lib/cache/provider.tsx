import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createAppCache } from './index';
import type { ResourceCache } from './resource-cache';

const CacheContext = createContext<ResourceCache | null>(null);

/**
 * Injects the cache rather than letting modules import a singleton, so tests can
 * mount a memory-only instance and the app never depends on module-load order.
 */
export function CacheProvider({
  children,
  cache,
}: {
  children: ReactNode;
  cache?: ResourceCache;
}) {
  const value = useMemo(() => cache ?? createAppCache(), [cache]);
  return <CacheContext.Provider value={value}>{children}</CacheContext.Provider>;
}

export function useCache(): ResourceCache {
  const cache = useContext(CacheContext);
  if (!cache) throw new Error('useCache must be used inside <CacheProvider>');
  return cache;
}
