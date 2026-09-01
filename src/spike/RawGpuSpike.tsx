/**
 * Diagnostic: raw WebGPU with no three.js. Clears the canvas to red and
 * presents. If this shows red, react-native-webgpu works and the problem in
 * CrownSpike is three.js's integration. Throwaway.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Canvas, useDevice, useSurface} from 'react-native-webgpu';

export function RawGpuSpike(): React.JSX.Element {
  const {ref, surface} = useSurface();
  const {adapter, device} = useDevice();
  const [status, setStatus] = useState('waiting for device…');

  useEffect(() => {
    if (!device || !surface) {
      return;
    }
    let frame = 0;
    let disposed = false;
    let configured = false;
    const format = navigator.gpu.getPreferredCanvasFormat();

    // The native surface reports 0x0 until the view has been laid out, so poll
    // it each frame and only configure/draw once it has real dimensions.
    const tick = () => {
      if (disposed) {
        return;
      }
      try {
        const context = ref.current?.getContext('webgpu');
        const live = ref.current?.getNativeSurface();
        const w = live?.width ?? 0;
        const h = live?.height ?? 0;

        if (context && w > 0 && h > 0) {
          if (!configured) {
            context.configure({device, format, alphaMode: 'opaque'});
            configured = true;
          }
          const encoder = device.createCommandEncoder();
          const view = context.getCurrentTexture().createView();
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view,
                clearValue: {r: 1, g: 0.1, b: 0.2, a: 1},
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          pass.end();
          device.queue.submit([encoder.finish()]);
          context.present();
          setStatus(
            `CLEARED ${w}x${h} adapter=${adapter?.info?.vendor ?? '?'} format=${format}`,
          );
        } else {
          setStatus(`waiting for layout — surface ${w}x${h}`);
        }
      } catch (error) {
        setStatus(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [device, surface, ref, adapter]);

  return (
    <View style={styles.container}>
      <Canvas ref={ref} style={styles.canvas} />
      <Text testID="raw-status" style={styles.status}>
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#101014'},
  canvas: {flex: 1},
  status: {color: '#fff', textAlign: 'center', padding: 12, fontSize: 13},
});
