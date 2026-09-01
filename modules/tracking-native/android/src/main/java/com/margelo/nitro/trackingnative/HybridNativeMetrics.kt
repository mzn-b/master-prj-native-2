package com.margelo.nitro.trackingnative

import android.app.ActivityManager
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager

/**
 * OS-level metrics on Android.
 *
 * Thermal state is mapped onto the same four names iOS reports; leaving the two
 * platforms on their native scales would turn a naming difference into a fake
 * finding. Battery is reported as a percentage (0..100) on both platforms.
 */
class HybridNativeMetrics : HybridNativeMetricsSpec() {

  private val context: Context get() = VisionContextHolder.requireContext()

  override fun snapshot(): NativeMetricsSnapshot {
    val runtime = Runtime.getRuntime()
    val usedMB = (runtime.totalMemory() - runtime.freeMemory()) / BYTES_PER_MB

    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    val memoryInfo = ActivityManager.MemoryInfo().also { activityManager?.getMemoryInfo(it) }

    val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    val batteryLevel = batteryManager
      ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
      ?.takeIf { it in 0..100 }
      ?.toDouble()

    val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val thermal = powerManager?.currentThermalStatus?.let(::thermalName)

    return NativeMetricsSnapshot(
      cpuUsagePercent = null, // no reliable per-process CPU on modern Android without root
      memoryUsedMB = usedMB,
      totalMemoryMB = memoryInfo.totalMem.toDouble() / BYTES_PER_MB,
      availableMemoryMB = memoryInfo.availMem.toDouble() / BYTES_PER_MB,
      cpuCores = runtime.availableProcessors().toDouble(),
      threadCount = Thread.activeCount().toDouble(),
      thermalState = thermal,
      batteryLevel = batteryLevel,
      batteryCharging = batteryManager?.isCharging,
      gpuVendor = Build.HARDWARE,
      gpuRenderer = Build.DEVICE
    )
  }

  /** Maps Android's 7-step thermal scale onto the 4 names iOS uses. */
  private fun thermalName(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
    PowerManager.THERMAL_STATUS_MODERATE -> "fair"
    PowerManager.THERMAL_STATUS_SEVERE -> "serious"
    else -> "critical"
  }

  companion object {
    private const val BYTES_PER_MB = 1024.0 * 1024.0
  }
}
