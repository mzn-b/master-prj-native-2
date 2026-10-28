import React from 'react';
import {render} from '@testing-library/react-native';
import type {RawDetection} from 'tracking-native';
import {LandmarkOverlay} from '../LandmarkOverlay';
import type {ViewGeometry} from '../coordinates';
import {FACE_STRIDE, HAND_STRIDE} from '../../native/landmarkFormat';

/**
 * Records what the overlay would draw: each Skia path keeps the circles added
 * to it, and each <Path> is rendered as a host view carrying its props, so the
 * test can read the dots, their radius and their colour.
 */
jest.mock('@shopify/react-native-skia', () => {
  const React2 = require('react');
  const {View} = require('react-native');
  return {
    Canvas: ({children}: {children: React.ReactNode}) =>
      React2.createElement(View, {testID: 'canvas'}, children),
    Path: (props: Record<string, unknown>) =>
      React2.createElement(View, {testID: 'sk-path', skPath: props.path, skColor: props.color}),
    Skia: {
      Path: {
        Make: () => {
          const circles: Array<[number, number, number]> = [];
          return {circles, addCircle: (x: number, y: number, r: number) => circles.push([x, y, r])};
        },
      },
    },
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

function detection(faces: number, hands: number): RawDetection {
  const values = new Float32Array(faces * FACE_STRIDE + hands * HAND_STRIDE).fill(0.5);
  if (faces > 0) {
    values[0] = 0.25; // first face landmark
    values[1] = 0.75;
  }
  return {
    timestampMs: 0,
    faceCount: faces,
    handCount: hands,
    landmarks: values.buffer,
    blendshapes: new ArrayBuffer(0),
    blendshapeNames: [],
    hands: [],
    inferenceTimeMs: 0,
  };
}

async function draw(value: RawDetection | null, mode: 'face' | 'hand' | 'combined', g = geometry) {
  const screen = await render(
    <LandmarkOverlay latest={{value} as never} geometry={g} mode={mode} />,
  );
  const [face, hand] = screen.getAllByTestId('sk-path');
  return {
    face: face.props.skPath.value.circles as Array<[number, number, number]>,
    faceColor: face.props.skColor,
    hand: hand.props.skPath.value.circles as Array<[number, number, number]>,
    handColor: hand.props.skColor,
  };
}

describe('LandmarkOverlay (F4)', () => {
  // @testing-library/react-native 14 made render() async.
  it('renders with no detection yet, and draws nothing', async () => {
    const {face, hand} = await draw(null, 'combined');
    expect(face).toHaveLength(0);
    expect(hand).toHaveLength(0);
  });

  it('draws every face and hand landmark as a dot in combined mode', async () => {
    const {face, hand} = await draw(detection(1, 2), 'combined');
    expect(face).toHaveLength(478);
    expect(hand).toHaveLength(42);
  });

  it('draws face dots 4 px and hand dots 6 px across, in the PWA colours', async () => {
    const {face, hand, faceColor, handColor} = await draw(detection(1, 1), 'combined');
    expect(new Set(face.map(c => c[2]))).toEqual(new Set([2]));
    expect(new Set(hand.map(c => c[2]))).toEqual(new Set([3]));
    expect(faceColor).toBe('rgba(0, 255, 128, 0.8)');
    expect(handColor).toBe('rgba(0, 204, 255, 0.9)');
  });

  it('draws only the face in face mode and only the hands in hand mode', async () => {
    const faceOnly = await draw(detection(1, 1), 'face');
    expect(faceOnly.face).toHaveLength(478);
    expect(faceOnly.hand).toHaveLength(0);
    const handOnly = await draw(detection(1, 1), 'hand');
    expect(handOnly.face).toHaveLength(0);
    expect(handOnly.hand).toHaveLength(21);
  });

  it('places dots through the shared projection', async () => {
    const {face} = await draw(detection(1, 0), 'face');
    expect(face[0][0]).toBeCloseTo(50);
    expect(face[0][1]).toBeCloseTo(150);
    const mirrored = await draw(detection(1, 0), 'face', {...geometry, mirrorX: true});
    expect(mirrored.face[0][0]).toBeCloseTo(150);
  });
});
