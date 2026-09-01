package com.margelo.nitro.trackingnative

import android.content.Context
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizer

/**
 * Owns the MediaPipe tasks for one tracking session.
 *
 * GPU delegate with a CPU fallback: the fallback is what makes
 * `gpuDelegateActive` a meaningful reported metric rather than an assumption.
 *
 * F13 uses GestureRecognizer rather than HandLandmarker. It is a strict
 * superset — same 21 landmarks and handedness, plus a gesture label — so it
 * satisfies F13 at no structural cost and matches what the PWA runs.
 */
class MediaPipeEngine(private val context: Context) {

  var gpuDelegateActive: Boolean = false
    private set
  var modelLoadTimeMs: Long = 0
    private set

  var faceLandmarker: FaceLandmarker? = null
    private set
  var gestureRecognizer: GestureRecognizer? = null
    private set

  fun configure(wantFace: Boolean, wantHand: Boolean, maxFaces: Int, maxHands: Int, useGpu: Boolean) {
    val started = System.currentTimeMillis()
    release()

    var gpuOk = useGpu
    val preferred = if (useGpu) Delegate.GPU else Delegate.CPU

    if (wantFace) {
      faceLandmarker = try {
        buildFace(preferred, maxFaces)
      } catch (error: Throwable) {
        gpuOk = false
        buildFace(Delegate.CPU, maxFaces)
      }
    }
    if (wantHand) {
      gestureRecognizer = try {
        buildHand(preferred, maxHands)
      } catch (error: Throwable) {
        gpuOk = false
        buildHand(Delegate.CPU, maxHands)
      }
    }

    gpuDelegateActive = gpuOk && (wantFace || wantHand)
    modelLoadTimeMs = System.currentTimeMillis() - started
  }

  private fun buildFace(delegate: Delegate, maxFaces: Int): FaceLandmarker =
    FaceLandmarker.createFromOptions(
      context,
      FaceLandmarker.FaceLandmarkerOptions.builder()
        .setBaseOptions(
          BaseOptions.builder()
            .setModelAssetPath(FACE_MODEL)
            .setDelegate(delegate)
            .build()
        )
        .setRunningMode(RunningMode.VIDEO)
        .setNumFaces(maxFaces)
        .setMinFaceDetectionConfidence(0.5f)
        .setMinFacePresenceConfidence(0.5f)
        .setMinTrackingConfidence(0.5f)
        .setOutputFaceBlendshapes(true) // F12
        .build()
    )

  private fun buildHand(delegate: Delegate, maxHands: Int): GestureRecognizer =
    GestureRecognizer.createFromOptions(
      context,
      GestureRecognizer.GestureRecognizerOptions.builder()
        .setBaseOptions(
          BaseOptions.builder()
            .setModelAssetPath(HAND_MODEL)
            .setDelegate(delegate)
            .build()
        )
        .setRunningMode(RunningMode.VIDEO)
        .setNumHands(maxHands)
        .setMinHandDetectionConfidence(0.5f)
        .setMinHandPresenceConfidence(0.5f)
        .setMinTrackingConfidence(0.5f)
        .build()
    )

  fun release() {
    faceLandmarker?.close()
    faceLandmarker = null
    gestureRecognizer?.close()
    gestureRecognizer = null
  }

  companion object {
    private const val FACE_MODEL = "face_landmarker.task"
    private const val HAND_MODEL = "gesture_recognizer.task"
  }
}
