import {FACE_STRIDE, HAND_STRIDE, type RawDetection} from '../native/landmarkFormat';
import {DEFAULT_SMOOTHING_CONFIG, type SmoothingConfig} from './LandmarkSmoother';

/**
 * F9 — One Euro smoothing over the packed landmark buffer.
 *
 * `LandmarkSmoother` operates on `TrackingDTO`, and the render path never builds
 * one: renderers read the packed `Float32Array` straight from the detector. The
 * DTO smoother was therefore configured, reset and never actually applied, which
 * left F9 unmet here while the PWA smoothed every frame — a difference in visible
 * jitter and in CPU cost that landed straight in the platform comparison.
 *
 * This is the same filter over the packed representation. The constants come from
 * `DEFAULT_SMOOTHING_CONFIG`, which the PWA shares, so both platforms damp motion
 * identically; changing them on one side alone invalidates the comparison.
 *
 * Worklet-safe, like `applyDropoutGrace`: a plain function over plain data, with
 * its state living in a SharedValue. A class instance cannot cross into a worklet.
 */

/** Previous filtered value and previous derivative, per coordinate slot. */
export interface PackedSmoothingState {
  /** Seconds. Negative means nothing has been filtered yet. */
  tPrev: number;
  faceCount: number;
  handCount: number;
  facePrev: Float32Array;
  faceDeriv: Float32Array;
  handPrev: Float32Array;
  handDeriv: Float32Array;
}

export function emptySmoothingState(): PackedSmoothingState {
  'worklet';
  return {
    tPrev: -1,
    faceCount: 0,
    handCount: 0,
    facePrev: new Float32Array(0),
    faceDeriv: new Float32Array(0),
    handPrev: new Float32Array(0),
    handDeriv: new Float32Array(0),
  };
}

function alpha(cutoff: number, dt: number): number {
  'worklet';
  const tau = 1.0 / (2 * Math.PI * cutoff);
  return 1.0 / (1.0 + tau / dt);
}

/**
 * Filter one contiguous run of coordinates in place.
 *
 * `values` is the output buffer and is overwritten; `prev` and `deriv` carry the
 * filter state for those same slots and are updated alongside it.
 */
function filterRun(
  values: Float32Array,
  from: number,
  count: number,
  prev: Float32Array,
  deriv: Float32Array,
  dt: number,
  config: SmoothingConfig,
): void {
  'worklet';
  const aD = alpha(config.dCutoff, dt);
  for (let i = 0; i < count; i++) {
    const at = from + i;
    const raw = values[at];
    const dx = (raw - prev[i]) / dt;
    const edx = aD * dx + (1 - aD) * deriv[i];
    const a = alpha(config.minCutoff + config.beta * Math.abs(edx), dt);
    const filtered = a * raw + (1 - a) * prev[i];
    values[at] = filtered;
    prev[i] = filtered;
    deriv[i] = edx;
  }
}

/** Seed the filter with the first sample of a run — it passes through unchanged. */
function seedRun(
  values: Float32Array,
  from: number,
  count: number,
  prev: Float32Array,
  deriv: Float32Array,
): void {
  'worklet';
  for (let i = 0; i < count; i++) {
    prev[i] = values[from + i];
    deriv[i] = 0;
  }
}

export function applySmoothing(
  state: PackedSmoothingState,
  raw: RawDetection,
  config: SmoothingConfig = DEFAULT_SMOOTHING_CONFIG,
): {result: RawDetection; state: PackedSmoothingState} {
  'worklet';
  if (!config.enabled) {
    return {result: raw, state};
  }

  const faceValues = raw.faceCount * FACE_STRIDE;
  const handValues = raw.handCount * HAND_STRIDE;
  if (faceValues + handValues === 0) {
    return {result: raw, state};
  }

  // Copy: the incoming buffer belongs to the detector, and the renderers may
  // still be reading the previous frame's view of it.
  const values = new Float32Array(raw.landmarks).slice();
  const t = raw.timestampMs / 1000;
  const dt = state.tPrev < 0 ? 0 : t - state.tPrev;

  // A changed entity count means the slots no longer refer to the same points,
  // so that modality restarts rather than filtering one face towards another.
  const faceUsable = dt > 0 && state.faceCount === raw.faceCount && state.facePrev.length === faceValues;
  const handUsable = dt > 0 && state.handCount === raw.handCount && state.handPrev.length === handValues;

  const facePrev = faceUsable ? state.facePrev : new Float32Array(faceValues);
  const faceDeriv = faceUsable ? state.faceDeriv : new Float32Array(faceValues);
  const handPrev = handUsable ? state.handPrev : new Float32Array(handValues);
  const handDeriv = handUsable ? state.handDeriv : new Float32Array(handValues);

  if (faceUsable) {
    filterRun(values, 0, faceValues, facePrev, faceDeriv, dt, config);
  } else {
    seedRun(values, 0, faceValues, facePrev, faceDeriv);
  }

  if (handUsable) {
    filterRun(values, faceValues, handValues, handPrev, handDeriv, dt, config);
  } else {
    seedRun(values, faceValues, handValues, handPrev, handDeriv);
  }

  return {
    result: {
      timestampMs: raw.timestampMs,
      faceCount: raw.faceCount,
      handCount: raw.handCount,
      landmarks: values.buffer as ArrayBuffer,
      blendshapes: raw.blendshapes,
      blendshapeNames: raw.blendshapeNames,
      hands: raw.hands,
      inferenceTimeMs: raw.inferenceTimeMs,
    },
    state: {
      tPrev: t,
      faceCount: raw.faceCount,
      handCount: raw.handCount,
      facePrev,
      faceDeriv,
      handPrev,
      handDeriv,
    },
  };
}
