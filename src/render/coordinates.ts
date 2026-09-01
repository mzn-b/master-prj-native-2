/**
 * The single implementation of the normalized-landmark to view-pixel transform.
 *
 * MediaPipe emits image-normalized coordinates (x, y in 0..1, origin top-left)
 * in the camera frame's own orientation. Turning those into overlay pixels needs
 * three steps, always in this order:
 *
 *     viewPoint = fit( mirror( rotate( normalizedPoint ) ) )
 *
 * Every overlay — landmark dots, 2D filters, the 3D crown — must use this module.
 * The previous app re-derived the same maths in three separate components, which
 * is why its overlays could disagree about where a face was.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface ViewGeometry {
  /** Camera frame size in sensor orientation, before rotation. */
  frameWidth: number;
  frameHeight: number;
  /** Preview box size in device-independent pixels. */
  viewWidth: number;
  viewHeight: number;
  /** Clockwise rotation applied to the frame before display. */
  rotation: Rotation;
  /** Selfie mirroring, applied after rotation. */
  mirrorX: boolean;
  /** How the frame is fitted into the preview box. */
  resizeMode: 'cover' | 'contain';
}

export interface Point2D {
  x: number;
  y: number;
}

/** Rotate a normalized point clockwise within the unit square. */
function rotateNormalized(x: number, y: number, rotation: Rotation): Point2D {
  'worklet';
  switch (rotation) {
    case 90:
      return {x: 1 - y, y: x};
    case 180:
      return {x: 1 - x, y: 1 - y};
    case 270:
      return {x: y, y: 1 - x};
    default:
      return {x, y};
  }
}

export function projectNormalized(x: number, y: number, g: ViewGeometry): Point2D {
  // Called from Reanimated/Skia worklets: an imported plain function cannot be
  // invoked on the UI runtime, it fails as a "remote function".
  'worklet';
  const rotated = rotateNormalized(x, y, g.rotation);
  const nx = g.mirrorX ? 1 - rotated.x : rotated.x;
  const ny = rotated.y;

  // A quarter turn swaps which frame axis maps to the view's width.
  const quarterTurn = g.rotation === 90 || g.rotation === 270;
  const frameW = quarterTurn ? g.frameHeight : g.frameWidth;
  const frameH = quarterTurn ? g.frameWidth : g.frameHeight;

  const scaleX = g.viewWidth / frameW;
  const scaleY = g.viewHeight / frameH;
  const scale = g.resizeMode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const drawnWidth = frameW * scale;
  const drawnHeight = frameH * scale;
  const offsetX = (g.viewWidth - drawnWidth) / 2;
  const offsetY = (g.viewHeight - drawnHeight) / 2;

  return {x: offsetX + nx * drawnWidth, y: offsetY + ny * drawnHeight};
}

export function projectPoint(p: Point2D, g: ViewGeometry): Point2D {
  'worklet';
  return projectNormalized(p.x, p.y, g);
}
