import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

export interface SessionControlsProps {
  isRunning: boolean;
  canStart: boolean;
  isUploading?: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** NF6 — the tracking state is always visible, not implied by the button label. */
export function SessionControls({
  isRunning,
  canStart,
  isUploading = false,
  onStart,
  onStop,
}: SessionControlsProps): React.JSX.Element {
  const status = isUploading
    ? 'Sende Daten…'
    : isRunning
      ? 'Tracking aktiv'
      : canStart
        ? 'Tracking gestoppt'
        : 'Gerät nicht bereit';

  return (
    <View style={styles.row}>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={isRunning ? false : !canStart}
        onPress={isRunning ? onStop : onStart}
        style={[styles.button, isRunning ? styles.stop : styles.start, !isRunning && !canStart && styles.disabled]}>
        <Text style={styles.label}>{isRunning ? 'Stop' : 'Start'}</Text>
      </TouchableOpacity>
      <View style={styles.statusRow}>
        <View style={[styles.dot, isRunning ? styles.dotActive : styles.dotIdle]} />
        <Text style={styles.status}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 12},
  button: {paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8},
  start: {backgroundColor: '#4f46e5'},
  stop: {backgroundColor: '#dc2626'},
  disabled: {backgroundColor: '#4b5563'},
  label: {color: '#fff', fontWeight: '700', fontSize: 16},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  dot: {width: 10, height: 10, borderRadius: 5},
  dotActive: {backgroundColor: '#22c55e'},
  dotIdle: {backgroundColor: '#9ca3af'},
  status: {color: '#e5e7eb', fontSize: 14},
});
