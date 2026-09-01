/**
 * Task 4 risk gate: can three.js render crown.glb through react-native-webgpu?
 * Nothing else depends on this file — it is deleted in Task 19 once the
 * approach is either proven (lifted into Crown3D) or abandoned.
 */
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {Canvas, useDevice, useSurface} from 'react-native-webgpu';
import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

const CROWN = require('../../assets/filters/crown.glb');

export function CrownSpike(): React.JSX.Element {
  const {ref, surface} = useSurface();
  const {device} = useDevice();
  const [status, setStatus] = useState('waiting for GPU device…');

  useEffect(() => {
    if (!device || !surface) {
      return;
    }
    let frame = 0;
    let disposed = false;

    (async () => {
      try {
        const context = ref.current?.getContext('webgpu');
        if (!context) {
          throw new Error('no webgpu context');
        }

        // A WebGPU canvas context must be configured with a device and format
        // before anything can be presented; three does not do this for a
        // non-DOM canvas.
        context.configure({
          device,
          format: navigator.gpu.getPreferredCanvasFormat(),
          alphaMode: 'premultiplied',
        });

        setStatus('loading crown.glb…');
        const asset = Image.resolveAssetSource(CROWN);
        if (!asset?.uri) {
          throw new Error('crown.glb asset did not resolve — is "glb" in metro assetExts?');
        }
        const response = await fetch(asset.uri);
        const bytes = await response.arrayBuffer();

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          45,
          surface.width / surface.height,
          0.1,
          100,
        );
        camera.position.set(0, 0, 3.5);
        scene.add(new THREE.AmbientLight(0xffffff, 2.5));
        const key = new THREE.DirectionalLight(0xffffff, 3);
        key.position.set(1, 2, 3);
        scene.add(key);

        // Diagnostic control: an untextured box. If this renders and the crown
        // does not, the WebGPU pipeline is fine and the problem is the model.
        const probe = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.6, 0.6),
          new THREE.MeshStandardMaterial({color: 0xff3366}),
        );
        probe.position.set(-1.0, 0, 0);
        scene.add(probe);

        const gltf = await new GLTFLoader().parseAsync(bytes, '');
        const model = gltf.scene;

        // Normalise: centre the model and scale its largest axis to ~1.5 units,
        // so the spike is independent of how crown.glb was authored.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        model.position.sub(centre);
        const maxAxis = Math.max(size.x, size.y, size.z) || 1;
        model.scale.setScalar(1.5 / maxAxis);
        const pivot = new THREE.Group();
        pivot.add(model);
        scene.add(pivot);

        const renderer = new THREE.WebGPURenderer({
          canvas: surface as never,
          context: context as never,
          device,
          antialias: true,
          alpha: true,
        });
        await renderer.init();
        renderer.setSize(surface.width, surface.height, false);

        setStatus('rendering');

        const tick = () => {
          if (disposed) {
            return;
          }
          pivot.rotation.y += 0.02;
          probe.rotation.y += 0.02;
          probe.rotation.x += 0.01;
          renderer.render(scene, camera);
          context.present();
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (error) {
        setStatus(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [device, surface, ref]);

  return (
    <View style={styles.container}>
      <Canvas ref={ref} style={styles.canvas} transparent />
      <Text testID="spike-status" style={styles.status}>
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#101014'},
  canvas: {flex: 1},
  status: {color: '#fff', textAlign: 'center', padding: 12, fontSize: 16},
});
