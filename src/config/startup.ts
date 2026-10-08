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
 * Called once, when the first frame is on screen. Later calls are ignored — the
 * value is a property of the launch, not of whatever remounts afterwards, so a
 * consent screen unmounting must not restart the clock.
 */
export function markInteractive(): void {
  if (interactiveAt === undefined) {
    interactiveAt = Date.now();
  }
}

/** Milliseconds from bundle evaluation to the first committed frame. */
export function getAppStartupMs(): number | undefined {
  if (interactiveAt === undefined) {
    return undefined;
  }
  return Math.round((interactiveAt - bundleEvalStart) * 10) / 10;
}
