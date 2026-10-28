import React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';
import * as VisionCamera from 'react-native-vision-camera';
import {CameraScreen} from '../CameraScreen';
import {drawnRenderBackend, DEFAULT_ACTIVE_FILTERS} from '../../render/filters/types';
import type {PerformanceMetricsDTO} from '../../domain/tracking.dto';

/**
 * The session lifecycle as the operator drives it: Start, Stop, the view and
 * the filter buttons, and what each of them submits. The tracking hook is
 * replaced by a stand-in that records how it is called, and the backend call
 * is mocked; the measurement pipeline itself is covered in useTracking.test.ts.
 */
const mockTracking = {
  start: jest.fn(),
  stop: jest.fn(),
  resetSession: jest.fn(),
  metrics: null as PerformanceMetricsDTO | null,
  options: null as Record<string, unknown> | null,
};
jest.mock('../../tracking/useTracking', () => {
  const React2 = require('react');
  return {
    useTracking: (options: Record<string, unknown>) => {
      const [isRunning, setRunning] = React2.useState(false);
      mockTracking.options = options;
      return {
        isRunning,
        latest: {value: null},
        frameSize: {value: {width: 0, height: 0}},
        metrics: mockTracking.metrics,
        currentFrameSkip: 1,
        frameOutput: {},
        start: () => {
          mockTracking.start();
          setRunning(true);
        },
        stop: () => {
          setRunning(false);
          return mockTracking.stop();
        },
        resetSession: mockTracking.resetSession,
      };
    },
  };
});

const mockSubmit = jest.fn(async () => ({}));
jest.mock('../../api/trackingApi', () => ({
  submitTrackingSession: (...args: unknown[]) => mockSubmit(...(args as [])),
}));

const mockPrewarm = jest.fn();
jest.mock('../../render/filters/Crown3D', () => ({
  Crown3D: () => null,
  prewarmCrownModel: () => mockPrewarm(),
}));

const sessionMetrics = (frameCount: number) =>
  ({frameCount, avgInferenceTimeMs: 25}) as unknown as PerformanceMetricsDTO;
const PATHS = {landmarks: 'skia', flat: 'skia', crown: 'webgpu'};

beforeEach(() => {
  mockTracking.start.mockReset();
  mockTracking.stop.mockReset();
  mockTracking.resetSession.mockReset();
  mockTracking.metrics = null;
  mockSubmit.mockClear();
  mockPrewarm.mockClear();
});

describe('CameraScreen sessions', () => {
  it('starts tracking on Start and submits the session on Stop', async () => {
    mockTracking.stop.mockReturnValue(sessionMetrics(900));
    const {getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Start'));
    expect(mockTracking.start).toHaveBeenCalledTimes(1);
    expect(getByText('Tracking aktiv')).toBeTruthy();

    await fireEvent.press(getByText('Stop'));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const [mode, metrics, filters] = mockSubmit.mock.calls[0] as unknown as [string, PerformanceMetricsDTO, string[]];
    expect(mode).toBe('combined');
    expect(metrics.frameCount).toBe(900);
    expect(metrics.renderBackend).toBe(drawnRenderBackend('landmarks', DEFAULT_ACTIVE_FILTERS, PATHS));
    expect(filters).toEqual([]);
  });

  it('never submits a session without frames', async () => {
    mockTracking.stop.mockReturnValue(sessionMetrics(0));
    const {getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Start'));
    await fireEvent.press(getByText('Stop'));
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('submits the drawn filters and their drawing paths from the filter view', async () => {
    mockTracking.stop.mockReturnValue(sessionMetrics(600));
    const {getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Filters'));
    await fireEvent.press(getByText('Crown'));
    await fireEvent.press(getByText('Glasses'));
    expect(mockPrewarm).toHaveBeenCalled(); // the crown is decoded before Start
    expect(mockTracking.options?.mode).toBe('combined');

    await fireEvent.press(getByText('Start'));
    await fireEvent.press(getByText('Stop'));
    const [mode, metrics, filters] = mockSubmit.mock.calls[0] as unknown as [string, PerformanceMetricsDTO, string[]];
    expect(mode).toBe('combined');
    expect(filters).toEqual(['crown', 'glasses']);
    expect(metrics.renderBackend).toBe(
      drawnRenderBackend('filters', {crown: true, glasses: true, sparkles: false}, PATHS),
    );
  });

  it('closes the measurement window when a filter is toggled mid-run', async () => {
    const {getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Filters'));
    await fireEvent.press(getByText('Glasses'));
    await fireEvent.press(getByText('Start'));

    mockTracking.metrics = sessionMetrics(300);
    await fireEvent.press(getByText('Sparkles')); // rerenders with the new metrics first
    mockSubmit.mockClear();
    await fireEvent.press(getByText('Sparkles'));

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const [, metrics, filters] = mockSubmit.mock.calls[0] as unknown as [string, PerformanceMetricsDTO, string[]];
    expect(metrics.frameCount).toBe(300);
    expect(filters).toEqual(['glasses', 'sparkles']); // the set that was drawn
    expect(mockTracking.resetSession).toHaveBeenCalled();
  });

  it('keeps the view while a session runs and clears the filters when it changes', async () => {
    mockTracking.stop.mockReturnValue(sessionMetrics(10));
    const {getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Filters'));
    await fireEvent.press(getByText('Crown'));
    await fireEvent.press(getByText('Start'));
    await fireEvent.press(getByText('Landmarks')); // ignored while running
    await fireEvent.press(getByText('Stop'));
    const [, , filters] = mockSubmit.mock.calls[0] as unknown as [string, unknown, string[]];
    expect(filters).toEqual(['crown']);

    await fireEvent.press(getByText('Landmarks'));
    await fireEvent.press(getByText('Filters'));
    mockSubmit.mockClear();
    await fireEvent.press(getByText('Start'));
    await fireEvent.press(getByText('Stop'));
    const [, , after] = mockSubmit.mock.calls[0] as unknown as [string, unknown, string[]];
    expect(after).toEqual([]);
  });

  it('passes the settings to the tracking hook', async () => {
    const {getAllByRole, getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('face'));
    const [smoothing, dynamic, gpu] = getAllByRole('switch');
    await fireEvent(smoothing, 'valueChange', false);
    await fireEvent(dynamic, 'valueChange', false);
    await fireEvent(gpu, 'valueChange', false);
    expect(mockTracking.options).toEqual({
      mode: 'face',
      smoothingEnabled: false,
      dynamicInferenceEnabled: false,
      gpuDelegateEnabled: false,
    });
  });

  it('stops a running session when the camera reports an error', async () => {
    mockTracking.stop.mockReturnValue(undefined);
    const {getByText} = await render(<CameraScreen />);
    await fireEvent.press(getByText('Start'));
    const calls = (VisionCamera.useCamera as jest.Mock).mock.calls;
    await act(() => calls[calls.length - 1][0].onError(new Error('camera disconnected')));
    expect(mockTracking.stop).toHaveBeenCalled();
    expect(getByText('Kamera: camera disconnected')).toBeTruthy();
  });

  it('shows the performance HUD when switched on', async () => {
    mockTracking.metrics = {
      ...sessionMetrics(42),
      fps: 30,
      avgFps: 29,
      avgFrameProcessingTimeMs: 26,
      droppedFrames: 0,
      warmupComplete: true,
    } as unknown as PerformanceMetricsDTO;
    const {getAllByRole, queryByTestId} = await render(<CameraScreen />);
    expect(queryByTestId('performance-hud')).toBeNull();
    await fireEvent(getAllByRole('switch')[3], 'valueChange', true);
    expect(queryByTestId('performance-hud')).not.toBeNull();
  });
});
