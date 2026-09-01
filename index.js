// Hermes ships no TextDecoder/TextEncoder; three.js's GLTFLoader needs them to
// read the JSON chunk of a .glb. Must be imported before anything else.
import 'fast-text-encoding';
/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
