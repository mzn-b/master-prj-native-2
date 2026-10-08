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
    t.recordDroppedFrame('governor');
    t.recordDroppedFrame('busy');
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

  // NF7 is asserted against the batch path, because that is the one the app
  // runs. These used to drive recordFrameEnd, which the camera pipeline never
  // calls — they passed while the production path counted something else
  // entirely. See the note on recordFrameEnd.

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

  it('takes tracking losses from the worklet, not from an empty batch', () => {
    // NF7 is counted per frame in the worklet now. A batch that happens to
    // contain no detections is NOT by itself one loss event: at a 500 ms drain
    // that would need a ~25x longer blackout than the PWA needs to register the
    // same event, and the two columns would not be comparable.
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch());
    t.recordBatch(batch({trackedFrames: 0, facesSum: 0, handsSum: 0}));
    expect(t.getMetrics().trackingLostCount).toBe(0);

    t.recordBatch(batch({lostEvents: 3, consecutiveLossMax: 2}));
    const m = t.getMetrics();
    expect(m.trackingLostCount).toBe(3);
    expect(m.consecutiveTrackingLossMax).toBe(2);
  });

  it('averages recovery time over the recoveries the worklet counted', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch({recoverySumMs: 120, recoveryCount: 2}));
    t.recordBatch(batch({recoverySumMs: 60, recoveryCount: 1}));
    // (120 + 60) / 3 — previously always undefined on native, because the code
    // that computed it lived in recordFrameEnd, which the app never calls.
    expect(t.getMetrics().trackingRecoveryTimeMs).toBe(60);
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

/**
 * The metrics added on 2026-09-15. Rationale, and the reasoning behind the
 * deliberately one-sided ones, is in METRICS.md.
 */
describe('PerformanceTracker percentiles from batched frames', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  function batch(
    inferenceSamples: number[],
    intervalSamples: number[] = inferenceSamples,
    extra: Record<string, number> = {},
  ) {
    const frames = inferenceSamples.length;
    const sum = inferenceSamples.reduce((a, b) => a + b, 0);
    const intervalSum = intervalSamples.reduce((a, b) => a + b, 0);
    return {
      frames,
      intervalSumMs: intervalSum,
      minIntervalMs: Math.min(...intervalSamples),
      maxIntervalMs: Math.max(...intervalSamples),
      inferenceSumMs: sum,
      processingSumMs: sum,
      facesSum: frames,
      handsSum: 0,
      trackedFrames: frames,
      inferenceSamples,
      intervalSamples,
      ...extra,
    };
  }

  it('uses the individual samples, not the batch mean', () => {
    // The whole point of carrying samples through the worklet: a batch mean
    // would flatten the 200 ms frame that the p95 exists to expose.
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(batch([10, 10, 10, 10, 10, 10, 10, 10, 10, 200]));
    const m = t.getMetrics();
    expect(m.inferenceTimeP95Ms).toBeCloseTo(200, 1);
    expect(m.inferenceTimeP50Ms).toBeCloseTo(10, 1);
  });

  it('accumulates across batches rather than resetting per drain', () => {
    const t = new PerformanceTracker();
    t.start();
    for (let i = 0; i < 20; i++) t.recordBatch(batch([10, 10, 10, 10, 10]));
    t.recordBatch(batch([500, 500]));
    expect(t.getMetrics().inferenceTimeP99Ms!).toBeGreaterThan(400);
  });

  it('omits percentiles rather than reporting zero before any frame', () => {
    const t = new PerformanceTracker();
    t.start();
    const m = t.getMetrics();
    expect(m.inferenceTimeP50Ms).toBeUndefined();
    expect(m.frameIntervalP95Ms).toBeUndefined();
  });
});

describe('PerformanceTracker detection quality from the worklet', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  function qualityBatch(extra: Record<string, number>) {
    return {
      frames: 2,
      intervalSumMs: 20,
      minIntervalMs: 10,
      maxIntervalMs: 10,
      inferenceSumMs: 20,
      processingSumMs: 20,
      facesSum: 2,
      handsSum: 2,
      trackedFrames: 2,
      ...extra,
    };
  }

  it('averages over the counts the worklet carried, not over frames', () => {
    // Sum and count travel together because a frame with no hand must not
    // dilute the confidence average with an implicit zero.
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(qualityBatch({gestureConfidenceSum: 1.6, gestureConfidenceCount: 2}));
    t.recordBatch(qualityBatch({gestureConfidenceSum: 0.9, gestureConfidenceCount: 1}));
    expect(t.getMetrics().avgGestureConfidence).toBeCloseTo(0.8333, 3);
  });

  it('reports blendshape activation and landmark jitter', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(
      qualityBatch({
        blendshapeActivationSum: 1.2,
        blendshapeActivationCount: 2,
        landmarkDeltaSum: 0.08,
        landmarkDeltaCount: 2,
      }),
    );
    const m = t.getMetrics();
    expect(m.avgBlendshapeActivation).toBeCloseTo(0.6, 3);
    expect(m.landmarkStability).toBeCloseTo(0.04, 3);
  });

  it('reports nothing rather than zero when no quality was observed', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordBatch(qualityBatch({}));
    const m = t.getMetrics();
    expect(m.avgGestureConfidence).toBeUndefined();
    expect(m.avgBlendshapeActivation).toBeUndefined();
    expect(m.landmarkStability).toBeUndefined();
  });
});

describe('PerformanceTracker one-sided metrics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  it('never submits a render time', () => {
    // Deliberate, and pinned so it cannot be "fixed" by accident: this app
    // renders declaratively through Skia with no point equivalent to the PWA's
    // draw call, so any number here would invite a comparison the measurement
    // cannot support. See METRICS.md §5.
    const t = new PerformanceTracker();
    t.start();
    runFrames(t, 30, 16);
    const m = t.getMetrics();
    expect(m.avgRenderTimeMs).toBeUndefined();
    expect(m.renderTimeP95Ms).toBeUndefined();
  });

  it('submits a startup figure taken at session start', () => {
    // A property of the launch, so it is the same for every session in the
    // process — as the PWA's navigation timing also is.
    const t = new PerformanceTracker();
    t.start();
    const first = t.getMetrics().appStartupMs;
    t.reset();
    expect(t.getMetrics().appStartupMs).toBe(first);
  });
});


describe('PerformanceTracker F15 governor accounting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  it('splits dropped frames by cause while keeping the total', () => {
    // The two causes mean opposite things: the governor skipping is the system
    // working as designed, the runner refusing is the device overwhelmed. A
    // single total cannot distinguish them. See METRICS.md.
    const t = new PerformanceTracker();
    t.start();
    t.recordDroppedFrame('governor', 40);
    t.recordDroppedFrame('busy', 3);
    const m = t.getMetrics();
    expect(m.droppedFrames).toBe(43);
    expect(m.droppedFramesGovernor).toBe(40);
    expect(m.droppedFramesBusy).toBe(3);
  });

  it('reports the mean and peak divider the governor reached', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordFrameSkipBatch(10, 10, 1); // ten frames at skip 1
    t.recordFrameSkipBatch(30, 10, 5); // ten frames averaging 3, peaking at 5
    const m = t.getMetrics();
    expect(m.avgFrameSkip).toBeCloseTo(2, 2);
    expect(m.maxFrameSkip).toBe(5);
  });

  it('ignores an empty drain rather than dividing by zero', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordFrameSkipBatch(0, 0, 0);
    const m = t.getMetrics();
    expect(m.avgFrameSkip).toBeUndefined();
    expect(m.maxFrameSkip).toBeUndefined();
  });

  it('keeps the peak across a reset boundary only within a session', () => {
    const t = new PerformanceTracker();
    t.start();
    t.recordFrameSkipBatch(50, 10, 8);
    expect(t.getMetrics().maxFrameSkip).toBe(8);
    t.reset();
    expect(t.getMetrics().maxFrameSkip).toBeUndefined();
  });
});
