import type {PerformanceMetricsDTO} from '../domain/tracking.dto';
import type {NativeMetricsSnapshot} from '../metrics/nativeMetrics';

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
    this.trackingLostTime = 0;
    this.totalRecoveryTimeMs = 0;
    this.recoveryCount = 0;
    this.currentConsecutiveLoss = 0;
    this.consecutiveTrackingLossMax = 0;
  }

  start(): void {
    this.clearCounters();
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

  recordError(): void {
    this.errorCount++;
  }

  recordDroppedFrame(): void {
    this.droppedFrames++;
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

    // A batch with no detections at all counts as one tracking-loss event.
    const lost = batch.trackedFrames === 0;
    if (this.lastTrackingValid && lost) {
      this.trackingLostCount++;
      this.currentConsecutiveLoss = batch.frames;
    } else if (lost) {
      this.currentConsecutiveLoss += batch.frames;
    } else {
      this.currentConsecutiveLoss = 0;
    }
    this.consecutiveTrackingLossMax = Math.max(
      this.consecutiveTrackingLossMax,
      this.currentConsecutiveLoss,
    );
    this.lastTrackingValid = !lost;
  }

  recordFrameStart(): number {
    return Date.now();
  }

  /** Measures the MediaPipe call only, matching the PWA's definition. */
  recordInferenceTime(startTime: number): void {
    this.inferenceTimes.push(Date.now() - startTime);
  }

  recordFrameEnd(frameStart: number, hasTracking: boolean): void {
    const now = Date.now();
    this.processingTimes.push(now - frameStart);
    this.frameCount++;

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

    if (this.lastTrackingValid && !hasTracking) {
      this.trackingLostCount++;
      this.trackingLostTime = now;
      this.currentConsecutiveLoss = 1;
    } else if (!this.lastTrackingValid && hasTracking && this.trackingLostTime > 0) {
      this.totalRecoveryTimeMs += now - this.trackingLostTime;
      this.recoveryCount++;
      this.trackingLostTime = 0;
      this.currentConsecutiveLoss = 0;
    } else if (!hasTracking && !this.lastTrackingValid) {
      this.currentConsecutiveLoss++;
      this.consecutiveTrackingLossMax = Math.max(
        this.consecutiveTrackingLossMax,
        this.currentConsecutiveLoss,
      );
    }
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
      peakMemoryUsageMB: this.peakMemoryUsageMB > 0 ? this.peakMemoryUsageMB : undefined,
      memoryUsageStartMB: this.memoryUsageStartMB,
      memoryUsageEndMB: native.memoryUsedMB,
      memoryDeltaMB,

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
      batteryDeltaPercent,

      facesDetectedAvg:
        this.detectionFrameCount > 0
          ? this.totalFacesDetected / this.detectionFrameCount
          : undefined,
      handsDetectedAvg:
        this.detectionFrameCount > 0
          ? this.totalHandsDetected / this.detectionFrameCount
          : undefined,
      detectionRate:
        sessionDurationMs > 0 ? (this.detectionFrameCount * 1000) / sessionDurationMs : undefined,

      modelLoadTimeMs: this.modelLoadTimeMs,

      frameCount: this.frameCount,
      droppedFrames: this.droppedFrames,
      sessionDurationMs,
      warmupComplete: this.warmupComplete,
      trackingLostCount: this.trackingLostCount,

      trackingRecoveryTimeMs:
        this.recoveryCount > 0 ? Math.round(this.totalRecoveryTimeMs / this.recoveryCount) : undefined,
      consecutiveTrackingLossMax: this.consecutiveTrackingLossMax,
      errorCount: this.errorCount,
    };
  }
}
