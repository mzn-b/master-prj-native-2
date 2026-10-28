import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {ModeSelector} from '../ModeSelector';

/** F5 — face, hand or combined, chosen only while no session runs. */
describe('ModeSelector', () => {
  it('reports the chosen mode', async () => {
    const onChange = jest.fn();
    const {getByText} = await render(<ModeSelector mode="combined" disabled={false} onChange={onChange} />);
    for (const mode of ['face', 'hand', 'combined']) {
      await fireEvent.press(getByText(mode));
      expect(onChange).toHaveBeenLastCalledWith(mode);
    }
  });

  it('cannot be changed while a session runs', async () => {
    const onChange = jest.fn();
    const {getByText} = await render(<ModeSelector mode="combined" disabled onChange={onChange} />);
    await fireEvent.press(getByText('face'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
