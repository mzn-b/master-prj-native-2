import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {FILTER_IDS, FILTER_LABELS, type ActiveFilters, type FilterId} from '../render/filters/types';

export interface FilterBarProps {
  activeFilters: ActiveFilters;
  onToggle: (id: FilterId) => void;
}

/** Toggling a filter closes the current measurement session — see CameraScreen. */
export function FilterBar({activeFilters, onToggle}: FilterBarProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      {FILTER_IDS.map(id => (
        <TouchableOpacity
          key={id}
          accessibilityRole="button"
          onPress={() => onToggle(id)}
          style={[styles.chip, activeFilters[id] && styles.active]}>
          <Text style={styles.label}>{FILTER_LABELS[id]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 6},
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4b5563',
  },
  active: {borderColor: '#4f46e5', backgroundColor: '#312e81'},
  label: {color: '#fff'},
});
