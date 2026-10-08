import type {HybridObject} from 'react-native-nitro-modules';

/**
 * OS-level metrics. Every field is optional because no platform provides all
 * of them, and the thesis reports asymmetric metrics as one-sided observations
 * rather than inventing values.
 */
export interface NativeMetricsSnapshot {
  cpuUsagePercent?: number;
  memoryUsedMB?: number;
  totalMemoryMB?: number;
  availableMemoryMB?: number;
  cpuCores?: number;
  threadCount?: number;
  /** nominal | fair | serious | critical — the same four names on both platforms. */
  thermalState?: string;
  /**
   * Battery charge as a PERCENTAGE (0..100).
   * iOS reports a 0..1 fraction natively and is scaled here; the existing apps
   * mix both conventions in one database column (docs/pwa-followups.md #6).
   */
  batteryLevel?: number;
  batteryCharging?: boolean;
  gpuVendor?: string;
  gpuRenderer?: string;
  /**
   * Marketing-ish device model — "Pixel 7", "iPhone14,6".
   *
   * The app used to submit the literal string "Android device" / "iOS device",
   * which made every native row unattributable to a handset. In a study that
   * compares platforms across devices, that is the one identifier the dataset
   * cannot do without.
   */
  deviceModel?: string;
}

export interface NativeMetrics extends HybridObject<{ios: 'swift'; android: 'kotlin'}> {
  snapshot(): NativeMetricsSnapshot;
}
