import {DEFAULT_SMOOTHING_CONFIG, LandmarkSmoother} from '../LandmarkSmoother';
import type {TrackingDTO} from '../../domain/tracking.dto';

function frame(timestampMs: number, x: number): TrackingDTO {
  return {
    timestampMs,
    mode: 'combined',
    face: {
      faces: [
        {
          landmarks: [{x, y: 0.5, z: 0}],
          blendshapes: [{categoryName: 'jawOpen', score: 0.4}],
        },
      ],
    },
    hand: {
      hands: [
        {
          handedness: 'Right',
          landmarks: [{x, y: 0.5}],
          gesture: 'Open_Palm',
          gestureScore: 0.8,
        },
      ],
    },
  };
}

describe('LandmarkSmoother', () => {
  it('returns the input untouched when disabled', () => {
    const smoother = new LandmarkSmoother({...DEFAULT_SMOOTHING_CONFIG, enabled: false});
    const input = frame(0, 0.2);
    expect(smoother.smooth(input)).toBe(input);
  });

  it('passes the first sample through unchanged', () => {
    const smoother = new LandmarkSmoother();
    expect(smoother.smooth(frame(0, 0.2)).face!.faces[0].landmarks[0].x).toBeCloseTo(0.2, 6);
  });

  it('damps a step change instead of following it', () => {
    const smoother = new LandmarkSmoother();
    smoother.smooth(frame(0, 0.2));
    const x = smoother.smooth(frame(33, 0.8)).face!.faces[0].landmarks[0].x;
    expect(x).toBeGreaterThan(0.2);
    expect(x).toBeLessThan(0.8);
  });

  it('converges towards a held value across many frames', () => {
    const smoother = new LandmarkSmoother();
    smoother.smooth(frame(0, 0.2));
    let x = 0;
    for (let i = 1; i <= 60; i++) {
      x = smoother.smooth(frame(i * 33, 0.8)).face!.faces[0].landmarks[0].x;
    }
    expect(x).toBeCloseTo(0.8, 2);
  });

  // Regression: the PWA's smoother rebuilds these objects and drops the extra
  // fields, so F12/F13 data vanishes whenever smoothing is on (the default).
  it('preserves blendshapes while smoothing (F12)', () => {
    const smoother = new LandmarkSmoother();
    const out = smoother.smooth(frame(0, 0.2));
    expect(out.face!.faces[0].blendshapes).toEqual([{categoryName: 'jawOpen', score: 0.4}]);
  });

  it('preserves gesture and handedness while smoothing (F13)', () => {
    const smoother = new LandmarkSmoother();
    const out = smoother.smooth(frame(0, 0.2));
    expect(out.hand!.hands[0].gesture).toBe('Open_Palm');
    expect(out.hand!.hands[0].gestureScore).toBe(0.8);
    expect(out.hand!.hands[0].handedness).toBe('Right');
  });

  it('keeps preserving them after many smoothed frames', () => {
    const smoother = new LandmarkSmoother();
    let out = smoother.smooth(frame(0, 0.2));
    for (let i = 1; i <= 10; i++) {
      out = smoother.smooth(frame(i * 33, 0.3));
    }
    expect(out.face!.faces[0].blendshapes).toHaveLength(1);
    expect(out.hand!.hands[0].gesture).toBe('Open_Palm');
  });

  it('forgets filter state on reset', () => {
    const smoother = new LandmarkSmoother();
    smoother.smooth(frame(0, 0.2));
    smoother.reset();
    expect(smoother.smooth(frame(33, 0.9)).face!.faces[0].landmarks[0].x).toBeCloseTo(0.9, 6);
  });

  it('resets when smoothing is switched off via setConfig', () => {
    const smoother = new LandmarkSmoother();
    smoother.smooth(frame(0, 0.2));
    smoother.setConfig({enabled: false});
    smoother.setConfig({enabled: true});
    expect(smoother.smooth(frame(33, 0.9)).face!.faces[0].landmarks[0].x).toBeCloseTo(0.9, 6);
  });
});
