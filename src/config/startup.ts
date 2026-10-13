import {AppState} from 'react-native';

/**
 * NF3 — how long the app takes to become usable after launch.
 *
 * `modelLoadTimeMs` starts once the app is already running, so it hides the one
 * difference this study exists to measure: a PWA boots a JS engine and pulls a
 * ~26 MB precache over the network, a native app runs an installed binary.
 *
 * **What this measures, precisely:** the first statement of the JS bundle to
 * the first frame React commits. It does *not* include the OS spawning the
 * process, loading the native binary, or initialising the React Native runtime
 * up to the point the bundle starts evaluating — none of which JavaScript can
 * see without a native module, and all of which is real startup cost. The
 * figure is therefore a **lower bound** on native startup.
 *
 * The PWA's counterpart is navigation start to `domInteractive`, which likewise
 * excludes the browser's own process launch. The two spans are analogous, not
 * identical; report them with their definitions rather than as one number.
 * See METRICS.md.
 */
const bundleEvalStart = Date.now();

let interactiveAt: number | undefined;

/**
 * Whether the app has been continuously foregrounded since the bundle started.
 *
 * `requestAnimationFrame` does not fire while the app is backgrounded or the
 * screen is off, so any idle gap before first use lands in the measurement.
 * Observed 2026-10-13: every Android session reported **139,181 ms**, because
 * `react-native run-android` launches the app itself and it then sat untouched
 * until the operator picked the phone up. iOS read 30 ms in the same batch
 * purely because it was used immediately.
 *
 * A number that large is not a slow startup, it is a different quantity
 * altogether. Reporting nothing is correct where reporting 139 seconds is not —
 * the same rule the rest of the schema follows for metrics a platform cannot
 * supply.
 */
let foregroundThroughout = AppState.currentState === 'active';

AppState.addEventListener('change', next => {
  if (interactiveAt === undefined && next !== 'active') {
    foregroundThroughout = false;
  }
});

/**
 * Called once, when the first frame is on screen. Later calls are ignored — the
 * value is a property of the launch, not of whatever remounts afterwards, so a
 * consent screen unmounting must not restart the clock.
 */
export function markInteractive(): void {
  if (interactiveAt === undefined) {
    interactiveAt = Date.now();
  }
}

/**
 * Milliseconds from bundle evaluation to the first committed frame.
 *
 * `undefined` when the app was not foregrounded throughout, because the clock
 * then includes time the app spent idle rather than starting up.
 */
export function getAppStartupMs(): number | undefined {
  if (interactiveAt === undefined || !foregroundThroughout) {
    return undefined;
  }
  return Math.round((interactiveAt - bundleEvalStart) * 10) / 10;
}
