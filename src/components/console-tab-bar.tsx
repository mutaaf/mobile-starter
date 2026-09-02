import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_ICONS } from '@/components/icons';
import { Palette, Space, Type } from '@/constants/theme';

// Derived from the public Tabs component rather than imported from expo-router's
// vendored react-navigation build/ path, which is not a stable entry point.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * A custom tab bar rather than NativeTabs: the platform chrome would impose its
 * own look and break the instrument aesthetic. The trade-off is that we own the
 * accessibility wiring below.
 */
export function ConsoleTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, Space.md) }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = (options.title ?? route.name).toUpperCase();
        const focused = state.index === index;
        const Icon = TAB_ICONS[route.name as keyof typeof TAB_ICONS];

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (focused || event.defaultPrevented) return;

          // Selection feedback is a no-op on web and on devices without a Taptic
          // Engine, so it needs no platform guard beyond that.
          Haptics.selectionAsync().catch(() => {});
          navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={styles.tab}>
            {/* The active marker is a rule above the icon, like a channel
                selector on a mixing desk. */}
            <View style={[styles.marker, focused && styles.markerActive]} />
            {Icon ? (
              <Icon size={22} color={focused ? Palette.signal : Palette.faint} active={focused} />
            ) : null}
            <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Palette.void,
    borderTopWidth: 1,
    borderTopColor: Palette.rule,
    paddingTop: Space.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.xs,
  },
  marker: {
    height: 2,
    width: 22,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  markerActive: { backgroundColor: Palette.signal },
  label: {
    fontFamily: Type.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    color: Palette.faint,
    // Android renders mono slightly larger at the same size; keep the baseline even.
    ...Platform.select({ android: { lineHeight: 14 }, default: null }),
  },
  labelActive: { color: Palette.signal },
});
