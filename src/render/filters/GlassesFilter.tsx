import React from 'react';
import {Group, Image, useImage} from '@shopify/react-native-skia';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import {VALUES_PER_POINT, faceOffset, type RawDetection} from '../../native/landmarkFormat';
import {projectNormalized, type ViewGeometry} from '../coordinates';

/** MediaPipe face-mesh indices for the outer eye corners. */
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

/** Width of the image relative to the inter-eye distance. */
const WIDTH_SCALE = 2.1;
/** Source aspect ratio of sunglasses.png (height / width). */
const ASPECT = 0.42;

export interface GlassesFilterProps {
  latest: SharedValue<RawDetection | null>;
  geometry: ViewGeometry;
}

/** 2D sunglasses anchored to the eye line, rotating and scaling with the face. */
export function GlassesFilter({latest, geometry}: GlassesFilterProps): React.JSX.Element | null {
  const image = useImage(require('../../../assets/filters/sunglasses.png'));

  const transform = useDerivedValue(() => {
    const detection = latest.value;
    if (!detection || detection.faceCount === 0) {
      return {x: 0, y: 0, width: 0, height: 0, rotation: 0};
    }
    const values = new Float32Array(detection.landmarks);
    const base = faceOffset(0);
    const readPoint = (index: number) => {
      const at = base + index * VALUES_PER_POINT;
      return projectNormalized(values[at], values[at + 1], geometry);
    };

    const left = readPoint(LEFT_EYE_OUTER);
    const right = readPoint(RIGHT_EYE_OUTER);
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const eyeDistance = Math.hypot(dx, dy);
    const width = eyeDistance * WIDTH_SCALE;
    const height = width * ASPECT;

    return {
      x: (left.x + right.x) / 2 - width / 2,
      y: (left.y + right.y) / 2 - height / 2,
      width,
      height,
      rotation: Math.atan2(dy, dx),
    };
  }, [latest, geometry]);

  const groupTransform = useDerivedValue(
    () => [
      {translateX: transform.value.x + transform.value.width / 2},
      {translateY: transform.value.y + transform.value.height / 2},
      {rotate: transform.value.rotation},
      {translateX: -(transform.value.x + transform.value.width / 2)},
      {translateY: -(transform.value.y + transform.value.height / 2)},
    ],
    [transform],
  );

  const x = useDerivedValue(() => transform.value.x, [transform]);
  const y = useDerivedValue(() => transform.value.y, [transform]);
  const width = useDerivedValue(() => transform.value.width, [transform]);
  const height = useDerivedValue(() => transform.value.height, [transform]);

  if (!image) {
    return null;
  }

  return (
    <Group transform={groupTransform}>
      <Image image={image} x={x} y={y} width={width} height={height} fit="fill" />
    </Group>
  );
}
