import {drawnRenderBackend} from '../types';
import type {ActiveFilters} from '../types';

/**
 * NF4 / data integrity — `renderBackend` must name what drew the session.
 *
 * It was hard-coded to 'skia' at start, so a crown-only session, which mounts
 * no Skia canvas at all, still reported Skia, and no session recorded that the
 * crown is drawn through WebGPU.
 */
const PATHS = {landmarks: 'skia', flat: 'skia', crown: 'webgpu'};
const filters = (f: Partial<ActiveFilters>): ActiveFilters => ({
  crown: false,
  glasses: false,
  sparkles: false,
  ...f,
});

describe('drawnRenderBackend', () => {
  it('reports Skia in landmarks mode, whatever the selection holds', () => {
    expect(drawnRenderBackend('landmarks', filters({crown: true}), PATHS)).toBe('skia');
  });

  it('reports Skia for the image filters and WebGPU for the crown', () => {
    expect(drawnRenderBackend('filters', filters({glasses: true}), PATHS)).toBe('skia');
    expect(drawnRenderBackend('filters', filters({sparkles: true}), PATHS)).toBe('skia');
    expect(drawnRenderBackend('filters', filters({crown: true}), PATHS)).toBe('webgpu');
  });

  it('joins both paths when all three filters are drawn', () => {
    expect(
      drawnRenderBackend('filters', filters({crown: true, glasses: true, sparkles: true}), PATHS),
    ).toBe('skia+webgpu');
  });

  it('reports none for a filter view with nothing selected', () => {
    expect(drawnRenderBackend('filters', filters({}), PATHS)).toBe('none');
  });
});
