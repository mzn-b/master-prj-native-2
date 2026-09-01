import React from 'react';
import {Linking, StyleSheet, Switch, Text, TouchableOpacity, View} from 'react-native';
import {UX_SURVEY_URL} from '../config/survey';

export interface SettingsSheetProps {
  smoothingEnabled: boolean;
  dynamicInferenceEnabled: boolean;
  showPerformance: boolean;
  showDebug: boolean;
  onChange: (
    key: 'smoothingEnabled' | 'dynamicInferenceEnabled' | 'showPerformance' | 'showDebug',
    value: boolean,
  ) => void;
}

function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

/**
 * Settings that affect measurement. Both apps must be in the same state for a
 * comparison run — smoothing and dynamic inference in particular.
 */
export function SettingsSheet({
  smoothingEnabled,
  dynamicInferenceEnabled,
  showPerformance,
  showDebug,
  onChange,
}: SettingsSheetProps): React.JSX.Element {
  const surveyUrl = UX_SURVEY_URL
    ? `${UX_SURVEY_URL}${UX_SURVEY_URL.includes('?') ? '&' : '?'}platform=NATIVE`
    : null;

  return (
    <View style={styles.card} testID="settings-sheet">
      <Toggle
        label="F9: Glättung (One Euro)"
        value={smoothingEnabled}
        onValueChange={next => onChange('smoothingEnabled', next)}
      />
      <Toggle
        label="F15: Dynamische Inferenzrate"
        value={dynamicInferenceEnabled}
        onValueChange={next => onChange('dynamicInferenceEnabled', next)}
      />
      <Toggle
        label="Performance-HUD"
        value={showPerformance}
        onValueChange={next => onChange('showPerformance', next)}
      />
      <Toggle
        label="F14: Debug-HUD"
        value={showDebug}
        onValueChange={next => onChange('showDebug', next)}
      />
      {surveyUrl && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => Linking.openURL(surveyUrl)}
          style={styles.survey}>
          <Text style={styles.surveyLabel}>UX Feedback</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: 'rgba(17,24,39,0.92)', borderRadius: 8, padding: 12, gap: 6},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  label: {color: '#e5e7eb', fontSize: 14, flexShrink: 1},
  survey: {backgroundColor: '#4f46e5', borderRadius: 6, paddingVertical: 8, alignItems: 'center'},
  surveyLabel: {color: '#fff', fontWeight: '600'},
});
