import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {PerformanceMetricsDTO} from '../domain/tracking.dto';

export interface PerformanceHudProps {
  metrics: PerformanceMetricsDTO | null;
  currentFrameSkip: number;
}

function Row({label, value}: {label: string; value: string}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/** F8 — live metrics. Updated on the 500 ms tick, never per frame. */
export function PerformanceHud({
  metrics,
  currentFrameSkip,
}: PerformanceHudProps): React.JSX.Element | null {
  if (!metrics) {
    return null;
  }
  const optional = (value: number | null | undefined, unit: string, digits = 0) =>
    value === null || value === undefined ? '—' : `${value.toFixed(digits)}${unit}`;

  return (
    <View style={styles.card} testID="performance-hud">
      <Row label="FPS" value={`${metrics.fps.toFixed(1)} (Ø ${metrics.avgFps.toFixed(1)})`} />
      <Row label="Inferenz" value={`${metrics.avgInferenceTimeMs.toFixed(1)} ms`} />
      <Row label="Frame" value={`${metrics.avgFrameProcessingTimeMs.toFixed(1)} ms`} />
      <Row label="Frames" value={`${metrics.frameCount} (${metrics.droppedFrames} verworfen)`} />
      <Row label="Speicher" value={optional(metrics.memoryUsageMB, ' MB', 1)} />
      <Row label="CPU" value={optional(metrics.cpuUsagePercent, ' %', 0)} />
      <Row label="Thermal" value={metrics.thermalState ?? '—'} />
      <Row label="Akku" value={optional(metrics.batteryLevel, ' %', 0)} />
      <Row label="Frame-Skip" value={`${currentFrameSkip}`} />
      <Row label="Warmup" value={metrics.warmupComplete ? 'fertig' : 'läuft'} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: 'rgba(17,24,39,0.82)', borderRadius: 8, padding: 10, gap: 2},
  row: {flexDirection: 'row', justifyContent: 'space-between', gap: 16},
  label: {color: '#9ca3af', fontSize: 12},
  value: {color: '#f9fafb', fontSize: 12, fontVariant: ['tabular-nums']},
});
