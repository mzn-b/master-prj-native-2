import React, {useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  CONSENT_ACCEPT,
  CONSENT_CONTROLLER,
  CONSENT_DECLINE,
  CONSENT_DECLINED_MESSAGE,
  CONSENT_INTRO,
  CONSENT_SECTIONS,
  CONSENT_TITLE,
  consentIsIncomplete,
} from './consentText';

/**
 * Blocks the app until the participant has consented.
 *
 * Consent has to precede processing, so this replaces the whole screen and the
 * camera cannot be started behind it.
 *
 * **Deliberately not persisted.** Sessions are supervised individually and
 * several participants use the same device, so remembering a previous person's
 * decision would mean the next one never consents at all. Every launch asks
 * again.
 *
 * Kept visually identical to the PWA's gate: participants must read the same
 * words, laid out the same way, before either app starts.
 */
export interface ConsentGateProps {
  onAccept: () => void;
}

export function ConsentGate({onAccept}: ConsentGateProps): React.JSX.Element {
  const [declined, setDeclined] = useState(false);
  const incomplete = consentIsIncomplete();

  if (declined) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.body}>{CONSENT_DECLINED_MESSAGE}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{CONSENT_TITLE}</Text>
        <Text style={styles.body}>{CONSENT_INTRO}</Text>

        {CONSENT_SECTIONS.map(section => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading}>{section.heading}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}

        <View style={styles.section}>
          <Text style={styles.heading}>{CONSENT_CONTROLLER.heading}</Text>
          <Text style={styles.body}>{CONSENT_CONTROLLER.body}</Text>
        </View>

        {incomplete ? (
          // A notice that still names no controller does not inform anyone, so
          // the app refuses to proceed rather than collecting consent against
          // placeholder text.
          <Text style={styles.error} testID="consent-incomplete">
            Diese Einwilligungserklärung ist noch unvollständig (siehe „TODO“
            oben) und darf nicht verwendet werden. Bitte die Kontaktdaten in
            src/ui/consentText.ts ergänzen.
          </Text>
        ) : (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onAccept}
              style={[styles.button, styles.accept]}>
              <Text style={styles.buttonLabel}>{CONSENT_ACCEPT}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setDeclined(true)}
              style={[styles.button, styles.decline]}>
              <Text style={styles.buttonLabel}>{CONSENT_DECLINE}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b0b0f'},
  centered: {alignItems: 'center', justifyContent: 'center', padding: 24},
  content: {padding: 20, gap: 14},
  title: {color: '#fff', fontSize: 22, fontWeight: '700'},
  section: {gap: 4},
  heading: {color: '#fff', fontSize: 15, fontWeight: '700'},
  body: {color: '#e5e7eb', fontSize: 14, lineHeight: 21},
  error: {color: '#fca5a5', fontSize: 15, lineHeight: 22},
  buttonRow: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4, paddingBottom: 24},
  button: {paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8},
  accept: {backgroundColor: '#4f46e5'},
  decline: {backgroundColor: '#4b5563'},
  buttonLabel: {color: '#fff', fontWeight: '700', fontSize: 16},
});
