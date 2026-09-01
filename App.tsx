/**
 * Task 4 risk gate host. Replaced by CameraScreen in Task 23.
 */
import React from 'react';
import {SafeAreaView, StyleSheet, Text} from 'react-native';


function App(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>CameraScreen lands in Task 23</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#101014', alignItems: 'center', justifyContent: 'center'},
  text: {color: '#fff'},
});

export default App;
