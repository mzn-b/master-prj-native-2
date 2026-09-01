/**
 * Task 4 risk gate: can three.js render crown.glb through react-native-webgpu?
 *
 * Key finding: the native canvas surface reports 0x0 until the view has been
 * laid out. Initialising the renderer before then silently produces
 * setSize(0, 0) and nothing is ever presented — with no error anywhere.
 * The loop below waits for real dimensions before creating the renderer.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {Canvas, useDevice, useSurface} from 'react-native-webgpu';
import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {applyGlbTextures, decodeGlbTextures} from './glbTextures';

const CROWN = require('../../assets/filters/crown.glb');

export function CrownSpike(): React.JSX.Element {
  const {ref, surface} = useSurface();
  const {device} = useDevice();
  const [status, setStatus] = useState('waiting for GPU device…');
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
      const w = live?.width ?? 0;
      const h = live?.height ?? 0;
      if (w > 0 && h > 0) {
        startedRef.current = true;
        void init(w, h);
        return;
      }
      setStatus(`waiting for layout — surface ${w}x${h}`);
      frame = requestAnimationFrame(waitForLayout);
    };

    const init = async (width: number, height: number) => {
      try {
        const context = ref.current?.getContext('webgpu');
        if (!context) {
          throw new Error('no webgpu context');
        }
        context.configure({
          device,
          format: navigator.gpu.getPreferredCanvasFormat(),
          alphaMode: 'premultiplied',
        });

        setStatus('loading crown.glb…');
        const asset = Image.resolveAssetSource(CROWN);
        if (!asset?.uri) {
          throw new Error('crown.glb did not resolve — is "glb" in metro assetExts?');
        }
        const bytes = await (await fetch(asset.uri)).arrayBuffer();

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(0, 0.35, 4.2);

        // Lighting copied verbatim from master-prj-pwa CrownFilter.ts so the
        // same model looks the same on both platforms (NF4). The model is
        // metallic; without an environment map it only shows what these lights
        // give it, which is why the PWA drives them this hard.
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

        // GLTFLoader's own texture path dies on React Native's Blob; decode the
        // embedded PNGs ourselves and attach them.
        setStatus('decoding textures…');
        const decoded = await decodeGlbTextures(bytes);
        const applied = applyGlbTextures(bytes, model, decoded);

        // Normalise so the spike does not depend on how crown.glb was authored.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        model.position.sub(box.getCenter(new THREE.Vector3()));
        model.scale.setScalar(2.0 / (Math.max(size.x, size.y, size.z) || 1));
        const pivot = new THREE.Group();
        pivot.add(model);
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

        setStatus(`rendering ${width}x${height} — ${decoded.size} textures, ${applied} applied`);

        const tick = () => {
          if (disposed) {
            return;
          }
          pivot.rotation.y += 0.02;
          renderer.render(scene, camera);
          context.present();
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (error) {
        setStatus(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    waitForLayout();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [device, surface, ref]);

  return (
    <View style={styles.container}>
      <Canvas ref={ref} style={styles.canvas} />
      <Text testID="spike-status" style={styles.status}>
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#101014'},
  canvas: {flex: 1},
  status: {color: '#fff', textAlign: 'center', padding: 12, fontSize: 14},
});
