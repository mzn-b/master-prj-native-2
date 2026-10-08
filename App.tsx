/**
 * @format
 */
import React, {useEffect, useState} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {StatusBar} from 'react-native';
import {CameraScreen} from './src/screens/CameraScreen';
import {ConsentGate} from './src/ui/ConsentGate';
import {markInteractive} from './src/config/startup';

function App(): React.JSX.Element {
  // Gate the whole app rather than the Start button: consent has to precede
  // processing, and this way the camera cannot be reached without it. Held in
  // state, not storage — see the note in ConsentGate.
  const [consented, setConsented] = useState(false);

  // NF3 — stop the launch clock once the first frame is actually on screen.
  // After the commit rather than inside it: a layout effect would run before
  // paint and undercount. See src/config/startup.ts for what the span covers.
  useEffect(() => {
    const handle = requestAnimationFrame(markInteractive);
    return () => cancelAnimationFrame(handle);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      {consented ? (
        <CameraScreen />
      ) : (
        <ConsentGate onAccept={() => setConsented(true)} />
      )}
    </SafeAreaProvider>
  );
}

export default App;
