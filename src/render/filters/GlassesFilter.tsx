import React from 'react';
import {Group, Image, useImage} from '@shopify/react-native-skia';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import {VALUES_PER_POINT, faceOffset, type RawDetection} from '../../native/landmarkFormat';
import {projectNormalized, type ViewGeometry} from '../coordinates';

/** MediaPipe face-mesh indices for the outer eye corners. */
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

/**
 * Width of the image relative to the outer-eye-corner distance. Landmarks 33
 * and 263 are the OUTER corners, so they already span most of the face — a
 * large multiplier here made the glasses far too wide.
 */
const WIDTH_SCALE = 1.25;
/**
 * Fallback aspect (height / width) for the frames before the image has loaded.
 *
 * The real value is read off the decoded image below. It used to be hard-coded
 * at 0.42 while sunglasses.png is 955x350 — an aspect of 0.366 — so the frames
 * were drawn ~15% too tall and `fit="fill"` stretched them. That distortion was
 * present on both platforms but only became obvious once the overlay geometry
 * stopped scaling everything up uniformly.
 */
const FALLBACK_ASPECT = 350 / 955;

export interface GlassesFilterProps {
  latest: SharedValue<RawDetection | null>;
  geometry: ViewGeometry;
}

/** 2D sunglasses anchored to the eye line, rotating and scaling with the face. */
export function GlassesFilter({latest, geometry}: GlassesFilterProps): React.JSX.Element | null {
  const image = useImage(require('../../../assets/filters/sunglasses.png'));

  // Taken from the decoded image so it cannot drift from the asset.
  const aspect = image ? image.height() / image.width() : FALLBACK_ASPECT;

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

    // The preview is mirrored, so landmark 33 ("left eye" in face space) lands
    // on the right of the screen. Order the points by screen x before taking
    // the angle, otherwise the image is rotated by 180 degrees — upside down.
    const a = readPoint(LEFT_EYE_OUTER);
    const b = readPoint(RIGHT_EYE_OUTER);
    const left = a.x <= b.x ? a : b;
    const right = a.x <= b.x ? b : a;
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const eyeDistance = Math.hypot(dx, dy);
    const width = eyeDistance * WIDTH_SCALE;
    const height = width * aspect;

    return {
      x: (left.x + right.x) / 2 - width / 2,
      y: (left.y + right.y) / 2 - height / 2,
      width,
      height,
      rotation: Math.atan2(dy, dx),
    };
  });

  const groupTransform = useDerivedValue(
    () => [
      {translateX: transform.value.x + transform.value.width / 2},
      {translateY: transform.value.y + transform.value.height / 2},
      {rotate: transform.value.rotation},
      {translateX: -(transform.value.x + transform.value.width / 2)},
      {translateY: -(transform.value.y + transform.value.height / 2)},
    ],
  );

  const x = useDerivedValue(() => transform.value.x);
  const y = useDerivedValue(() => transform.value.y);
  const width = useDerivedValue(() => transform.value.width);
  const height = useDerivedValue(() => transform.value.height);

  if (!image) {
    return null;
  }

  return (
    <Group transform={groupTransform}>
      <Image image={image} x={x} y={y} width={width} height={height} fit="fill" />
    </Group>
  );
}
