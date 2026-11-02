import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {CommonResolutions, useFrameOutput} from 'react-native-vision-camera';
import {useNewestFrameRunner} from './newestFrameRunner';
// Shared values are Reanimated's API; react-native-worklets is the runtime beneath it.
import {useAnimatedReaction, useSharedValue} from 'react-native-reanimated';
import {createSynchronizable} from 'react-native-worklets';
import {NitroModules} from 'react-native-nitro-modules';
import {createLandmarkDetector} from 'tracking-native';
import type {PerformanceMetricsDTO, TrackingMode} from '../domain/tracking.dto';
import {VALUES_PER_POINT, type RawDetection} from '../native/landmarkFormat';

/** MediaPipe face-mesh nose tip — the landmark used as the jitter reference. */
const NOSE_TIP_INDEX = 1;
import {getNativeMetrics} from '../metrics/nativeMetrics';
import {DEFAULT_SMOOTHING_CONFIG} from './LandmarkSmoother';
import {applyDropoutGrace, emptyGraceState} from './dropoutGrace';
import {applySmoothing, emptySmoothingState} from './packedSmoothing';
import {PerformanceTracker} from './PerformanceTracker';

/** The only periodic React state update in the app. */
const METRICS_INTERVAL_MS = 500;

/**
 * What the detection worklet has measured since the run began.
 *
 * Cumulative, and written by the runner's two worklets alone; the metrics
 * tick only reads it and records the difference from the copy it read last
 * time (statsDelta). Held in a Synchronizable, not a shared value.
 *
 * Both choices fix the same defect, measured on 2026-11-01 against counters
 * nothing reset: the Pixel 7 submitted 150 of 181 processed frames and the
 * iPhone 371 of 323. Two things lost or doubled frames:
 *  - The tick reset the figures itself after reading them, racing the worklet
 *    on its own thread. A frame finishing between the read and the reset was
 *    lost, and one that had read the figures before the reset wrote an
 *    already drained batch back.
 *  - A shared value lives on the UI runtime, where a worklet's write is queued
 *    and applied later while a read returns at once. A worklet's `x = x + 1`
 *    can therefore read a value whose last write has not landed and overwrite
 *    it, with one writer or several, whenever the UI thread is busy. With
 *    only the first cause fixed, the Pixel still lost 6–8 frames a run.
 * A Synchronizable is held natively behind a lock and is read and written
 * synchronously from any thread.
 */
interface FrameStats {
  /** The run these figures belong to. A new run starts them from zero. */
  runId: number;
  frames: number;
  intervalSumMs: number;
  inferenceSumMs: number;
  processingSumMs: number;
  facesSum: number;
  handsSum: number;
  trackedFrames: number;
  /** Detection failures; see the catch in the detection worklet. */
  errors: number;
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
  lastAtMs: number;
  /** NF3 — clock of the first detecting frame of the run, or 0. */
  firstTrackedAtMs: number;
  /**
   * NF7 state carried from frame to frame: whether the previous frame was
   * tracked, when the current loss began, and how long it has run.
   */
  trackingValid: boolean;
  lostAtMs: number;
  consecutiveLoss: number;
  /** Previous nose-tip position, for the landmark-jitter metric. -1 means none. */
  lastNoseX: number;
  lastNoseY: number;
  /**
   * The last SAMPLE_WINDOW per-frame samples, newest last.
   *
   * The sums above are enough for means, but percentiles taken over batch means
   * understate jitter — averaging is exactly what removes the spikes a user
   * feels. The tick takes the samples added since its last read: about 15 at
   * 500 ms, so the window only overflows if the JS thread stalls for seconds,
   * which would cost percentile samples but never the sums.
   */
  intervalSamples: number[];
  inferenceSamples: number[];
  /** The loss-run length after each frame, for the per-window maximum (NF7). */
  lossSamples: number[];
  /** Detection quality, summed since the run began — see PerformanceTracker. */
  gestureConfidenceSum: number;
  gestureConfidenceCount: number;
  blendshapeActivationSum: number;
  blendshapeActivationCount: number;
  landmarkDeltaSum: number;
  landmarkDeltaCount: number;
  /**
   * Frames dropped on the runner because a newer one was queued behind them
   * (see newestFrameRunner). Busy drops, like the ones the camera thread
   * counts in CameraTotals, but counted here because only the runner sees them.
   */
  superseded: number;
}

/**
 * Drop accounting from the camera thread, cumulative since the run began,
 * written by the frame callback alone and held in a Synchronizable, for the
 * reasons FrameStats gives.
 *
 * F15 is met by the pipeline itself rather than by a frame-skip governor
 * (removed 2026-11-02): the detector takes the newest frame as soon as it is
 * free (newestFrameRunner), so the inference rate follows what the device
 * sustains. The
 * governor could only lower that rate, because skipping frames makes inference
 * less frequent, not faster. The skip divider is therefore always 1, and
 * `skipSum` and `droppedGovernor` stay so the submitted columns keep their
 * meaning (avgFrameSkip 1, droppedFramesGovernor 0).
 */
interface CameraTotals {
  runId: number;
  /** Camera frames seen while running, and the skip divider summed over them. */
  frames: number;
  skipSum: number;
  droppedGovernor: number;
  droppedBusy: number;
}

const SAMPLE_WINDOW = 128;

const EMPTY_STATS: FrameStats = {
  runId: 0,
  frames: 0,
  intervalSumMs: 0,
  inferenceSumMs: 0,
  processingSumMs: 0,
  facesSum: 0,
  handsSum: 0,
  trackedFrames: 0,
  errors: 0,
  lostEvents: 0,
  recoverySumMs: 0,
  recoveryCount: 0,
  lastAtMs: 0,
  firstTrackedAtMs: 0,
  trackingValid: false,
  lostAtMs: 0,
  consecutiveLoss: 0,
  lastNoseX: -1,
  lastNoseY: -1,
  intervalSamples: [],
  inferenceSamples: [],
  lossSamples: [],
  gestureConfidenceSum: 0,
  gestureConfidenceCount: 0,
  blendshapeActivationSum: 0,
  blendshapeActivationCount: 0,
  landmarkDeltaSum: 0,
  landmarkDeltaCount: 0,
  superseded: 0,
};

const EMPTY_CAMERA_TOTALS: CameraTotals = {
  runId: 0,
  frames: 0,
  skipSum: 0,
  droppedGovernor: 0,
  droppedBusy: 0,
};

/** What `now` adds to `previous`, two reads of one run, as a tracker batch. */
export function statsDelta(previous: FrameStats, now: FrameStats) {
  const frames = now.frames - previous.frames;
  const added = (samples: number[]) => samples.slice(Math.max(0, samples.length - frames));
  const intervals = added(now.intervalSamples);
  const measured = intervals.filter(interval => interval > 0);
  return {
    frames,
    intervalSumMs: now.intervalSumMs - previous.intervalSumMs,
    minIntervalMs: measured.length > 0 ? Math.min(...measured) : 0,
    maxIntervalMs: Math.max(0, ...intervals),
    inferenceSumMs: now.inferenceSumMs - previous.inferenceSumMs,
    processingSumMs: now.processingSumMs - previous.processingSumMs,
    facesSum: now.facesSum - previous.facesSum,
    handsSum: now.handsSum - previous.handsSum,
    trackedFrames: now.trackedFrames - previous.trackedFrames,
    lostEvents: now.lostEvents - previous.lostEvents,
    recoverySumMs: now.recoverySumMs - previous.recoverySumMs,
    recoveryCount: now.recoveryCount - previous.recoveryCount,
    consecutiveLossMax: Math.max(0, ...added(now.lossSamples)),
    firstTrackedAtMs: now.firstTrackedAtMs,
    intervalSamples: intervals,
    inferenceSamples: added(now.inferenceSamples),
    gestureConfidenceSum: now.gestureConfidenceSum - previous.gestureConfidenceSum,
    gestureConfidenceCount: now.gestureConfidenceCount - previous.gestureConfidenceCount,
    blendshapeActivationSum: now.blendshapeActivationSum - previous.blendshapeActivationSum,
    blendshapeActivationCount: now.blendshapeActivationCount - previous.blendshapeActivationCount,
    landmarkDeltaSum: now.landmarkDeltaSum - previous.landmarkDeltaSum,
    landmarkDeltaCount: now.landmarkDeltaCount - previous.landmarkDeltaCount,
  };
}

export interface UseTrackingOptions {
  mode: TrackingMode;
  smoothingEnabled: boolean;
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

  /** Latest detection, read directly by every renderer. */
  const latest = useSharedValue<RawDetection | null>(null);
  /** Raw detector output, before NF7 dropout grace is applied. */
  const latestRaw = useSharedValue<RawDetection | null>(null);
  /** Real frame dimensions, taken from the frames themselves. */
  const frameSize = useSharedValue({width: 0, height: 0});
  /**
   * Synchronizables for the reasons FrameStats gives: a shared value written
   * here reached the camera thread only after the UI thread got to it, up to a
   * second late on the Pixel 7, so after Stop the camera went on processing
   * frames, and on the iPhone called the released detector (2026-11-01).
   */
  const [running] = useState(() => createSynchronizable(false));
  /** Written by start() alone; the worklets start their figures afresh on a new value. */
  const [runId] = useState(() => createSynchronizable(0));

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
  const runner = useNewestFrameRunner();

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
  /** Camera-frame and drop accounting; see CameraTotals. */
  const [cameraTotals] = useState(() => createSynchronizable<CameraTotals>(EMPTY_CAMERA_TOTALS));
  /**
   * Measurements accumulated on the worklet runtime and read by the metrics
   * tick. The tracker itself is a JS object and cannot be called from here.
   */
  const [stats] = useState(() => createSynchronizable<FrameStats>(EMPTY_STATS));
  /** The figures as the tick last read them; the next read records the difference. */
  const lastStats = useRef<FrameStats>(EMPTY_STATS);
  const lastCamera = useRef<CameraTotals>(EMPTY_CAMERA_TOTALS);

  useEffect(() => {
    smoothingConfig.value = {...DEFAULT_SMOOTHING_CONFIG, enabled: options.smoothingEnabled};
  }, [options.smoothingEnabled, smoothingConfig]);

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
      if (!running.getBlocking()) {
        frame.dispose();
        return;
      }

      if (frameSize.value.width !== frame.width) {
        frameSize.value = {width: frame.width, height: frame.height};
      }

      // Only this callback writes cameraTotals; see FrameStats. A new run starts
      // from zero here rather than in start(). The skip divider is always 1;
      // see CameraTotals.
      const run = runId.getBlocking();
      const counts = cameraTotals.getBlocking();
      const totals = counts.runId === run ? counts : {...EMPTY_CAMERA_TOTALS, runId: run};
      const counted = {...totals, frames: totals.frames + 1, skipSum: totals.skipSum + 1};

      const scheduled = runner.submit(
        () => {
          'worklet';
          const startedAt = Date.now();
          // Only the runner's two worklets write stats, and the runner takes one
          // job at a time; see FrameStats. A new run starts from zero here rather than in
          // start(), so a job of the previous run that is still finishing cannot
          // write over the reset. `run` is the run the frame arrived in.
          const stored = stats.getBlocking();
          const previous: FrameStats = stored.runId === run ? stored : {...EMPTY_STATS, runId: run};
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
            let lostAtMs = previous.lostAtMs;
            let consecutiveLoss = previous.consecutiveLoss;
            if (previous.trackingValid && !detected) {
              lostEvents += 1;
              lostAtMs = finishedAt;
              consecutiveLoss = 1;
            } else if (!previous.trackingValid && detected && lostAtMs > 0) {
              recoverySumMs += finishedAt - lostAtMs;
              recoveryCount += 1;
              lostAtMs = 0;
              consecutiveLoss = 0;
            } else if (!detected) {
              consecutiveLoss += 1;
            } else {
              consecutiveLoss = 0;
            }

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
            let lastNoseX = previous.lastNoseX;
            let lastNoseY = previous.lastNoseY;
            if (detection.faceCount > 0) {
              const values = new Float32Array(detection.landmarks);
              const at = NOSE_TIP_INDEX * VALUES_PER_POINT;
              const nx = values[at];
              const ny = values[at + 1];
              if (lastNoseX >= 0) {
                const dx = nx - lastNoseX;
                const dy = ny - lastNoseY;
                deltaSum += Math.sqrt(dx * dx + dy * dy);
                deltaCount += 1;
              }
              lastNoseX = nx;
              lastNoseY = ny;
            } else {
              // Tracking lost: the next delta would measure re-acquisition.
              lastNoseX = -1;
            }

            stats.setBlocking({
              runId: run,
              frames: previous.frames + 1,
              errors: previous.errors,
              intervalSamples: [...previous.intervalSamples.slice(1 - SAMPLE_WINDOW), interval],
              inferenceSamples: [
                ...previous.inferenceSamples.slice(1 - SAMPLE_WINDOW),
                detection.inferenceTimeMs,
              ],
              lossSamples: [...previous.lossSamples.slice(1 - SAMPLE_WINDOW), consecutiveLoss],
              gestureConfidenceSum: gestureSum,
              gestureConfidenceCount: gestureCount,
              blendshapeActivationSum: blendSum,
              blendshapeActivationCount: blendCount,
              landmarkDeltaSum: deltaSum,
              landmarkDeltaCount: deltaCount,
              intervalSumMs: previous.intervalSumMs + interval,
              inferenceSumMs: previous.inferenceSumMs + detection.inferenceTimeMs,
              processingSumMs: previous.processingSumMs + (finishedAt - startedAt),
              facesSum: previous.facesSum + detection.faceCount,
              handsSum: previous.handsSum + detection.handCount,
              trackedFrames: previous.trackedFrames + (detected ? 1 : 0),
              lostEvents,
              recoverySumMs,
              recoveryCount,
              lastAtMs: finishedAt,
              firstTrackedAtMs:
                previous.firstTrackedAtMs > 0
                  ? previous.firstTrackedAtMs
                  : detected
                    ? finishedAt
                    : 0,
              trackingValid: detected,
              lostAtMs,
              consecutiveLoss,
              lastNoseX,
              lastNoseY,
              superseded: previous.superseded,
            });
          } catch {
            // Counted rather than rethrown: the async runner has nowhere to
            // surface a throw, and an uncounted failure is indistinguishable from
            // a frame that simply found nothing. The PWA has always counted
            // these (its engine reports through `onError`); a metric only one
            // platform can report makes that platform look worse for a reason
            // that is not about the platform.
            stats.setBlocking({...previous, errors: previous.errors + 1});
          } finally {
            frame.dispose();
          }
        },
        () => {
          'worklet';
          // A newer frame is queued behind this one, so this one is not worth
          // running: a busy drop, counted on the runner, which alone sees it.
          const stored = stats.getBlocking();
          const previous: FrameStats = stored.runId === run ? stored : {...EMPTY_STATS, runId: run};
          stats.setBlocking({...previous, superseded: previous.superseded + 1});
          frame.dispose();
        },
      );

      if (!scheduled) {
        // NF1 — inference is far behind and the queue is full. Drop this frame
        // and count it honestly rather than queueing more than the device can
        // catch up with.
        frame.dispose();
      }
      cameraTotals.setBlocking({...counted, droppedBusy: totals.droppedBusy + (scheduled ? 0 : 1)});
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
      // F9 moves the numbers, so it is submitted with them. F15's governor
      // was removed (see CameraTotals); the column stays, always false.
      smoothingEnabled: options.smoothingEnabled,
      dynamicInferenceEnabled: false,
      // The delegate *request*. `gpuDelegateActive` records what the engine
      // reported building, which is unreliable on every arm, so it cannot
      // identify a run made with the delegate off.
      gpuDelegateEnabled: options.gpuDelegateEnabled,
    });
    graceState.value = emptyGraceState();
    smoothState.value = emptySmoothingState();
    // The worklets start their figures from zero when they see the new run;
    // until then the tick ignores what they hold.
    const run = runId.getBlocking() + 1;
    lastStats.current = {...EMPTY_STATS, runId: run};
    lastCamera.current = {...EMPTY_CAMERA_TOTALS, runId: run};
    runId.setBlocking(run);
    running.setBlocking(true);
    setIsRunning(true);
  }, [
    detector,
    options.mode,
    options.smoothingEnabled,
    options.gpuDelegateEnabled,
    tracker,
    running,
    runId,
    graceState,
    smoothState,
  ]);

  /**
   * Move everything the worklet has accumulated since the last drain onto the
   * tracker. Called by the metrics tick and by stop(): without the call in
   * stop(), up to one tick of frames, drops and detection errors was never
   * recorded, while the session duration still counted that time (thesis
   * audit, 2026-10-28).
   */
  const drainPending = useCallback(() => {
    // Read, never write: see FrameStats. Figures still belonging to an earlier
    // run are left alone until this run's first frame starts them afresh.
    const now = stats.getBlocking();
    const previous = lastStats.current;
    if (now.runId === previous.runId) {
      const batch = statsDelta(previous, now);
      if (batch.frames > 0) {
        tracker.recordBatch(batch);
        if (!engineStateRecorded.current) {
          tracker.setModelLoadTime(detector.modelLoadTimeMs);
          tracker.setGpuDelegateActive(detector.gpuDelegateActive);
          engineStateRecorded.current = true;
        }
      }
      for (let i = previous.errors; i < now.errors; i++) {
        tracker.recordError();
      }
      if (now.superseded > previous.superseded) {
        tracker.recordDroppedFrame('busy', now.superseded - previous.superseded);
      }
      lastStats.current = now;
    }
    // The dropped-frame counts by cause, and the skip samples (always 1).
    const camera = cameraTotals.getBlocking();
    const before = lastCamera.current;
    if (camera.runId === before.runId) {
      const governorDrops = camera.droppedGovernor - before.droppedGovernor;
      if (governorDrops > 0) {
        tracker.recordDroppedFrame('governor', governorDrops);
      }
      const busyDrops = camera.droppedBusy - before.droppedBusy;
      if (busyDrops > 0) {
        tracker.recordDroppedFrame('busy', busyDrops);
      }
      if (camera.frames > before.frames) {
        tracker.recordFrameSkipBatch(
          camera.skipSum - before.skipSum,
          camera.frames - before.frames,
          1,
        );
      }
      lastCamera.current = camera;
    }
    const size = frameSize.value;
    if (size.width > 0) {
      tracker.setRunConditions({frameWidth: size.width, frameHeight: size.height});
    }
  }, [tracker, detector, stats, cameraTotals, frameSize]);

  const stop = useCallback((): PerformanceMetricsDTO | undefined => {
    // Stop the camera thread first, then take the last reading: the other way
    // round, frames kept arriving while the native metrics were sampled and
    // were left out although they fell inside the session.
    running.setBlocking(false);
    drainPending();
    const final = tracker.getMetrics(getNativeMetrics());
    setIsRunning(false);
    try {
      detector.release();
    } catch {
      // Releasing a detector that never configured is not an error.
    }
    graceState.value = emptyGraceState();
    smoothState.value = emptySmoothingState();
    latest.value = null;
    setMetrics(null);
    return final;
  }, [detector, tracker, latest, running, graceState, smoothState, drainPending]);

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
      setMetrics(tracker.getMetrics(getNativeMetrics()));
    }, METRICS_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRunning, tracker, drainPending]);

  return {
    isRunning,
    frameOutput,
    latest,
    frameSize,
    metrics,
    start,
    stop,
    resetSession,
  };
}
