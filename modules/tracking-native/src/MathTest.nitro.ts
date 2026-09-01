import type {HybridObject} from 'react-native-nitro-modules';

/**
 * Throwaway smoke-test object: proves the nitrogen codegen and the iOS/Android
 * build wiring work end to end before any MediaPipe code depends on them.
 * Deleted in Task 12.
 */
export interface MathTest
  extends HybridObject<{ios: 'swift'; android: 'kotlin'}> {
  add(a: number, b: number): number;
}
