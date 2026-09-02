import { render as rntlRender, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { MemoryStore, ResourceCache } from '@/lib/cache';
import { CacheProvider } from '@/lib/cache/provider';

// Screens call useSafeAreaInsets(), which throws outside a provider. On a device
// the insets arrive from native; in tests we supply fixed metrics so layout is
// deterministic. These match an iPhone 14-class device.
const initialMetrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * A memory-only cache per render. AsyncStorage is not available under Jest, and
 * a shared instance would leak entries between tests.
 */
export function createTestCache() {
  return new ResourceCache(new MemoryStore());
}

function makeWrapper(cache: ResourceCache) {
  return function AllProviders({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <CacheProvider cache={cache}>{children}</CacheProvider>
      </SafeAreaProvider>
    );
  };
}

/**
 * Renders a component inside the app's providers.
 *
 * Remember that this is async — RNTL v14 renders through React 19's concurrent
 * root, so callers must `await render(...)` (see AGENTS.md, invariant 1).
 *
 * Pass `cache` to assert on cache behaviour from a test.
 */
export function render(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { cache?: ResourceCache },
) {
  const { cache = createTestCache(), ...rest } = options ?? {};
  return rntlRender(ui, { wrapper: makeWrapper(cache), ...rest });
}

export * from '@testing-library/react-native';
