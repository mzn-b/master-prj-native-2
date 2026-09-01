import React from 'react';
import {render} from '@testing-library/react-native';
import {DebugHud} from '../DebugHud';

describe('DebugHud (F14)', () => {
  it('reports when nothing is tracked', async () => {
    const {getByText} = await render(<DebugHud tracking={null} />);
    expect(getByText(/nicht erkannt/)).toBeTruthy();
  });

  it('shows the gesture and handedness when a hand is tracked', async () => {
    const {getByText} = await render(
      <DebugHud
        tracking={{
          timestampMs: 0,
          mode: 'combined',
          hand: {
            hands: [
              {
                handedness: 'Left',
                landmarks: [{x: 0.25, y: 0.5}],
                gesture: 'Victory',
                gestureScore: 0.91,
              },
            ],
          },
        }}
      />,
    );
    expect(getByText(/Victory/)).toBeTruthy();
    expect(getByText(/Left/)).toBeTruthy();
  });
});
