import React, {useMemo} from 'react';
import {Canvas, Path, Skia} from '@shopify/react-native-skia';
import {StyleSheet} from 'react-native';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import type {TrackingMode} from '../domain/tracking.dto';
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  VALUES_PER_POINT,
  faceOffset,
  handOffset,
  type RawDetection,
} from '../native/landmarkFormat';
import {projectNormalized, type ViewGeometry} from './coordinates';

/**
 * Dot size and colour, matched to the PWA's DEFAULT_LANDMARK_CONFIG
 * (src/rendering/types.ts there): its `size` is a diameter in logical pixels,
 * 4 for the face and 6 for a hand, and both are filled. The landmark view is
 * the study's baseline and is shown to participants, so both apps draw the
 * same dots.
 */
const FACE_DOT_RADIUS = 2;
const HAND_DOT_RADIUS = 3;
const FACE_DOT_COLOR = 'rgba(0, 255, 128, 0.8)';
const HAND_DOT_COLOR = 'rgba(0, 204, 255, 0.9)';

export interface LandmarkOverlayProps {
  latest: SharedValue<RawDetection | null>;
  geometry: ViewGeometry;
  mode: TrackingMode;
}

/**
 * F4 — draws every detected landmark over the camera preview.
 *
 * Builds one path per modality per frame rather than one node per landmark: a
 * face is 478 points, and 478 declarative elements at 30 fps is what made the
 * previous app's overlay slow.
 */
export function LandmarkOverlay({
  latest,
  geometry,
  mode,
}: LandmarkOverlayProps): React.JSX.Element {
  const showFace = mode === 'face' || mode === 'combined';
  const showHand = mode === 'hand' || mode === 'combined';

  const facePath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const detection = latest.value;
    if (!detection || !showFace) {
      return path;
    }
    const values = new Float32Array(detection.landmarks);
    for (let f = 0; f < detection.faceCount; f++) {
      const base = faceOffset(f);
      for (let i = 0; i < FACE_LANDMARK_COUNT; i++) {
        const at = base + i * VALUES_PER_POINT;
        const point = projectNormalized(values[at], values[at + 1], geometry);
        path.addCircle(point.x, point.y, FACE_DOT_RADIUS);
      }
    }
    return path;
  });

  const handPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const detection = latest.value;
    if (!detection || !showHand) {
      return path;
    }
    const values = new Float32Array(detection.landmarks);
    // Points only, no skeleton between them. The PWA draws none, and the
    // landmark view is the study's baseline condition, so drawing the finger
    // chains here made the native baseline draw more than the web one (NF4).
    for (let h = 0; h < detection.handCount; h++) {
      const base = handOffset(detection.faceCount, h);
      for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
        const at = base + i * VALUES_PER_POINT;
        const point = projectNormalized(values[at], values[at + 1], geometry);
        path.addCircle(point.x, point.y, HAND_DOT_RADIUS);
      }
    }
    return path;
  });

  const style = useMemo(() => StyleSheet.absoluteFill, []);

  return (
    <Canvas style={style} pointerEvents="none">
      <Path path={facePath} color={FACE_DOT_COLOR} style="fill" />
      <Path path={handPath} color={HAND_DOT_COLOR} style="fill" />
    </Canvas>
  );
}
