import * as THREE from 'three/webgpu';
import {createCrownView} from '../crownView';

/**
 * The crown rendered far darker on native than in the PWA. The orthographic
 * camera flipped y in its projection so that the scene could use screen
 * coordinates directly. A projection that mirrors the image reverses the
 * winding of every triangle, but three decides which side of a face is its
 * front from the object's world matrix alone, never from the projection. With
 * the crown's double-sided material it therefore took every visible face for a
 * back face and turned its normal away from the lights, leaving only the
 * ambient term. Reproduced on desktop with three 0.185.1: mean luminance 7.0
 * against 54.6 for the PWA's camera, and no highlights at all.
 */
describe('createCrownView', () => {
  const W = 400;
  const H = 800;

  const view = () => {
    const {camera, screenSpace} = createCrownView(W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    screenSpace.updateMatrixWorld(true);
    return {camera, screenSpace};
  };

  // three's projections also flip the depth axis, so a projection that does
  // not mirror the image has the same determinant sign as three's own default
  // camera (negative), and the old y-down camera had the opposite one.
  const handedness = (camera: THREE.Camera) =>
    Math.sign(camera.projectionMatrix.determinant());
  const reference = handedness(new THREE.OrthographicCamera());

  it('uses a projection with the handedness of three’s default camera', () => {
    const {camera} = view();
    expect(handedness(camera)).toBe(reference);
  });

  it('would have caught the old y-down projection', () => {
    const old = new THREE.OrthographicCamera(0, W, 0, H, -1000, 1000);
    old.updateProjectionMatrix();
    expect(handedness(old)).not.toBe(reference);
  });

  it('keeps the vertical flip in the scene graph, where three accounts for it', () => {
    const {screenSpace} = view();
    expect(screenSpace.matrixWorld.determinant()).toBeLessThan(0);
  });

  it('places screen coordinates exactly where the old y-down camera did', () => {
    const {camera, screenSpace} = view();
    const old = new THREE.OrthographicCamera(0, W, 0, H, -1000, 1000);
    old.updateProjectionMatrix();
    old.updateMatrixWorld(true);

    const points: Array<[number, number]> = [
      [0, 0],
      [W, H],
      [W / 2, H / 4],
      [37, 611],
    ];
    for (const [x, y] of points) {
      const now = new THREE.Vector3(x, y, 0)
        .applyMatrix4(screenSpace.matrixWorld)
        .project(camera);
      const before = new THREE.Vector3(x, y, 0).project(old);
      expect(now.x).toBeCloseTo(before.x, 6);
      expect(now.y).toBeCloseTo(before.y, 6);
    }
  });
});
