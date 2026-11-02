import {renderHook} from '@testing-library/react-native';
import {RUN_DURATION_MS, useAutoStop} from '../useAutoStop';

describe('useAutoStop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stops a run once, after exactly the run length', async () => {
    const stop = jest.fn();
    await renderHook(() => useAutoStop(true, true, stop));
    jest.advanceTimersByTime(RUN_DURATION_MS - 1);
    expect(stop).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled (the full build) or not running', async () => {
    const stop = jest.fn();
    await renderHook(() => useAutoStop(true, false, stop));
    await renderHook(() => useAutoStop(false, true, stop));
    jest.advanceTimersByTime(RUN_DURATION_MS * 2);
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not restart the clock when the stop callback changes mid-run', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const {rerender} = await renderHook(({stop}: {stop: () => void}) => useAutoStop(true, true, stop), {
      initialProps: {stop: first},
    });
    jest.advanceTimersByTime(RUN_DURATION_MS / 2);
    await rerender({stop: second});
    jest.advanceTimersByTime(RUN_DURATION_MS / 2);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending stop when the run is stopped by hand', async () => {
    const stop = jest.fn();
    const {rerender} = await renderHook(({running}: {running: boolean}) => useAutoStop(running, true, stop), {
      initialProps: {running: true},
    });
    jest.advanceTimersByTime(10_000);
    await rerender({running: false});
    jest.advanceTimersByTime(RUN_DURATION_MS);
    expect(stop).not.toHaveBeenCalled();
  });
});
