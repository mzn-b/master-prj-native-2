import {useMemo} from 'react';
import {NitroModules} from 'react-native-nitro-modules';
import type {NativeThreadFactory} from 'react-native-vision-camera';
import {createWorkletRuntimeForThread} from 'react-native-vision-camera-worklets';
import {createSynchronizable, scheduleOnRuntime} from 'react-native-worklets';

/**
 * Runs detection on its own thread and, when frames arrive faster than it
 * finishes them, always takes the newest one next.
 *
 * VisionCamera's AsyncRunner refuses a frame while a job runs, and the caller
 * drops it. On Android that hardly ever happens: CameraX (KEEP_ONLY_LATEST)
 * holds the next frame back until the previous one is disposed and then hands
 * over the newest. iOS delivers every frame regardless, so a frame arriving
 * during an inference was dropped and the detector then sat idle until the
 * following one. Whenever an inference took longer than one frame interval,
 * iOS therefore processed only every other frame: 15 instead of ~28 per second
 * at 35 ms (sessions 190, 191 and 216, 2026-11-01/02). The PWA's video-frame
 * callback, like CameraX, delivers the newest frame once the detector is free.
 *
 * Here every frame is queued on the runner's thread with a sequence number. A
 * job that finds a newer frame queued behind it drops its own frame instead of
 * running, so the newest frame starts as soon as the previous job ends. At most
 * MAX_QUEUED frames wait, so a long stall such as the model load cannot hold
 * on to the camera's buffers; beyond that a frame is refused, as before.
 */
export interface NewestFrameRunner {
  /**
   * Queue `task` for this frame. If a newer frame has been queued by the time
   * this one's turn comes, `drop` runs instead, on the runner's thread. Returns
   * false when the queue is full; the caller then drops the frame itself.
   */
  submit(task: () => void, drop: () => void): boolean;
}

/** Frames that may wait behind the running job: three frame intervals at 30 fps. */
export const MAX_QUEUED = 3;

interface Counter {
  getBlocking(): number;
  setBlocking(value: number): void;
}

/**
 * The queueing rule, apart from the thread it runs on. `submitted` is written
 * by the camera thread alone and `started` by the runner alone.
 */
export function createNewestFrameRunner(
  schedule: (job: () => void) => void,
  submitted: Counter = createSynchronizable(0),
  started: Counter = createSynchronizable(0),
): NewestFrameRunner {
  return {
    submit(task, drop) {
      'worklet';
      const id = submitted.getBlocking() + 1;
      if (id - started.getBlocking() > MAX_QUEUED) {
        return false;
      }
      submitted.setBlocking(id);
      schedule(() => {
        'worklet';
        started.setBlocking(id);
        if (submitted.getBlocking() !== id) {
          drop();
        } else {
          task();
        }
      });
      return true;
    },
  };
}

/** One runner, on a native thread of its own, for the lifetime of the component. */
export function useNewestFrameRunner(): NewestFrameRunner {
  return useMemo(() => {
    const factory = NitroModules.createHybridObject<NativeThreadFactory>('NativeThreadFactory');
    const runtime = createWorkletRuntimeForThread(factory.createNativeThread('detection-runner'));
    return createNewestFrameRunner(job => {
      'worklet';
      scheduleOnRuntime(runtime, job);
    });
  }, []);
}
