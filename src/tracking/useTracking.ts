import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAsyncRunner, useFrameOutput} from 'react-native-vision-camera';
// Shared values are Reanimated's API; react-native-worklets is the runtime beneath it.
import {useAnimatedReaction, useSharedValue} from 'react-native-reanimated';
import {NitroModules} from 'react-native-nitro-modules';
import {createLandmarkDetector} from 'tracking-native';
import type {PerformanceMetricsDTO, TrackingMode} from '../domain/tracking.dto';
import type {RawDetection} from '../native/landmarkFormat';
import {getNativeMetrics} from '../metrics/nativeMetrics';
import {DEFAULT_SMOOTHING_CONFIG, LandmarkSmoother} from './LandmarkSmoother';
import {
  DEFAULT_DYNAMIC_INFERENCE_CONFIG,
  DynamicInferenceController,
} from './DynamicInferenceController';
import {applyDropoutGrace, emptyGraceState} from './dropoutGrace';
import {PerformanceTracker} from './PerformanceTracker';

/** The only periodic React state update in the app. */
const METRICS_INTERVAL_MS = 500;

export interface UseTrackingOptions {
  mode: TrackingMode;
  smoothingEnabled: boolean;
  dynamicInferenceEnabled: boolean;
}

/**
 * Owns the camera -> detect -> smooth -> publish pipeline and the session
 * lifecycle. The single place that touches the detector.
 *
 * Design rule: results are published to a SharedValue, never to React state.
 * Renderers read that value directly, so a 30 fps camera does not cause 30
 * component renders per second — which is both a performance problem and a
 * measurement artefact.
 */
export function useTracking(options: UseTrackingOptions) {
  const [isRunning, setIsRunning] = useState(false);
  const [metrics, setMetrics] = useState<PerformanceMetricsDTO | null>(null);
  const [currentFrameSkip, setCurrentFrameSkip] = useState(1);

  /** Latest detection, read directly by every renderer. */
  const latest = useSharedValue<RawDetection | null>(null);
  /** Raw detector output, before NF7 dropout grace is applied. */
  const latestRaw = useSharedValue<RawDetection | null>(null);
  /** Real frame dimensions, taken from the frames themselves. */
  const frameSize = useSharedValue({width: 0, height: 0});
  const frameCounter = useSharedValue(0);
  const frameSkip = useSharedValue(1);
  const running = useSharedValue(false);

  const detector = useMemo(() => createLandmarkDetector(), []);
  /**
   * A HybridObject must be boxed to cross into another Runtime. The detection
   * worklet runs on the async runner's own runtime, where an unboxed object
   * arrives without its methods ("Object is not a function").
   */
  const boxedDetector = useMemo(() => NitroModules.box(detector), [detector]);
  const tracker = useRef(new PerformanceTracker()).current;
  const smoother = useRef(new LandmarkSmoother(DEFAULT_SMOOTHING_CONFIG)).current;
  const governor = useRef(
    new DynamicInferenceController(DEFAULT_DYNAMIC_INFERENCE_CONFIG),
  ).current;
  const asyncRunner = useAsyncRunner();

  // Worklet-owned state. Everything the frame callback touches must be a
  // SharedValue or a HybridObject — a JS class instance has no methods on the
  // worklet runtime and fails at runtime, not at compile time.
  const graceState = useSharedValue(emptyGraceState());
  const droppedFrames = useSharedValue(0);

  useEffect(() => {
    smoother.setConfig({enabled: options.smoothingEnabled});
  }, [options.smoothingEnabled, smoother]);

  useEffect(() => {
    governor.setConfig({enabled: options.dynamicInferenceEnabled});
  }, [options.dynamicInferenceEnabled, governor]);

  const frameOutput = useFrameOutput({
    // MediaPipe reads pixels on the CPU. The default 'native' format is a
    // GPU-side buffer (PRIVATE on Android), which cannot be converted to a
    // Bitmap at all — every detection silently returned empty.
    pixelFormat: 'rgb',
    onFrame(frame) {
      'worklet';
      frameCounter.value += 1;

      if (!running.value) {
        frame.dispose();
        return;
      }

      if (frameSize.value.width !== frame.width) {
        frameSize.value = {width: frame.width, height: frame.height};
      }

      // F15 — skip without touching the detector at all.
      if (frameCounter.value % frameSkip.value !== 0) {
        frame.dispose();
        return;
      }

      const scheduled = asyncRunner.runAsync(() => {
        'worklet';
        try {
          // Keep this worklet minimal: the async runner has its own runtime,
          // where an imported worklet arrives as an object rather than a
          // function. Only HybridObjects and SharedValues are safe to touch.
          latestRaw.value = boxedDetector.unbox().detect(frame, frame.timestamp);
        } finally {
          frame.dispose();
        }
      });

      if (!scheduled) {
        // NF1 — inference is behind. Drop this frame and count it honestly
        // rather than queueing work the device cannot keep up with. The count
        // is drained onto the tracker by the metrics tick.
        frame.dispose();
        droppedFrames.value += 1;
      }
    },
  });

  // NF7 runs on Reanimated's UI runtime, which does unpack imported worklets.
  useAnimatedReaction(
    () => latestRaw.value,
    raw => {
      'worklet';
      if (!raw) {
        latest.value = null;
        return;
      }
      const graced = applyDropoutGrace(graceState.value, raw);
      graceState.value = graced.state;
      latest.value = graced.result;
    },
  );

  const start = useCallback(() => {
    detector.configure({
      mode: options.mode,
      maxFaces: 1,
      maxHands: 2,
      useGpu: true,
    });
    tracker.start();
    tracker.setModelLoadTime(detector.modelLoadTimeMs);
    tracker.setGpuDelegateActive(detector.gpuDelegateActive);
    graceState.value = emptyGraceState();
    droppedFrames.value = 0;
    smoother.reset();
    governor.reset();
    frameCounter.value = 0;
    frameSkip.value = 1;
    running.value = true;
    setIsRunning(true);
  }, [
    detector,
    options.mode,
    tracker,
    smoother,
    governor,
    frameCounter,
    frameSkip,
    running,
    graceState,
    droppedFrames,
  ]);

  const stop = useCallback((): PerformanceMetricsDTO | undefined => {
    const final = tracker.getMetrics(getNativeMetrics());
    running.value = false;
    setIsRunning(false);
    try {
      detector.release();
    } catch {
      // Releasing a detector that never configured is not an error.
    }
    graceState.value = emptyGraceState();
    smoother.reset();
    governor.reset();
    latest.value = null;
    setMetrics(null);
    return final;
  }, [detector, tracker, smoother, governor, latest, running, graceState]);

  /**
   * Begin a new measurement window without interrupting the camera. Used on a
   * filter toggle so each filter combination is submitted as its own session.
   */
  const resetSession = useCallback(() => {
    tracker.reset();
    smoother.reset();
    setMetrics(tracker.getMetrics(getNativeMetrics()));
  }, [tracker, smoother]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const id = setInterval(() => {
      // Drain the worklet's dropped-frame counter onto the tracker.
      if (droppedFrames.value > 0) {
        for (let i = 0; i < droppedFrames.value; i++) {
          tracker.recordDroppedFrame();
        }
        droppedFrames.value = 0;
      }
      const snapshot = tracker.getMetrics(getNativeMetrics());
      setMetrics(snapshot);
      if (snapshot.avgInferenceTimeMs > 0) {
        governor.recordInferenceTime(snapshot.avgInferenceTimeMs);
        const skip = governor.getCurrentFrameSkip();
        frameSkip.value = skip;
        setCurrentFrameSkip(skip);
      }
    }, METRICS_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRunning, tracker, governor, frameSkip, droppedFrames]);

  return {
    isRunning,
    frameOutput,
    latest,
    frameSize,
    metrics,
    currentFrameSkip,
    start,
    stop,
    resetSession,
  };
}
