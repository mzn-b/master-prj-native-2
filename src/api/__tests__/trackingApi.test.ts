import {submitTrackingSession} from '../trackingApi';
import type {PerformanceMetricsDTO} from '../../domain/tracking.dto';

const metrics: PerformanceMetricsDTO = {
  fps: 30,
  avgFps: 29,
  minFps: 20,
  maxFps: 31,
  inferenceTimeMs: 12,
  avgInferenceTimeMs: 13,
  frameProcessingTimeMs: 20,
  avgFrameProcessingTimeMs: 21,
  frameCount: 100,
  droppedFrames: 2,
  sessionDurationMs: 3400,
  warmupComplete: true,
  trackingLostCount: 1,
};

describe('submitTrackingSession', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 1,
        sessionId: 'abc',
        platform: 'ANDROID_NATIVE',
        recordedAt: '',
        message: 'ok',
      }),
    }) as never;
  });

  it('posts to the sessions endpoint', async () => {
    await submitTrackingSession('combined', metrics, ['crown']);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/tracking/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends a native platform value and the active filters', async () => {
    await submitTrackingSession('combined', metrics, ['crown', 'sparkles']);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(['IOS_NATIVE', 'ANDROID_NATIVE']).toContain(body.platform);
    expect(body.activeFilters).toEqual(['crown', 'sparkles']);
  });

  it('upper-cases the mode to match the backend enum', async () => {
    await submitTrackingSession('face', metrics, []);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.mode).toBe('FACE');
  });

  it('includes device info and a session id', async () => {
    await submitTrackingSession('hand', metrics, []);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.deviceInfo.osVersion).toBeTruthy();
    expect(body.sessionId).toHaveLength(36);
    expect(body.recordedAt).toContain('T');
  });

  it('sends a fresh session id per submission', async () => {
    await submitTrackingSession('face', metrics, []);
    await submitTrackingSession('face', metrics, []);
    const first = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).sessionId;
    const second = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).sessionId;
    expect(first).not.toBe(second);
  });

  it('resolves to null instead of throwing when the network fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(submitTrackingSession('face', metrics, [])).resolves.toBeNull();
  });

  it('resolves to null on a non-2xx response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ok: false, status: 500} as never);
    await expect(submitTrackingSession('face', metrics, [])).resolves.toBeNull();
  });
});
