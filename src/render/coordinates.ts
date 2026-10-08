/**
 * The single implementation of the normalized-landmark to view-pixel transform.
 *
 * MediaPipe emits image-normalized coordinates (x, y in 0..1, origin top-left)
 * in the camera frame's own orientation. Turning those into overlay pixels needs
 * four steps, always in this order:
 *
 *     viewPoint = fit( mirror( rotate( toPreviewFov( normalizedPoint ) ) ) )
 *
 * Every overlay — landmark dots, 2D filters, the 3D crown — must use this module.
 * The previous app re-derived the same maths in three separate components, which
 * is why its overlays could disagree about where a face was.
 *
 * `toPreviewFov` exists because the analysis stream and the preview stream are
 * two separate camera outputs that do NOT share a field of view. VisionCamera
 * negotiates them independently, and for the preview it "only prefers Formats at
 * least as large as the screen, ignoring aspect ratio" — so a 16:9 analysis
 * frame is routinely displayed by a 4:3 preview. Projecting landmarks with the
 * analysis frame's own dimensions then scales them against a reference that is
 * not what the user is looking at, and every overlay lands uniformly too large.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface ViewGeometry {
  /** Camera frame size in sensor orientation, before rotation. */
  frameWidth: number;
  frameHeight: number;
  /**
   * Size of the preview stream, in the same sensor orientation as the frame.
   *
   * This is a *different camera output* from the frame, negotiated separately,
   * and its aspect ratio is routinely different. Landmarks are normalized to the
   * frame; the preview is what the user sees. When the two aspects differ, the
   * narrower field of view is a centre-crop of the wider one, and landmarks have
   * to be re-normalized into preview space before being fitted into the view.
   *
   * Leave undefined when the preview stream is the frame stream — the browser
   * case, and the degenerate case before the session has resolved a resolution.
   */
  previewWidth?: number;
  previewHeight?: number;
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

/**
 * Re-normalize a frame-normalized point into preview-normalized space.
 *
 * The two streams share a sensor and a centre, so the one with the narrower
 * aspect is a centre-crop of the other along a single axis. Only that axis is
 * rescaled; the axis they agree on passes through untouched.
 *
 * Both sizes are given in the same (sensor) orientation, so this runs before
 * rotation and needs no knowledge of it.
 */
function toPreviewFov(x: number, y: number, g: ViewGeometry): Point2D {
  'worklet';
  const pw = g.previewWidth;
  const ph = g.previewHeight;
  if (pw === undefined || ph === undefined || pw <= 0 || ph <= 0) {
    return {x, y};
  }

  const frameAspect = g.frameWidth / g.frameHeight;
  const previewAspect = pw / ph;

  if (frameAspect < previewAspect) {
    // The frame is narrower: it is a horizontal centre-crop of the preview, so
    // its full width spans only frameAspect/previewAspect of the preview's.
    return {x: 0.5 + (x - 0.5) * (frameAspect / previewAspect), y};
  }
  if (frameAspect > previewAspect) {
    // The frame is wider: a vertical centre-crop.
    return {x, y: 0.5 + (y - 0.5) * (previewAspect / frameAspect)};
  }
  return {x, y};
}

export function projectNormalized(x: number, y: number, g: ViewGeometry): Point2D {
  // Called from Reanimated/Skia worklets: an imported plain function cannot be
  // invoked on the UI runtime, it fails as a "remote function".
  'worklet';
  // Landmarks are normalized to the analysis frame; everything downstream is in
  // the preview's field of view, which is what the view actually displays.
  const inPreview = toPreviewFov(x, y, g);
  const rotated = rotateNormalized(inPreview.x, inPreview.y, g.rotation);
  const nx = g.mirrorX ? 1 - rotated.x : rotated.x;
  const ny = rotated.y;

  // The fit is against the preview stream — the thing on screen — falling back
  // to the frame when no preview size is known.
  const sourceW = g.previewWidth ?? g.frameWidth;
  const sourceH = g.previewHeight ?? g.frameHeight;

  // A quarter turn swaps which axis maps to the view's width.
  const quarterTurn = g.rotation === 90 || g.rotation === 270;
  const frameW = quarterTurn ? sourceH : sourceW;
  const frameH = quarterTurn ? sourceW : sourceH;

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
