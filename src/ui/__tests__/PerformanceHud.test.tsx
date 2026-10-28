import React from 'react';
import {render} from '@testing-library/react-native';
import {PerformanceHud} from '../PerformanceHud';
import type {PerformanceMetricsDTO} from '../../domain/tracking.dto';

/** F8 — the live readout, shown only in the full build. */
const metrics = (overrides: Partial<PerformanceMetricsDTO> = {}): PerformanceMetricsDTO =>
  ({
    fps: 29.96,
    avgFps: 28.44,
    avgInferenceTimeMs: 21.26,
    avgFrameProcessingTimeMs: 23.04,
    frameCount: 812,
    droppedFrames: 9,
    memoryUsageMB: 612.34,
    cpuUsagePercent: 88.6,
    thermalState: 'nominal',
    batteryLevel: 77,
    warmupComplete: true,
    ...overrides,
  }) as PerformanceMetricsDTO;

describe('PerformanceHud', () => {
  it('shows nothing before the first metrics arrive', async () => {
    const {queryByTestId} = await render(<PerformanceHud metrics={null} currentFrameSkip={1} />);
    expect(queryByTestId('performance-hud')).toBeNull();
  });

  it('formats every readout', async () => {
    const {getByText} = await render(<PerformanceHud metrics={metrics()} currentFrameSkip={2} />);
    expect(getByText('30.0 (Ø 28.4)')).toBeTruthy();
    expect(getByText('21.3 ms')).toBeTruthy();
    expect(getByText('23.0 ms')).toBeTruthy();
    expect(getByText('812 (9 verworfen)')).toBeTruthy();
    expect(getByText('612.3 MB')).toBeTruthy();
    expect(getByText('89 %')).toBeTruthy();
    expect(getByText('nominal')).toBeTruthy();
    expect(getByText('77 %')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('fertig')).toBeTruthy();
  });

  it('marks missing platform metrics and a running warm-up', async () => {
    const {getAllByText, getByText} = await render(
      <PerformanceHud
        metrics={metrics({
          memoryUsageMB: undefined,
          cpuUsagePercent: undefined,
          thermalState: undefined,
          batteryLevel: undefined,
          warmupComplete: false,
        })}
        currentFrameSkip={1}
      />,
    );
    expect(getAllByText('—')).toHaveLength(4);
    expect(getByText('läuft')).toBeTruthy();
  });
});
