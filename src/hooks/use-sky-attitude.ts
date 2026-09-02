import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useState } from 'react';

import { normalizeDegrees } from '@/lib/sky/astro';

export type Attitude = {
  /** Degrees clockwise from true north that the camera is pointing. */
  heading: number;
  /** Degrees above the horizon that the camera is pointing. */
  elevation: number;
  /** Device roll, degrees — used only to counter-rotate the overlay. */
  roll: number;
};

export type AttitudeState = Attitude & {
  /** null while probing, false when this device cannot supply an attitude. */
  available: boolean | null;
  /** True once a heading with a real magnetic reference has arrived. */
  hasHeading: boolean;
  reason: string | null;
};

const IDLE: AttitudeState = {
  heading: 0,
  elevation: 0,
  roll: 0,
  available: null,
  hasHeading: false,
  reason: null,
};

/** Complementary smoothing across the shorter way round the circle. */
function smoothAngle(previous: number, next: number, weight: number): number {
  let delta = normalizeDegrees(next - previous);
  if (delta > 180) delta -= 360;
  return normalizeDegrees(previous + delta * weight);
}

/**
 * Where the handset is pointing, in sky coordinates.
 *
 * Heading comes from `Location.watchHeadingAsync` rather than DeviceMotion:
 * DeviceMotion's alpha is a *relative* yaw with an arbitrary origin, so a sky
 * built on it drifts and never lines up with north. watchHeadingAsync is backed
 * by the magnetometer and reports true heading, which is what a star field needs.
 *
 * Elevation comes from DeviceMotion's pitch. Held upright looking at the horizon
 * beta is ~90°, flat on its back pointing at the zenith it is ~0°, hence
 * `90 - beta`.
 */
export function useSkyAttitude(active: boolean): AttitudeState {
  const [state, setState] = useState<AttitudeState>(IDLE);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let motionSub: { remove: () => void } | undefined;
    let headingSub: Location.LocationSubscription | undefined;

    (async () => {
      const hasMotion = await DeviceMotion.isAvailableAsync().catch(() => false);
      if (cancelled) return;

      if (!hasMotion) {
        setState({
          ...IDLE,
          available: false,
          reason: 'This device reports no motion sensor. Simulators normally do not.',
        });
        return;
      }

      DeviceMotion.setUpdateInterval(50);
      motionSub = DeviceMotion.addListener(({ rotation }) => {
        if (!rotation) return;
        const beta = (rotation.beta * 180) / Math.PI;
        const gamma = (rotation.gamma * 180) / Math.PI;

        setState((prev) => ({
          ...prev,
          available: true,
          // Clamped: past the zenith the pitch wraps and the sky would flip.
          elevation: Math.max(-90, Math.min(90, smoothAngle(prev.elevation + 180, 90 - beta + 180, 0.25) - 180)),
          roll: gamma,
        }));
      });

      // Foreground permission is required for heading on both platforms.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;

      if (status !== 'granted') {
        setState((prev) => ({
          ...prev,
          available: true,
          hasHeading: false,
          reason: 'Location permission denied, so the sky cannot be aligned to north.',
        }));
        return;
      }

      headingSub = await Location.watchHeadingAsync((h) => {
        // trueHeading is -1 until the magnetometer has a fix; magHeading is the
        // fallback and is wrong by the local declination, which is better than
        // nothing but worth not pretending about.
        const usable = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        if (usable < 0) return;

        setState((prev) => ({
          ...prev,
          hasHeading: true,
          heading: smoothAngle(prev.heading, usable, 0.2),
          reason: h.trueHeading >= 0 ? null : 'Using magnetic north — true north unavailable.',
        }));
      });
    })();

    return () => {
      cancelled = true;
      motionSub?.remove();
      headingSub?.remove();
    };
  }, [active]);

  return state;
}

export type ObserverState = {
  latitude: number;
  longitude: number;
  elevationM: number;
  /** null while resolving. */
  ready: boolean | null;
  reason: string | null;
};

/**
 * The observer's position, which the whole sky depends on: the same star is
 * overhead in one hemisphere and invisible in the other.
 */
export function useObserver(active: boolean): ObserverState {
  const [state, setState] = useState<ObserverState>({
    latitude: 0,
    longitude: 0,
    elevationM: 0,
    ready: null,
    reason: null,
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;

      if (status !== 'granted') {
        setState((prev) => ({
          ...prev,
          ready: false,
          reason: 'Location permission is required to compute what is above you.',
        }));
        return;
      }

      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;

        setState({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          elevationM: pos.coords.altitude ?? 0,
          ready: true,
          reason: null,
        });
      } catch {
        if (cancelled) return;
        setState((prev) => ({ ...prev, ready: false, reason: 'Could not obtain a position fix.' }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active]);

  return state;
}
