import { render as rntlRender, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

// Screens call useSafeAreaInsets(), which throws outside a provider. On a device
// the insets arrive from native; in tests we supply fixed metrics so layout is
// deterministic. These match an iPhone 14-class device.
const initialMetrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function AllProviders({ children }: { children: ReactNode }) {
  return <SafeAreaProvider initialMetrics={initialMetrics}>{children}</SafeAreaProvider>;
}

/**
 * Renders a component inside the app's providers.
 *
 * Remember that this is async — RNTL v14 renders through React 19's concurrent
 * root, so callers must `await render(...)` (see AGENTS.md, invariant 1).
 */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rntlRender(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react-native';
