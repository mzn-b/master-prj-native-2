import {decodeDetection} from '../decodeDetection';
import {
  BLENDSHAPE_COUNT,
  FACE_LANDMARK_COUNT,
  FACE_STRIDE,
  HAND_LANDMARK_COUNT,
  HAND_STRIDE,
  type RawDetection,
} from '../../native/landmarkFormat';

function buildRaw(faceCount: number, handCount: number): RawDetection {
  const values = new Float32Array(faceCount * FACE_STRIDE + handCount * HAND_STRIDE);
  // Recognisable ramp: every value equals its own index / 10000.
  for (let i = 0; i < values.length; i++) {
    values[i] = i / 10000;
  }
  const blend = new Float32Array(faceCount * BLENDSHAPE_COUNT).fill(0.5);
  return {
    timestampMs: 1234,
    faceCount,
    handCount,
    landmarks: values.buffer,
    blendshapes: blend.buffer,
    blendshapeNames: Array.from({length: BLENDSHAPE_COUNT}, (_, i) => `shape${i}`),
    hands: Array.from({length: handCount}, () => ({
      handedness: 'Left' as const,
      gesture: 'Victory',
      gestureScore: 0.9,
    })),
    inferenceTimeMs: 12.5,
  };
}

describe('decodeDetection', () => {
  it('decodes the right number of faces and landmarks', () => {
    const dto = decodeDetection(buildRaw(1, 0), 'face');
    expect(dto.face!.faces).toHaveLength(1);
    expect(dto.face!.faces[0].landmarks).toHaveLength(FACE_LANDMARK_COUNT);
  });

  it('decodes the first face point from the head of the buffer', () => {
    const dto = decodeDetection(buildRaw(1, 0), 'face');
    const p = dto.face!.faces[0].landmarks[0];
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1 / 10000, 6);
    expect(p.z).toBeCloseTo(2 / 10000, 6);
  });

  it('places hands after faces in the packed buffer', () => {
    const dto = decodeDetection(buildRaw(1, 1), 'combined');
    expect(dto.hand!.hands[0].landmarks).toHaveLength(HAND_LANDMARK_COUNT);
    expect(dto.hand!.hands[0].landmarks[0].x).toBeCloseTo(FACE_STRIDE / 10000, 6);
  });

  it('handles two faces without overlapping their blocks', () => {
    const dto = decodeDetection(buildRaw(2, 0), 'face');
    expect(dto.face!.faces[1].landmarks[0].x).toBeCloseTo(FACE_STRIDE / 10000, 6);
  });

  it('attaches blendshapes to each face (F12)', () => {
    const dto = decodeDetection(buildRaw(1, 0), 'face');
    expect(dto.face!.faces[0].blendshapes).toHaveLength(BLENDSHAPE_COUNT);
    expect(dto.face!.faces[0].blendshapes![0]).toEqual({categoryName: 'shape0', score: 0.5});
  });

  it('attaches gesture metadata to each hand (F13)', () => {
    const dto = decodeDetection(buildRaw(0, 2), 'hand');
    expect(dto.hand!.hands[1].gesture).toBe('Victory');
    expect(dto.hand!.hands[1].gestureScore).toBe(0.9);
    expect(dto.hand!.hands[1].handedness).toBe('Left');
  });

  it('emits empty collections rather than undefined when nothing is detected', () => {
    const dto = decodeDetection(buildRaw(0, 0), 'combined');
    expect(dto.face!.faces).toEqual([]);
    expect(dto.hand!.hands).toEqual([]);
  });

  it('omits the modality the mode excludes', () => {
    const dto = decodeDetection(buildRaw(1, 0), 'face');
    expect(dto.hand).toBeUndefined();
  });

  it('omits blendshapes when the native side sent none', () => {
    const raw = buildRaw(1, 0);
    raw.blendshapes = new Float32Array(0).buffer;
    const dto = decodeDetection(raw, 'face');
    expect(dto.face!.faces[0].blendshapes).toBeUndefined();
  });

  it('carries the timestamp through', () => {
    expect(decodeDetection(buildRaw(1, 1), 'combined').timestampMs).toBe(1234);
  });
});
