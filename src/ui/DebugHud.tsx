import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {TrackingDTO} from '../domain/tracking.dto';

const NOSE_TIP = 1;
const WRIST = 0;

export interface DebugHudProps {
  tracking: TrackingDTO | null;
}

/**
 * F14 — coordinates, per-modality tracking status and the recognised gesture.
 *
 * Fed a decoded DTO from the 500 ms metrics tick, never per frame. Per-landmark
 * confidence is not exposed by MediaPipe Tasks Vision, so it is absent here
 * rather than fabricated.
 */
export function DebugHud({tracking}: DebugHudProps): React.JSX.Element {
  const face = tracking?.face?.faces[0];
  const nose = face?.landmarks[NOSE_TIP];
  const hands = tracking?.hand?.hands ?? [];

  return (
    <View style={styles.card} testID="debug-hud">
      <Text style={styles.heading}>Debug</Text>
      <Text style={styles.line}>
        Gesicht: {face ? 'erkannt' : 'nicht erkannt'}
        {nose ? `  Nase (${nose.x.toFixed(3)}, ${nose.y.toFixed(3)})` : ''}
      </Text>
      <Text style={styles.line}>
        Blendshapes: {face?.blendshapes ? `${face.blendshapes.length}` : '—'}
      </Text>
      <Text style={styles.line}>Hände: {hands.length}</Text>
      {hands.map((hand, index) => {
        const wrist = hand.landmarks[WRIST];
        return (
          <Text key={index} style={styles.line}>
            {hand.handedness ?? 'Unknown'} · Wrist (
            {wrist ? `${wrist.x.toFixed(3)}, ${wrist.y.toFixed(3)}` : '—'}) ·{' '}
            {hand.gesture ?? 'keine Geste'}
            {hand.gestureScore !== undefined ? ` ${(hand.gestureScore * 100).toFixed(0)}%` : ''}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: 'rgba(17,24,39,0.82)', borderRadius: 8, padding: 10, gap: 2},
  heading: {color: '#9ca3af', fontSize: 12, fontWeight: '700'},
  line: {color: '#f9fafb', fontSize: 12},
});
