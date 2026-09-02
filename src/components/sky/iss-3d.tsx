import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { memo, useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { Palette, Type } from '@/constants/theme';
import type { Horizontal, Observer } from '@/lib/sky/astro';
import { issModelBuffer } from '@/lib/sky/iss-model-data';
import {
  ecefToEnu,
  frameToMatrix,
  orbitalFrame,
  sunDirectionEcef,
  type Fix,
} from '@/lib/sky/orientation';
import { toUnitVector } from '@/lib/sky/projection';

type Props = {
  /** Where the station is in the observer's sky. */
  direction: Horizontal;
  observer: Observer;
  /** Two consecutive fixes; the attitude comes from the velocity between them. */
  previousFix: Fix | null;
  currentFix: Fix | null;
  size: number;
  at: Date;
};

/**
 * The ISS rendered as NASA's actual geometry, on the GPU.
 *
 * expo-gl gives an OpenGL ES context that the platform backs with Metal on iOS
 * and Vulkan/GLES on Android, so this is hardware-accelerated on both without
 * any per-platform code.
 *
 * The station is not drawn at an arbitrary angle. It flies local-vertical /
 * local-horizontal — nose along track, belly to the earth — and the camera is
 * placed along the real line of sight from the observer, so what you see is the
 * aspect you would actually see if you could resolve it.
 */
export const Iss3D = memo(function Iss3D({
  direction,
  observer,
  previousFix,
  currentFix,
  size,
  at,
}: Props) {
  const [failed, setFailed] = useState<string | null>(null);

  // Held in refs so the render loop reads current values without being torn
  // down and rebuilt every time a fix arrives.
  const latest = useRef({ direction, observer, previousFix, currentFix, at });
  latest.current = { direction, observer, previousFix, currentFix, at };

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    try {
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;

      // WebGLRenderer falls back to creating its own canvas via `document` when
      // `parameters.canvas` is absent — and React Native has no `document`, so
      // that throws "Property 'document' doesn't exist". Passing the shim as
      // BOTH the constructor's canvas and context.canvas is what avoids it.
      const shim = {
        width,
        height,
        style: {},
        clientWidth: width,
        clientHeight: height,
        addEventListener: () => {},
        removeEventListener: () => {},
        getContext: () => gl,
      };
      (gl as unknown as { canvas: unknown }).canvas = shim;

      /**
       * three r163+ rejects WebGL1 with:
       *   `instanceof WebGLRenderingContext` -> throw
       *
       * expo-gl's context extends WebGL2RenderingContext — it really is WebGL2 —
       * but it also satisfies `instanceof WebGLRenderingContext`, so that guard
       * is a false positive here. Hiding the global across the constructor call
       * (and only that call) is the narrowest way past it; the alternative is
       * pinning three to r162 and giving up five years of fixes.
       */
      const globals = globalThis as { WebGLRenderingContext?: unknown };
      const savedWebGL1 = globals.WebGLRenderingContext;
      delete globals.WebGLRenderingContext;

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: shim as unknown as HTMLCanvasElement,
          context: gl as unknown as WebGLRenderingContext,
          antialias: true,
          alpha: true,
        });
      } finally {
        if (savedWebGL1 !== undefined) globals.WebGLRenderingContext = savedWebGL1;
      }
      renderer.setSize(width, height);
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 1000);

      // The station's hull is metallic, and a metal with nothing to reflect
      // renders pure black however bright the lights are. A generated room
      // probe gives it an environment without shipping an HDR file.
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.55;

      // Sunlight from the real solar direction, plus a dim earthshine fill so
      // the shadowed side is not a black cut-out.
      const sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
      scene.add(sun);
      scene.add(new THREE.AmbientLight(0x2b3a4a, 1.4));
      const earthshine = new THREE.DirectionalLight(0x4a6fa5, 0.5);
      earthshine.position.set(0, -1, 0);
      scene.add(earthshine);

      const model = new THREE.Group();
      scene.add(model);

      await new Promise<void>((resolve, reject) => {
        new GLTFLoader().parse(
          issModelBuffer(),
          '',
          (gltf) => {
            const object = gltf.scene;

            // Normalise: NASA's model arrives in its own units and off-centre.
            // Fit it to a unit box so the camera distance below is meaningful
            // regardless of which model is swapped in.
            const box = new THREE.Box3().setFromObject(object);
            const span = box.getSize(new THREE.Vector3()).length();
            const centre = box.getCenter(new THREE.Vector3());
            object.position.sub(centre);
            object.scale.setScalar(span > 0 ? 2 / span : 1);

            model.add(object);
            resolve();
          },
          (error) =>
            reject(
              error instanceof Error ? error : new Error('Could not parse the ISS model'),
            ),
        );
      });

      let frame = 0;
      const render = () => {
        frame = requestAnimationFrame(render);

        const { direction: dir, observer: obs, previousFix, currentFix, at } = latest.current;

        // Camera sits on the line of sight, looking back at the station.
        const los = toUnitVector(dir);
        camera.position.set(los[0] * 4, los[2] * 4, -los[1] * 4);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);

        const sunEnu = ecefToEnu(sunDirectionEcef(at), obs);
        sun.position.set(sunEnu[0], sunEnu[2], -sunEnu[1]);

        if (previousFix && currentFix) {
          const frameMatrix = orbitalFrame(previousFix, currentFix);
          if (frameMatrix) {
            const m = frameToMatrix(frameMatrix, obs);
            // ENU is x=east, y=north, z=up; three is x=right, y=up, z=toward
            // the viewer. The swap below is that change of basis, not a fudge.
            const basis = new THREE.Matrix4().set(
              m[0], m[1], m[2], 0,
              m[8], m[9], m[10], 0,
              -m[4], -m[5], -m[6], 0,
              0, 0, 0, 1,
            );
            model.quaternion.setFromRotationMatrix(basis);
          }
        }

        renderer.render(scene, camera);
        gl.endFrameEXP();
      };

      render();
      return () => cancelAnimationFrame(frame);
    } catch (error) {
      // A GL context can fail to come up on an emulator without host GPU
      // support. Say so rather than leaving a silent black square.
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Iss3D] GL setup failed:', message);
      setFailed(message || 'GL unavailable');
    }
  }, []);

  if (failed) {
    return (
      <View style={[styles.fallback, { width: size, height: size }]} testID="iss-3d-fallback">
        <Text style={styles.fallbackText} numberOfLines={4}>
          {failed}
        </Text>
      </View>
    );
  }

  return (
    <GLView
      style={{ width: size, height: size }}
      onContextCreate={onContextCreate}
      testID="iss-3d"
    />
  );
});

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Palette.rule,
  },
  fallbackText: { fontFamily: Type.mono, fontSize: 8, color: Palette.faint },
});
