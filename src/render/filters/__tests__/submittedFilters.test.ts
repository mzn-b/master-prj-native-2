import {submittedFilters} from '../types';
import type {ActiveFilters} from '../types';

/**
 * NF4 / data integrity — what a session reports as active must be what was
 * actually drawn.
 *
 * `appMode` gates rendering (landmarks mode draws LandmarkOverlay and never
 * mounts FilterLayer), but the filter selection is independent state that
 * survives a mode switch. On 2026-10-08 that put `activeFilters: ['crown']` on
 * two iOS sessions recorded in landmarks mode, where no filter was on screen.
 *
 * Because filters mode forces the tracking mode to `combined`, every FACE or
 * HAND session is necessarily a landmarks-mode session — so any filter
 * reported on one of those rows is provably spurious.
 */
const CROWN_ONLY: ActiveFilters = {crown: true, glasses: false, sparkles: false};
const ALL: ActiveFilters = {crown: true, glasses: true, sparkles: true};
const NONE: ActiveFilters = {crown: false, glasses: false, sparkles: false};

describe('submittedFilters', () => {
  it('reports the selected filters in filters mode', () => {
    expect(submittedFilters('filters', ALL).sort()).toEqual(['crown', 'glasses', 'sparkles']);
    expect(submittedFilters('filters', CROWN_ONLY)).toEqual(['crown']);
  });

  it('reports nothing in landmarks mode, whatever the selection holds', () => {
    // The defect: a stale selection was submitted for a run that drew no
    // filters at all.
    expect(submittedFilters('landmarks', CROWN_ONLY)).toEqual([]);
    expect(submittedFilters('landmarks', ALL)).toEqual([]);
  });

  it('reports nothing when nothing is selected', () => {
    expect(submittedFilters('filters', NONE)).toEqual([]);
    expect(submittedFilters('landmarks', NONE)).toEqual([]);
  });
});
