import React from 'react';
import {render} from '@testing-library/react-native';
import {LandmarkOverlay} from '../LandmarkOverlay';
import type {ViewGeometry} from '../coordinates';

const geometry: ViewGeometry = {
  frameWidth: 100,
  frameHeight: 100,
  viewWidth: 200,
  viewHeight: 200,
  rotation: 0,
  mirrorX: true,
  resizeMode: 'cover',
};

describe('LandmarkOverlay (F4)', () => {
  // @testing-library/react-native 14 made render() async.
  it('renders with no detection yet', async () => {
    const {toJSON} = await render(
      <LandmarkOverlay latest={{value: null} as never} geometry={geometry} mode="combined" />,
    );
    expect(toJSON()).toBeTruthy();
  });
});
