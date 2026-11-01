import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {CameraScreen} from '../CameraScreen';
import type {PerformanceMetricsDTO} from '../../domain/tracking.dto';

const mockPrewarm = jest.fn();
jest.mock('../../render/filters/Crown3D', () => ({
  Crown3D: () => null,
  prewarmCrownModel: () => mockPrewarm(),
}));
/** A stand-in for the tracking hook, as in CameraScreen.session.test.tsx. */
const mockStop = jest.fn();
jest.mock('../../tracking/useTracking', () => {
  const React2 = require('react');
  return {
    useTracking: () => {
      const [isRunning, setRunning] = React2.useState(false);
      return {
        isRunning,
        latest: {value: null},
        frameSize: {value: {width: 0, height: 0}},
        metrics: null,
        currentFrameSkip: 1,
        frameOutput: {},
        start: () => setRunning(true),
        stop: () => {
          setRunning(false);
          return mockStop();
        },
        resetSession: jest.fn(),
      };
    },
  };
});
const mockSubmit = jest.fn(async () => ({}));
jest.mock('../../api/trackingApi', () => ({
  submitTrackingSession: (...args: unknown[]) => mockSubmit(...(args as [])),
}));
jest.mock('../../config/buildInfo', () => ({
  APP_VERSION: '0.0.1+test',
  BUILT_AT: '2026-10-28T00:00:00.000Z',
  SURVEY_BUILD: true,
}));

/**
 * In the survey build participants hold the phone and the operator selects one
 * of the study's two conditions, the landmark view or the filter view with all
 * three filters; nothing else may be changeable. Every run must use the study
 * settings (thesis §6.1.2): combined tracking, smoothing, the adaptive
 * inference rate and the GPU delegate on. Those are the defaults, so hiding the
 * controls fixes them there.
 */
beforeEach(() => {
  mockPrewarm.mockClear();
  mockStop.mockReset();
  mockSubmit.mockClear();
});

const submittedFilters = () => (mockSubmit.mock.calls[0] as unknown as [string, unknown, string[]])[2];

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

  it('offers no filter selection: the filter view draws all three filters', async () => {
    mockStop.mockReturnValue({frameCount: 600} as unknown as PerformanceMetricsDTO);
    const {getByText, queryByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Filters'));
    for (const label of ['Crown', 'Glasses', 'Sparkles']) {
      expect(queryByText(label)).toBeNull();
    }
    expect(mockPrewarm).toHaveBeenCalled(); // the crown is decoded before Start
    await fireEvent.press(getByText('Start'));
    await fireEvent.press(getByText('Stop'));
    expect(submittedFilters()).toEqual(['crown', 'glasses', 'sparkles']);
  });

  it('draws no filter in the landmark view, also after the filter view', async () => {
    mockStop.mockReturnValue({frameCount: 600} as unknown as PerformanceMetricsDTO);
    const {getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Filters'));
    await fireEvent.press(getByText('Landmarks'));
    await fireEvent.press(getByText('Start'));
    await fireEvent.press(getByText('Stop'));
    expect(submittedFilters()).toEqual([]);
  });
});
