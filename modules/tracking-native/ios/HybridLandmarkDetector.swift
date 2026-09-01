import AVFoundation
import Foundation
import MediaPipeTasksVision
import NitroModules
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

  var modelLoadTimeMs: Double { engine.modelLoadTimeMs }
  var gpuDelegateActive: Bool { engine.gpuDelegateActive }

  func configure(config: DetectorConfig) throws {
    lock.lock()
    defer { lock.unlock() }
    isActive = true
    wantFace = config.mode == "face" || config.mode == "combined"
    wantHand = config.mode == "hand" || config.mode == "combined"
    engine.configure(
      wantFace: wantFace,
      wantHand: wantHand,
      maxFaces: max(Int(config.maxFaces), 1),
      maxHands: max(Int(config.maxHands), 1),
      useGpu: config.useGpu
    )
  }

  func release() throws {
    lock.lock()
    defer { lock.unlock() }
    isActive = false
    engine.release()
  }

  func detect(frame: any HybridFrameSpec, timestampMs: Double) throws -> RawDetection {
    lock.lock()
    defer { lock.unlock() }
    // A detection arriving after release() must not touch a closed task.
    guard isActive else { return Self.empty(timestampMs: timestampMs) }

    guard let nativeFrame = frame as? any NativeFrame,
          let sampleBuffer = nativeFrame.sampleBuffer,
          let image = try? MPImage(sampleBuffer: sampleBuffer)
    else {
      return Self.empty(timestampMs: timestampMs)
    }

    let started = CFAbsoluteTimeGetCurrent()
    let ts = Int(timestampMs)
    let faceResult = wantFace ? try? engine.faceLandmarker?.detect(videoFrame: image, timestampInMilliseconds: ts) : nil
    let handResult = wantHand ? try? engine.gestureRecognizer?.recognize(videoFrame: image, timestampInMilliseconds: ts) : nil
    let inferenceMs = (CFAbsoluteTimeGetCurrent() - started) * 1000

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
