/**
 * OS-level metrics that only native code can read.
 *
 * The implementation is wired to the NativeMetrics HybridObject in Task 15;
 * until then it reports nothing, and every consumer already treats each field
 * as optional because no platform provides all of them.
 */
export interface NativeMetricsSnapshot {
  cpuUsagePercent?: number;
  memoryUsedMB?: number;
  totalMemoryMB?: number;
  availableMemoryMB?: number;
  cpuCores?: number;
  threadCount?: number;
  /** nominal | fair | serious | critical — same scale on both platforms. */
  thermalState?: string;
  /** 0..100. */
  batteryLevel?: number;
  batteryCharging?: boolean;
  gpuVendor?: string;
  gpuRenderer?: string;
}

export function getNativeMetrics(): NativeMetricsSnapshot {
  return {};
}
