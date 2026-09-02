import * as Haptics from 'expo-haptics';
import { router, Tabs } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_ICONS } from '@/components/icons';
import { NeuralMenu } from '@/components/nav/neural-menu';
import { Palette, Space, Type } from '@/constants/theme';
import { NODE_BY_ID, type FeatureNode, type NodeId } from '@/lib/nav/graph';

// Derived from the public Tabs component rather than imported from expo-router's
// vendored react-navigation build/ path, which is not a stable entry point.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * A row of tabs stops scaling somewhere around five items — at seven the labels
 * wrapped and the touch targets shrank. So the bar is now just "where am I" plus
 * a hub, and the whole feature set lives in a graph menu that grows by adding a
 * node rather than by subdividing a fixed width.
 */
export function ConsoleTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  const activeRoute = state.routes[state.index];
  const activeId = activeRoute?.name as NodeId | undefined;
  const activeNode = activeId ? NODE_BY_ID.get(activeId) : undefined;
  const ActiveIcon = activeId ? TAB_ICONS[activeId as keyof typeof TAB_ICONS] : undefined;

  const open = useCallback((node: FeatureNode) => {
    setMenuOpen(false);
    Haptics.selectionAsync().catch(() => {});
    // push, not navigate: /sky is not a tab and its params have to survive.
    router.push(
      node.params ? ({ pathname: node.href, params: node.params } as never) : (node.href as never),
    );
  }, []);

  // /sky is a full-screen AR view; a navigation bar across the bottom of it
  // covers the horizon, which is exactly where the interesting objects are.
  if (activeId === 'sky' && !menuOpen) return null;

  const label = (
    activeNode?.label ??
    descriptors[activeRoute.key]?.options.title ??
    activeRoute?.name ??
    ''
  ).toUpperCase();

  return (
    <>
      {menuOpen ? (
        <NeuralMenu activeId={activeId ?? null} onSelect={open} onClose={() => setMenuOpen(false)} />
      ) : null}

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, Space.md) }]}>
        <View style={styles.current}>
          {ActiveIcon ? (
            <ActiveIcon size={20} color={activeNode?.accent ?? Palette.signal} active />
          ) : null}
          <View style={styles.currentText}>
            <Text style={styles.currentLabel}>{label}</Text>
            <Text style={styles.currentHint} numberOfLines={1}>
              {activeNode?.blurb ?? ''}
            </Text>
          </View>
        </View>

        <Pressable
          testID="nav-hub"
          accessibilityRole="button"
          accessibilityLabel="Open feature menu"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setMenuOpen(true);
            // Keeps the tabPress contract for anything still listening to it.
            navigation.emit({
              type: 'tabPress',
              target: activeRoute.key,
              canPreventDefault: true,
            });
          }}
          style={styles.hub}
        >
          {/* Three inputs fanning into one output — the graph, at button scale. */}
          <View style={styles.hubGlyph}>
            <View style={[styles.hubDot, { top: 2, left: 1 }]} />
            <View style={[styles.hubDot, { top: 9, left: 1 }]} />
            <View style={[styles.hubDot, { top: 16, left: 1 }]} />
            <View style={styles.hubBar} />
            <View style={[styles.hubDot, styles.hubOut]} />
          </View>
          <Text style={styles.hubText}>ALL</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    backgroundColor: Palette.void,
    borderTopWidth: 1,
    borderTopColor: Palette.rule,
    paddingTop: Space.md,
    paddingHorizontal: Space.lg,
  },
  current: { flexDirection: 'row', alignItems: 'center', gap: Space.md, flex: 1, minWidth: 0 },
  currentText: { flex: 1, minWidth: 0 },
  currentLabel: {
    fontFamily: Type.monoBold,
    fontSize: 12,
    letterSpacing: 1.8,
    color: Palette.text,
  },
  currentHint: { fontFamily: Type.mono, fontSize: 9, color: Palette.faint },
  hub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: 999,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    backgroundColor: Palette.panel,
  },
  hubGlyph: { width: 22, height: 22 },
  hubDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Palette.signal,
  },
  hubOut: { top: 9, left: 17 },
  hubBar: {
    position: 'absolute',
    left: 5,
    top: 10.5,
    width: 12,
    height: 1,
    backgroundColor: Palette.signal,
    opacity: 0.7,
  },
  hubText: {
    fontFamily: Type.monoBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: Palette.signal,
  },
});
