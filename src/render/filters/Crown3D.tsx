import React, {useEffect, useRef} from 'react';
import {Image, StyleSheet} from 'react-native';
import {Canvas, useDevice, useSurface} from 'react-native-webgpu';
import type {SharedValue} from 'react-native-reanimated';
import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {faceOffset, type RawDetection} from '../../native/landmarkFormat';
import {projectNormalized, type ViewGeometry} from '../coordinates';
import {estimateHeadPose} from '../headPose';
import {applyGlbTextures, decodeGlbTextures} from './glbTextures';

const CROWN = require('../../../assets/filters/crown.glb');

/** Crown height as a multiple of the temple-to-temple distance. */
const CROWN_WIDTH_RATIO = 1.35;
/** How far above the temple line the crown sits, in crown heights. */
const LIFT = 0.75;

export interface Crown3DProps {
  latest: SharedValue<RawDetection | null>;
  geometry: ViewGeometry;
}

/**
 * 3D crown rendered with three.js through WebGPU.
 *
 * Three things here are load-bearing and were each a silent failure during the
 * Task 4 spike:
 *  - the canvas surface reports 0x0 until layout, and initialising then gives
 *    setSize(0, 0) with no error and nothing on screen;
 *  - the context must be configured with a device and format before anything
 *    is presented;
 *  - GLTFLoader cannot decode embedded textures under React Native (it wraps
 *    them in a Blob), so glbTextures.ts decodes them separately.
 *
 * Lighting and tone mapping are copied from the PWA's CrownFilter so the same
 * model looks the same on both platforms (NF4).
 */
export function Crown3D({latest, geometry}: Crown3DProps): React.JSX.Element {
  const {ref, surface} = useSurface();
  const {device} = useDevice();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!device || !surface || startedRef.current) {
      return;
    }
    let frame = 0;
    let disposed = false;

    const waitForLayout = () => {
      if (disposed) {
        return;
      }
      const live = ref.current?.getNativeSurface();
      const width = live?.width ?? 0;
      const height = live?.height ?? 0;
      if (width > 0 && height > 0) {
        startedRef.current = true;
        init(width, height).catch(() => {
          /* filter stays hidden if the GPU path is unavailable */
        });
        return;
      }
      frame = requestAnimationFrame(waitForLayout);
    };

    const init = async (width: number, height: number) => {
      const context = ref.current?.getContext('webgpu');
      if (!context) {
        return;
      }
      context.configure({
        device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'premultiplied',
      });

      const asset = Image.resolveAssetSource(CROWN);
      if (!asset?.uri) {
        throw new Error('crown.glb did not resolve — is "glb" in metro assetExts?');
      }
      const bytes = await (await fetch(asset.uri)).arrayBuffer();

      const scene = new THREE.Scene();
      // Orthographic in view pixels: landmark projection already gives us
      // screen coordinates, so the crown can be positioned directly.
      const camera = new THREE.OrthographicCamera(0, width, 0, height, -1000, 1000);

      scene.add(new THREE.AmbientLight(0xffffff, 5.0));
      const front = new THREE.DirectionalLight(0xfffbe8, 6.0);
      front.position.set(0, 1, 6);
      scene.add(front);
      const topLight = new THREE.DirectionalLight(0xffffff, 4.0);
      topLight.position.set(0, 6, 2);
      scene.add(topLight);
      const rimL = new THREE.DirectionalLight(0xffd700, 3.0);
      rimL.position.set(-4, 2, 3);
      scene.add(rimL);
      const rimR = new THREE.DirectionalLight(0xffd700, 3.0);
      rimR.position.set(4, 2, 3);
      scene.add(rimR);

      const gltf = await new GLTFLoader().parseAsync(bytes, '');
      const model = gltf.scene;
      const decoded = await decodeGlbTextures(bytes);
      applyGlbTextures(bytes, model, decoded);

      // Normalise the model to a unit box so placement is independent of how
      // crown.glb was authored.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(box.getCenter(new THREE.Vector3()));
      const unit = 1 / (Math.max(size.x, size.y, size.z) || 1);
      model.scale.setScalar(unit);

      const pivot = new THREE.Group();
      pivot.add(model);
      pivot.visible = false;
      scene.add(pivot);

      const renderer = new THREE.WebGPURenderer({
        canvas: ref.current?.getNativeSurface() as never,
        context: context as never,
        device,
        antialias: true,
        alpha: true,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 2.2;
      await renderer.init();
      renderer.setSize(width, height, false);

      const tick = () => {
        if (disposed) {
          return;
        }
        const detection = latest.value;
        if (detection && detection.faceCount > 0) {
          const values = new Float32Array(detection.landmarks);
          const pose = estimateHeadPose(values, faceOffset(0));
          const centre = projectNormalized(pose.centre.x, pose.centre.y, geometry);
          const edge = projectNormalized(pose.centre.x + pose.scale / 2, pose.centre.y, geometry);
          const widthPx = Math.abs(edge.x - centre.x) * 2 * CROWN_WIDTH_RATIO;

          pivot.visible = widthPx > 1;
          pivot.scale.setScalar(widthPx);
          pivot.position.set(centre.x, centre.y - widthPx * LIFT, 0);
          // Mirroring flips the apparent direction of yaw and roll.
          const handedness = geometry.mirrorX ? -1 : 1;
          pivot.rotation.set(pose.pitch, pose.yaw * handedness, -pose.roll * handedness);
        } else {
          pivot.visible = false;
        }

        renderer.render(scene, camera);
        context.present();
        frame = requestAnimationFrame(tick);
      };
      tick();
    };

    waitForLayout();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [device, surface, ref, latest, geometry]);

  return <Canvas ref={ref} style={StyleSheet.absoluteFill} transparent />;
}
