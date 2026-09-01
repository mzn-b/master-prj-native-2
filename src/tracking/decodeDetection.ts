import type {NormalizedPoint, TrackingDTO, TrackingMode} from '../domain/tracking.dto';
import {
  BLENDSHAPE_COUNT,
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  VALUES_PER_POINT,
  faceOffset,
  handOffset,
  type RawDetection,
} from '../native/landmarkFormat';

function readPoints(values: Float32Array, offset: number, count: number): NormalizedPoint[] {
  const points: NormalizedPoint[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const base = offset + i * VALUES_PER_POINT;
    points[i] = {x: values[base], y: values[base + 1], z: values[base + 2]};
  }
  return points;
}

/**
 * Convert the packed native payload into the shared DTO.
 *
 * Call this only where a DTO is genuinely needed — the debug HUD and tests.
 * Renderers read the packed buffer directly, which is what keeps the per-frame
 * path allocation-free.
 */
export function decodeDetection(raw: RawDetection, mode: TrackingMode): TrackingDTO {
  const values = new Float32Array(raw.landmarks);
  const scores = new Float32Array(raw.blendshapes);
  const dto: TrackingDTO = {timestampMs: raw.timestampMs, mode};

  if (mode === 'face' || mode === 'combined') {
    const faces = [];
    for (let i = 0; i < raw.faceCount; i++) {
      const blockStart = i * BLENDSHAPE_COUNT;
      const hasBlendshapes = scores.length >= blockStart + BLENDSHAPE_COUNT;
      faces.push({
        landmarks: readPoints(values, faceOffset(i), FACE_LANDMARK_COUNT),
        blendshapes: hasBlendshapes
          ? raw.blendshapeNames.map((categoryName, b) => ({
              categoryName,
              score: scores[blockStart + b],
            }))
          : undefined,
      });
    }
    dto.face = {faces};
  }

  if (mode === 'hand' || mode === 'combined') {
    const hands = [];
    for (let i = 0; i < raw.handCount; i++) {
      const meta = raw.hands[i];
      hands.push({
        handedness: meta?.handedness ?? ('Unknown' as const),
        landmarks: readPoints(values, handOffset(raw.faceCount, i), HAND_LANDMARK_COUNT),
        gesture: meta?.gesture,
        gestureScore: meta?.gestureScore,
      });
    }
    dto.hand = {hands};
  }

  return dto;
}
