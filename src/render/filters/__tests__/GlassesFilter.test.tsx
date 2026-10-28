import React from 'react';
import {render} from '@testing-library/react-native';
import type {RawDetection} from 'tracking-native';
import {GlassesFilter} from '../GlassesFilter';
import type {ViewGeometry} from '../../coordinates';
import {FACE_STRIDE, VALUES_PER_POINT} from '../../../native/landmarkFormat';

/**
 * The glasses are placed from the outer eye corners: 1.5 times their distance
 * wide, the image's own aspect tall, centred between them and rotated with the
 * eye line. filterParity.test.ts in the PWA pins the constants to this file;
 * this test pins what the component does with them.
 */
let mockImage: {width: () => number; height: () => number} | null = null;
jest.mock('@shopify/react-native-skia', () => {
  const React2 = require('react');
  const {View} = require('react-native');
  return {
    Group: (props: {transform: unknown; children: React.ReactNode}) =>
      React2.createElement(View, {testID: 'sk-group', skTransform: props.transform}, props.children),
    Image: (props: Record<string, unknown>) =>
      React2.createElement(View, {testID: 'sk-image', skProps: props}),
    useImage: () => mockImage,
  };
});

const geometry: ViewGeometry = {
  frameWidth: 100,
  frameHeight: 100,
  viewWidth: 200,
  viewHeight: 200,
  rotation: 0,
  mirrorX: false,
  resizeMode: 'cover',
};

const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

function face(left: [number, number], right: [number, number]): RawDetection {
  const values = new Float32Array(FACE_STRIDE);
  values.set(left, LEFT_EYE_OUTER * VALUES_PER_POINT);
  values.set(right, RIGHT_EYE_OUTER * VALUES_PER_POINT);
  return {
    timestampMs: 0,
    faceCount: 1,
    handCount: 0,
    landmarks: values.buffer,
    blendshapes: new ArrayBuffer(0),
    blendshapeNames: [],
    hands: [],
    inferenceTimeMs: 0,
  };
}

async function place(value: RawDetection | null, g = geometry) {
  const screen = await render(<GlassesFilter latest={{value} as never} geometry={g} />);
  const image = screen.queryByTestId('sk-image');
  if (!image) {
    return null;
  }
  const p = image.props.skProps;
  const transform = screen.getByTestId('sk-group').props.skTransform.value;
  return {
    x: p.x.value,
    y: p.y.value,
    width: p.width.value,
    height: p.height.value,
    rotation: transform[2].rotate,
    fit: p.fit,
  };
}

describe('GlassesFilter', () => {
  beforeEach(() => {
    mockImage = {width: () => 955, height: () => 350};
  });

  it('draws nothing until the image has loaded', async () => {
    mockImage = null;
    expect(await place(face([0.4, 0.5], [0.6, 0.5]))).toBeNull();
  });

  it('spans 1.5 eye distances at the image aspect, centred on the eyes', async () => {
    // Eyes at (80, 100) and (120, 100) on screen: 40 px apart.
    const g = await place(face([0.4, 0.5], [0.6, 0.5]));
    expect(g?.width).toBeCloseTo(60);
    expect(g?.height).toBeCloseTo(60 * (350 / 955));
    expect(g?.x).toBeCloseTo(100 - 30);
    expect(g?.y).toBeCloseTo(100 - (60 * (350 / 955)) / 2);
    expect(g?.rotation).toBeCloseTo(0);
    expect(g?.fit).toBe('fill');
  });

  it('rotates with the eye line', async () => {
    const g = await place(face([0.4, 0.45], [0.6, 0.55]));
    expect(g?.rotation).toBeCloseTo(Math.atan2(20, 40));
  });

  it('stays upright in the mirrored preview', async () => {
    // Mirroring puts landmark 33 on the right; ordering by screen x keeps the
    // angle near zero instead of a half turn.
    const g = await place(face([0.4, 0.5], [0.6, 0.5]), {...geometry, mirrorX: true});
    expect(g?.rotation).toBeCloseTo(0);
    expect(g?.x).toBeCloseTo(70);
  });

  it('collapses to nothing when no face is tracked', async () => {
    const g = await place({...face([0.4, 0.5], [0.6, 0.5]), faceCount: 0});
    expect(g?.width).toBe(0);
    expect(g?.height).toBe(0);
  });
});
