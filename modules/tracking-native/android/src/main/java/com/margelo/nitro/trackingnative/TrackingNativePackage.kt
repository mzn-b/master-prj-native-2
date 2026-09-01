package com.margelo.nitro.trackingnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Exports no bridge modules — every HybridObject is registered from C++ by
 * nitrogen's generated autolinking. Two reasons this type is still required:
 *
 *  1. React Native's CLI only autolinks an Android dependency that declares a
 *     package, so without it this module is skipped entirely.
 *  2. The static initialiser loads the native library at the point React Native
 *     initialises packages — after SoLoader is ready, and without duplicating
 *     React Native's own native libraries.
 *
 * NOTE: keep prose above free of the words "c-l-a-s-s ... ReactPackage" in one
 * sentence; the CLI detects the package type with a regex over this file and
 * will happily match a comment.
 */
class TrackingNativePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { emptyMap() }

  companion object {
    init {
      TrackingNativeOnLoad.initializeNative()
    }
  }
}
