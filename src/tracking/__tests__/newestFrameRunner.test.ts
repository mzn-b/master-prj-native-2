import {createNewestFrameRunner, MAX_QUEUED} from '../newestFrameRunner';

/**
 * The queueing rule of the detection runner. The runner's thread is replaced
 * by a list of jobs that the test runs one at a time, in order, as the serial
 * native queue does; `runNext` is "the previous inference has finished".
 */
function setup() {
  const queue: Array<() => void> = [];
  const runner = createNewestFrameRunner(job => {
    queue.push(job);
  });
  const ran: string[] = [];
  const dropped: string[] = [];
  const submit = (name: string) =>
    runner.submit(
      () => ran.push(name),
      () => dropped.push(name),
    );
  const runNext = () => queue.shift()?.();
  const runAll = () => {
    while (queue.length > 0) {
      runNext();
    }
  };
  return {submit, runNext, runAll, ran, dropped};
}

describe('newestFrameRunner', () => {
  it('runs every frame when the detector keeps up', () => {
    const {submit, runNext, ran, dropped} = setup();
    for (const name of ['a', 'b', 'c']) {
      expect(submit(name)).toBe(true);
      runNext();
    }
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(dropped).toEqual([]);
  });

  it('takes the newest frame next and drops the ones it supersedes', () => {
    const {submit, runNext, runAll, ran, dropped} = setup();
    submit('a');
    runNext(); // a is running…
    submit('b'); // …while b and c arrive
    submit('c');
    runAll();
    expect(ran).toEqual(['a', 'c']);
    expect(dropped).toEqual(['b']);
  });

  it('runs a frame that arrived during an inference as soon as it ends', () => {
    // The defect this fixes: VisionCamera's AsyncRunner refused b because a was
    // still running, and the detector then idled until the next frame arrived.
    const queue: Array<() => void> = [];
    const runner = createNewestFrameRunner(job => {
      queue.push(job);
    });
    const ran: string[] = [];
    const drop = () => ran.push('dropped');
    runner.submit(() => {
      ran.push('a');
      expect(runner.submit(() => ran.push('b'), drop)).toBe(true); // b arrives during a
    }, drop);
    queue.shift()?.(); // a runs; b arrives meanwhile
    queue.shift()?.(); // a has ended: b is the newest and starts at once
    expect(ran).toEqual(['a', 'b']);
  });

  it(`refuses a frame when ${MAX_QUEUED} are already waiting`, () => {
    const {submit, runNext, runAll, ran, dropped} = setup();
    submit('a');
    runNext(); // a has started and is still running
    const accepted = ['b', 'c', 'd', 'e'].map(submit);
    expect(accepted).toEqual([true, true, true, false]);
    runAll();
    // e was refused, so the caller dropped it; d is the newest queued.
    expect(ran).toEqual(['a', 'd']);
    expect(dropped).toEqual(['b', 'c']);
  });

  it('accepts frames again once the queue has drained', () => {
    const {submit, runAll, ran} = setup();
    ['a', 'b', 'c'].forEach(submit);
    runAll();
    expect(submit('d')).toBe(true);
    runAll();
    expect(ran).toEqual(['c', 'd']);
  });
});
