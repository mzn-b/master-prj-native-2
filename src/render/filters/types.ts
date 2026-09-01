export type FilterId = 'crown' | 'glasses' | 'sparkles'

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
