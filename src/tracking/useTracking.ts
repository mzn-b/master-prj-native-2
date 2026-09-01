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

interface FrameStats {
  frames: number;
  intervalSumMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  inferenceSumMs: number;
  processingSumMs: number;
  facesSum: number;
  handsSum: number;
  trackedFrames: number;
  lastAtMs: number;
}

function emptyStats(): FrameStats {
  'worklet';
  return {
    frames: 0,
    intervalSumMs: 0,
    minIntervalMs: 0,
    maxIntervalMs: 0,
    inferenceSumMs: 0,
    processingSumMs: 0,
    facesSum: 0,
    handsSum: 0,
    trackedFrames: 0,
    lastAtMs: 0,
  };
}

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
  /**
   * Measurements accumulated on the worklet runtime and drained by the metrics
   * tick. The tracker itself is a JS object and cannot be called from here.
   */
  const stats = useSharedValue(emptyStats());

  useEffect(() => {
    smoother.setConfig({enabled: options.smoothingEnabled});
  }, [options.smoothingEnabled, smoother]);

  useEffect(() => {
    governor.setConfig({enabled: options.dynamicInferenceEnabled});
  }, [options.dynamicInferenceEnabled, governor]);

  const frameOutput = useFrameOutput({
    /**
     * Both platforms need a CPU-readable format.
     *
     * Android's native format is a GPU-side PRIVATE buffer that cannot be read
     * at all. iOS looked like it could take its native buffer straight into
     * MPImage, but in practice MPImage rejects it and every detection returns
     * empty — measured on an iPhone SE: frames counted, 0 ms inference, no
     * landmarks. Keep 'rgb' on both.
     */
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
        const startedAt = Date.now();
        try {
          // Supply our own millisecond clock rather than frame.timestamp: its
          // units differ per platform (iOS reports seconds), and MediaPipe's
          // VIDEO mode silently returns nothing when the millisecond value does
          // not strictly increase.
          // Keep this worklet minimal: the async runner has its own runtime,
          // where an imported worklet arrives as an object rather than a
          // function. Only HybridObjects and SharedValues are safe to touch.
          const detection = boxedDetector.unbox().detect(frame, startedAt);
          latestRaw.value = detection;

          const finishedAt = Date.now();
          const previous = stats.value;
          const interval = previous.lastAtMs > 0 ? finishedAt - previous.lastAtMs : 0;
          stats.value = {
            frames: previous.frames + 1,
            intervalSumMs: previous.intervalSumMs + interval,
            minIntervalMs:
              interval > 0 ? Math.min(previous.minIntervalMs || interval, interval) : previous.minIntervalMs,
            maxIntervalMs: Math.max(previous.maxIntervalMs, interval),
            inferenceSumMs: previous.inferenceSumMs + detection.inferenceTimeMs,
            processingSumMs: previous.processingSumMs + (finishedAt - startedAt),
            facesSum: previous.facesSum + detection.faceCount,
            handsSum: previous.handsSum + detection.handCount,
            trackedFrames:
              previous.trackedFrames + (detection.faceCount + detection.handCount > 0 ? 1 : 0),
            lastAtMs: finishedAt,
          };
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
    stats.value = emptyStats();
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
    stats,
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
      // Drain the worklet's measurements onto the tracker.
      const batch = stats.value;
      if (batch.frames > 0) {
        tracker.recordBatch(batch);
        stats.value = {...emptyStats(), lastAtMs: batch.lastAtMs};
      }
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
  }, [isRunning, tracker, governor, frameSkip, droppedFrames, stats]);

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
