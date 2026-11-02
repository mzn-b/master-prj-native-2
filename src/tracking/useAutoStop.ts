import {useEffect, useRef} from 'react';

/** Length of a study run (thesis §6.1.2), as in the PWA. */
export const RUN_DURATION_MS = 60_000;

/**
 * Stops a run by itself once it has lasted `ms`, when `enabled`.
 *
 * The survey build uses it so that every participant run lasts the same 60
 * seconds; until 3 Nov 2026 the operator stopped each run by hand, which added
 * the operator's reaction time to every run. The latest `stop` is called, so a
 * new callback identity during the run does not restart the clock. The PWA has
 * the same hook.
 */
export function useAutoStop(
  isRunning: boolean,
  enabled: boolean,
  stop: () => unknown,
  ms: number = RUN_DURATION_MS,
): void {
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!enabled || !isRunning) {
      return;
    }
    const id = setTimeout(() => void stopRef.current(), ms);
    return () => clearTimeout(id);
  }, [isRunning, enabled, ms]);
}
