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
