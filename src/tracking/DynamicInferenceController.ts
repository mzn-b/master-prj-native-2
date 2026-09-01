/**
 * F15 — adapts the inference rate to the device.
 *
 * Every `adjustmentInterval` samples the controller compares recent average
 * inference time against a 30 fps budget and moves a frame-skip divider. The
 * ladder is deliberately asymmetric: it climbs fast when the device is
 * struggling (double step past 1.5x the target) and descends one step at a
 * time, which avoids oscillating around the threshold.
 *
 * Constants match master-prj-pwa so F15 behaves identically on both platforms.
 */
export interface DynamicInferenceConfig {
  enabled: boolean;
  targetFps: number;
  minFrameSkip: number;
  maxFrameSkip: number;
  adjustmentInterval: number;
  targetInferenceTimeMs: number;
  inferenceTimeTolerance: number;
}

export const DEFAULT_DYNAMIC_INFERENCE_CONFIG: DynamicInferenceConfig = {
  enabled: true,
  targetFps: 30,
  minFrameSkip: 1,
  maxFrameSkip: 10,
  adjustmentInterval: 20,
  targetInferenceTimeMs: 33, // 1000 / 30
  inferenceTimeTolerance: 5,
};

const RECENT_SAMPLES = 10;

export class DynamicInferenceController {
  private config: DynamicInferenceConfig;
  private currentFrameSkip = 1;
  private framesSinceAdjustment = 0;
  private recentInferenceTimes: number[] = [];

  constructor(config: DynamicInferenceConfig = DEFAULT_DYNAMIC_INFERENCE_CONFIG) {
    this.config = {...config};
  }

  setConfig(config: Partial<DynamicInferenceConfig>): void {
    this.config = {...this.config, ...config};
  }

  getCurrentFrameSkip(): number {
    return this.config.enabled ? this.currentFrameSkip : 1;
  }

  recordInferenceTime(inferenceTimeMs: number): void {
    if (!this.config.enabled) {
      return;
    }

    this.recentInferenceTimes.push(inferenceTimeMs);
    if (this.recentInferenceTimes.length > RECENT_SAMPLES) {
      this.recentInferenceTimes.shift();
    }

    this.framesSinceAdjustment++;
    if (this.framesSinceAdjustment >= this.config.adjustmentInterval) {
      this.adjustFrameSkip();
      this.framesSinceAdjustment = 0;
    }
  }

  private adjustFrameSkip(): void {
    if (this.recentInferenceTimes.length < 3) {
      return;
    }

    const average =
      this.recentInferenceTimes.reduce((a, b) => a + b, 0) / this.recentInferenceTimes.length;
    const {targetInferenceTimeMs: target, inferenceTimeTolerance: tolerance} = this.config;

    if (average > target + tolerance && this.currentFrameSkip < this.config.maxFrameSkip) {
      const step = average > target * 1.5 ? 2 : 1;
      this.currentFrameSkip = Math.min(this.currentFrameSkip + step, this.config.maxFrameSkip);
    } else if (average < target - tolerance && this.currentFrameSkip > this.config.minFrameSkip) {
      this.currentFrameSkip = Math.max(this.currentFrameSkip - 1, this.config.minFrameSkip);
    }
  }

  reset(): void {
    this.currentFrameSkip = 1;
    this.framesSinceAdjustment = 0;
    this.recentInferenceTimes = [];
  }
}
