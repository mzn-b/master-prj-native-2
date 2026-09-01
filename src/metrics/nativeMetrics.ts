import {createNativeMetrics, type NativeMetricsSnapshot} from 'tracking-native';

export type {NativeMetricsSnapshot};

let cached: ReturnType<typeof createNativeMetrics> | null = null;

/**
 * OS-level metrics. Every field is optional: no platform provides all of them,
 * and the thesis reports asymmetric metrics as one-sided observations rather
 * than inventing values.
 *
 * `batteryLevel` is a percentage (0..100) on both platforms — see
 * docs/pwa-followups.md #6 for why that normalisation matters.
 */
export function getNativeMetrics(): NativeMetricsSnapshot {
  try {
    cached ??= createNativeMetrics();
    return cached.snapshot();
  } catch {
    // Metrics are best-effort; never let them break a tracking session.
    return {};
  }
}
