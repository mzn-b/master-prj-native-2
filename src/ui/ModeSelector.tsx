import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import type {TrackingMode} from '../domain/tracking.dto';

const MODES: TrackingMode[] = ['face', 'hand', 'combined'];

export interface ModeSelectorProps {
  mode: TrackingMode;
  disabled: boolean;
  onChange: (mode: TrackingMode) => void;
}

/** F5 — face / hand / combined. Locked while a session is running. */
export function ModeSelector({mode, disabled, onChange}: ModeSelectorProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      {MODES.map(candidate => (
        <TouchableOpacity
          key={candidate}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => onChange(candidate)}
          style={[styles.chip, mode === candidate && styles.active, disabled && styles.disabled]}>
          <Text style={styles.label}>{candidate}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 6},
  chip: {paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, backgroundColor: '#374151'},
  active: {backgroundColor: '#4f46e5'},
  disabled: {opacity: 0.5},
  label: {color: '#fff', textTransform: 'capitalize'},
});
