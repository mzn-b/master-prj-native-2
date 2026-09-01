import {VALUES_PER_POINT} from '../native/landmarkFormat';

/**
 * Head pose from face landmarks, used to place the 3D crown.
 *
 * A pure function over the packed buffer — no React, no Skia, no three.js —
 * which is why it can be unit-tested without a renderer.
 */

const FOREHEAD_TOP = 10;
const CHIN = 152;
const LEFT_TEMPLE = 234;
const RIGHT_TEMPLE = 454;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const NOSE_TIP = 1;

export interface HeadPose {
  /** Radians, positive when the head turns towards its right temple. */
  yaw: number;
  /** Radians, positive when the chin rises. */
  pitch: number;
  /** Radians, positive when the head tilts clockwise on screen. */
  roll: number;
  /** Temple-to-temple distance in normalized units. */
  scale: number;
  /** Midpoint between the temples, normalized. */
  centre: {x: number; y: number};
}

export function estimateHeadPose(values: Float32Array, offset: number): HeadPose {
  const point = (index: number) => {
    const at = offset + index * VALUES_PER_POINT;
    return {x: values[at], y: values[at + 1], z: values[at + 2]};
  };

  const leftEye = point(LEFT_EYE_OUTER);
  const rightEye = point(RIGHT_EYE_OUTER);
  const leftTemple = point(LEFT_TEMPLE);
  const rightTemple = point(RIGHT_TEMPLE);
  const forehead = point(FOREHEAD_TOP);
  const chin = point(CHIN);
  const nose = point(NOSE_TIP);

  // Roll: the angle of the eye line.
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  // Yaw: how far the nose sits from the midpoint between the temples,
  // as a fraction of half the face width.
  const centreX = (leftTemple.x + rightTemple.x) / 2;
  const centreY = (leftTemple.y + rightTemple.y) / 2;
  const halfWidth = Math.abs(rightTemple.x - leftTemple.x) / 2 || 1e-6;
  const yaw = Math.atan((nose.x - centreX) / halfWidth);

  // Pitch: where the nose falls along the forehead-to-chin axis. A neutral face
  // puts it slightly above the midpoint, so measure against that.
  const faceHeight = chin.y - forehead.y || 1e-6;
  const noseRatio = (nose.y - forehead.y) / faceHeight;
  const NEUTRAL_NOSE_RATIO = 0.58;
  const pitch = Math.atan((NEUTRAL_NOSE_RATIO - noseRatio) * 2);

  return {
    yaw,
    pitch,
    roll,
    scale: Math.hypot(rightTemple.x - leftTemple.x, rightTemple.y - leftTemple.y),
    centre: {x: centreX, y: centreY},
  };
}
