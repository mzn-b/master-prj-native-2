export type FilterId = 'crown' | 'glasses' | 'sparkles'

/**
 * Which surface the app is showing. Landmarks mode draws the raw landmark
 * overlay (F4); filters mode draws the AR filters and forces the tracking mode
 * to `combined`, since the filters need both face and hand.
 */
export type AppMode = 'landmarks' | 'filters'

export interface ActiveFilters {
  crown: boolean
  glasses: boolean
  sparkles: boolean
}

export const DEFAULT_ACTIVE_FILTERS: ActiveFilters = {
  crown: false,
  glasses: false,
  sparkles: false,
}

export const FILTER_LABELS: Record<FilterId, string> = {
  crown: 'Crown',
  glasses: 'Glasses',
  sparkles: 'Sparkles',
}

export const FILTER_IDS: FilterId[] = ['crown', 'glasses', 'sparkles']

/**
 * The filters a session should report as active.
 *
 * Derived from `appMode` and not from the selection alone, because the two are
 * independent state and only `appMode` gates rendering: landmarks mode never
 * mounts FilterLayer, yet the selection survives the mode switch. Submitting
 * the raw selection therefore labelled landmarks runs with filters that were
 * never on screen — two iOS sessions on 2026-10-08 reported `['crown']` while
 * drawing only landmarks.
 *
 * Reporting what was *drawn* rather than what was *selected* is the invariant;
 * the selection is also cleared when leaving filters mode, so this guard and
 * the state agree rather than one compensating for the other.
 */
export function submittedFilters(
  appMode: AppMode,
  active: ActiveFilters,
): FilterId[] {
  if (appMode !== 'filters') {
    return []
  }
  return FILTER_IDS.filter(id => active[id])
}

/**
 * The drawing paths behind a session, for the `renderBackend` run condition.
 *
 * Derived from what was drawn, like submittedFilters(), because the path
 * differs by view and by filter: the landmark renderer draws the dots, the
 * platform's 2D path draws the glasses and the sparkles, and three.js draws the
 * crown. Recording only the landmark renderer labelled every filter session
 * with a renderer that drew nothing in it, and never recorded whether the
 * crown ran on WebGPU or on three's WebGL fallback.
 *
 * `paths` names the platform's own: its landmark renderer, its 2D path and
 * the backend the crown actually used. A filter view with nothing selected
 * draws nothing and reports 'none'; a crown that had not finished
 * initialising when the session was submitted reports 'pending'.
 */
export function drawnRenderBackend(
  appMode: AppMode,
  active: ActiveFilters,
  paths: { landmarks?: string; flat: string; crown?: string },
): string | undefined {
  if (appMode !== 'filters') {
    return paths.landmarks
  }
  const drawn: string[] = []
  if (active.glasses || active.sparkles) {
    drawn.push(paths.flat)
  }
  if (active.crown) {
    drawn.push(paths.crown ?? 'pending')
  }
  return drawn.length > 0 ? drawn.join('+') : 'none'
}
