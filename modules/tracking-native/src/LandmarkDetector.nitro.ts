import type {HybridObject} from 'react-native-nitro-modules';
import type {Frame} from 'react-native-vision-camera';

/**
 * Packed detection payload. The layout is defined by
 * `src/native/landmarkFormat.ts` in the app; both native implementations must
 * produce exactly that layout.
 */
export interface RawHandMeta {
  handedness: string;
  gesture?: string;
  gestureScore?: number;
}

export interface RawDetection {
  timestampMs: number;
  faceCount: number;
  handCount: number;
  /** Float32 (x, y, z) triplets: all faces, then all hands. */
  landmarks: ArrayBuffer;
  /** Float32, faceCount * 52 blendshape scores; empty when unavailable. */
  blendshapes: ArrayBuffer;
  blendshapeNames: string[];
  hands: RawHandMeta[];
  /** Time inside MediaPipe only. */
  inferenceTimeMs: number;
}

export interface DetectorConfig {
  /** Mirrors TrackingMode in the app's domain/tracking.dto.ts. */
  mode: string;
  maxFaces: number;
  maxHands: number;
  useGpu: boolean;
}

export interface LandmarkDetector
  extends HybridObject<{ios: 'swift'; android: 'kotlin'}> {
  /** Create or recreate the MediaPipe tasks. Blocking; call once per session. */
  configure(config: DetectorConfig): void;

  /**
   * Run detection on one camera frame. MediaPipe's VIDEO mode requires
   * strictly increasing timestamps and no concurrent calls, which is why this
   * is driven from VisionCamera's single-threaded async runner.
   */
  detect(frame: Frame, timestampMs: number): RawDetection;

  readonly modelLoadTimeMs: number;
  readonly gpuDelegateActive: boolean;

  release(): void;
}
