import React from 'react';
import {act, render} from '@testing-library/react-native';
import type {RawDetection} from 'tracking-native';
import {SparklesFilter} from '../SparklesFilter';
import type {ViewGeometry} from '../../coordinates';
import {FACE_STRIDE, HAND_STRIDE, VALUES_PER_POINT} from '../../../native/landmarkFormat';

/**
 * Sparkles spawn at the five fingertips of every tracked hand on a 33 ms tick
 * and fade out; the physics is pinned in sparkleSystem.test.ts, so this test
 * pins where and how often the component spawns, and what it draws.
 */
let mockImage: object | null = null;
jest.mock('@shopify/react-native-skia', () => {
  const React2 = require('react');
  const {View} = require('react-native');
  return {
    Group: ({children}: {children: React.ReactNode}) =>
      React2.createElement(View, {testID: 'sk-group'}, children),
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

const FINGERTIPS = [4, 8, 12, 16, 20];

function hands(count: number, withFace = true): RawDetection {
  const faces = withFace ? 1 : 0;
  const values = new Float32Array(faces * FACE_STRIDE + count * HAND_STRIDE);
  for (let h = 0; h < count; h++) {
    FINGERTIPS.forEach((tip, i) => {
      const at = faces * FACE_STRIDE + h * HAND_STRIDE + tip * VALUES_PER_POINT;
      values[at] = 0.1 + 0.1 * i; // tips at x = 20, 40, 60, 80, 100 px
      values[at + 1] = 0.25 + 0.5 * h; // hand 0 at y = 50, hand 1 at y = 150
    });
  }
  return {
    timestampMs: 0,
    faceCount: faces,
    handCount: count,
    landmarks: values.buffer,
    blendshapes: new ArrayBuffer(0),
    blendshapeNames: [],
    hands: [],
    inferenceTimeMs: 0,
  };
}

let random: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockImage = {};
  random = jest.spyOn(Math, 'random').mockReturnValue(0); // always spawn
});

afterEach(() => {
  random.mockRestore();
  jest.useRealTimers();
});

describe('SparklesFilter', () => {
  it('draws nothing until the image has loaded', async () => {
    mockImage = null;
    const screen = await render(<SparklesFilter latest={{value: hands(1)} as never} geometry={geometry} />);
    expect(screen.queryByTestId('sk-group')).toBeNull();
  });

  it('spawns one sparkle per fingertip of each hand per tick', async () => {
    const latest = {value: hands(2)};
    const screen = await render(<SparklesFilter latest={latest as never} geometry={geometry} />);
    await act(() => {
      jest.advanceTimersByTime(33);
    });
    const images = screen.getAllByTestId('sk-image');
    expect(images).toHaveLength(10);
    const first = images[0].props.skProps;
    // Spawned at the projected fingertip, drawn 18 px square around it.
    expect(first.x).toBeCloseTo(20 - 9);
    expect(first.y).toBeCloseTo(50 - 9);
    expect(first.width).toBe(18);
    expect(first.height).toBe(18);
    expect(first.opacity).toBeGreaterThan(0);
  });

  it('spawns at a fingertip only with the spawn probability', async () => {
    random.mockReturnValue(0.9); // above 0.35: no spawn
    const screen = await render(<SparklesFilter latest={{value: hands(1)} as never} geometry={geometry} />);
    await act(() => {
      jest.advanceTimersByTime(33 * 5);
    });
    expect(screen.queryAllByTestId('sk-image')).toHaveLength(0);
  });

  it('lets the sparkles fade out once the hands are gone', async () => {
    const latest = {value: hands(1) as RawDetection | null};
    const screen = await render(<SparklesFilter latest={latest as never} geometry={geometry} />);
    await act(() => {
      jest.advanceTimersByTime(33);
    });
    expect(screen.getAllByTestId('sk-image')).toHaveLength(5);
    latest.value = null;
    await act(() => {
      jest.advanceTimersByTime(1300); // past the longest lifetime
    });
    expect(screen.queryAllByTestId('sk-image')).toHaveLength(0);
  });

  it('stops its timer when unmounted', async () => {
    const setSpy = jest.spyOn(globalThis, 'setInterval');
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    const screen = await render(<SparklesFilter latest={{value: hands(1)} as never} geometry={geometry} />);
    const started = setSpy.mock.results.map(r => r.value);
    await screen.unmount();
    expect(started.length).toBeGreaterThan(0);
    for (const id of started) {
      expect(clearSpy).toHaveBeenCalledWith(id);
    }
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
