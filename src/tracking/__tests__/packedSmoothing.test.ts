import {applySmoothing, emptySmoothingState} from '../packedSmoothing';
import {DEFAULT_SMOOTHING_CONFIG, LandmarkSmoother} from '../LandmarkSmoother';
import {FACE_LANDMARK_COUNT, FACE_STRIDE, HAND_STRIDE} from '../../native/landmarkFormat';
import type {RawDetection} from '../../native/landmarkFormat';
import type {TrackingDTO} from '../../domain/tracking.dto';

/** A detection with one face (and optionally one hand) whose every x is `x`. */
function detection(timestampMs: number, x: number, handCount = 0): RawDetection {
  const values = new Float32Array(FACE_STRIDE + handCount * HAND_STRIDE);
  for (let i = 0; i < values.length; i += 3) {
    values[i] = x;
    values[i + 1] = 0.5;
    values[i + 2] = 0;
  }
  return {
    timestampMs,
    faceCount: 1,
    handCount,
    landmarks: values.buffer as ArrayBuffer,
    blendshapes: new Float32Array(0).buffer as ArrayBuffer,
    blendshapeNames: [],
    hands: [],
    inferenceTimeMs: 5,
  };
}

function firstX(raw: RawDetection): number {
  return new Float32Array(raw.landmarks)[0];
}

/** Drive a sequence of frames through the packed smoother. */
function run(frames: Array<[number, number]>): number {
  let state = emptySmoothingState();
  let x = 0;
  for (const [t, value] of frames) {
    const out = applySmoothing(state, detection(t, value));
    state = out.state;
    x = firstX(out.result);
  }
  return x;
}

describe('applySmoothing (F9 over the packed buffer)', () => {
  it('returns the input untouched when disabled', () => {
    const input = detection(0, 0.2);
    const out = applySmoothing(emptySmoothingState(), input, {
      ...DEFAULT_SMOOTHING_CONFIG,
      enabled: false,
    });
    expect(out.result).toBe(input);
  });

  it('passes the first sample through unchanged', () => {
    expect(run([[0, 0.2]])).toBeCloseTo(0.2, 6);
  });

  it('damps a step change instead of following it', () => {
    const x = run([
      [0, 0.2],
      [33, 0.8],
    ]);
    expect(x).toBeGreaterThan(0.2);
    expect(x).toBeLessThan(0.8);
  });

  it('converges towards a held value across many frames', () => {
    const frames: Array<[number, number]> = [[0, 0.2]];
    for (let i = 1; i <= 60; i++) {
      frames.push([i * 33, 0.8]);
    }
    expect(run(frames)).toBeCloseTo(0.8, 2);
  });

  it('does not modify the detector’s own buffer', () => {
    const input = detection(0, 0.2);
    applySmoothing(emptySmoothingState(), input);
    const second = detection(33, 0.9);
    const out = applySmoothing(
      applySmoothing(emptySmoothingState(), input).state,
      second,
    );
    expect(firstX(out.result)).not.toBeCloseTo(0.9, 6);
    // The caller's buffer is untouched, so renderers still reading it are safe.
    expect(firstX(second)).toBeCloseTo(0.9, 6);
  });

  it('smooths every coordinate of the face, not just the first', () => {
    let state = emptySmoothingState();
    state = applySmoothing(state, detection(0, 0.2)).state;
    const out = applySmoothing(state, detection(33, 0.8));
    const values = new Float32Array(out.result.landmarks);
    for (let i = 0; i < FACE_LANDMARK_COUNT; i++) {
      expect(values[i * 3]).toBeLessThan(0.8);
      expect(values[i * 3]).toBeGreaterThan(0.2);
    }
  });

  it('smooths hand landmarks as well as face landmarks', () => {
    let state = emptySmoothingState();
    state = applySmoothing(state, detection(0, 0.2, 1)).state;
    const out = applySmoothing(state, detection(33, 0.8, 1));
    const values = new Float32Array(out.result.landmarks);
    const firstHandX = values[FACE_STRIDE];
    expect(firstHandX).toBeGreaterThan(0.2);
    expect(firstHandX).toBeLessThan(0.8);
  });

  it('restarts a modality when its entity count changes', () => {
    let state = emptySmoothingState();
    state = applySmoothing(state, detection(0, 0.2, 0)).state;
    // A hand appears: its slots are new, so they must pass through unfiltered
    // rather than being filtered towards a face's coordinates.
    const out = applySmoothing(state, detection(33, 0.9, 1));
    expect(new Float32Array(out.result.landmarks)[FACE_STRIDE]).toBeCloseTo(0.9, 6);
  });

  it('forgets its state when reset', () => {
    applySmoothing(emptySmoothingState(), detection(0, 0.2));
    // A fresh state is what start()/stop() install, so the next frame must pass
    // through rather than being filtered towards the previous session's values.
    const out = applySmoothing(emptySmoothingState(), detection(33, 0.9));
    expect(firstX(out.result)).toBeCloseTo(0.9, 6);
  });

  it('passes a detection with nothing in it straight through', () => {
    const empty: RawDetection = {
      timestampMs: 0,
      faceCount: 0,
      handCount: 0,
      landmarks: new Float32Array(0).buffer as ArrayBuffer,
      blendshapes: new Float32Array(0).buffer as ArrayBuffer,
      blendshapeNames: [],
      hands: [],
      inferenceTimeMs: 0,
    };
    expect(applySmoothing(emptySmoothingState(), empty).result).toBe(empty);
  });

  it('keeps blendshapes, hand meta and inference time intact', () => {
    const input = detection(0, 0.2);
    const out = applySmoothing(emptySmoothingState(), input);
    expect(out.result.inferenceTimeMs).toBe(5);
    expect(out.result.faceCount).toBe(1);
    expect(out.result.blendshapeNames).toBe(input.blendshapeNames);
  });
});

// The whole point of this module is that it behaves like the DTO smoother the
// PWA runs. If the two ever diverge, the platforms damp motion differently and
// the comparison measures the smoothing, not the runtime.
describe('parity with the DTO smoother the PWA uses', () => {
  function dtoFrame(timestampMs: number, x: number): TrackingDTO {
    return {
      timestampMs,
      mode: 'face',
      face: {faces: [{landmarks: [{x, y: 0.5, z: 0}]}]},
    };
  }

  it('produces the same values as LandmarkSmoother for the same input', () => {
    const dto = new LandmarkSmoother(DEFAULT_SMOOTHING_CONFIG);
    let state = emptySmoothingState();

    for (let i = 0; i <= 40; i++) {
      const t = i * 33;
      const x = i < 10 ? 0.2 : 0.75;

      const dtoOut = dto.smooth(dtoFrame(t, x)).face!.faces[0].landmarks[0].x;
      const packedOut = (() => {
        const out = applySmoothing(state, detection(t, x));
        state = out.state;
        return firstX(out.result);
      })();

      // Float32 storage on the packed side vs Float64 in the DTO, so compare at
      // single-precision tolerance rather than demanding bit equality.
      expect(packedOut).toBeCloseTo(dtoOut, 5);
    }
  });
});
