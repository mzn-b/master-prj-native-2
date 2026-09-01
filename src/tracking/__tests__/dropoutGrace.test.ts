import {DROPOUT_GRACE_MS, DropoutGrace} from '../dropoutGrace';
import {FACE_STRIDE, HAND_STRIDE, type RawDetection} from '../../native/landmarkFormat';

function detection(
  timestampMs: number,
  faceCount: number,
  handCount: number,
  fill = 1,
): RawDetection {
  const values = new Float32Array(faceCount * FACE_STRIDE + handCount * HAND_STRIDE).fill(fill);
  return {
    timestampMs,
    faceCount,
    handCount,
    landmarks: values.buffer,
    blendshapes: new Float32Array(faceCount * 52).fill(fill).buffer,
    blendshapeNames: faceCount > 0 ? ['jawOpen'] : [],
    hands: Array.from({length: handCount}, () => ({handedness: 'Left' as const})),
    inferenceTimeMs: 10,
  };
}

describe('DropoutGrace (NF7)', () => {
  it('passes a good detection straight through', () => {
    const grace = new DropoutGrace();
    expect(grace.apply(detection(0, 1, 1)).faceCount).toBe(1);
  });

  it('holds the last good face through a short dropout', () => {
    const grace = new DropoutGrace();
    grace.apply(detection(0, 1, 0));
    expect(grace.apply(detection(100, 0, 0)).faceCount).toBe(1);
  });

  it('keeps the held landmark values, not zeros', () => {
    const grace = new DropoutGrace();
    grace.apply(detection(0, 1, 0, 0.42));
    const held = grace.apply(detection(100, 0, 0));
    expect(new Float32Array(held.landmarks)[0]).toBeCloseTo(0.42, 5);
  });

  it('releases the held face once the grace window expires', () => {
    const grace = new DropoutGrace();
    grace.apply(detection(0, 1, 0));
    expect(grace.apply(detection(DROPOUT_GRACE_MS + 1, 0, 0)).faceCount).toBe(0);
  });

  it('holds faces and hands independently', () => {
    const grace = new DropoutGrace();
    grace.apply(detection(0, 1, 2));
    const out = grace.apply(detection(1000, 0, 2)); // face long gone, hands still live
    expect(out.faceCount).toBe(0);
    expect(out.handCount).toBe(2);
  });

  it('keeps hands positioned after faces when a face is held', () => {
    const grace = new DropoutGrace();
    grace.apply(detection(0, 1, 0, 0.5));
    const out = grace.apply(detection(50, 0, 1, 0.9));
    const values = new Float32Array(out.landmarks);
    expect(out.faceCount).toBe(1);
    expect(out.handCount).toBe(1);
    expect(values[0]).toBeCloseTo(0.5, 5); // held face first
    expect(values[FACE_STRIDE]).toBeCloseTo(0.9, 5); // live hand after it
  });

  it('carries the held face blendshapes and hand metadata', () => {
    const grace = new DropoutGrace();
    grace.apply(detection(0, 1, 1));
    const out = grace.apply(detection(50, 0, 0));
    expect(out.blendshapeNames).toEqual(['jawOpen']);
    expect(out.hands).toHaveLength(1);
  });

  it('forgets everything on reset', () => {
    const grace = new DropoutGrace();
    grace.apply(detection(0, 1, 0));
    grace.reset();
    expect(grace.apply(detection(10, 0, 0)).faceCount).toBe(0);
  });
});
