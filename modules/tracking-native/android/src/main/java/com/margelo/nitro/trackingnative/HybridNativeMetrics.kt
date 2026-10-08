package com.margelo.nitro.trackingnative

import android.app.ActivityManager
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import java.io.File

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

    /**
     * Total PSS, not the Java heap.
     *
     * This used to report `Runtime.totalMemory() - freeMemory()`, which is the
     * JVM heap alone. Nearly all of this app's memory is native — MediaPipe's
     * tensors, the camera buffers, Skia's textures — so that figure was ~10-14 MB
     * against iOS's 505-722 MB resident size, a ~40x gap that measured nothing
     * but the difference between two definitions.
     *
     * `totalPss` is proportional set size across every mapping the process owns,
     * which is the closest Android analogue to the Mach `resident_size` iOS
     * reports. It is reported in KB.
     *
     * `Debug.getMemoryInfo` is a synchronous kernel read costing a few hundred
     * microseconds. It runs on the 500 ms metrics tick, never per frame.
     */
    val memoryUsedMB = try {
      val info = Debug.MemoryInfo()
      Debug.getMemoryInfo(info)
      info.totalPss.toDouble() / 1024.0
    } catch (error: Throwable) {
      // Never let a metrics read take the session down; a missing reading is a
      // null column, which the HUD and the analysis both already handle.
      null
    }

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
      cpuUsagePercent = cpuUsagePercent(),
      memoryUsedMB = memoryUsedMB,
      totalMemoryMB = memoryInfo.totalMem.toDouble() / BYTES_PER_MB,
      availableMemoryMB = memoryInfo.availMem.toDouble() / BYTES_PER_MB,
      cpuCores = runtime.availableProcessors().toDouble(),
      threadCount = Thread.activeCount().toDouble(),
      thermalState = thermal,
      batteryLevel = batteryLevel,
      batteryCharging = batteryManager?.isCharging,
      gpuVendor = Build.HARDWARE,
      gpuRenderer = Build.DEVICE,
      // MANUFACTURER + MODEL, e.g. "Google Pixel 7". MODEL alone is ambiguous
      // across vendors, and the dataset needs to name the actual handset.
      deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    )
  }

  /** Maps Android's 7-step thermal scale onto the 4 names iOS uses. */
  private fun thermalName(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
    PowerManager.THERMAL_STATUS_MODERATE -> "fair"
    PowerManager.THERMAL_STATUS_SEVERE -> "serious"
    else -> "critical"
  }


  /**
   * Process-wide CPU usage as a percentage, matched to what iOS reports.
   *
   * iOS sums `thread_basic_info.cpu_usage` across the process's threads, giving a
   * figure that is **not normalised by core count** and therefore exceeds 100 %
   * when more than one thread is busy. This does the same thing from the other
   * direction: `/proc/self/stat` carries the process's cumulative user and system
   * time in clock ticks, so the difference between two samples over a known wall
   * interval is the number of CPU-seconds consumed per second of real time —
   * ×100, the same quantity.
   *
   * The earlier comment here claimed no reliable per-process CPU was available
   * without root. That is true of *other* processes; a process may always read
   * its own `/proc/self/`, on every Android version this project targets.
   *
   * **One semantic difference remains and must be reported with the numbers:**
   * iOS's value is instantaneous (the kernel's own short decayed average per
   * thread), while this is the mean over the sampling interval — 500 ms, the
   * metrics tick. Both answer "how much CPU is this process using", but this side
   * smooths brief spikes that iOS would show. See THESIS-FINDINGS §3.2.
   *
   * Returns null on the first call, having nothing to difference against, and on
   * any read failure — a missing reading is a null column, which the HUD and the
   * analysis both already handle.
   */
  private fun cpuUsagePercent(): Double? = try {
    val ticks = readProcessCpuTicks()
    val nowNanos = SystemClock.elapsedRealtimeNanos()
    val previousTicks = lastCpuTicks
    val previousNanos = lastCpuSampleNanos
    lastCpuTicks = ticks
    lastCpuSampleNanos = nowNanos

    if (ticks == null || previousTicks == null || previousNanos == 0L) {
      null
    } else {
      val elapsedSeconds = (nowNanos - previousNanos) / 1_000_000_000.0
      // A zero or backwards interval would divide by zero; skip that sample.
      if (elapsedSeconds <= 0.0) {
        null
      } else {
        val cpuSeconds = (ticks - previousTicks).toDouble() / clockTicksPerSecond
        (cpuSeconds / elapsedSeconds * 100.0).coerceAtLeast(0.0)
      }
    }
  } catch (error: Throwable) {
    null
  }

  /**
   * Cumulative utime + stime for this process, in clock ticks.
   *
   * The second field of `/proc/self/stat` is the executable name in parentheses
   * and may itself contain spaces or parentheses, so the line is split after the
   * **last** ')' rather than tokenised from the start. After that split, utime and
   * stime are fields 12 and 13 (they are 14 and 15 counting from the beginning).
   */
  private fun readProcessCpuTicks(): Long? {
    val stat = File("/proc/self/stat").readText()
    val afterComm = stat.substringAfterLast(')').trim()
    val fields = afterComm.split(' ')
    if (fields.size < 13) return null
    val utime = fields[11].toLongOrNull() ?: return null
    val stime = fields[12].toLongOrNull() ?: return null
    return utime + stime
  }

  private var lastCpuTicks: Long? = null
  private var lastCpuSampleNanos: Long = 0L

  private val clockTicksPerSecond: Double by lazy {
    // _SC_CLK_TCK is 100 on every Android device in practice, but it is a
    // configurable kernel constant and hard-coding it would silently scale the
    // whole metric on a device that differs.
    Os.sysconf(OsConstants._SC_CLK_TCK).toDouble().takeIf { it > 0 } ?: 100.0
  }

  companion object {
    private const val BYTES_PER_MB = 1024.0 * 1024.0
  }
}
