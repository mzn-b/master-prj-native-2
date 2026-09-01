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

export class DropoutGrace {
  private faces: HeldFaces | null = null;
  private hands: HeldHands | null = null;

  reset(): void {
    this.faces = null;
    this.hands = null;
  }

  apply(raw: RawDetection): RawDetection {
    const values = new Float32Array(raw.landmarks);
    const faceValueCount = raw.faceCount * FACE_STRIDE;

    if (raw.faceCount > 0) {
      this.faces = {
        timestampMs: raw.timestampMs,
        count: raw.faceCount,
        values: values.slice(0, faceValueCount),
        blendshapes: new Float32Array(raw.blendshapes),
        blendshapeNames: raw.blendshapeNames,
      };
    }
    if (raw.handCount > 0) {
      this.hands = {
        timestampMs: raw.timestampMs,
        count: raw.handCount,
        values: values.slice(faceValueCount, faceValueCount + raw.handCount * HAND_STRIDE),
        meta: raw.hands,
      };
    }

    const heldFaces =
      raw.faceCount === 0 && this.withinGrace(this.faces?.timestampMs, raw.timestampMs)
        ? this.faces
        : null;
    const heldHands =
      raw.handCount === 0 && this.withinGrace(this.hands?.timestampMs, raw.timestampMs)
        ? this.hands
        : null;

    if (!heldFaces && !heldHands) {
      return raw;
    }

    const faceValues = heldFaces ? heldFaces.values : values.subarray(0, faceValueCount);
    const handValues = heldHands
      ? heldHands.values
      : values.subarray(faceValueCount, faceValueCount + raw.handCount * HAND_STRIDE);

    // Rebuild the packed buffer, faces first, as landmarkFormat requires.
    const merged = new Float32Array(faceValues.length + handValues.length);
    merged.set(faceValues, 0);
    merged.set(handValues, faceValues.length);

    return {
      timestampMs: raw.timestampMs,
      faceCount: heldFaces ? heldFaces.count : raw.faceCount,
      handCount: heldHands ? heldHands.count : raw.handCount,
      landmarks: merged.buffer as ArrayBuffer,
      blendshapes: heldFaces ? (heldFaces.blendshapes.buffer as ArrayBuffer) : raw.blendshapes,
      blendshapeNames: heldFaces ? heldFaces.blendshapeNames : raw.blendshapeNames,
      hands: heldHands ? heldHands.meta : raw.hands,
      inferenceTimeMs: raw.inferenceTimeMs,
    };
  }

  private withinGrace(heldAt: number | undefined, now: number): boolean {
    return heldAt !== undefined && now - heldAt <= DROPOUT_GRACE_MS;
  }
}
