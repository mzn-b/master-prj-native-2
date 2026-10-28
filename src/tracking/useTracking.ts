import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {CommonResolutions, useAsyncRunner, useFrameOutput} from 'react-native-vision-camera';
// Shared values are Reanimated's API; react-native-worklets is the runtime beneath it.
import {useAnimatedReaction, useSharedValue} from 'react-native-reanimated';
import {NitroModules} from 'react-native-nitro-modules';
import {createLandmarkDetector} from 'tracking-native';
import type {PerformanceMetricsDTO, TrackingMode} from '../domain/tracking.dto';
import {VALUES_PER_POINT, type RawDetection} from '../native/landmarkFormat';

/** MediaPipe face-mesh nose tip — the landmark used as the jitter reference. */
const NOSE_TIP_INDEX = 1;
import {getNativeMetrics} from '../metrics/nativeMetrics';
import {DEFAULT_SMOOTHING_CONFIG} from './LandmarkSmoother';
import {
  DEFAULT_DYNAMIC_INFERENCE_CONFIG,
  DynamicInferenceController,
} from './DynamicInferenceController';
import {applyDropoutGrace, emptyGraceState} from './dropoutGrace';
import {applySmoothing, emptySmoothingState} from './packedSmoothing';
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
  /**
   * NF7, counted **per frame** rather than per drain.
   *
   * These used to be derived in the tracker from `trackedFrames === 0`, which
   * made a loss event mean "no detection anywhere in a 500 ms window". The PWA
   * counts a single missed frame, so native needed a ~25x longer blackout to
   * register the same event and the two columns were not comparable. The state
   * machine now lives here, where the individual frames are, and matches the
   * PWA's exactly. See METRICS.md.
   */
  lostEvents: number;
  recoverySumMs: number;
  recoveryCount: number;
  consecutiveLossMax: number;
  lastAtMs: number;
  /** NF3 — clock of the first detecting frame since the last drain, or 0. */
  firstTrackedAtMs: number;
  /**
   * Per-frame samples for the session percentiles.
   *
   * The sums above are enough for means, but percentiles taken over batch means
   * understate jitter — averaging is exactly what removes the spikes a user
   * feels. The drain runs every 500 ms, so these hold a handful of entries at a
   * time and are cleared on each drain.
   */
  intervalSamples: number[];
  inferenceSamples: number[];
  /** Detection quality, summed per drain — see PerformanceTracker. */
  gestureConfidenceSum: number;
  gestureConfidenceCount: number;
  blendshapeActivationSum: number;
  blendshapeActivationCount: number;
  landmarkDeltaSum: number;
  landmarkDeltaCount: number;
}

function emptyStats(): FrameStats {
  'worklet';
  return {
    frames: 0,
    intervalSamples: [],
    inferenceSamples: [],
    gestureConfidenceSum: 0,
    gestureConfidenceCount: 0,
    blendshapeActivationSum: 0,
    blendshapeActivationCount: 0,
    landmarkDeltaSum: 0,
    landmarkDeltaCount: 0,
    intervalSumMs: 0,
    minIntervalMs: 0,
    maxIntervalMs: 0,
    inferenceSumMs: 0,
    processingSumMs: 0,
    facesSum: 0,
    handsSum: 0,
    trackedFrames: 0,
    lostEvents: 0,
    recoverySumMs: 0,
    recoveryCount: 0,
    consecutiveLossMax: 0,
    lastAtMs: 0,
    firstTrackedAtMs: 0,
  };
}

export interface UseTrackingOptions {
  mode: TrackingMode;
  smoothingEnabled: boolean;
  dynamicInferenceEnabled: boolean;
  /**
   * Whether to request the MediaPipe GPU delegate.
   *
   * Exposed so the delegate can be tested rather than assumed.
   * `gpuDelegateActive` reports that the delegate was *requested and built*,
   * not that inference ran on the GPU, and it has never correlated with
   * performance in any measurement — so it cannot be cited as evidence. The
   * decisive test is matched pairs with the delegate forced off.
   *
   * It matters more since 2026-10-13, when Android native measured ~1.6x
   * slower than its own PWA on the same device at the same resolution. If the
   * delegate was never engaging, that is an implementation defect rather than
   * a finding about native versus web.
   *
   * Read at `configure()` time, so it only takes effect on the next start.
   */
  gpuDelegateEnabled: boolean;
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
  /** Whether this session's model load time and delegate state are recorded. */
  const engineStateRecorded = useRef(false);
  const governor = useRef(
    new DynamicInferenceController(DEFAULT_DYNAMIC_INFERENCE_CONFIG),
  ).current;
  const asyncRunner = useAsyncRunner();

  // Worklet-owned state. Everything the frame callback touches must be a
  // SharedValue or a HybridObject — a JS class instance has no methods on the
  // worklet runtime and fails at runtime, not at compile time.
  const graceState = useSharedValue(emptyGraceState());
  const smoothState = useSharedValue(emptySmoothingState());
  /**
   * F9 — read by the smoothing worklet. The LandmarkSmoother instance below
   * cannot be reached from a worklet, so the toggle has to live in a SharedValue.
   */
  const smoothingConfig = useSharedValue({...DEFAULT_SMOOTHING_CONFIG});
  const droppedFrames = useSharedValue(0);
  // F15 accounting. The two drop causes are counted apart because they mean
  // opposite things: the governor skipping is the system working, the runner
  // refusing is the device overwhelmed. Skip level is sampled per camera frame.
  // NF7 state that has to survive a drain: whether tracking was valid on the
  // previous frame, when the current loss began, and how long it has run.
  const trackingValid = useSharedValue(false);
  const lostAtMs = useSharedValue(0);
  const consecutiveLoss = useSharedValue(0);
  const droppedGovernor = useSharedValue(0);
  const droppedBusy = useSharedValue(0);
  const frameSkipSum = useSharedValue(0);
  const frameSkipFrames = useSharedValue(0);
  const frameSkipMax = useSharedValue(0);
  /**
   * Detection failures, drained onto the tracker like droppedFrames.
   *
   * The PWA has always counted these (its engine reports through `onError`),
   * while this side let a throw escape the worklet uncounted — so `errorCount`
   * was live in one dataset and structurally zero in the other. A metric that
   * only one platform can report makes that platform look worse for a reason
   * that is not about the platform.
   */
  const detectErrors = useSharedValue(0);
  /** Previous nose-tip position, for the landmark-jitter metric. -1 means none. */
  const lastNoseX = useSharedValue(-1);
  const lastNoseY = useSharedValue(-1);
  /**
   * Measurements accumulated on the worklet runtime and drained by the metrics
   * tick. The tracker itself is a JS object and cannot be called from here.
   */
  const stats = useSharedValue(emptyStats());

  useEffect(() => {
    smoothingConfig.value = {...DEFAULT_SMOOTHING_CONFIG, enabled: options.smoothingEnabled};
  }, [options.smoothingEnabled, smoothingConfig]);

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
    /**
     * NF4 — pinned, not left to the default. Inference cost scales with source
     * resolution, so a comparison across platforms is only meaningful if both
     * capture at the same size. 720p is also what useFrameOutput happens to
     * default to today; stating it means a library default cannot move it out
     * from under the measurements. The PWA requests the same size, and both
     * apps submit the size the camera actually delivered.
     */
    targetResolution: CommonResolutions.HD_16_9,
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

      // F15 — skip without touching the detector at all. Counted as dropped:
      // the frame reached the pipeline and produced no inference, which is what
      // the droppedFrames column measures. The PWA counts the same event, so the
      // column means the same thing in both datasets — see docs/pwa-followups.md #8.
      // Sampled before the check so every camera frame contributes and the
      // mean divider is time-weighted, matching the PWA.
      const skip = frameSkip.value;
      frameSkipSum.value += skip;
      frameSkipFrames.value += 1;
      if (skip > frameSkipMax.value) {
        frameSkipMax.value = skip;
      }

      if (frameCounter.value % skip !== 0) {
        frame.dispose();
        droppedFrames.value += 1;
        droppedGovernor.value += 1;
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
          // Quality signals, read from the detection MediaPipe just produced.
          // The PWA reads these from the smoothed DTO because that is what it
          // draws; here the smoothing happens downstream on the UI runtime, so
          // these are the raw values. Documented in METRICS.md — the jitter
          // figures are therefore pre-smoothing on native and post-smoothing in
          // the PWA, and must not be compared without saying so.
          let gestureSum = previous.gestureConfidenceSum;
          let gestureCount = previous.gestureConfidenceCount;
          for (const hand of detection.hands) {
            if (hand.gestureScore !== undefined) {
              gestureSum += hand.gestureScore;
              gestureCount += 1;
            }
          }

          // NF7 — the same state machine the PWA runs in recordFrameEnd, at
          // the same granularity. `detected` is raw detector output, which is
          // also what the PWA counts (its grace is excluded from the metrics
          // via rawFaceCount/rawHandCount).
          const detected = detection.faceCount + detection.handCount > 0;
          let lostEvents = previous.lostEvents;
          let recoverySumMs = previous.recoverySumMs;
          let recoveryCount = previous.recoveryCount;
          if (trackingValid.value && !detected) {
            lostEvents += 1;
            lostAtMs.value = finishedAt;
            consecutiveLoss.value = 1;
          } else if (!trackingValid.value && detected && lostAtMs.value > 0) {
            recoverySumMs += finishedAt - lostAtMs.value;
            recoveryCount += 1;
            lostAtMs.value = 0;
            consecutiveLoss.value = 0;
          } else if (!detected) {
            consecutiveLoss.value += 1;
          } else {
            consecutiveLoss.value = 0;
          }
          trackingValid.value = detected;

          let blendSum = previous.blendshapeActivationSum;
          let blendCount = previous.blendshapeActivationCount;
          const shapes = new Float32Array(detection.blendshapes);
          if (shapes.length > 0) {
            let top = 0;
            for (let i = 0; i < shapes.length; i++) {
              if (shapes[i] > top) top = shapes[i];
            }
            blendSum += top;
            blendCount += 1;
          }

          let deltaSum = previous.landmarkDeltaSum;
          let deltaCount = previous.landmarkDeltaCount;
          if (detection.faceCount > 0) {
            const values = new Float32Array(detection.landmarks);
            const at = NOSE_TIP_INDEX * VALUES_PER_POINT;
            const nx = values[at];
            const ny = values[at + 1];
            if (lastNoseX.value >= 0) {
              const dx = nx - lastNoseX.value;
              const dy = ny - lastNoseY.value;
              deltaSum += Math.sqrt(dx * dx + dy * dy);
              deltaCount += 1;
            }
            lastNoseX.value = nx;
            lastNoseY.value = ny;
          } else {
            // Tracking lost: the next delta would measure re-acquisition.
            lastNoseX.value = -1;
          }

          stats.value = {
            frames: previous.frames + 1,
            intervalSamples: [...previous.intervalSamples, interval],
            inferenceSamples: [...previous.inferenceSamples, detection.inferenceTimeMs],
            gestureConfidenceSum: gestureSum,
            gestureConfidenceCount: gestureCount,
            blendshapeActivationSum: blendSum,
            blendshapeActivationCount: blendCount,
            landmarkDeltaSum: deltaSum,
            landmarkDeltaCount: deltaCount,
            intervalSumMs: previous.intervalSumMs + interval,
            minIntervalMs:
              interval > 0 ? Math.min(previous.minIntervalMs || interval, interval) : previous.minIntervalMs,
            maxIntervalMs: Math.max(previous.maxIntervalMs, interval),
            inferenceSumMs: previous.inferenceSumMs + detection.inferenceTimeMs,
            processingSumMs: previous.processingSumMs + (finishedAt - startedAt),
            facesSum: previous.facesSum + detection.faceCount,
            handsSum: previous.handsSum + detection.handCount,
            trackedFrames: previous.trackedFrames + (detected ? 1 : 0),
            lostEvents,
            recoverySumMs,
            recoveryCount,
            consecutiveLossMax: Math.max(
              previous.consecutiveLossMax,
              consecutiveLoss.value,
            ),
            lastAtMs: finishedAt,
            firstTrackedAtMs:
              previous.firstTrackedAtMs > 0
                ? previous.firstTrackedAtMs
                : detected
                  ? finishedAt
                  : 0,
          };
        } catch {
          // Counted rather than rethrown: the async runner has nowhere to
          // surface a throw, and an uncounted failure is indistinguishable from
          // a frame that simply found nothing.
          detectErrors.value += 1;
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
        droppedBusy.value += 1;
      }
    },
  });

  // NF7 dropout grace and F9 smoothing both run on Reanimated's UI runtime,
  // which — unlike the async runner's runtime — does unpack imported worklets.
  // Order matches the PWA: detect, then grace, then smooth.
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

      const smoothed = applySmoothing(smoothState.value, graced.result, smoothingConfig.value);
      smoothState.value = smoothed.state;
      latest.value = smoothed.result;
    },
  );

  const start = useCallback(() => {
    detector.configure({
      mode: options.mode,
      maxFaces: 1,
      maxHands: 2,
      useGpu: options.gpuDelegateEnabled,
    });
    tracker.start();
    // The models are built lazily inside the first detect(), so their load
    // time and the delegate actually built are only known once a frame has
    // been processed. drainPending() records both after the first batch;
    // reading them here returned zero or the previous session's values.
    engineStateRecorded.current = false;
    tracker.setRunConditions({
      // Provisional. Landmarks and the 2D filters are drawn by Skia and the
      // crown by three.js on WebGPU, so which applies depends on what the
      // session draws; CameraScreen replaces this at submission with
      // drawnRenderBackend().
      renderBackend: 'skia',
      inferenceThreading: 'async-runner',
      // F9/F15 — both move the numbers, so both are submitted with them.
      smoothingEnabled: options.smoothingEnabled,
      dynamicInferenceEnabled: options.dynamicInferenceEnabled,
      // The delegate *request*. `gpuDelegateActive` records what the engine
      // reported building, which is unreliable on every arm, so it cannot
      // identify a run made with the delegate off.
      gpuDelegateEnabled: options.gpuDelegateEnabled,
    });
    graceState.value = emptyGraceState();
    smoothState.value = emptySmoothingState();
    droppedFrames.value = 0;
    trackingValid.value = false;
    lostAtMs.value = 0;
    consecutiveLoss.value = 0;
    droppedGovernor.value = 0;
    droppedBusy.value = 0;
    frameSkipSum.value = 0;
    frameSkipFrames.value = 0;
    frameSkipMax.value = 0;
    governor.reset();
    frameCounter.value = 0;
    frameSkip.value = 1;
    stats.value = emptyStats();
    running.value = true;
    setIsRunning(true);
  }, [
    detector,
    options.mode,
    options.smoothingEnabled,
    options.dynamicInferenceEnabled,
    options.gpuDelegateEnabled,
    tracker,
    governor,
    frameCounter,
    frameSkip,
    running,
    graceState,
    smoothState,
    trackingValid,
    lostAtMs,
    consecutiveLoss,
    droppedFrames,
    droppedGovernor,
    droppedBusy,
    frameSkipSum,
    frameSkipFrames,
    frameSkipMax,
    stats,
  ]);

  /**
   * Move everything the worklet has accumulated since the last drain onto the
   * tracker. Called by the metrics tick and by stop(): without the call in
   * stop(), up to one tick of frames, drops and detection errors was never
   * recorded, while the session duration still counted that time (thesis
   * audit, 2026-10-28).
   */
  const drainPending = useCallback(() => {
    // Drain the worklet's measurements onto the tracker.
    const batch = stats.value;
    if (batch.frames > 0) {
      tracker.recordBatch(batch);
      stats.value = {...emptyStats(), lastAtMs: batch.lastAtMs};
      if (!engineStateRecorded.current) {
        tracker.setModelLoadTime(detector.modelLoadTimeMs);
        tracker.setGpuDelegateActive(detector.gpuDelegateActive);
        engineStateRecorded.current = true;
      }
    }
    // Drain the worklet's dropped-frame counters onto the tracker, by cause.
    if (droppedGovernor.value > 0) {
      tracker.recordDroppedFrame('governor', droppedGovernor.value);
      droppedGovernor.value = 0;
    }
    if (droppedBusy.value > 0) {
      tracker.recordDroppedFrame('busy', droppedBusy.value);
      droppedBusy.value = 0;
    }
    droppedFrames.value = 0;
    // Drain the F15 skip samples.
    if (frameSkipFrames.value > 0) {
      tracker.recordFrameSkipBatch(
        frameSkipSum.value,
        frameSkipFrames.value,
        frameSkipMax.value,
      );
      frameSkipSum.value = 0;
      frameSkipFrames.value = 0;
      frameSkipMax.value = 0;
    }
    // Drain the worklet's detection-failure counter onto the tracker.
    if (detectErrors.value > 0) {
      for (let i = 0; i < detectErrors.value; i++) {
        tracker.recordError();
      }
      detectErrors.value = 0;
    }
    const size = frameSize.value;
    if (size.width > 0) {
      tracker.setRunConditions({frameWidth: size.width, frameHeight: size.height});
    }
  }, [
    tracker,
    detector,
    stats,
    droppedFrames,
    droppedGovernor,
    droppedBusy,
    frameSkipSum,
    frameSkipFrames,
    frameSkipMax,
    detectErrors,
    frameSize,
  ]);

  const stop = useCallback((): PerformanceMetricsDTO | undefined => {
    drainPending();
    const final = tracker.getMetrics(getNativeMetrics());
    running.value = false;
    setIsRunning(false);
    try {
      detector.release();
    } catch {
      // Releasing a detector that never configured is not an error.
    }
    graceState.value = emptyGraceState();
    smoothState.value = emptySmoothingState();
    governor.reset();
    latest.value = null;
    setMetrics(null);
    return final;
  }, [detector, tracker, governor, latest, running, graceState, smoothState, drainPending]);

  /**
   * Begin a new measurement window without interrupting the camera. Used on a
   * filter toggle so each filter combination is submitted as its own session.
   */
  const resetSession = useCallback(() => {
    tracker.reset();
    smoothState.value = emptySmoothingState();
    setMetrics(tracker.getMetrics(getNativeMetrics()));
  }, [tracker, smoothState]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const id = setInterval(() => {
      drainPending();
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
  }, [isRunning, tracker, governor, frameSkip, drainPending]);

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
