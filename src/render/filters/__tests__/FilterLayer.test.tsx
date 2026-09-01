import React from 'react';
import {render} from '@testing-library/react-native';
import {FilterLayer} from '../FilterLayer';
import {DEFAULT_ACTIVE_FILTERS} from '../types';
import type {ViewGeometry} from '../../coordinates';

jest.mock('../Crown3D', () => ({Crown3D: () => null}));
jest.mock('../GlassesFilter', () => {
  const React2 = require('react');
  return {GlassesFilter: () => React2.createElement('GlassesFilter', {testID: 'filter-glasses'})};
});
jest.mock('../SparklesFilter', () => {
  const React2 = require('react');
  return {SparklesFilter: () => React2.createElement('SparklesFilter', {testID: 'filter-sparkles'})};
});

const geometry: ViewGeometry = {
  frameWidth: 100,
  frameHeight: 100,
  viewWidth: 200,
  viewHeight: 200,
  rotation: 0,
  mirrorX: true,
  resizeMode: 'cover',
};

const latest = {value: null} as never;

describe('FilterLayer', () => {
  it('mounts nothing when every filter is off', async () => {
    const {queryByTestId} = await render(
      <FilterLayer activeFilters={DEFAULT_ACTIVE_FILTERS} latest={latest} geometry={geometry} />,
    );
    expect(queryByTestId('filter-glasses')).toBeNull();
    expect(queryByTestId('filter-sparkles')).toBeNull();
    expect(queryByTestId('filter-crown')).toBeNull();
  });

  it('mounts only the enabled filter', async () => {
    const {queryByTestId} = await render(
      <FilterLayer
        activeFilters={{...DEFAULT_ACTIVE_FILTERS, glasses: true}}
        latest={latest}
        geometry={geometry}
      />,
    );
    expect(queryByTestId('filter-glasses')).not.toBeNull();
    expect(queryByTestId('filter-sparkles')).toBeNull();
  });

  it('mounts the crown on its own surface', async () => {
    const {queryByTestId} = await render(
      <FilterLayer
        activeFilters={{...DEFAULT_ACTIVE_FILTERS, crown: true}}
        latest={latest}
        geometry={geometry}
      />,
    );
    expect(queryByTestId('filter-crown')).not.toBeNull();
  });

  it('mounts several filters together', async () => {
    const {queryByTestId} = await render(
      <FilterLayer
        activeFilters={{crown: true, glasses: true, sparkles: true}}
        latest={latest}
        geometry={geometry}
      />,
    );
    expect(queryByTestId('filter-crown')).not.toBeNull();
    expect(queryByTestId('filter-glasses')).not.toBeNull();
    expect(queryByTestId('filter-sparkles')).not.toBeNull();
  });
});
