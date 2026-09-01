import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {FilterBar} from '../FilterBar';
import {DEFAULT_ACTIVE_FILTERS} from '../../render/filters/types';

describe('FilterBar', () => {
  it('renders a control per filter', async () => {
    const {getByText} = await render(
      <FilterBar activeFilters={DEFAULT_ACTIVE_FILTERS} onToggle={jest.fn()} />,
    );
    expect(getByText('Crown')).toBeTruthy();
    expect(getByText('Glasses')).toBeTruthy();
    expect(getByText('Sparkles')).toBeTruthy();
  });

  it('reports which filter was toggled', async () => {
    const onToggle = jest.fn();
    const {getByText} = await render(
      <FilterBar activeFilters={DEFAULT_ACTIVE_FILTERS} onToggle={onToggle} />,
    );
    fireEvent.press(getByText('Crown'));
    expect(onToggle).toHaveBeenCalledWith('crown');
  });
});
