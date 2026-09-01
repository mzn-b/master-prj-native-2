import {
  DEFAULT_DYNAMIC_INFERENCE_CONFIG,
  DynamicInferenceController,
} from '../DynamicInferenceController';

function feed(controller: DynamicInferenceController, ms: number, times: number) {
  for (let i = 0; i < times; i++) {
    controller.recordInferenceTime(ms);
  }
}

describe('DynamicInferenceController (F15)', () => {
  it('starts at frame skip 1', () => {
    expect(new DynamicInferenceController().getCurrentFrameSkip()).toBe(1);
  });

  it('reports skip 1 while disabled regardless of load', () => {
    const c = new DynamicInferenceController({
      ...DEFAULT_DYNAMIC_INFERENCE_CONFIG,
      enabled: false,
    });
    feed(c, 200, 100);
    expect(c.getCurrentFrameSkip()).toBe(1);
  });

  it('raises skip when inference exceeds the target', () => {
    const c = new DynamicInferenceController();
    feed(c, 60, 20);
    expect(c.getCurrentFrameSkip()).toBeGreaterThan(1);
  });

  it('steps by 2 when inference is more than 1.5x the target', () => {
    const c = new DynamicInferenceController();
    feed(c, 100, 20);
    expect(c.getCurrentFrameSkip()).toBe(3);
  });

  it('lowers skip by exactly 1 when inference is comfortably under target', () => {
    const c = new DynamicInferenceController();
    feed(c, 100, 20);
    const raised = c.getCurrentFrameSkip();
    feed(c, 5, 20);
    expect(c.getCurrentFrameSkip()).toBe(raised - 1);
  });

  it('does not adjust before the adjustment interval elapses', () => {
    const c = new DynamicInferenceController();
    feed(c, 500, DEFAULT_DYNAMIC_INFERENCE_CONFIG.adjustmentInterval - 1);
    expect(c.getCurrentFrameSkip()).toBe(1);
  });

  it('never exceeds maxFrameSkip', () => {
    const c = new DynamicInferenceController();
    feed(c, 500, 400);
    expect(c.getCurrentFrameSkip()).toBe(DEFAULT_DYNAMIC_INFERENCE_CONFIG.maxFrameSkip);
  });

  it('never drops below minFrameSkip', () => {
    const c = new DynamicInferenceController();
    feed(c, 1, 400);
    expect(c.getCurrentFrameSkip()).toBe(DEFAULT_DYNAMIC_INFERENCE_CONFIG.minFrameSkip);
  });

  it('holds steady inside the tolerance band', () => {
    const c = new DynamicInferenceController();
    feed(c, DEFAULT_DYNAMIC_INFERENCE_CONFIG.targetInferenceTimeMs, 100);
    expect(c.getCurrentFrameSkip()).toBe(1);
  });

  it('returns to 1 after reset', () => {
    const c = new DynamicInferenceController();
    feed(c, 200, 60);
    c.reset();
    expect(c.getCurrentFrameSkip()).toBe(1);
  });
});
