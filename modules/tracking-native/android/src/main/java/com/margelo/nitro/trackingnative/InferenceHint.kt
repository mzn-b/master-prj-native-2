package com.margelo.nitro.trackingnative

import android.content.Context
import android.os.Build
import android.os.PerformanceHintManager
import android.os.Process
import android.util.Log
import java.io.File

/**
 * Registers the inference threads with Android's performance-hint service
 * (ADPF) and reports each frame's work duration, so the system raises CPU
 * clocks when a frame misses its target.
 *
 * Why: on the Pixel 7 the same MediaPipe work took ~100 ms here and ~60 ms in
 * Chrome, and Chrome ran the big and mid clusters near their maximum while this
 * app ran them at about a third. The inference work is spread over the
 * async-runner thread and MediaPipe's own threads, which wait on each other and
 * are each lightly loaded, so the scheduler sees little utilisation and keeps
 * the clocks low. With the hint session the median inference time fell from
 * ~100 ms to ~78 ms (GPU-delegate runs of sessions 198-203 against 208-210,
 * measured on branch diag/adpf).
 *
 * The target is one camera frame at 30 fps. The session only asks for clocks;
 * it does not change what is computed. Without ADPF support (API < 31, or a
 * device that declines the session) the detector runs exactly as before.
 *
 * The thread set is read from /proc/self/task: the calling thread plus every
 * thread MediaPipe names "drishti…". MediaPipe starts its threads lazily, so the
 * set is refreshed during the first frames.
 */
internal class InferenceHint(private val context: Context) {
  private var session: PerformanceHintManager.Session? = null
  private var tids = IntArray(0)
  private var frames = 0
  private var unsupported = false

  fun begin() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || unsupported) return
    if (session != null && frames > REFRESH_FRAMES) return
    val current = inferenceThreads()
    if (current.contentEquals(tids)) return
    val existing = session
    try {
      if (existing == null) {
        val manager = context.getSystemService(PerformanceHintManager::class.java)
        val created = manager?.createHintSession(current, TARGET_NANOS)
        if (created == null) {
          unsupported = true
          Log.i(TAG, "hint session not supported on this device")
          return
        }
        session = created
        Log.i(TAG, "hint session created: target=${TARGET_NANOS / 1_000_000} ms threads=${describe(current)}")
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        existing.setThreads(current)
        Log.i(TAG, "hint session threads updated: ${describe(current)}")
      }
      tids = current
    } catch (error: Throwable) {
      unsupported = true
      Log.w(TAG, "hint session unavailable: $error")
    }
  }

  fun end(actualNanos: Long) {
    session?.reportActualWorkDuration(actualNanos)
    frames++
  }

  fun close() {
    session?.close()
    session = null
    tids = IntArray(0)
    frames = 0
  }

  private fun inferenceThreads(): IntArray {
    val others = File("/proc/self/task").listFiles()?.mapNotNull { dir ->
      val name = runCatching { File(dir, "comm").readText().trim() }.getOrNull()
      if (name != null && name.startsWith("drishti")) dir.name.toIntOrNull() else null
    } ?: emptyList()
    return (listOf(Process.myTid()) + others).distinct().sorted().toIntArray()
  }

  private fun describe(ids: IntArray): String = ids.joinToString(",") { tid ->
    val name = runCatching { File("/proc/self/task/$tid/comm").readText().trim() }.getOrDefault("?")
    "$tid:$name"
  }

  companion object {
    private const val TAG = "InferenceHint"
    /** One camera frame at 30 fps. */
    private const val TARGET_NANOS = 33_333_333L
    private const val REFRESH_FRAMES = 30
  }
}
