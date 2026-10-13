import type {PerformanceMetricsDTO} from '../domain/tracking.dto';
import type {NativeMetricsSnapshot} from '../metrics/nativeMetrics';
import {getAppStartupMs} from '../config/startup';

/**
 * Collects the measurements the thesis reports.
 *
 * Metric definitions are inherited from master-prj-pwa without modification —
 * a difference in definition would be indistinguishable from a difference in
 * performance. In particular: the 30-frame warmup gate, min/max fps resetting
 * at warmup end, `fps` from mean frame time vs `avgFps` from the session, and
 * battery/memory deltas measured from the first sample of the session.
 *
 * Differences from the PWA version, all platform-driven:
 *  - `Date.now()` instead of `performance.now()` (no browser global; also makes
 *    the tests deterministic under fake timers).
 *  - Hardware fields come from a NativeMetricsSnapshot argument rather than
 *    browser APIs.
 *  - `recordDroppedFrame()` exists: on this platform a dropped frame is an
 *    observed event (the async runner reported busy), not an estimate.
 */
export const WARMUP_FRAMES = 30;
const BUFFER_SIZE = 60;

/** O(1) circular buffer — avoids the O(n) array.shift() of a naive window. */
/**
 * Every sample of one session, for percentiles.
 *
 * The CircularBuffer below is a 60-sample rolling window — right for the live
 * HUD, wrong for a session summary. Mirrors the PWA's SampleSeries exactly,
 * including nearest-rank percentiles, so the two report the same statistic.
 */
class SampleSeries {
  private samples: number[] = [];

  push(value: number): void {
    this.samples.push(value);
  }

  reset(): void {
    this.samples = [];
  }

  get mean(): number | undefined {
    if (this.samples.length === 0) return undefined;
    let total = 0;
    for (const v of this.samples) total += v;
    return total / this.samples.length;
  }

  /** Nearest-rank, so a reported p95 is a value that actually occurred. */
  percentile(p: number): number | undefined {
    if (this.samples.length === 0) return undefined;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil(p * sorted.length);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
  }
}

class CircularBuffer {
  private buffer: Float64Array;
  private index = 0;
  private count = 0;
  private sum = 0;

  constructor(size: number) {
    this.buffer = new Float64Array(size);
  }

  push(value: number): void {
    if (this.count === this.buffer.length) {
      this.sum -= this.buffer[this.index];
    } else {
      this.count++;
    }
    this.buffer[this.index] = value;
    this.sum += value;
    this.index = (this.index + 1) % this.buffer.length;
  }

  average(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  last(): number {
    if (this.count === 0) {
      return 0;
    }
    return this.buffer[(this.index - 1 + this.buffer.length) % this.buffer.length];
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
  }
}

export class PerformanceTracker {
  private startTime = 0;
  private frameCount = 0;
  private droppedFrames = 0;
  private trackingLostCount = 0;
  private lastFrameTime = 0;
  private warmupComplete = false;
  private lastTrackingValid = false;

  // Session-wide series, for the percentiles submitted with the session.
  private inferenceSeries = new SampleSeries();
  private frameIntervalSeries = new SampleSeries();
  // Detection quality, accumulated from the worklet's drains.
  private gestureConfidenceSum = 0;
  private gestureConfidenceCount = 0;
  private blendshapeActivationSum = 0;
  private blendshapeActivationCount = 0;
  // F15 governor behaviour, drained from the worklet's shared counters.
  private frameSkipSum = 0;
  private frameSkipCount = 0;
  private frameSkipMax = 0;
  private droppedFramesGovernor = 0;
  private droppedFramesBusy = 0;
  private landmarkDeltaSum = 0;
  private landmarkDeltaCount = 0;
  private appStartupMs?: number;

  private frameTimes = new CircularBuffer(BUFFER_SIZE);
  private inferenceTimes = new CircularBuffer(BUFFER_SIZE);
  private processingTimes = new CircularBuffer(BUFFER_SIZE);

  private minFps = Infinity;
  private maxFps = 0;

  private totalFacesDetected = 0;
  private totalHandsDetected = 0;
  private detectionFrameCount = 0;

  private peakMemoryUsageMB = 0;
  private memoryUsageStartMB: number | undefined;
  private batteryLevelStart: number | undefined;
  private errorCount = 0;

  private trackingLostTime = 0;
  private totalRecoveryTimeMs = 0;
  private recoveryCount = 0;
  private currentConsecutiveLoss = 0;
  private consecutiveTrackingLossMax = 0;

  private modelLoadTimeMs: number | undefined;
  private gpuDelegateActive: boolean | undefined;

  /** NF3 — wall clock of the first frame that produced a detection. */
  private firstDetectionAtMs: number | undefined;
  /** Run conditions, set once per session by the caller. */
  private runConditions: {
    frameWidth?: number;
    frameHeight?: number;
    renderBackend?: string;
    inferenceThreading?: string;
    smoothingEnabled?: boolean;
    gpuDelegateEnabled?: boolean;
    dynamicInferenceEnabled?: boolean;
  } = {};

  private clearCounters(): void {
    this.startTime = Date.now();
    this.lastFrameTime = this.startTime;
    this.frameCount = 0;
    this.droppedFrames = 0;
    this.trackingLostCount = 0;
    this.warmupComplete = false;
    this.lastTrackingValid = false;
    this.minFps = Infinity;
    this.maxFps = 0;
    this.frameTimes.reset();
    this.inferenceTimes.reset();
    this.processingTimes.reset();
    this.totalFacesDetected = 0;
    this.totalHandsDetected = 0;
    this.detectionFrameCount = 0;
    this.peakMemoryUsageMB = 0;
    this.memoryUsageStartMB = undefined;
    this.batteryLevelStart = undefined;
    this.errorCount = 0;
    this.inferenceSeries.reset();
    this.frameIntervalSeries.reset();
    this.gestureConfidenceSum = 0;
    this.gestureConfidenceCount = 0;
    this.blendshapeActivationSum = 0;
    this.blendshapeActivationCount = 0;
    this.frameSkipSum = 0;
    this.frameSkipCount = 0;
    this.frameSkipMax = 0;
    this.droppedFramesGovernor = 0;
    this.droppedFramesBusy = 0;
    this.landmarkDeltaSum = 0;
    this.landmarkDeltaCount = 0;
    this.trackingLostTime = 0;
    this.totalRecoveryTimeMs = 0;
    this.recoveryCount = 0;
    this.currentConsecutiveLoss = 0;
    this.consecutiveTrackingLossMax = 0;
    this.firstDetectionAtMs = undefined;
  }

  start(): void {
    this.clearCounters();
    // NF3. Read rather than accumulated: it is a property of the launch, so it
    // is the same value for every session in this process — which is also true
    // of the PWA's navigation timing.
    this.appStartupMs = getAppStartupMs();
  }

  /**
   * Start a new measurement window without tearing down the session — used when
   * a filter is toggled, so each filter combination is its own submitted session.
   * Unlike start(), this also forgets the model load time: it belongs to the
   * window in which the models were actually loaded.
   */
  reset(): void {
    this.clearCounters();
    this.modelLoadTimeMs = undefined;
  }

  setModelLoadTime(timeMs: number): void {
    this.modelLoadTimeMs = timeMs;
  }

  setGpuDelegateActive(active: boolean): void {
    this.gpuDelegateActive = active;
  }

  /**
   * NF4 — the conditions this session ran under. Without them two rows that
   * differ only in capture resolution are indistinguishable in the dataset.
   */
  setRunConditions(conditions: {
    frameWidth?: number;
    frameHeight?: number;
    renderBackend?: string;
    inferenceThreading?: string;
    smoothingEnabled?: boolean;
    gpuDelegateEnabled?: boolean;
    dynamicInferenceEnabled?: boolean;
  }): void {
    this.runConditions = {...this.runConditions, ...conditions};
  }

  recordError(): void {
    this.errorCount++;
  }

  /**
   * A camera frame that reached the pipeline and produced no inference.
   *
   * The cause is required rather than defaulted: "the governor skipped it" and
   * "the device could not keep up" are opposite findings, and a wrong default
   * would silently attribute one to the other. `droppedFrames` stays the total.
   */
  recordDroppedFrame(cause: 'governor' | 'busy', count = 1): void {
    this.droppedFrames += count;
    if (cause === 'governor') {
      this.droppedFramesGovernor += count;
    } else {
      this.droppedFramesBusy += count;
    }
  }

  /**
   * F15 — skip samples drained from the worklet. Batched rather than per-frame
   * because the samples are accumulated on the camera runtime and handed over
   * on the metrics tick; the arithmetic is identical to the PWA's per-frame
   * call, which runs on the only thread that app has.
   */
  recordFrameSkipBatch(sum: number, count: number, max: number): void {
    if (count <= 0) return;
    this.frameSkipSum += sum;
    this.frameSkipCount += count;
    if (max > this.frameSkipMax) this.frameSkipMax = max;
  }

  recordDetection(facesCount: number, handsCount: number): void {
    this.totalFacesDetected += facesCount;
    this.totalHandsDetected += handsCount;
    this.detectionFrameCount++;
  }

  /**
   * Record a batch of frames measured on the worklet runtime.
   *
   * Detection runs on the async-runner thread, where a JS class instance has no
   * methods, so the frame loop accumulates raw numbers into SharedValues and
   * hands them over here on the metrics tick. Semantics match the per-frame
   * path: the same circular buffers, the same warmup gate.
   */
  recordBatch(batch: {
    frames: number;
    intervalSumMs: number;
    minIntervalMs: number;
    maxIntervalMs: number;
    inferenceSumMs: number;
    processingSumMs: number;
    facesSum: number;
    handsSum: number;
    trackedFrames: number;
    /** NF7, counted per frame in the worklet; see the note in FrameStats. */
    lostEvents?: number;
    recoverySumMs?: number;
    recoveryCount?: number;
    consecutiveLossMax?: number;
    /** NF3 — clock of the first detecting frame in this batch, or 0. */
    firstTrackedAtMs?: number;
    /** Per-frame samples; see the note in useTracking's FrameStats. */
    intervalSamples?: number[];
    inferenceSamples?: number[];
    gestureConfidenceSum?: number;
    gestureConfidenceCount?: number;
    blendshapeActivationSum?: number;
    blendshapeActivationCount?: number;
    landmarkDeltaSum?: number;
    landmarkDeltaCount?: number;
  }): void {
    if (batch.frames <= 0) {
      return;
    }

    const meanInterval = batch.intervalSumMs / batch.frames;
    const meanInference = batch.inferenceSumMs / batch.frames;
    const meanProcessing = batch.processingSumMs / batch.frames;

    for (let i = 0; i < batch.frames; i++) {
      this.frameTimes.push(meanInterval);
      this.inferenceTimes.push(meanInference);
      this.processingTimes.push(meanProcessing);
    }

    // The rolling buffers above take batch means, which is fine for the live
    // HUD. The percentiles must not: averaging is what removes the spikes they
    // exist to show, so they take the individual samples the worklet carried.
    for (const sample of batch.intervalSamples ?? []) {
      if (sample > 0) this.frameIntervalSeries.push(sample);
    }
    for (const sample of batch.inferenceSamples ?? []) {
      this.inferenceSeries.push(sample);
    }

    this.gestureConfidenceSum += batch.gestureConfidenceSum ?? 0;
    this.gestureConfidenceCount += batch.gestureConfidenceCount ?? 0;
    this.blendshapeActivationSum += batch.blendshapeActivationSum ?? 0;
    this.blendshapeActivationCount += batch.blendshapeActivationCount ?? 0;
    this.landmarkDeltaSum += batch.landmarkDeltaSum ?? 0;
    this.landmarkDeltaCount += batch.landmarkDeltaCount ?? 0;

    if (this.firstDetectionAtMs === undefined && (batch.firstTrackedAtMs ?? 0) > 0) {
      this.firstDetectionAtMs = batch.firstTrackedAtMs;
    }

    this.frameCount += batch.frames;
    this.totalFacesDetected += batch.facesSum;
    this.totalHandsDetected += batch.handsSum;
    this.detectionFrameCount += batch.frames;

    if (!this.warmupComplete && this.frameCount >= WARMUP_FRAMES) {
      this.warmupComplete = true;
      this.minFps = Infinity;
      this.maxFps = 0;
    }

    if (this.warmupComplete) {
      // Extremes come from the real per-frame intervals, not the batch mean.
      if (batch.maxIntervalMs > 0) {
        this.minFps = Math.min(this.minFps, 1000 / batch.maxIntervalMs);
      }
      if (batch.minIntervalMs > 0) {
        this.maxFps = Math.max(this.maxFps, 1000 / batch.minIntervalMs);
      }
    }

    // NF7 — taken from the worklet, which runs the state machine per frame.
    // Deriving it here from `trackedFrames === 0` would have meant "no
    // detection anywhere in the 500 ms drain window", so a brief dropout that
    // the PWA counts as one loss registered as none at all on native. The two
    // columns were measuring different events; now they measure the same one.
    this.trackingLostCount += batch.lostEvents ?? 0;
    this.totalRecoveryTimeMs += batch.recoverySumMs ?? 0;
    this.recoveryCount += batch.recoveryCount ?? 0;
    this.consecutiveTrackingLossMax = Math.max(
      this.consecutiveTrackingLossMax,
      batch.consecutiveLossMax ?? 0,
    );
    this.lastTrackingValid = batch.trackedFrames > 0;
  }

  recordFrameStart(): number {
    return Date.now();
  }

  /**
   * NF4 — end-to-end: frame in hand to landmarks ready, including this
   * platform's own image conversion. The PWA brackets the same span.
   */
  recordInferenceTime(startTime: number): void {
    this.inferenceTimes.push(Date.now() - startTime);
  }

  /**
   * **Not on this app's production path.** The camera pipeline drains batched
   * frame statistics from the worklet through `recordBatch`; nothing calls this,
   * `recordFrameStart`, `recordDetection`, `recordInferenceTime` or
   * `recordInferenceMs` outside the tests.
   *
   * They are kept because they define the per-frame semantics the PWA uses and
   * the batch path has to reproduce, so the tests over them document the
   * contract. Treat a test that only exercises this method as evidence about
   * the contract, **not** about what the app does — that assumption is exactly
   * how the NF7 counting defect survived: this method had the correct per-frame
   * tracking-loss logic while the batch path the app actually ran derived loss
   * per 500 ms drain instead.
   *
   * The NF7 state machine has therefore been removed from here and lives in one
   * place only: the worklet in `useTracking.ts`, which is what runs.
   */
  recordFrameEnd(frameStart: number, hasTracking: boolean): void {
    const now = Date.now();
    this.processingTimes.push(now - frameStart);
    this.frameCount++;

    if (hasTracking && this.firstDetectionAtMs === undefined) {
      this.firstDetectionAtMs = now;
    }

    const frameTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (frameTime > 0) {
      this.frameTimes.push(frameTime);
      if (this.warmupComplete) {
        const fps = 1000 / frameTime;
        this.minFps = Math.min(this.minFps, fps);
        this.maxFps = Math.max(this.maxFps, fps);
      }
    }

    // NF7 accounting deliberately absent — see the note above. One
    // implementation, in the worklet, on the path the app actually runs.
    this.lastTrackingValid = hasTracking;

    if (!this.warmupComplete && this.frameCount >= WARMUP_FRAMES) {
      // Warmup absorbs model load, JIT and GPU pipeline setup; discard the
      // extremes measured during it so they do not bias the reported range.
      this.warmupComplete = true;
      this.minFps = Infinity;
      this.maxFps = 0;
    }
  }

  /** Rounding matches the PWA exactly so both datasets carry the same precision. */
  private static round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  getMetrics(native: NativeMetricsSnapshot = {}): PerformanceMetricsDTO {
    const now = Date.now();
    const sessionDurationMs = now - this.startTime;
    const avgFrameTime = this.frameTimes.average();
    const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    const avgFps = sessionDurationMs > 0 ? (this.frameCount * 1000) / sessionDurationMs : 0;

    if (native.memoryUsedMB !== undefined) {
      this.memoryUsageStartMB ??= native.memoryUsedMB;
      this.peakMemoryUsageMB = Math.max(this.peakMemoryUsageMB, native.memoryUsedMB);
    }
    if (native.batteryLevel !== undefined) {
      this.batteryLevelStart ??= native.batteryLevel;
    }

    const memoryDeltaMB =
      native.memoryUsedMB !== undefined && this.memoryUsageStartMB !== undefined
        ? native.memoryUsedMB - this.memoryUsageStartMB
        : undefined;
    // Positive means consumed.
    const batteryDeltaPercent =
      native.batteryLevel !== undefined && this.batteryLevelStart !== undefined
        ? this.batteryLevelStart - native.batteryLevel
        : undefined;

    const r = PerformanceTracker.round;
    /** Rounds a value that may be absent — a missing metric stays missing. */
    const opt = (v: number | undefined, digits: number) =>
      v === undefined ? undefined : r(v, digits);
    return {
      fps: r(fps, 1),
      avgFps: r(avgFps, 1),
      minFps: this.minFps === Infinity ? null : r(this.minFps, 1),
      maxFps: this.maxFps === 0 ? null : r(this.maxFps, 1),
      inferenceTimeMs: r(this.inferenceTimes.last(), 2),
      avgInferenceTimeMs: r(this.inferenceTimes.average(), 2),
      frameProcessingTimeMs: r(this.processingTimes.last(), 2),
      avgFrameProcessingTimeMs: r(this.processingTimes.average(), 2),

      memoryUsageMB:
        native.memoryUsedMB !== undefined ? r(native.memoryUsedMB, 1) : undefined,
      totalMemoryMB: native.totalMemoryMB,
      availableMemoryMB: native.availableMemoryMB,
      peakMemoryUsageMB: this.peakMemoryUsageMB > 0 ? r(this.peakMemoryUsageMB, 1) : undefined,
      memoryUsageStartMB:
        this.memoryUsageStartMB !== undefined ? r(this.memoryUsageStartMB, 1) : undefined,
      memoryUsageEndMB: native.memoryUsedMB !== undefined ? r(native.memoryUsedMB, 1) : undefined,
      memoryDeltaMB: memoryDeltaMB !== undefined ? r(memoryDeltaMB, 1) : undefined,

      cpuUsagePercent: native.cpuUsagePercent,
      cpuCores: native.cpuCores,
      threadCount: native.threadCount,

      gpuVendor: native.gpuVendor,
      gpuRenderer: native.gpuRenderer,
      gpuDelegateActive: this.gpuDelegateActive,

      thermalState: native.thermalState,

      batteryLevel: native.batteryLevel,
      batteryCharging: native.batteryCharging,
      batteryLevelStart: this.batteryLevelStart,
      batteryLevelEnd: native.batteryLevel,
      batteryDeltaPercent:
        batteryDeltaPercent !== undefined ? r(batteryDeltaPercent, 2) : undefined,

      facesDetectedAvg:
        this.detectionFrameCount > 0
          ? r(this.totalFacesDetected / this.detectionFrameCount, 2)
          : undefined,
      handsDetectedAvg:
        this.detectionFrameCount > 0
          ? r(this.totalHandsDetected / this.detectionFrameCount, 2)
          : undefined,
      detectionRate:
        sessionDurationMs > 0
          ? r((this.detectionFrameCount * 1000) / sessionDurationMs, 1)
          : undefined,

      modelLoadTimeMs: this.modelLoadTimeMs,

      frameCount: this.frameCount,
      droppedFrames: this.droppedFrames,
      sessionDurationMs,
      warmupComplete: this.warmupComplete,
      trackingLostCount: this.trackingLostCount,

      trackingRecoveryTimeMs:
        this.recoveryCount > 0 ? Math.round(this.totalRecoveryTimeMs / this.recoveryCount) : undefined,
      // NULL rather than 0 when nothing happened, matching the PWA. AVG() treats
      // the two differently, so a mismatch here silently skews any aggregate that
      // mixes platforms.
      consecutiveTrackingLossMax:
        this.consecutiveTrackingLossMax > 0 ? this.consecutiveTrackingLossMax : undefined,
      errorCount: this.errorCount > 0 ? this.errorCount : undefined,

      // Run conditions
      frameWidth: this.runConditions.frameWidth,
      frameHeight: this.runConditions.frameHeight,
      renderBackend: this.runConditions.renderBackend,
      inferenceThreading: this.runConditions.inferenceThreading,
      smoothingEnabled: this.runConditions.smoothingEnabled,
      dynamicInferenceEnabled: this.runConditions.dynamicInferenceEnabled,
      gpuDelegateEnabled: this.runConditions.gpuDelegateEnabled,
      timeToFirstDetectionMs:
        this.firstDetectionAtMs !== undefined
          ? r(this.firstDetectionAtMs - this.startTime, 1)
          : undefined,

      // Distribution over the whole session, from per-frame samples.
      inferenceTimeP50Ms: opt(this.inferenceSeries.percentile(0.5), 1),
      inferenceTimeP95Ms: opt(this.inferenceSeries.percentile(0.95), 1),
      inferenceTimeP99Ms: opt(this.inferenceSeries.percentile(0.99), 1),
      frameIntervalP50Ms: opt(this.frameIntervalSeries.percentile(0.5), 1),
      frameIntervalP95Ms: opt(this.frameIntervalSeries.percentile(0.95), 1),
      frameIntervalP99Ms: opt(this.frameIntervalSeries.percentile(0.99), 1),

      // Render time is deliberately absent here, not merely unimplemented.
      // The PWA has one imperative draw call to bracket; this app renders
      // declaratively through Skia and Reanimated on the UI runtime, where
      // there is no equivalent point to time. Emitting a number measured a
      // different way would be worse than emitting none — it would invite a
      // comparison the measurement cannot support. See METRICS.md.
      avgRenderTimeMs: undefined,
      renderTimeP95Ms: undefined,

      appStartupMs: opt(this.appStartupMs, 1),

      avgFrameSkip:
        this.frameSkipCount > 0
          ? Math.round((this.frameSkipSum / this.frameSkipCount) * 100) / 100
          : undefined,
      maxFrameSkip: this.frameSkipCount > 0 ? this.frameSkipMax : undefined,
      droppedFramesGovernor: this.droppedFramesGovernor,
      droppedFramesBusy: this.droppedFramesBusy,

      avgGestureConfidence:
        this.gestureConfidenceCount > 0
          ? r(this.gestureConfidenceSum / this.gestureConfidenceCount, 3)
          : undefined,
      avgBlendshapeActivation:
        this.blendshapeActivationCount > 0
          ? r(this.blendshapeActivationSum / this.blendshapeActivationCount, 3)
          : undefined,
      landmarkStability:
        this.landmarkDeltaCount > 0
          ? r(this.landmarkDeltaSum / this.landmarkDeltaCount, 5)
          : undefined,
    };
  }
}
