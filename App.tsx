/**
 * Task 4 risk gate host. Replaced by CameraScreen in Task 23.
 */
import React from 'react';
import {SafeAreaView, StyleSheet} from 'react-native';
import {CrownSpike} from './src/spike/CrownSpike';

function App(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <CrownSpike />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#101014'},
});

export default App;
