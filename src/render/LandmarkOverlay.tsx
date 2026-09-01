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

/** Finger chains of the MediaPipe hand skeleton, drawn as connecting lines. */
const HAND_CONNECTIONS: ReadonlyArray<readonly number[]> = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
  [5, 9, 13, 17],
];

const FACE_DOT_RADIUS = 1.4;
const HAND_DOT_RADIUS = 3;

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
    for (let h = 0; h < detection.handCount; h++) {
      const base = handOffset(detection.faceCount, h);
      const at = (index: number) => {
        const offset = base + index * VALUES_PER_POINT;
        return projectNormalized(values[offset], values[offset + 1], geometry);
      };

      for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
        const point = at(i);
        path.addCircle(point.x, point.y, HAND_DOT_RADIUS);
      }
      for (const chain of HAND_CONNECTIONS) {
        const start = at(chain[0]);
        path.moveTo(start.x, start.y);
        for (let i = 1; i < chain.length; i++) {
          const next = at(chain[i]);
          path.lineTo(next.x, next.y);
        }
      }
    }
    return path;
  });

  const style = useMemo(() => StyleSheet.absoluteFill, []);

  return (
    <Canvas style={style} pointerEvents="none">
      <Path path={facePath} color="#4ade80" style="fill" />
      <Path path={handPath} color="#60a5fa" style="stroke" strokeWidth={2} />
    </Canvas>
  );
}
