import * as THREE from 'three/webgpu';

/**
 * The crown's camera and the scene-graph root its content is placed under.
 *
 * Children of `screenSpace` are positioned in view pixels with y growing
 * downward, the convention the landmark projection already uses. The flip from
 * that convention to three's y-up world lives here, in the scene graph, and not
 * in the camera's projection.
 *
 * It used to live in the projection (`top = 0, bottom = height`). A projection
 * that mirrors the image reverses the winding of every triangle, but three
 * decides which side of a face is its front from the object's world matrix
 * alone. With the crown's double-sided material it took every visible face for
 * a back face and turned its normal away from the lights, so the crown was lit
 * by the ambient term alone and rendered far darker than in the PWA. A mirror
 * in the world matrix is one three does account for.
 */
export function createCrownView(
  width: number,
  height: number,
): {camera: THREE.OrthographicCamera; screenSpace: THREE.Group} {
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -1000, 1000);
  const screenSpace = new THREE.Group();
  screenSpace.scale.set(1, -1, 1);
  screenSpace.position.set(0, height, 0);
  return {camera, screenSpace};
}
