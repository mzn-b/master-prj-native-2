/**
 * @format
 */
import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {StatusBar} from 'react-native';
import {CameraScreen} from './src/screens/CameraScreen';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <CameraScreen />
    </SafeAreaProvider>
  );
}

export default App;
