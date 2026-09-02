import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Space, Type } from '@/constants/theme';
import {
  angularDelta,
  compassPoint,
  equatorialToHorizontal,
  type Horizontal,
  type Observer,
} from '@/lib/sky/astro';
import { STARS, starColor } from '@/lib/sky/catalogue';
import {
  edgeIndicator,
  project,
  separateEdgeIndicators,
  type ViewDirection,
  type Viewport,
} from '@/lib/sky/projection';

export type SkyObject = {
  id: string;
  label: string;
  direction: Horizontal;
  color: string;
  /** Targets are always labelled; stars only when bright enough to name. */
  priority: 'target' | 'star';
};

/** Naming every star turns the sky into a word cloud. Only the ones people know. */
const NAMEABLE_MAGNITUDE = 1.7;

type Props = {
  view: ViewDirection;
  viewport: Viewport;
  observer: Observer;
  at: Date;
  targets: SkyObject[];
  selectedId: string | null;
  onSelect: (object: SkyObject) => void;
};

export const SkyLabels = memo(function SkyLabels({
  view,
  viewport,
  observer,
  at,
  targets,
  selectedId,
  onSelect,
}: Props) {
  const objects = useMemo<SkyObject[]>(() => {
    const named = STARS.filter((s) => s.mag <= NAMEABLE_MAGNITUDE).map((s) => ({
      id: `star-${s.name}`,
      label: s.name,
      color: starColor(s.bv),
      priority: 'star' as const,
      direction: equatorialToHorizontal(s.ra, s.dec, observer, at),
    }));

    return [...targets, ...named];
  }, [targets, observer, at]);

  const { onScreen, offScreen } = useMemo(() => {
    const on: { o: SkyObject; x: number; y: number }[] = [];
    const off: { o: SkyObject; x: number; y: number; rotation: number; away: number }[] = [];

    for (const o of objects) {
      // Below the horizon is only worth an arrow for a target; a star under your
      // feet is noise.
      const buried = o.direction.altitude < -3;
      if (buried && o.priority === 'star') continue;

      const p = project(o.direction, view, viewport);

      if (p.onScreen && !buried) {
        on.push({ o, x: p.x, y: p.y });
        continue;
      }

      const dAz = angularDelta(view.heading, o.direction.azimuth);
      const dAlt = o.direction.altitude - view.elevation;
      const e = edgeIndicator(dAz, dAlt, viewport.width, viewport.height);
      off.push({ o, ...e, away: Math.hypot(dAz, dAlt) });
    }

    // Only targets and the nearest few stars get an arrow, or the border fills
    // with chevrons and stops meaning anything.
    const arrows = off
      .filter((e) => e.o.priority === 'target' || e.away < 110)
      .sort((a, b) => {
        if (a.o.priority !== b.o.priority) return a.o.priority === 'target' ? -1 : 1;
        return a.away - b.away;
      })
      .slice(0, 6);

    // Objects in similar directions land on nearly the same border point; two
    // stacked chevrons are worse than one, so spread them along the edge.
    return {
      onScreen: on,
      offScreen: separateEdgeIndicators(arrows, viewport.width, viewport.height),
    };
  }, [objects, view, viewport]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {onScreen.map(({ o, x, y }) => {
        const selected = o.id === selectedId;
        return (
          <Pressable
            key={o.id}
            testID={`sky-label-${o.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${o.label}, ${Math.round(o.direction.altitude)} degrees above ${compassPoint(o.direction.azimuth)}`}
            onPress={() => onSelect(o)}
            hitSlop={10}
            style={[styles.label, { left: x + 14, top: y - 12 }]}
          >
            <View
              style={[
                styles.chip,
                o.priority === 'target' && styles.chipTarget,
                selected && { borderColor: o.color },
              ]}
            >
              <Text style={[styles.chipText, { color: selected ? o.color : Palette.text }]}>
                {o.label}
              </Text>
              {o.priority === 'target' ? (
                <Text style={styles.chipMeta}>{Math.round(o.direction.altitude)}°</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {offScreen.map(({ o, x, y, rotation }) => (
        <Pressable
          key={`edge-${o.id}`}
          testID={`sky-edge-${o.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${o.label} is off screen, ${compassPoint(o.direction.azimuth)}. Tap to centre.`}
          onPress={() => onSelect(o)}
          hitSlop={14}
          style={[styles.edge, { left: x - 26, top: y - 26 }]}
        >
          <View
            style={[
              styles.edgeInner,
              o.priority === 'target' && { borderColor: o.color },
              { transform: [{ rotate: `${rotation}deg` }] },
            ]}
          >
            {/* A chevron built from two rules, rotated to point at the target. */}
            <View style={[styles.chevron, { borderColor: o.color }]} />
          </View>
          <Text style={[styles.edgeLabel, { color: o.color }]} numberOfLines={1}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  label: { position: 'absolute' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    backgroundColor: 'rgba(8,9,11,0.66)',
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipTarget: { borderColor: Palette.rule },
  chipText: { fontFamily: Type.mono, fontSize: 10, letterSpacing: 0.4 },
  chipMeta: { fontFamily: Type.mono, fontSize: 9, color: Palette.dim },
  edge: { position: 'absolute', width: 52, alignItems: 'center', gap: 2 },
  edgeInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Palette.rule,
    backgroundColor: 'rgba(8,9,11,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    width: 7,
    height: 7,
    borderTopWidth: 1.6,
    borderRightWidth: 1.6,
    transform: [{ rotate: '45deg' }],
    marginLeft: -2,
  },
  edgeLabel: {
    fontFamily: Type.mono,
    fontSize: 8,
    letterSpacing: 0.4,
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
});
