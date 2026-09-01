/**
 * Task 3 smoke gate: proves the Nitro HybridObject registers and executes at
 * runtime, not merely that it compiles. Replaced by CameraScreen in Task 23.
 */
import React from 'react';
import {SafeAreaView, StyleSheet, Text} from 'react-native';
import {mathTest} from 'tracking-native';

function describeNitro(): string {
  try {
    const sum = mathTest.add(2, 3);
    return sum === 5 ? `NITRO OK: 2 + 3 = ${sum}` : `NITRO WRONG: got ${sum}`;
  } catch (error) {
    return `NITRO FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function App(): React.JSX.Element {
  const result = describeNitro();
  return (
    <SafeAreaView style={styles.container}>
      <Text testID="nitro-result" style={styles.text}>
        {result}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  text: {fontSize: 20, fontWeight: '600', textAlign: 'center', padding: 24},
});

export default App;
