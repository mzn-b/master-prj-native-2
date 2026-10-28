import React from 'react';
import {render} from '@testing-library/react-native';
import {CameraScreen} from '../CameraScreen';

jest.mock('../../render/filters/Crown3D', () => ({Crown3D: () => null}));
jest.mock('../../config/buildInfo', () => ({
  APP_VERSION: '0.0.1+test',
  BUILT_AT: '2026-10-28T00:00:00.000Z',
  SURVEY_BUILD: true,
}));

/**
 * In the survey build participants hold the phone and the operator selects the
 * view and the filters; nothing else may be changeable. Every run must use the
 * study settings (thesis §6.1.2): combined tracking, smoothing, the adaptive
 * inference rate and the GPU delegate on. Those are the defaults, so hiding the
 * controls fixes them there.
 */
describe('CameraScreen, survey build', () => {
  it('keeps what the operator needs', async () => {
    const {getByText} = await render(<CameraScreen />);
    expect(getByText('Start')).toBeTruthy();
    expect(getByText('Landmarks')).toBeTruthy();
    expect(getByText('Filters')).toBeTruthy();
    expect(getByText(/\(Studie\)/)).toBeTruthy();
  });

  it('offers no tracking-mode choice', async () => {
    const {queryByText} = await render(<CameraScreen />);
    expect(queryByText('face')).toBeNull();
    expect(queryByText('hand')).toBeNull();
    expect(queryByText('combined')).toBeNull();
  });

  it('offers none of the measurement settings', async () => {
    const {queryByText, queryByTestId} = await render(<CameraScreen />);
    for (const label of [
      'F9: Glättung (One Euro)',
      'F15: Dynamische Inferenzrate',
      'GPU-Delegate',
      'Performance-HUD',
      'F14: Debug-HUD',
    ]) {
      expect(queryByText(label)).toBeNull();
    }
    expect(queryByTestId('settings-sheet')).toBeNull();
  });
});
