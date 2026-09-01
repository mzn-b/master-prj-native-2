import {estimateHeadPose} from '../headPose';
import {FACE_LANDMARK_COUNT, VALUES_PER_POINT} from '../../native/landmarkFormat';

/** A synthetic, symmetric face looking straight at the camera. */
function neutralFace(): Float32Array {
  const v = new Float32Array(FACE_LANDMARK_COUNT * VALUES_PER_POINT);
  const set = (i: number, x: number, y: number, z = 0) => {
    v[i * 3] = x;
    v[i * 3 + 1] = y;
    v[i * 3 + 2] = z;
  };
  set(10, 0.5, 0.2); // forehead top
  set(152, 0.5, 0.8); // chin
  set(234, 0.3, 0.5); // left temple
  set(454, 0.7, 0.5); // right temple
  set(33, 0.4, 0.45); // left eye outer
  set(263, 0.6, 0.45); // right eye outer
  set(1, 0.5, 0.55); // nose tip
  return v;
}

describe('estimateHeadPose', () => {
  it('reports near-zero roll for a level face', () => {
    expect(Math.abs(estimateHeadPose(neutralFace(), 0).roll)).toBeLessThan(0.01);
  });

  it('reports non-zero roll when the head tilts', () => {
    const v = neutralFace();
    v[33 * 3 + 1] = 0.55; // drop the left eye
    expect(Math.abs(estimateHeadPose(v, 0).roll)).toBeGreaterThan(0.05);
  });

  it('reports near-zero yaw when the nose is centred', () => {
    expect(Math.abs(estimateHeadPose(neutralFace(), 0).yaw)).toBeLessThan(0.05);
  });

  it('reports positive yaw when the nose moves toward the right temple', () => {
    const v = neutralFace();
    v[1 * 3] = 0.62;
    expect(estimateHeadPose(v, 0).yaw).toBeGreaterThan(0);
  });

  it('scales with face width', () => {
    const narrow = neutralFace();
    const wide = neutralFace();
    wide[234 * 3] = 0.1;
    wide[454 * 3] = 0.9;
    expect(estimateHeadPose(wide, 0).scale).toBeGreaterThan(estimateHeadPose(narrow, 0).scale);
  });

  it('centres between the temples', () => {
    const pose = estimateHeadPose(neutralFace(), 0);
    expect(pose.centre.x).toBeCloseTo(0.5, 5);
  });

  it('reads a second face from its own offset', () => {
    const single = neutralFace();
    const two = new Float32Array(single.length * 2);
    two.set(single, 0);
    two.set(single, single.length);
    const pose = estimateHeadPose(two, single.length);
    expect(pose.centre.x).toBeCloseTo(0.5, 5);
  });
});
