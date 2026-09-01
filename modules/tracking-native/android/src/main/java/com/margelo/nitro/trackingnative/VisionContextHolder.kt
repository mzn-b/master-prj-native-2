package com.margelo.nitro.trackingnative

import android.content.Context

/**
 * Holds the application context for the detector, which MediaPipe needs to
 * read its models from assets. Populated by TrackingNativePackage when React
 * Native initialises packages.
 */
object VisionContextHolder {
  @Volatile
  private var appContext: Context? = null

  fun set(context: Context) {
    appContext = context.applicationContext
  }

  fun requireContext(): Context =
    appContext ?: throw IllegalStateException(
      "VisionContextHolder has no context — TrackingNativePackage did not initialise."
    )
}
