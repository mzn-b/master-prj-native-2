import {
  FACE_STRIDE,
  HAND_STRIDE,
  type RawDetection,
  type RawHandMeta,
} from '../native/landmarkFormat';

/**
 * NF7 — bridge momentary tracking dropouts.
 *
 * When MediaPipe reports nothing for a modality, reuse the last good result for
 * a short window so filters do not snap off during a blink or when a hand
 * briefly leaves the frame. 150 ms matches the PWA, so both platforms behave
 * the same under occlusion.
 *
 * Faces and hands are held independently: losing a hand should not resurrect a
 * face that has been gone for a second.
 */
export const DROPOUT_GRACE_MS = 150;

interface HeldFaces {
  timestampMs: number;
  count: number;
  values: Float32Array;
  blendshapes: Float32Array;
  blendshapeNames: string[];
}

interface HeldHands {
  timestampMs: number;
  count: number;
  values: Float32Array;
  meta: RawHandMeta[];
}

/** Plain, serialisable state so this can live in a SharedValue. */
export interface GraceState {
  faces: HeldFaces | null;
  hands: HeldHands | null;
}

export function emptyGraceState(): GraceState {
  return {faces: null, hands: null};
}

/**
 * Worklet-safe: this runs on the async detection thread, so it must be a plain
 * function over plain data. A class instance cannot cross into a worklet — its
 * methods simply are not there, which fails at runtime as
 * "Cannot read property 'apply' of undefined".
 */
export function applyDropoutGrace(
  state: GraceState,
  raw: RawDetection,
): {result: RawDetection; state: GraceState} {
  'worklet';
  const withinGrace = (heldAt: number | undefined, now: number): boolean =>
    heldAt !== undefined && now - heldAt <= DROPOUT_GRACE_MS;

  const values = new Float32Array(raw.landmarks);
  const faceValueCount = raw.faceCount * FACE_STRIDE;

  let faces = state.faces;
  let hands = state.hands;

  if (raw.faceCount > 0) {
    faces = {
      timestampMs: raw.timestampMs,
      count: raw.faceCount,
      values: values.slice(0, faceValueCount),
      blendshapes: new Float32Array(raw.blendshapes),
      blendshapeNames: raw.blendshapeNames,
    };
  }
  if (raw.handCount > 0) {
    hands = {
      timestampMs: raw.timestampMs,
      count: raw.handCount,
      values: values.slice(faceValueCount, faceValueCount + raw.handCount * HAND_STRIDE),
      meta: raw.hands,
    };
  }

  const heldFaces = raw.faceCount === 0 && withinGrace(faces?.timestampMs, raw.timestampMs) ? faces : null;
  const heldHands = raw.handCount === 0 && withinGrace(hands?.timestampMs, raw.timestampMs) ? hands : null;

  if (!heldFaces && !heldHands) {
    return {result: raw, state: {faces, hands}};
  }

  const faceValues = heldFaces ? heldFaces.values : values.subarray(0, faceValueCount);
  const handValues = heldHands
    ? heldHands.values
    : values.subarray(faceValueCount, faceValueCount + raw.handCount * HAND_STRIDE);

  const merged = new Float32Array(faceValues.length + handValues.length);
  merged.set(faceValues, 0);
  merged.set(handValues, faceValues.length);

  return {
    result: {
      timestampMs: raw.timestampMs,
      faceCount: heldFaces ? heldFaces.count : raw.faceCount,
      handCount: heldHands ? heldHands.count : raw.handCount,
      landmarks: merged.buffer as ArrayBuffer,
      blendshapes: heldFaces ? (heldFaces.blendshapes.buffer as ArrayBuffer) : raw.blendshapes,
      blendshapeNames: heldFaces ? heldFaces.blendshapeNames : raw.blendshapeNames,
      hands: heldHands ? heldHands.meta : raw.hands,
      inferenceTimeMs: raw.inferenceTimeMs,
    },
    state: {faces, hands},
  };
}

/** Stateful wrapper for JS-thread callers and tests. */
export class DropoutGrace {
  private state: GraceState = emptyGraceState();

  reset(): void {
    this.state = emptyGraceState();
  }

  apply(raw: RawDetection): RawDetection {
    const {result, state} = applyDropoutGrace(this.state, raw);
    this.state = state;
    return result;
  }

}
