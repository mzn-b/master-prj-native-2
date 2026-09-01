package com.margelo.nitro.trackingnative

import android.graphics.Bitmap
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
// `public` is a Kotlin keyword, so this package segment needs backticks.
import com.margelo.nitro.camera.`public`.NativeFrame
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.core.ArrayBuffer
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * MediaPipe face + hand detection for one camera frame.
 *
 * Results are packed into a single Float32 buffer laid out exactly as
 * `src/native/landmarkFormat.ts` describes: all faces (478 points each), then
 * all hands (21 points each), as (x, y, z) triplets. The iOS implementation
 * must produce byte-identical layout.
 */
class HybridLandmarkDetector : HybridLandmarkDetectorSpec() {

  private val engine = MediaPipeEngine(VisionContextHolder.requireContext())
  private var wantFace = true
  private var wantHand = true
  private var maxFaces = 1
  private var maxHands = 2
  private var useGpu = true
  private var needsConfigure = true
  /**
   * detect() runs on the async-runner thread while configure()/release() are
   * called from the JS thread. Closing a MediaPipe task while a detection is in
   * flight is a use-after-free, which shows up as a SIGSEGV inside
   * libmediapipe. This lock makes the three mutually exclusive.
   */
  private val lock = Any()
  private var isActive = false
  private var lastTimestampMs = -1L

  override val modelLoadTimeMs: Double
    get() = engine.modelLoadTimeMs.toDouble()

  override val gpuDelegateActive: Boolean
    get() = engine.gpuDelegateActive

  /**
   * Records the configuration only. The MediaPipe tasks are built lazily inside
   * detect(), on the thread that will call them: a GPU delegate is bound to the
   * thread that created it, and creating it here (the JS thread) then detecting
   * on the async-runner thread segfaults after a few frames.
   */
  override fun configure(config: DetectorConfig) {
    wantFace = config.mode == "face" || config.mode == "combined"
    wantHand = config.mode == "hand" || config.mode == "combined"
    maxFaces = config.maxFaces.toInt().coerceAtLeast(1)
    maxHands = config.maxHands.toInt().coerceAtLeast(1)
    synchronized(lock) {
      useGpu = config.useGpu
      needsConfigure = true
      isActive = true
      lastTimestampMs = -1
    }
  }

  override fun release() {
    synchronized(lock) {
      isActive = false
      needsConfigure = true
      engine.release()
    }
  }

  override fun detect(frame: HybridFrameSpec, timestampMs: Double): RawDetection {
    return synchronized(lock) {
    // A detection that arrives after release() must not resurrect the engine.
    if (!isActive) {
      return empty(timestampMs)
    }

    if (needsConfigure) {
      engine.configure(wantFace, wantHand, maxFaces, maxHands, useGpu)
      needsConfigure = false
    }

    // MediaPipe's VIDEO mode requires strictly increasing timestamps.
    val ts = timestampMs.toLong()
    if (ts <= lastTimestampMs) {
      return empty(timestampMs)
    }
    lastTimestampMs = ts

    val nativeFrame = frame as? NativeFrame ?: return empty(timestampMs)
    val bitmap = bitmapOf(nativeFrame.image) ?: return empty(timestampMs)

    val mpImage = BitmapImageBuilder(bitmap).build()
    // Camera frames arrive rotated (90/270 on a phone held upright). MediaPipe
    // detects on the image as given, so without this the face is sideways and
    // nothing is found at all.
    val rotation = nativeFrame.image.imageInfo.rotationDegrees
    val options = ImageProcessingOptions.builder()
      .setRotationDegrees(rotation)
      .build()

    val started = System.nanoTime()

    val faceResult = if (wantFace) engine.faceLandmarker?.detectForVideo(mpImage, options, ts) else null
    val handResult = if (wantHand) engine.gestureRecognizer?.recognizeForVideo(mpImage, options, ts) else null

    val inferenceMs = (System.nanoTime() - started) / 1_000_000.0

    val faces = faceResult?.faceLandmarks() ?: emptyList()
    val hands = handResult?.landmarks() ?: emptyList()


    val floats = FloatArray(faces.size * FACE_STRIDE + hands.size * HAND_STRIDE)
    var cursor = 0
    for (face in faces) {
      for (point in face) {
        floats[cursor++] = point.x()
        floats[cursor++] = point.y()
        floats[cursor++] = point.z()
      }
    }
    for (hand in hands) {
      for (point in hand) {
        floats[cursor++] = point.x()
        floats[cursor++] = point.y()
        floats[cursor++] = point.z()
      }
    }

    // F12 — blendshape scores, one block of 52 per face.
    val blendshapeCategories = faceResult?.faceBlendshapes()?.orElse(null)
    val names = ArrayList<String>()
    val scores: FloatArray
    if (blendshapeCategories != null && blendshapeCategories.isNotEmpty()) {
      val first = blendshapeCategories[0]
      first.forEach { names.add(it.categoryName()) }
      scores = FloatArray(blendshapeCategories.size * first.size)
      var s = 0
      for (perFace in blendshapeCategories) {
        for (category in perFace) {
          scores[s++] = category.score()
        }
      }
    } else {
      scores = FloatArray(0)
    }

    // F13 — handedness and the top gesture per hand.
    val handedness = handResult?.handedness() ?: emptyList()
    val gestures = handResult?.gestures() ?: emptyList()
    val handMeta = Array(hands.size) { index ->
      val side = handedness.getOrNull(index)?.firstOrNull()?.categoryName() ?: "Unknown"
      val top = gestures.getOrNull(index)?.firstOrNull()
      RawHandMeta(
        handedness = if (side == "Left" || side == "Right") side else "Unknown",
        gesture = top?.categoryName(),
        gestureScore = top?.score()?.toDouble()
      )
    }

    mpImage.close()

    return@synchronized RawDetection(
      timestampMs = timestampMs,
      faceCount = faces.size.toDouble(),
      handCount = hands.size.toDouble(),
      landmarks = toArrayBuffer(floats),
      blendshapes = toArrayBuffer(scores),
      blendshapeNames = names.toTypedArray(),
      hands = handMeta,
      inferenceTimeMs = inferenceMs
    )
    }
  }

  private fun empty(timestampMs: Double) = RawDetection(
    timestampMs = timestampMs,
    faceCount = 0.0,
    handCount = 0.0,
    landmarks = toArrayBuffer(FloatArray(0)),
    blendshapes = toArrayBuffer(FloatArray(0)),
    blendshapeNames = emptyArray(),
    hands = emptyArray(),
    inferenceTimeMs = 0.0
  )

  private fun toArrayBuffer(values: FloatArray): ArrayBuffer {
    val bytes = ByteBuffer.allocateDirect(values.size * 4).order(ByteOrder.nativeOrder())
    bytes.asFloatBuffer().put(values)
    return ArrayBuffer.copy(bytes)
  }

  /** CameraX converts the frame's pixel format for us (androidx.camera.core 1.3+). */
  private fun bitmapOf(image: ImageProxy): Bitmap? = try {
    image.toBitmap()
  } catch (error: Throwable) {
    null
  }

  companion object {
    private const val FACE_STRIDE = 478 * 3
    private const val HAND_STRIDE = 21 * 3
  }
}
