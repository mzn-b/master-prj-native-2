import {NitroModules} from 'react-native-nitro-modules';
import type {LandmarkDetector} from './LandmarkDetector.nitro';
import type {NativeMetrics as NativeMetricsHybrid} from './NativeMetrics.nitro';

export type {DetectorConfig, LandmarkDetector, RawDetection, RawHandMeta} from './LandmarkDetector.nitro';

/** The MediaPipe face + hand detector, implemented in Swift and Kotlin. */
export function createLandmarkDetector(): LandmarkDetector {
  return NitroModules.createHybridObject<LandmarkDetector>('LandmarkDetector');
}

export type {NativeMetrics, NativeMetricsSnapshot} from './NativeMetrics.nitro';

/** OS-level CPU / memory / thermal / battery metrics. */
export function createNativeMetrics(): NativeMetricsHybrid {
  return NitroModules.createHybridObject<NativeMetricsHybrid>('NativeMetrics');
}
