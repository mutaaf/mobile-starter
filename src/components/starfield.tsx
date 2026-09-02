import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Palette } from '@/constants/theme';

const STAR_COUNT = 44;

type Star = {
  id: number;
  left: number;
  top: number;
  size: number;
  /** Parallax depth 0..1; nearer stars drift faster and sit brighter. */
  depth: number;
  delay: number;
  twinkleMs: number;
};

/**
 * Deterministic PRNG so the field is identical across reloads and screenshots.
 * A random layout would make visual diffs in CI useless.
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const StarDot = memo(function StarDot({
  star,
  height,
  still,
}: {
  star: Star;
  height: number;
  still: boolean;
}) {
  // Held at mid-brightness when motion is reduced, so the field still reads as a
  // starfield rather than disappearing.
  const progress = useSharedValue(still ? 0.5 : 0);

  // Starting an animation is a side effect, so it belongs in an effect — not in
  // useMemo, whose body React is free to skip or re-run. Getting this wrong left
  // the field static, which also made the FPS meter read near zero because
  // nothing was requesting frames.
  useEffect(() => {
    if (still) return;
    progress.value = withDelay(
      star.delay,
      withRepeat(
        withTiming(1, { duration: star.twinkleMs, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress, star.delay, star.twinkleMs, still]);

  const style = useAnimatedStyle(() => {
    const drift = progress.value * 14 * star.depth;
    return {
      opacity: 0.12 + progress.value * 0.55 * star.depth,
      transform: [{ translateY: -drift }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.star,
        {
          left: star.left,
          top: star.top * height,
          width: star.size,
          height: star.size,
          borderRadius: star.size / 2,
        },
        style,
      ]}
    />
  );
});

/**
 * Ambient parallax starfield behind the console.
 *
 * Memoised on dimensions only: the field is decorative and must never re-render
 * because a screen above it updated.
 */
export const Starfield = memo(function Starfield() {
  const { width, height } = useWindowDimensions();

  // Respects the OS "reduce motion" setting. This is an accessibility win, and
  // it is also what makes the app E2E-testable: Maestro waits for the screen to
  // stop changing before each action, and a perpetual ambient animation means it
  // never settles. CI disables animations on the device for exactly this reason.
  const still = useReducedMotion();

  const stars = useMemo<Star[]>(() => {
    const rand = mulberry32(20260901);
    return Array.from({ length: STAR_COUNT }, (_, id) => {
      const depth = 0.35 + rand() * 0.65;
      return {
        id,
        left: rand() * width,
        top: rand(),
        size: 1 + depth * 2.2,
        depth,
        delay: rand() * 3000,
        twinkleMs: 2200 + rand() * 3800,
      };
    });
  }, [width]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {stars.map((star) => (
        <StarDot key={star.id} star={star} height={height} still={still} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  star: { position: 'absolute', backgroundColor: Palette.text },
});
