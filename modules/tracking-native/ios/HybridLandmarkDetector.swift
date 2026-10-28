import AVFoundation
import Foundation
import MediaPipeTasksVision
import NitroModules
import UIKit
import VisionCamera

/// MediaPipe face + hand detection for one camera frame.
///
/// Packs results into a single Float32 buffer laid out exactly as
/// `src/native/landmarkFormat.ts` describes — all faces (478 points each), then
/// all hands (21 points each), as (x, y, z) triplets. This must stay
/// byte-identical to the Kotlin implementation; a divergence shows up as
/// scrambled overlays on one platform only.
final class HybridLandmarkDetector: HybridLandmarkDetectorSpec {

  private let engine = MediaPipeEngine()
  private var wantFace = true
  private var wantHand = true
  /**
   * detect() runs on the async-runner thread while configure()/release() come
   * from the JS thread. Tearing down a MediaPipe task mid-detection is a
   * use-after-free, so the three are serialised.
   */
  private let lock = NSLock()
  private var isActive = false
  private var needsConfigure = true
  private var maxFaces = 1
  private var maxHands = 2
  private var useGpu = true
  private var lastTimestampMs = -1

  var modelLoadTimeMs: Double { engine.modelLoadTimeMs }
  var gpuDelegateActive: Bool { engine.gpuDelegateActive }

  func configure(config: DetectorConfig) throws {
    lock.lock()
    defer { lock.unlock() }
    isActive = true
    wantFace = config.mode == "face" || config.mode == "combined"
    wantHand = config.mode == "hand" || config.mode == "combined"
    maxFaces = max(Int(config.maxFaces), 1)
    maxHands = max(Int(config.maxHands), 1)
    useGpu = config.useGpu
    lastTimestampMs = -1
    // Build the tasks lazily inside detect(), on the thread that will use them.
    // A GPU delegate is bound to its creating thread; building here (the JS
    // thread) and detecting on the async-runner thread stalls the runner.
    needsConfigure = true
  }

  func release() throws {
    lock.lock()
    defer { lock.unlock() }
    isActive = false
    needsConfigure = true
    engine.release()
  }

  func detect(frame: any HybridFrameSpec, timestampMs: Double) throws -> RawDetection {
    lock.lock()
    defer { lock.unlock() }
    // A detection arriving after release() must not touch a closed task.
    guard isActive else { return Self.empty(timestampMs: timestampMs) }

    if needsConfigure {
      engine.configure(
        wantFace: wantFace,
        wantHand: wantHand,
        maxFaces: maxFaces,
        maxHands: maxHands,
        useGpu: useGpu
      )
      needsConfigure = false
    }

    // MediaPipe's VIDEO mode requires strictly increasing timestamps. Compared
    // in whole milliseconds, the unit MediaPipe receives, as on Android: two
    // frames inside the same millisecond would pass a fractional comparison and
    // then make MediaPipe throw.
    let ts = Int(timestampMs)
    guard ts > lastTimestampMs else {
      return Self.empty(timestampMs: timestampMs)
    }
    lastTimestampMs = ts

    // NF4 — inferenceTimeMs is measured end-to-end: frame in hand -> landmarks
    // ready, including MPImage construction and the packing loop below. Timing
    // only the MediaPipe call would exclude work the platform genuinely does and
    // make it look faster than it is. The PWA brackets the equivalent span.
    let started = CFAbsoluteTimeGetCurrent()

    guard let nativeFrame = frame as? any NativeFrame else {
      return Self.empty(timestampMs: timestampMs)
    }
    guard let sampleBuffer = nativeFrame.sampleBuffer else {
      return Self.empty(timestampMs: timestampMs)
    }
    let image: MPImage
    do {
      // The buffer arrives in sensor orientation — landscape while the phone is
      // held upright — so without this MediaPipe is handed a sideways face and
      // told it is upright. It copes while the face is large and close, then
      // degrades badly as the face shrinks: the pose estimate tips, and the user
      // reads it as "leaning" or "looking upwards".
      //
      // Android has always passed its rotation via ImageProcessingOptions, so
      // the two platforms were feeding MediaPipe materially different images.
      // That is an NF4 problem as much as a correctness one: Android was paying
      // for a rotation iOS never did, and iOS was paying in accuracy instead.
      //
      // VisionCamera's own `uiImageOrientation` helper is internal to its
      // module, but the Frame exposes the two values it derives from.
      image = try MPImage(
        sampleBuffer: sampleBuffer,
        orientation: Self.uiOrientation(frame.orientation, isMirrored: frame.isMirrored),
      )
    } catch {
      return Self.empty(timestampMs: timestampMs)
    }

    // A detection error is thrown, not turned into an empty result: it reaches
    // the worklet's catch in useTracking.ts and is counted in errorCount, as on
    // Android, where detectForVideo/recognizeForVideo throw straight through.
    // `try?` here made every iOS detection error look like a frame with
    // nothing in it, so errorCount was structurally zero on this arm.
    var faceResult: FaceLandmarkerResult?
    if wantFace {
      faceResult = try engine.faceLandmarker?.detect(videoFrame: image, timestampInMilliseconds: ts)
    }
    var handResult: GestureRecognizerResult?
    if wantHand {
      handResult = try engine.gestureRecognizer?.recognize(videoFrame: image, timestampInMilliseconds: ts)
    }

    let faces = faceResult?.faceLandmarks ?? []
    let hands = handResult?.landmarks ?? []

    var floats = [Float](repeating: 0, count: faces.count * Self.faceStride + hands.count * Self.handStride)
    var cursor = 0
    for face in faces {
      for point in face {
        floats[cursor] = point.x; floats[cursor + 1] = point.y; floats[cursor + 2] = point.z
        cursor += 3
      }
    }
    for hand in hands {
      for point in hand {
        floats[cursor] = point.x; floats[cursor + 1] = point.y; floats[cursor + 2] = point.z
        cursor += 3
      }
    }

    // F12 — blendshape scores, one block per face.
    var blendshapeNames: [String] = []
    var scores: [Float] = []
    if let perFace = faceResult?.faceBlendshapes, let first = perFace.first {
      blendshapeNames = first.categories.map { $0.categoryName ?? "" }
      scores.reserveCapacity(perFace.count * first.categories.count)
      for face in perFace {
        for category in face.categories {
          scores.append(Float(category.score))
        }
      }
    }

    // F13 — handedness and the top gesture per hand.
    let handedness = handResult?.handedness ?? []
    let gestures = handResult?.gestures ?? []
    var handMeta: [RawHandMeta] = []
    handMeta.reserveCapacity(hands.count)
    for index in hands.indices {
      let side = handedness.indices.contains(index) ? (handedness[index].first?.categoryName ?? "Unknown") : "Unknown"
      let top = gestures.indices.contains(index) ? gestures[index].first : nil
      handMeta.append(
        RawHandMeta(
          handedness: (side == "Left" || side == "Right") ? side : "Unknown",
          gesture: top?.categoryName,
          gestureScore: top.map { Double($0.score) }
        )
      )
    }

    let inferenceMs = (CFAbsoluteTimeGetCurrent() - started) * 1000

    return RawDetection(
      timestampMs: timestampMs,
      faceCount: Double(faces.count),
      handCount: Double(hands.count),
      landmarks: Self.buffer(from: floats),
      blendshapes: Self.buffer(from: scores),
      blendshapeNames: blendshapeNames,
      hands: handMeta,
      inferenceTimeMs: inferenceMs
    )
  }

  /**
   * Map the frame's orientation onto the one MediaPipe wants.
   *
   * `orientation` says how the pixel data is rotated relative to upright, and
   * `isMirrored` is set for the front camera. MediaPipe rotates the image into
   * upright before inference, and reports landmarks in that upright space.
   */
  private static func uiOrientation(
    _ orientation: CameraOrientation,
    isMirrored: Bool
  ) -> UIImage.Orientation {
    switch orientation {
    case .up: return isMirrored ? .upMirrored : .up
    case .right: return isMirrored ? .rightMirrored : .right
    case .down: return isMirrored ? .downMirrored : .down
    case .left: return isMirrored ? .leftMirrored : .left
    @unknown default: return isMirrored ? .upMirrored : .up
    }
  }

  private static func empty(timestampMs: Double) -> RawDetection {
    RawDetection(
      timestampMs: timestampMs,
      faceCount: 0,
      handCount: 0,
      landmarks: buffer(from: []),
      blendshapes: buffer(from: []),
      blendshapeNames: [],
      hands: [],
      inferenceTimeMs: 0
    )
  }

  /// Copies the packed floats into an owning ArrayBuffer that JS can read.
  private static func buffer(from values: [Float]) -> ArrayBuffer {
    return values.withUnsafeBufferPointer { source in
      guard let base = source.baseAddress, !values.isEmpty else {
        return ArrayBuffer.allocate(size: 0)
      }
      return base.withMemoryRebound(to: UInt8.self, capacity: values.count * MemoryLayout<Float>.size) { bytes in
        ArrayBuffer.copy(of: bytes, size: values.count * MemoryLayout<Float>.size)
      }
    }
  }

  private static let faceStride = 478 * 3
  private static let handStride = 21 * 3
}
