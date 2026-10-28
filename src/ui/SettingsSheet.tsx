import React from 'react';
import {Linking, StyleSheet, Switch, Text, TouchableOpacity, View} from 'react-native';
import {SURVEY_BUILD} from '../config/buildInfo';
import {UX_SURVEY_URL} from '../config/survey';

export interface SettingsSheetProps {
  smoothingEnabled: boolean;
  dynamicInferenceEnabled: boolean;
  gpuDelegateEnabled: boolean;
  showPerformance: boolean;
  showDebug: boolean;
  /**
   * Disables the settings that are read when a session starts.
   *
   * The GPU delegate is chosen when the detector is configured, so changing it
   * mid-session would record a condition the run did not actually use.
   */
  settingsLocked?: boolean;
  onChange: (
    key:
      | 'smoothingEnabled'
      | 'dynamicInferenceEnabled'
      | 'gpuDelegateEnabled'
      | 'showPerformance'
      | 'showDebug',
    value: boolean,
  ) => void;
}

function Toggle({
  label,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

/**
 * Settings that affect measurement. Both apps must be in the same state for a
 * comparison run — smoothing and dynamic inference in particular.
 *
 * The survey build shows none of them: participants hold the phone and the
 * operator only selects the view and the filters, so every study run keeps the
 * study settings (thesis §6.1.2), which are the defaults.
 */
export function SettingsSheet({
  smoothingEnabled,
  dynamicInferenceEnabled,
  gpuDelegateEnabled,
  showPerformance,
  showDebug,
  settingsLocked = false,
  onChange,
}: SettingsSheetProps): React.JSX.Element | null {
  const surveyUrl = UX_SURVEY_URL
    ? `${UX_SURVEY_URL}${UX_SURVEY_URL.includes('?') ? '&' : '?'}platform=NATIVE`
    : null;

  if (SURVEY_BUILD && !surveyUrl) {
    return null;
  }

  return (
    <View style={styles.card} testID="settings-sheet">
      {!SURVEY_BUILD && (
        <Toggle
          label="F9: Glättung (One Euro)"
          value={smoothingEnabled}
          onValueChange={next => onChange('smoothingEnabled', next)}
        />
      )}
      {!SURVEY_BUILD && (
        <Toggle
          label="F15: Dynamische Inferenzrate"
          value={dynamicInferenceEnabled}
          onValueChange={next => onChange('dynamicInferenceEnabled', next)}
        />
      )}
      {!SURVEY_BUILD && (
        <Toggle
          label="GPU-Delegate"
          value={gpuDelegateEnabled}
          disabled={settingsLocked}
          onValueChange={next => onChange('gpuDelegateEnabled', next)}
        />
      )}
      {/* Hidden in the survey build: the HUD readouts differ between the apps
          (memory, CPU and thermal state are blank in the PWA), which would tell
          a participant which implementation this is. */}
      {!SURVEY_BUILD && (
        <Toggle
          label="Performance-HUD"
          value={showPerformance}
          onValueChange={next => onChange('showPerformance', next)}
        />
      )}
      {!SURVEY_BUILD && (
        <Toggle
          label="F14: Debug-HUD"
          value={showDebug}
          onValueChange={next => onChange('showDebug', next)}
        />
      )}
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
  rowDisabled: {opacity: 0.5},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  label: {color: '#e5e7eb', fontSize: 14, flexShrink: 1},
  survey: {backgroundColor: '#4f46e5', borderRadius: 6, paddingVertical: 8, alignItems: 'center'},
  surveyLabel: {color: '#fff', fontWeight: '600'},
});
