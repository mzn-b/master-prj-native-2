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

/**
 * The detector's payload types come from the Nitro spec, which is the single
 * source of truth — redeclaring them here would let the two drift silently.
 */
export type {RawDetection, RawHandMeta} from 'tracking-native';

export type Handedness = 'Left' | 'Right' | 'Unknown';

/** Narrow the native side's free-form string to the DTO's union. */
export function toHandedness(value: string | undefined): Handedness {
  return value === 'Left' || value === 'Right' ? value : 'Unknown';
}
