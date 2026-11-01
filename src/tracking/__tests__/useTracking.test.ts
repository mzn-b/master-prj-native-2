import {act, renderHook} from '@testing-library/react-native';
import * as VisionCamera from 'react-native-vision-camera';
import type {RawDetection} from 'tracking-native';
import {FACE_STRIDE, HAND_STRIDE, VALUES_PER_POINT} from '../../native/landmarkFormat';
import {useTracking, type UseTrackingOptions} from '../useTracking';
import {PerformanceTracker} from '../PerformanceTracker';

/**
 * The measurement pipeline: camera frame -> detect -> per-frame statistics on
 * the worklet runtime -> drained onto the tracker -> submitted metrics.
 *
 * Under jest the worklet callbacks run as plain functions (the setup mocks
 * make shared values plain objects), so the test drives the real hook frame by
 * frame and reads what a session would submit. Device behaviour — the worklet
 * runtimes, the camera, MediaPipe — is checked on the phones.
 */

const mockDetector = {
  configure: jest.fn(),
  detect: jest.fn(),
  release: jest.fn(),
  modelLoadTimeMs: 420,
  gpuDelegateActive: true,
};
jest.mock('tracking-native', () => ({
  createLandmarkDetector: () => mockDetector,
  createNativeMetrics: () => ({snapshot: () => ({})}),
}));
jest.mock('../../metrics/nativeMetrics', () => ({getNativeMetrics: () => ({})}));
/**
 * The shared jest setup returns a new object from useSharedValue on every
 * render, which is enough for rendering components but not for this hook:
 * start() and the frame callback must see the same shared value, as they do
 * with the real Reanimated, where a shared value is stable for the component's
 * lifetime.
 */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return {
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef(null);
      if (ref.current === null) {
        ref.current = {value: initial};
      }
      return ref.current;
    },
    useDerivedValue: (factory: () => unknown) => ({value: factory()}),
    useAnimatedReaction: () => undefined,
  };
});

const BASE_OPTIONS: UseTrackingOptions = {
  mode: 'combined',
  smoothingEnabled: true,
  dynamicInferenceEnabled: true,
  gpuDelegateEnabled: true,
};

interface Spec {
  faces?: number;
  hands?: number;
  inferenceMs?: number;
  noseX?: number;
  noseY?: number;
  gestureScore?: number;
  topBlendshape?: number;
}

function detection({
  faces = 1,
  hands = 0,
  inferenceMs = 20,
  noseX = 0.5,
  noseY = 0.5,
  gestureScore,
  topBlendshape,
}: Spec = {}): RawDetection {
  const values = new Float32Array(faces * FACE_STRIDE + hands * HAND_STRIDE);
  if (faces > 0) {
    values[VALUES_PER_POINT] = noseX; // nose tip, landmark 1
    values[VALUES_PER_POINT + 1] = noseY;
  }
  const shapes = new Float32Array(faces > 0 && topBlendshape !== undefined ? 52 : 0);
  if (shapes.length > 0) {
    shapes[7] = topBlendshape as number;
    shapes[3] = (topBlendshape as number) / 2;
  }
  return {
    timestampMs: Date.now(),
    faceCount: faces,
    handCount: hands,
    landmarks: values.buffer,
    blendshapes: shapes.buffer,
    blendshapeNames: [],
    hands: Array.from({length: hands}, () => ({
      handedness: 'Right',
      gesture: 'Open_Palm',
      gestureScore,
    })) as unknown as RawDetection['hands'],
    inferenceTimeMs: inferenceMs,
  };
}

let busy = false;

function frame() {
  return {width: 1280, height: 720, dispose: jest.fn()};
}

async function setup(options: Partial<UseTrackingOptions> = {}) {
  const hook = await renderHook(() => useTracking({...BASE_OPTIONS, ...options}));
  const calls = (VisionCamera.useFrameOutput as jest.Mock).mock.calls;
  const onFrame = (f: ReturnType<typeof frame>) => calls[calls.length - 1][0].onFrame(f);
  return {hook, onFrame};
}

/** One camera frame that reaches the detector, `ms` after the previous one. */
async function feed(onFrame: (f: ReturnType<typeof frame>) => void, spec: Spec | Error, ms = 33) {
  await act(() => {
    jest.advanceTimersByTime(ms);
  });
  if (spec instanceof Error) {
    mockDetector.detect.mockImplementationOnce(() => {
      throw spec;
    });
  } else {
    mockDetector.detect.mockReturnValueOnce(detection(spec));
  }
  const f = frame();
  onFrame(f);
  return f;
}

beforeEach(() => {
  jest.useFakeTimers({now: new Date('2026-10-28T12:00:00Z')});
  busy = false;
  mockDetector.configure.mockReset();
  mockDetector.detect.mockReset();
  mockDetector.release.mockReset();
  (VisionCamera.useAsyncRunner as jest.Mock).mockReturnValue({
    runAsync: (work: () => void) => {
      if (busy) {
        return false;
      }
      work();
      return true;
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useTracking', () => {
  it('configures the detector from the options when a session starts', async () => {
    const {hook} = await setup({mode: 'face', gpuDelegateEnabled: false});
    await act(() => hook.result.current.start());
    expect(mockDetector.configure).toHaveBeenCalledWith({
      mode: 'face',
      maxFaces: 1,
      maxHands: 2,
      useGpu: false,
    });
    expect(hook.result.current.isRunning).toBe(true);
  });

  it('ignores camera frames while no session is running', async () => {
    const {onFrame} = await setup();
    const f = frame();
    onFrame(f);
    expect(f.dispose).toHaveBeenCalled();
    expect(mockDetector.detect).not.toHaveBeenCalled();
  });

  it('records every processed frame, its inference time and the frame size', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {inferenceMs: 20});
    await feed(onFrame, {inferenceMs: 30});
    await feed(onFrame, {inferenceMs: 40});
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({
      frameCount: 3,
      avgInferenceTimeMs: 30,
      frameWidth: 1280,
      frameHeight: 720,
    });
  });

  it('drains the frames of the last half-second on stop (fix of 2026-10-28)', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    for (let i = 0; i < 5; i++) {
      await feed(onFrame, {}, 20); // 100 ms in all: no metrics tick has run
    }
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({frameCount: 5});
  });

  it('records model load time and delegate state only once a frame was processed', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(hook.result.current.metrics?.modelLoadTimeMs).toBeUndefined();

    await feed(onFrame, {});
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({modelLoadTimeMs: 420, gpuDelegateActive: true});
  });

  it('counts a detection error instead of losing it', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {});
    const failed = await feed(onFrame, new Error('MediaPipe rejected the frame'));
    const metrics = await act(() => hook.result.current.stop());
    expect(failed.dispose).toHaveBeenCalled();
    expect(metrics).toMatchObject({frameCount: 1, errorCount: 1});
  });

  it('counts a frame the busy runner refused as a busy drop', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {});
    busy = true;
    const refused = frame();
    onFrame(refused);
    const metrics = await act(() => hook.result.current.stop());
    expect(refused.dispose).toHaveBeenCalled();
    expect(metrics).toMatchObject({droppedFramesBusy: 1, droppedFramesGovernor: 0, droppedFrames: 1});
  });

  it('lets the governor skip frames under load and counts the skips apart (F15)', async () => {
    const {hook, onFrame} = await setup({dynamicInferenceEnabled: true});
    await act(() => hook.result.current.start());
    // Sustained slow inference: the governor raises the skip after enough samples.
    for (let tick = 0; tick < 30; tick++) {
      await feed(onFrame, {inferenceMs: 120}, 250);
      await act(() => {
        jest.advanceTimersByTime(250);
      });
    }
    expect(hook.result.current.currentFrameSkip).toBeGreaterThan(1);
    for (let i = 0; i < 6; i++) {
      await feed(onFrame, {inferenceMs: 120}, 33);
    }
    const metrics: Record<string, unknown> | undefined = await act(() => hook.result.current.stop());
    expect(metrics?.droppedFramesGovernor as number).toBeGreaterThan(0);
    expect(metrics?.maxFrameSkip as number).toBeGreaterThan(1);
    expect(metrics?.avgFrameSkip as number).toBeGreaterThan(1);
  });

  it('never skips frames with the governor off', async () => {
    const {hook, onFrame} = await setup({dynamicInferenceEnabled: false});
    await act(() => hook.result.current.start());
    for (let tick = 0; tick < 30; tick++) {
      await feed(onFrame, {inferenceMs: 120}, 250);
      await act(() => {
        jest.advanceTimersByTime(250);
      });
    }
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({droppedFramesGovernor: 0, maxFrameSkip: 1});
  });

  it('counts tracking loss and recovery per frame (NF7)', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {faces: 1});
    await feed(onFrame, {faces: 0}, 40); // lost
    await feed(onFrame, {faces: 0}, 40);
    await feed(onFrame, {faces: 0}, 40);
    await feed(onFrame, {faces: 1}, 40); // recovered 120 ms after the loss
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({
      trackingLostCount: 1,
      trackingRecoveryTimeMs: 120,
      consecutiveTrackingLossMax: 3,
    });
  });

  it('times the first detection from Start (NF3)', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {faces: 0, hands: 0}, 100);
    await feed(onFrame, {faces: 0, hands: 0}, 100);
    await feed(onFrame, {faces: 1}, 100);
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({timeToFirstDetectionMs: 300});
  });

  it('derives the quality metrics from the raw detections', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {faces: 1, hands: 1, gestureScore: 0.8, topBlendshape: 0.6, noseX: 0.5});
    await feed(onFrame, {faces: 1, hands: 1, gestureScore: 0.6, topBlendshape: 0.4, noseX: 0.53});
    await feed(onFrame, {faces: 1, hands: 1, gestureScore: 0.7, topBlendshape: 0.2, noseX: 0.5, noseY: 0.54});
    const metrics: Record<string, unknown> | undefined = await act(() => hook.result.current.stop());
    expect(metrics?.avgGestureConfidence).toBeCloseTo(0.7, 3);
    expect(metrics?.avgBlendshapeActivation).toBeCloseTo(0.4, 3);
    // Nose moves 0.03, then 0.05: mean 0.04.
    expect(metrics?.landmarkStability).toBeCloseTo(0.04, 4);
  });

  it('submits the run conditions the session was started with', async () => {
    const {hook, onFrame} = await setup({
      smoothingEnabled: false,
      dynamicInferenceEnabled: false,
      gpuDelegateEnabled: false,
    });
    await act(() => hook.result.current.start());
    await feed(onFrame, {});
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({
      smoothingEnabled: false,
      dynamicInferenceEnabled: false,
      gpuDelegateEnabled: false,
      inferenceThreading: 'async-runner',
    });
  });

  it('releases the detector on stop and tolerates a release failure', async () => {
    const {hook} = await setup();
    await act(() => hook.result.current.start());
    mockDetector.release.mockImplementationOnce(() => {
      throw new Error('never configured');
    });
    await act(() => hook.result.current.stop());
    expect(mockDetector.release).toHaveBeenCalled();
    expect(hook.result.current.isRunning).toBe(false);
  });

  it('starts a fresh measurement window on resetSession without stopping', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {});
    await feed(onFrame, {});
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    await act(() => hook.result.current.resetSession());
    await feed(onFrame, {});
    const metrics = await act(() => hook.result.current.stop());
    expect(hook.result.current.isRunning).toBe(false);
    expect(metrics).toMatchObject({frameCount: 1});
  });

  /*
   * The metrics tick used to read the worklets' counters, hand them to the
   * tracker and then reset them. A frame counted in between was lost, or a
   * batch already handed over was written back and counted twice. Measured
   * on 2026-11-01 against counters nothing reset: the Pixel 7 submitted 150
   * of 181 processed frames, the iPhone 371 of 323. In these tests a frame
   * arrives inside the tracker call the drain makes, which is that window.
   */
  it('counts a frame that finishes while the tick is draining', async () => {
    const {hook, onFrame} = await setup({dynamicInferenceEnabled: false});
    await act(() => hook.result.current.start());
    await feed(onFrame, {});
    await feed(onFrame, {});
    const original = PerformanceTracker.prototype.recordBatch;
    const spy = jest
      .spyOn(PerformanceTracker.prototype, 'recordBatch')
      .mockImplementationOnce(function (
        this: PerformanceTracker,
        batch: Parameters<PerformanceTracker['recordBatch']>[0],
      ) {
        original.call(this, batch);
        mockDetector.detect.mockReturnValueOnce(detection({}));
        onFrame(frame());
      });
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    spy.mockRestore();
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({frameCount: 3});
  });

  it('counts a frame refused while the tick is draining', async () => {
    const {hook, onFrame} = await setup({dynamicInferenceEnabled: false});
    await act(() => hook.result.current.start());
    await feed(onFrame, {});
    busy = true;
    onFrame(frame());
    const original = PerformanceTracker.prototype.recordDroppedFrame;
    const spy = jest
      .spyOn(PerformanceTracker.prototype, 'recordDroppedFrame')
      .mockImplementationOnce(function (
        this: PerformanceTracker,
        ...args: Parameters<PerformanceTracker['recordDroppedFrame']>
      ) {
        original.apply(this, args);
        onFrame(frame());
      });
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    spy.mockRestore();
    const metrics = await act(() => hook.result.current.stop());
    expect(metrics).toMatchObject({droppedFramesBusy: 2, droppedFrames: 2});
  });

  it('publishes metrics on the half-second tick while running', async () => {
    const {hook, onFrame} = await setup();
    await act(() => hook.result.current.start());
    await feed(onFrame, {});
    expect(hook.result.current.metrics).toBeNull();
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(hook.result.current.metrics?.frameCount).toBe(1);
  });
});
