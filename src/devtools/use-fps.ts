import { useEffect, useState } from 'react';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * Rate at which Reanimated's frame callback fires on the UI thread.
 *
 * This is NOT the render frame rate. On Android it was measured firing ~8x/sec
 * while `adb shell dumpsys gfxinfo` reported a 28ms median frame (~35fps), so
 * Reanimated's callback is driven by its own loop rather than by vsync. It is
 * still a useful signal — it drops when the UI thread is genuinely blocked — but
 * it must not be labelled FPS.
 *
 * For authoritative render statistics use:
 *   adb shell dumpsys gfxinfo <package>
 */
export function useWorkletTickRate(): SharedValue<number> {
  const rate = useSharedValue(0);
  const ticks = useSharedValue(0);
  const windowStart = useSharedValue(0);

  useFrameCallback(() => {
    'worklet';
    const now = Date.now();

    if (windowStart.value === 0) {
      windowStart.value = now;
      ticks.value = 0;
      return;
    }

    ticks.value += 1;
    const elapsed = now - windowStart.value;

    if (elapsed >= 500) {
      rate.value = Math.round((ticks.value * 1000) / elapsed);
      ticks.value = 0;
      windowStart.value = now;
    }
  }, true);

  return rate;
}

/**
 * JS-thread frame rate. Deliberately separate: a busy JS thread is invisible to
 * the UI-thread meter, and the gap between the two is the interesting signal.
 */
export function useJsFps(sampleMs = 1000): number {
  const [fps, setFps] = useState(60);

  useEffect(() => {
    let frames = 0;
    let raf = 0;
    let last = Date.now();
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      frames += 1;
      const now = Date.now();
      if (now - last >= sampleMs) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [sampleMs]);

  return fps;
}
