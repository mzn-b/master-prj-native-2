import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAsyncRunner, useFrameOutput} from 'react-native-vision-camera';
// Shared values are Reanimated's API; react-native-worklets is the runtime beneath it.
import {useSharedValue} from 'react-native-reanimated';
import {createLandmarkDetector} from 'tracking-native';
import type {PerformanceMetricsDTO, TrackingMode} from '../domain/tracking.dto';
import type {RawDetection} from '../native/landmarkFormat';
import {getNativeMetrics} from '../metrics/nativeMetrics';
import {DEFAULT_SMOOTHING_CONFIG, LandmarkSmoother} from './LandmarkSmoother';
import {
  DEFAULT_DYNAMIC_INFERENCE_CONFIG,
  DynamicInferenceController,
} from './DynamicInferenceController';
import {DropoutGrace} from './dropoutGrace';
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
  const frameCounter = useSharedValue(0);
  const frameSkip = useSharedValue(1);
  const running = useSharedValue(false);

  const detector = useMemo(() => createLandmarkDetector(), []);
  const tracker = useRef(new PerformanceTracker()).current;
  const smoother = useRef(new LandmarkSmoother(DEFAULT_SMOOTHING_CONFIG)).current;
  const governor = useRef(
    new DynamicInferenceController(DEFAULT_DYNAMIC_INFERENCE_CONFIG),
  ).current;
  const grace = useRef(new DropoutGrace()).current;
  const asyncRunner = useAsyncRunner();

  useEffect(() => {
    smoother.setConfig({enabled: options.smoothingEnabled});
  }, [options.smoothingEnabled, smoother]);

  useEffect(() => {
    governor.setConfig({enabled: options.dynamicInferenceEnabled});
  }, [options.dynamicInferenceEnabled, governor]);

  const frameOutput = useFrameOutput({
    onFrame(frame) {
      'worklet';
      if (!running.value) {
        frame.dispose();
        return;
      }

      frameCounter.value += 1;
      // F15 — skip without touching the detector at all.
      if (frameCounter.value % frameSkip.value !== 0) {
        frame.dispose();
        return;
      }

      const scheduled = asyncRunner.runAsync(() => {
        'worklet';
        try {
          const result = detector.detect(frame, frame.timestamp);
          latest.value = grace.apply(result);
        } finally {
          frame.dispose();
        }
      });

      if (!scheduled) {
        // NF1 — inference is behind. Drop this frame and count it honestly
        // rather than queueing work the device cannot keep up with.
        frame.dispose();
        tracker.recordDroppedFrame();
      }
    },
  });

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
    grace.reset();
    smoother.reset();
    governor.reset();
    frameCounter.value = 0;
    frameSkip.value = 1;
    running.value = true;
    setIsRunning(true);
  }, [detector, options.mode, tracker, grace, smoother, governor, frameCounter, frameSkip, running]);

  const stop = useCallback((): PerformanceMetricsDTO | undefined => {
    const final = tracker.getMetrics(getNativeMetrics());
    running.value = false;
    setIsRunning(false);
    try {
      detector.release();
    } catch {
      // Releasing a detector that never configured is not an error.
    }
    grace.reset();
    smoother.reset();
    governor.reset();
    latest.value = null;
    setMetrics(null);
    return final;
  }, [detector, tracker, grace, smoother, governor, latest, running]);

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
  }, [isRunning, tracker, governor, frameSkip]);

  return {isRunning, frameOutput, latest, metrics, currentFrameSkip, start, stop, resetSession};
}
