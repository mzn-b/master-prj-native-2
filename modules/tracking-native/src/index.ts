import {NitroModules} from 'react-native-nitro-modules';
import type {MathTest} from './MathTest.nitro';

export type {MathTest};

/** Smoke-test HybridObject. Removed in Task 12. */
export const mathTest = NitroModules.createHybridObject<MathTest>('MathTest');
