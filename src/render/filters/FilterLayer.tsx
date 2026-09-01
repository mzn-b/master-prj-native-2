import React from 'react';
import {Canvas} from '@shopify/react-native-skia';
import {StyleSheet, View} from 'react-native';
import type {SharedValue} from 'react-native-reanimated';
import type {RawDetection} from '../../native/landmarkFormat';
import type {ViewGeometry} from '../coordinates';
import {Crown3D} from './Crown3D';
import {GlassesFilter} from './GlassesFilter';
import {SparklesFilter} from './SparklesFilter';
import type {ActiveFilters} from './types';

export interface FilterLayerProps {
  activeFilters: ActiveFilters;
  latest: SharedValue<RawDetection | null>;
  geometry: ViewGeometry;
}

/**
 * Composes the active filters over the camera preview.
 *
 * Two surfaces: one Skia canvas for the 2D filters, and the WebGPU canvas for
 * the crown. Inactive filters are not mounted at all, so a disabled filter
 * costs nothing — which is what makes per-filter measurement meaningful.
 */
export function FilterLayer({
  activeFilters,
  latest,
  geometry,
}: FilterLayerProps): React.JSX.Element {
  const needsSkia = activeFilters.glasses || activeFilters.sparkles;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {activeFilters.crown && (
        <View style={StyleSheet.absoluteFill} testID="filter-crown">
          <Crown3D latest={latest} geometry={geometry} />
        </View>
      )}
      {needsSkia && (
        <Canvas style={StyleSheet.absoluteFill}>
          {activeFilters.glasses && (
            <GlassesFilter latest={latest} geometry={geometry} />
          )}
          {activeFilters.sparkles && (
            <SparklesFilter latest={latest} geometry={geometry} />
          )}
        </Canvas>
      )}
    </View>
  );
}
