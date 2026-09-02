import { BlurMask, Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette, Radius, Space, Type } from '@/constants/theme';
import { EDGES, layout, NODE_BY_ID, NODES, type FeatureNode, type NodeId } from '@/lib/nav/graph';

type Props = {
  activeId: NodeId | null;
  onSelect: (node: FeatureNode) => void;
  onClose: () => void;
};

/** Node radius in points. Big enough to be a comfortable touch target. */
const R = 26;

/**
 * The navigation menu as the app's own dataflow graph.
 *
 * A tab bar stops working somewhere around five or six items; this scales by
 * adding a node. The edges are the real dependencies from `src/lib/nav/graph.ts`,
 * so the picture stays true as the app grows rather than becoming a decorative
 * lie.
 */
export function NeuralMenu({ activeId, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState(0);
  const [focus, setFocus] = useState<NodeId | null>(activeId);

  useEffect(() => {
    if (reduced) return;
    // Drives the pulses travelling along the edges. 20Hz is plenty for a dot
    // moving over ~300pt, and it keeps the JS thread almost idle.
    const id = setInterval(() => setPhase((p) => (p + 0.014) % 1), 50);
    return () => clearInterval(id);
  }, [reduced]);

  // The graph occupies the area between the header and the detail card.
  const stage = useMemo(() => {
    const top = insets.top + 96;
    const bottom = insets.bottom + 190;
    return { x: 0, y: top, width, height: Math.max(240, height - top - bottom) };
  }, [insets.top, insets.bottom, width, height]);

  const positions = useMemo(() => layout(), []);

  const points = useMemo(() => {
    const map = new Map<NodeId, { x: number; y: number }>();
    for (const [id, p] of positions) {
      map.set(id, { x: stage.x + p.x * stage.width, y: stage.y + p.y * stage.height });
    }
    return map;
  }, [positions, stage]);

  /** Cubic curves rather than straight lines — a mesh of straights reads as a net, not a network. */
  const edges = useMemo(() => {
    return EDGES.map(([fromId, toId]) => {
      const a = points.get(fromId)!;
      const b = points.get(toId)!;

      const path = Skia.Path.Make();
      path.moveTo(a.x, a.y);
      const midY = (a.y + b.y) / 2;
      path.cubicTo(a.x, midY, b.x, midY, b.x, b.y);

      const lit = focus === fromId || focus === toId;
      return { key: `${fromId}-${toId}`, path, a, b, lit, fromId, toId };
    });
  }, [points, focus]);

  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(180)}
      exiting={reduced ? undefined : FadeOut.duration(140)}
      style={styles.root}
      testID="neural-menu"
    >
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {edges.map((e) => (
          <Group key={e.key}>
            <Path
              path={e.path}
              style="stroke"
              strokeWidth={e.lit ? 1.6 : 1}
              color={e.lit ? Palette.signal : '#2A3340'}
              opacity={e.lit ? 0.75 : 0.5}
            />
            {/* A pulse travelling from source to sink — the direction the data
                actually moves. */}
            {!reduced ? (
              <Circle
                cx={e.a.x + (e.b.x - e.a.x) * phase}
                cy={e.a.y + (e.b.y - e.a.y) * phase}
                r={e.lit ? 2.6 : 1.8}
                color={e.lit ? Palette.signal : '#4A5A6E'}
                opacity={0.9 - Math.abs(phase - 0.5)}
              />
            ) : null}
          </Group>
        ))}

        {NODES.map((n) => {
          const p = points.get(n.id)!;
          const isActive = n.id === activeId;
          const isFocus = n.id === focus;
          return (
            <Group key={n.id}>
              <Circle cx={p.x} cy={p.y} r={R + 16} color={n.accent} opacity={isFocus ? 0.2 : 0.08}>
                <BlurMask blur={18} style="normal" />
              </Circle>
              <Circle cx={p.x} cy={p.y} r={R} color="#0B0F14" />
              <Circle
                cx={p.x}
                cy={p.y}
                r={R}
                color={n.accent}
                style="stroke"
                strokeWidth={isActive ? 2.4 : 1.2}
                opacity={isFocus || isActive ? 1 : 0.55}
              />
              {isActive ? <Circle cx={p.x} cy={p.y} r={4} color={n.accent} /> : null}
            </Group>
          );
        })}
      </Canvas>

      {/* Labels and hit targets are real views: Skia text needs a loaded font,
          and these must be reachable by the accessibility tree and by Maestro. */}
      {NODES.map((n) => {
        const p = points.get(n.id)!;
        return (
          <Pressable
            key={n.id}
            testID={`node-${n.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${n.label}. ${n.blurb}`}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              if (focus === n.id) onSelect(n);
              else setFocus(n.id);
            }}
            style={[styles.hit, { left: p.x - R - 8, top: p.y - R - 8, width: (R + 8) * 2, height: (R + 8) * 2 }]}
          >
            <Text
              style={[
                styles.nodeLabel,
                { color: n.id === focus || n.id === activeId ? n.accent : Palette.dim },
              ]}
              numberOfLines={1}
            >
              {n.label}
            </Text>
          </Pressable>
        );
      })}

      <View style={[styles.header, { paddingTop: insets.top + Space.md }]} pointerEvents="box-none">
        <View>
          <Text style={styles.title}>FEATURES</Text>
          <Text style={styles.subtitle}>Edges are real data dependencies</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={14} testID="menu-close" accessibilityLabel="Close menu">
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <View style={[styles.detail, { paddingBottom: insets.bottom + Space.lg }]} pointerEvents="box-none">
        {focus ? (
          <Animated.View
            key={focus}
            entering={reduced ? undefined : ZoomIn.duration(160)}
            style={styles.card}
            testID="menu-detail"
          >
            <Text style={[styles.cardTitle, { color: NODE_BY_ID.get(focus)!.accent }]}>
              {NODE_BY_ID.get(focus)!.label}
            </Text>
            <Text style={styles.cardBlurb}>{NODE_BY_ID.get(focus)!.blurb}</Text>
            <Pressable
              testID="menu-open"
              onPress={() => onSelect(NODE_BY_ID.get(focus)!)}
              style={[styles.open, { borderColor: NODE_BY_ID.get(focus)!.accent }]}
            >
              <Text style={[styles.openText, { color: NODE_BY_ID.get(focus)!.accent }]}>
                {focus === activeId ? 'CURRENT' : 'OPEN'}
              </Text>
            </Pressable>
          </Animated.View>
        ) : (
          <Text style={styles.hint}>Tap a node to see what it does, tap again to open it.</Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6,8,11,0.985)',
    zIndex: 60,
  },
  hit: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  nodeLabel: {
    fontFamily: Type.monoMedium,
    fontSize: 10,
    letterSpacing: 0.8,
    // Sits just below the node circle.
    marginBottom: -18,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: { fontFamily: Type.display, fontSize: 22, color: Palette.text, letterSpacing: 1 },
  subtitle: { fontFamily: Type.mono, fontSize: 9, color: Palette.faint, letterSpacing: 1 },
  close: { fontFamily: Type.mono, fontSize: 20, color: Palette.dim, paddingHorizontal: Space.sm },
  detail: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Space.lg,
  },
  card: {
    backgroundColor: Palette.panel,
    borderWidth: 1,
    borderColor: Palette.rule,
    borderRadius: Radius.lg,
    padding: Space.lg,
    gap: Space.sm,
  },
  cardTitle: { fontFamily: Type.monoBold, fontSize: 16, letterSpacing: 0.5 },
  cardBlurb: { fontFamily: Type.mono, fontSize: 12, color: Palette.dim, lineHeight: 18 },
  open: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Space.sm,
    alignItems: 'center',
    marginTop: Space.xs,
  },
  openText: { fontFamily: Type.monoBold, fontSize: 11, letterSpacing: 1.6 },
  hint: {
    fontFamily: Type.mono,
    fontSize: 11,
    color: Palette.faint,
    textAlign: 'center',
    paddingBottom: Space.lg,
  },
});
