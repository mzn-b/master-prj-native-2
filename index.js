// First, so the launch clock starts as early as JavaScript can see. Imports
// nothing itself, so it cannot disturb the ordering constraint below.
import './src/config/startup';
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
