import {PerformanceTracker, WARMUP_FRAMES} from '../PerformanceTracker';
import type {NativeMetricsSnapshot} from '../../metrics/nativeMetrics';

/** Drive the tracker with a controllable clock. */
function runFrames(
  tracker: PerformanceTracker,
  count: number,
  frameMs: number,
  hasTracking = true,
) {
  for (let i = 0; i < count; i++) {
    const start = tracker.recordFrameStart();
    jest.advanceTimersByTime(frameMs);
    tracker.recordFrameEnd(start, hasTracking);
  }
}

describe('PerformanceTracker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  it('is not warmed up before the warmup window closes (F11)', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, WARMUP_FRAMES - 1, 33);
    expect(t.getMetrics().warmupComplete).toBe(false);
  });

  it('completes warmup at exactly WARMUP_FRAMES frames', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, WARMUP_FRAMES, 33);
    expect(t.getMetrics().warmupComplete).toBe(true);
  });

  it('does not report min/max fps measured during warmup', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, WARMUP_FRAMES, 500); // deliberately terrible warmup frames
    runFrames(t, 10, 33);
    expect(t.getMetrics().minFps!).toBeGreaterThan(10);
  });

  it('reports null min/max fps until warmup completes', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, 5, 33);
    const m = t.getMetrics();
    expect(m.minFps).toBeNull();
    expect(m.maxFps).toBeNull();
  });

  it('counts frames and dropped frames separately', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, 5, 33);
    t.recordDroppedFrame();
    t.recordDroppedFrame();
    const m = t.getMetrics();
    expect(m.frameCount).toBe(5);
    expect(m.droppedFrames).toBe(2);
  });

  it('derives fps from frame time', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, 10, 40); // 40 ms per frame -> 25 fps
    expect(t.getMetrics().fps).toBeCloseTo(25, 1);
  });

  it('records inference time separately from frame time', () => {
    const t = new PerformanceTracker();
    t.start();
    const started = t.recordFrameStart();
    jest.advanceTimersByTime(12);
    t.recordInferenceTime(started);
    expect(t.getMetrics().avgInferenceTimeMs).toBeCloseTo(12, 1);
  });

  it('counts a tracking loss when tracking goes valid to invalid (NF7)', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, 3, 33, true);
    runFrames(t, 3, 33, false);
    expect(t.getMetrics().trackingLostCount).toBe(1);
  });

  it('records the longest consecutive loss streak', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, 1, 33, true);
    runFrames(t, 5, 33, false);
    runFrames(t, 1, 33, true);
    runFrames(t, 2, 33, false);
    expect(t.getMetrics().consecutiveTrackingLossMax!).toBeGreaterThanOrEqual(4);
  });

  it('averages detections per frame', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordDetection(1, 2);
    t.recordDetection(1, 0);
    const m = t.getMetrics();
    expect(m.facesDetectedAvg).toBeCloseTo(1, 5);
    expect(m.handsDetectedAvg).toBeCloseTo(1, 5);
  });

  it('reports the model load time and GPU delegate flag it was given', () => {
    const t = new PerformanceTracker();
    t.start();
    t.setModelLoadTime(412);
    t.setGpuDelegateActive(true);
    const m = t.getMetrics();
    expect(m.modelLoadTimeMs).toBe(412);
    expect(m.gpuDelegateActive).toBe(true);
  });

  it('computes a memory delta from the session baseline', () => {
    const t = new PerformanceTracker();
    t.start();
    t.getMetrics({memoryUsedMB: 100} as NativeMetricsSnapshot);
    const m = t.getMetrics({memoryUsedMB: 140} as NativeMetricsSnapshot);
    expect(m.memoryUsageStartMB).toBeCloseTo(100, 5);
    expect(m.memoryDeltaMB).toBeCloseTo(40, 5);
  });

  it('computes a battery delta as consumption (start - end)', () => {
    const t = new PerformanceTracker();
    t.start();
    t.getMetrics({batteryLevel: 80} as NativeMetricsSnapshot);
    const m = t.getMetrics({batteryLevel: 74} as NativeMetricsSnapshot);
    expect(m.batteryDeltaPercent).toBeCloseTo(6, 5);
  });

  it('tracks peak memory across the session', () => {
    const t = new PerformanceTracker();
    t.start();
    t.getMetrics({memoryUsedMB: 100} as NativeMetricsSnapshot);
    t.getMetrics({memoryUsedMB: 180} as NativeMetricsSnapshot);
    const m = t.getMetrics({memoryUsedMB: 120} as NativeMetricsSnapshot);
    expect(m.peakMemoryUsageMB).toBeCloseTo(180, 5);
  });

  it('clears counters on reset so a filter toggle starts a fresh session', () => {
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, 40, 33);
    t.reset();
    const m = t.getMetrics();
    expect(m.frameCount).toBe(0);
    expect(m.warmupComplete).toBe(false);
    expect(m.trackingLostCount).toBe(0);
  });

  it('counts errors', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordError();
    t.recordError();
    expect(t.getMetrics().errorCount).toBe(2);
  });
});

describe('PerformanceTracker.recordBatch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  const batch = (over: Partial<Parameters<PerformanceTracker['recordBatch']>[0]> = {}) => ({
    frames: 10,
    intervalSumMs: 10 * 40,
    minIntervalMs: 33,
    maxIntervalMs: 50,
    inferenceSumMs: 10 * 12,
    processingSumMs: 10 * 20,
    facesSum: 10,
    handsSum: 5,
    trackedFrames: 10,
    ...over,
  });

  it('counts the frames it was given', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch());
    expect(t.getMetrics().frameCount).toBe(10);
  });

  it('ignores an empty batch', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch({frames: 0}));
    expect(t.getMetrics().frameCount).toBe(0);
  });

  it('derives fps from the mean frame interval', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch());
    expect(t.getMetrics().fps).toBeCloseTo(25, 0); // 40 ms mean
  });

  it('averages inference time across the batch', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch());
    expect(t.getMetrics().avgInferenceTimeMs).toBeCloseTo(12, 1);
  });

  it('completes warmup once enough frames have accumulated (F11)', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch({frames: WARMUP_FRAMES}));
    expect(t.getMetrics().warmupComplete).toBe(true);
  });

  it('reports min/max fps from the real interval extremes after warmup', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch({frames: WARMUP_FRAMES}));
    t.recordBatch(batch({minIntervalMs: 25, maxIntervalMs: 100}));
    const m = t.getMetrics();
    expect(m.maxFps).toBeCloseTo(40, 0); // 1000/25
    expect(m.minFps).toBeCloseTo(10, 0); // 1000/100
  });

  it('counts a tracking loss when a whole batch saw nothing', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch());
    t.recordBatch(batch({trackedFrames: 0, facesSum: 0, handsSum: 0}));
    expect(t.getMetrics().trackingLostCount).toBe(1);
  });

  it('averages detections per frame', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch());
    const m = t.getMetrics();
    expect(m.facesDetectedAvg).toBeCloseTo(1, 5);
    expect(m.handsDetectedAvg).toBeCloseTo(0.5, 5);
  });
});
