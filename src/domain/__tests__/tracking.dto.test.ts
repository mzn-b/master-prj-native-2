import * as fs from 'fs';
import * as path from 'path';
import type {PerformanceMetricsDTO, TrackingDTO} from '../tracking.dto';

describe('tracking DTO contract (F7)', () => {
  it('is byte-identical to the PWA copy', () => {
    const ours = fs.readFileSync(path.join(__dirname, '../tracking.dto.ts'), 'utf8');
    const pwa = fs.readFileSync(
      path.join(__dirname, '../../../../master-prj-pwa/src/domain/tracking.dto.ts'),
      'utf8',
    );
    expect(ours).toBe(pwa);
  });

  it('accepts the tracking shape both apps produce', () => {
    const dto: TrackingDTO = {
      timestampMs: 1000,
      mode: 'combined',
      face: {
        faces: [
          {
            landmarks: [{x: 0.5, y: 0.5, z: 0}],
            blendshapes: [{categoryName: 'jawOpen', score: 0.2}],
          },
        ],
      },
      hand: {
        hands: [
          {
            handedness: 'Left',
            landmarks: [{x: 0.1, y: 0.2}],
            gesture: 'Victory',
            gestureScore: 0.9,
          },
        ],
      },
    };
    expect(dto.face?.faces[0].blendshapes?.[0].categoryName).toBe('jawOpen');
    expect(dto.hand?.hands[0].gesture).toBe('Victory');
  });

  it('requires the metric fields the backend persists as non-null', () => {
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
    expect(metrics.warmupComplete).toBe(true);
  });
});
