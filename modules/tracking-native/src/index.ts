import {NitroModules} from 'react-native-nitro-modules';
import type {LandmarkDetector} from './LandmarkDetector.nitro';

export type {DetectorConfig, LandmarkDetector, RawDetection, RawHandMeta} from './LandmarkDetector.nitro';

/** The MediaPipe face + hand detector, implemented in Swift and Kotlin. */
export function createLandmarkDetector(): LandmarkDetector {
  return NitroModules.createHybridObject<LandmarkDetector>('LandmarkDetector');
}
