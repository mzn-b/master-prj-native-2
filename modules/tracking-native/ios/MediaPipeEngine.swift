import Foundation
import MediaPipeTasksVision

/// Owns the MediaPipe tasks for one tracking session.
///
/// Mirrors the Android MediaPipeEngine exactly: same models, same running mode,
/// same confidence thresholds, GPU delegate with a CPU fallback. The fallback is
/// what makes `gpuDelegateActive` a measured value rather than an assumption.
final class MediaPipeEngine {

  private(set) var gpuDelegateActive = false
  private(set) var modelLoadTimeMs: Double = 0

  private(set) var faceLandmarker: FaceLandmarker?
  private(set) var gestureRecognizer: GestureRecognizer?

  func configure(wantFace: Bool, wantHand: Bool, maxFaces: Int, maxHands: Int, useGpu: Bool) {
    let started = CFAbsoluteTimeGetCurrent()
    release()

    var gpuOk = useGpu
    let preferred: Delegate = useGpu ? .GPU : .CPU

    if wantFace {
      do {
        faceLandmarker = try Self.makeFace(delegate: preferred, maxFaces: maxFaces)
      } catch {
        gpuOk = false
        faceLandmarker = try? Self.makeFace(delegate: .CPU, maxFaces: maxFaces)
      }
    }
    if wantHand {
      do {
        gestureRecognizer = try Self.makeHand(delegate: preferred, maxHands: maxHands)
      } catch {
        gpuOk = false
        gestureRecognizer = try? Self.makeHand(delegate: .CPU, maxHands: maxHands)
      }
    }

    gpuDelegateActive = gpuOk && (wantFace || wantHand)
    modelLoadTimeMs = (CFAbsoluteTimeGetCurrent() - started) * 1000
  }

  private static func modelPath(_ name: String) throws -> String {
    guard let path = Bundle.main.path(forResource: name, ofType: "task") else {
      throw NSError(
        domain: "TrackingNative", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "\(name).task missing from the app bundle"]
      )
    }
    return path
  }

  private static func makeFace(delegate: Delegate, maxFaces: Int) throws -> FaceLandmarker {
    let options = FaceLandmarkerOptions()
    options.baseOptions.modelAssetPath = try modelPath("face_landmarker")
    options.baseOptions.delegate = delegate
    options.runningMode = .video
    options.numFaces = maxFaces
    options.minFaceDetectionConfidence = 0.5
    options.minFacePresenceConfidence = 0.5
    options.minTrackingConfidence = 0.5
    options.outputFaceBlendshapes = true // F12
    return try FaceLandmarker(options: options)
  }

  private static func makeHand(delegate: Delegate, maxHands: Int) throws -> GestureRecognizer {
    let options = GestureRecognizerOptions()
    options.baseOptions.modelAssetPath = try modelPath("gesture_recognizer")
    options.baseOptions.delegate = delegate
    options.runningMode = .video
    options.numHands = maxHands
    options.minHandDetectionConfidence = 0.5
    options.minHandPresenceConfidence = 0.5
    options.minTrackingConfidence = 0.5
    return try GestureRecognizer(options: options)
  }

  func release() {
    faceLandmarker = nil
    gestureRecognizer = nil
  }
}
