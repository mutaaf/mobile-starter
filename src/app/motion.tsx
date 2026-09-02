import * as Haptics from 'expo-haptics';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UplinkMark } from '@/components/icons';
import { Label, Panel, Readout, ScreenTitle, Status } from '@/components/telemetry';
import { BottomTabInset, MaxContentWidth, Palette, Radius, Space, Type } from '@/constants/theme';

type Vec3 = { x: number; y: number; z: number };
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** Tilt magnitude (in G) past which the device counts as "off level". */
const LEVEL_THRESHOLD = 0.22;
const SENSOR_INTERVAL_MS = 60;
/** Half the travel available to the bubble, in points. */
const BUBBLE_RANGE = 74;

function Level({ tilt }: { tilt: Vec3 }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  // Sensor samples arrive on the JS thread; writing shared values directly (and
  // springing to them) keeps the bubble smooth without re-rendering per sample.
  useEffect(() => {
    x.value = withSpring(Math.max(-1, Math.min(1, tilt.x)) * BUBBLE_RANGE, {
      damping: 18,
      stiffness: 140,
    });
    y.value = withSpring(Math.max(-1, Math.min(1, tilt.y)) * -BUBBLE_RANGE, {
      damping: 18,
      stiffness: 140,
    });
  }, [tilt, x, y]);

  const bubble = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  const level = Math.hypot(tilt.x, tilt.y) < LEVEL_THRESHOLD;

  return (
    <View style={styles.level} testID="motion-level">
      <View style={styles.levelRingOuter} />
      <View style={[styles.levelRingInner, level && { borderColor: Palette.signal }]} />
      <View style={styles.levelCrossH} />
      <View style={styles.levelCrossV} />
      <Animated.View
        style={[styles.bubble, bubble, level && { backgroundColor: Palette.signal }]}
      />
    </View>
  );
}

/** Pan + pinch + rotate on one card, to show gesture composition. */
function GesturePad() {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pan = Gesture.Pan()
    .onChange((e) => {
      tx.value += e.changeX;
      ty.value += e.changeY;
    })
    .onEnd(() => {
      // Spring home so the card can never be lost off-screen.
      tx.value = withSpring(0, { damping: 14 });
      ty.value = withSpring(0, { damping: 14 });
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onChange((e) => {
      scale.value = Math.max(0.6, Math.min(2.2, savedScale.value * e.scale));
    })
    .onEnd(() => {
      scale.value = withSpring(1, { damping: 14 });
    });

  const composed = Gesture.Simultaneous(pan, pinch);

  const card = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
      // Lean into the drag direction; purely decorative, but it sells the physics.
      { rotateZ: `${tx.value * 0.04}deg` },
    ],
  }));

  return (
    <View style={styles.padStage}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.padCard, card]} testID="motion-gesture-card">
          <UplinkMark size={44} />
          <Text style={styles.padHint}>DRAG · PINCH</Text>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function MotionScreen() {
  const insets = useSafeAreaInsets();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [accel, setAccel] = useState<Vec3>(ZERO);
  const [gyro, setGyro] = useState<Vec3>(ZERO);
  const wasLevel = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const subscriptions: { remove: () => void }[] = [];

    (async () => {
      // Simulators report no accelerometer. Checking first means the screen shows
      // an honest empty state instead of a permanently frozen readout.
      const ok = await Accelerometer.isAvailableAsync().catch(() => false);
      if (cancelled) return;
      setAvailable(ok);
      if (!ok) return;

      Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);
      subscriptions.push(Accelerometer.addListener(setAccel), Gyroscope.addListener(setGyro));
    })();

    return () => {
      cancelled = true;
      subscriptions.forEach((s) => s.remove());
    };
  }, []);

  // Fire haptics only on the transition into level, not every frame it stays there.
  const isLevel = Math.hypot(accel.x, accel.y) < LEVEL_THRESHOLD;
  useEffect(() => {
    if (!available) return;
    if (isLevel && !wasLevel.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    wasLevel.current = isLevel;
  }, [isLevel, available]);

  const spin = Math.hypot(gyro.x, gyro.y, gyro.z);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.xl },
      ]}>
      <ScreenTitle sub="Accelerometer, gyroscope and gesture input, sampled on device">
        Motion
      </ScreenTitle>

      <Panel
        title="Attitude"
        right={
          <Status
            state={available === false ? 'error' : available ? 'live' : 'idle'}
            label={available === false ? 'no sensor' : available ? 'sampling' : 'probing'}
          />
        }
        testID="motion-attitude">
        {available === false ? (
          <Text style={styles.notice} testID="motion-unavailable">
            This device exposes no accelerometer. Simulators typically don&apos;t — run on real
            hardware, or use the Android emulator&apos;s virtual sensor controls.
          </Text>
        ) : (
          <>
            <Level tilt={accel} />
            <View style={styles.row}>
              <Readout
                label="Roll"
                value={accel.x.toFixed(2)}
                unit="g"
                tone={isLevel ? 'signal' : 'text'}
                testID="motion-roll"
              />
              <Readout label="Pitch" value={accel.y.toFixed(2)} unit="g" />
              <Readout label="Yaw rate" value={spin.toFixed(2)} unit="rad/s" />
            </View>
            <Label tone={isLevel ? 'signal' : 'dim'}>
              {isLevel ? 'Level — haptic fired on entry' : 'Off level'}
            </Label>
          </>
        )}
      </Panel>

      <Panel title="Gesture" testID="motion-gesture">
        <GesturePad />
        <Label>Pan and pinch run on the UI thread via Reanimated worklets</Label>
      </Panel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Palette.void },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.lg,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', gap: Space.lg },
  notice: { fontFamily: Type.mono, fontSize: 12, color: Palette.dim, lineHeight: 19 },
  level: {
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.panelHi,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  levelRingOuter: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: Palette.rule,
  },
  levelRingInner: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: Palette.faint,
  },
  levelCrossH: { position: 'absolute', width: 190, height: 1, backgroundColor: Palette.rule },
  levelCrossV: { position: 'absolute', width: 1, height: 190, backgroundColor: Palette.rule },
  bubble: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Palette.cool,
  },
  padStage: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.panelHi,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  padCard: {
    width: 118,
    height: 118,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.signal,
    backgroundColor: '#1A2110',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  padHint: {
    fontFamily: Type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    color: Palette.dim,
  },
});
