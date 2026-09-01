/**
 * Packed landmark transport format — the contract between the native detector
 * and JavaScript.
 *
 * One Float32Array carries every landmark of a frame as (x, y, z) triplets:
 *
 *   [ face 0 (478 pts) ][ face 1 … ][ hand 0 (21 pts) ][ hand 1 … ]
 *
 * Faces always precede hands. Values are image-normalized (x, y in 0..1).
 *
 * Why packed: a face is 478 points at 30 fps. Marshalling that as objects or
 * maps — which the previous app did, one HashMap per point — is the hottest
 * allocation path in the app, and it would distort the very numbers this
 * project exists to measure.
 *
 * Both native implementations must produce exactly this layout; a divergence
 * shows up as scrambled overlays on one platform only.
 */
export const FACE_LANDMARK_COUNT = 478;
export const HAND_LANDMARK_COUNT = 21;
export const BLENDSHAPE_COUNT = 52;
export const VALUES_PER_POINT = 3;

export const FACE_STRIDE = FACE_LANDMARK_COUNT * VALUES_PER_POINT;
export const HAND_STRIDE = HAND_LANDMARK_COUNT * VALUES_PER_POINT;

/** Index into the packed array where face `i` starts. */
export function faceOffset(i: number): number {
  return i * FACE_STRIDE;
}

/** Index into the packed array where hand `i` starts. */
export function handOffset(faceCount: number, i: number): number {
  return faceCount * FACE_STRIDE + i * HAND_STRIDE;
}

export interface RawHandMeta {
  handedness: 'Left' | 'Right' | 'Unknown';
  /** F13 — top gesture label from the GestureRecognizer. */
  gesture?: string;
  gestureScore?: number;
}

/** Exactly what the LandmarkDetector HybridObject returns per frame. */
export interface RawDetection {
  timestampMs: number;
  faceCount: number;
  handCount: number;
  /** Float32, packed as described above. */
  landmarks: ArrayBuffer;
  /** Float32, faceCount * BLENDSHAPE_COUNT scores; empty when unavailable. */
  blendshapes: ArrayBuffer;
  /** Category names, parallel to each face's blendshape block. */
  blendshapeNames: string[];
  hands: RawHandMeta[];
  /** Time spent inside MediaPipe only, matching the PWA's definition. */
  inferenceTimeMs: number;
}
