import type {
  FaceLandmarksDTO,
  HandLandmarksDTO,
  NormalizedPoint,
  TrackingDTO,
} from '../domain/tracking.dto';

/**
 * One Euro Filter (Casiez et al., 2012) — https://cristal.univ-lille.fr/~casiez/1euro/
 *
 * Reduces landmark jitter while staying responsive to fast movement. The
 * constants are shared with master-prj-pwa so smoothing behaves identically on
 * both platforms; changing them here alone would invalidate the comparison.
 */
class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number | null = null;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(coord: number, t: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = coord;
      this.dxPrev = 0;
      this.tPrev = t;
      return coord;
    }

    const dt = t - this.tPrev;
    if (dt <= 0) {
      return this.xPrev;
    }

    const dx = (coord - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const edx = aD * dx + (1 - aD) * (this.dxPrev ?? 0);

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const a = this.alpha(cutoff, dt);
    const result = a * coord + (1 - a) * this.xPrev;

    this.xPrev = result;
    this.dxPrev = edx;
    this.tPrev = t;
    return result;
  }
}

interface PointFilter {
  x: OneEuroFilter;
  y: OneEuroFilter;
  z: OneEuroFilter;
}

export interface SmoothingConfig {
  enabled: boolean;
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

export const DEFAULT_SMOOTHING_CONFIG: SmoothingConfig = {
  enabled: true,
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
};

export class LandmarkSmoother {
  private config: SmoothingConfig;
  private faceFilters = new Map<number, PointFilter[]>();
  private handFilters = new Map<number, PointFilter[]>();

  constructor(config: SmoothingConfig = DEFAULT_SMOOTHING_CONFIG) {
    this.config = {...config};
  }

  setConfig(config: Partial<SmoothingConfig>): void {
    this.config = {...this.config, ...config};
    if (!this.config.enabled) {
      this.reset();
    }
  }

  reset(): void {
    this.faceFilters.clear();
    this.handFilters.clear();
  }

  smooth(tracking: TrackingDTO): TrackingDTO {
    if (!this.config.enabled) {
      return tracking;
    }

    const t = tracking.timestampMs / 1000;
    const result: TrackingDTO = {timestampMs: tracking.timestampMs, mode: tracking.mode};
    if (tracking.face) {
      result.face = this.smoothFaces(tracking.face, t);
    }
    if (tracking.hand) {
      result.hand = this.smoothHands(tracking.hand, t);
    }
    return result;
  }

  private smoothFaces(face: FaceLandmarksDTO, t: number): FaceLandmarksDTO {
    return {
      // Spread the source: replacing only `landmarks` keeps blendshapes (F12).
      // Rebuilding the object instead silently discards them.
      faces: face.faces.map((f, i) => ({
        ...f,
        landmarks: this.smoothLandmarks(f.landmarks, t, this.faceFilters, i),
      })),
    };
  }

  private smoothHands(hand: HandLandmarksDTO, t: number): HandLandmarksDTO {
    return {
      // Spread the source: keeps handedness, gesture and gestureScore (F13).
      hands: hand.hands.map((h, i) => ({
        ...h,
        landmarks: this.smoothLandmarks(h.landmarks, t, this.handFilters, i),
      })),
    };
  }

  private smoothLandmarks(
    landmarks: NormalizedPoint[],
    t: number,
    filterMap: Map<number, PointFilter[]>,
    entityIndex: number,
  ): NormalizedPoint[] {
    let filters = filterMap.get(entityIndex);
    if (!filters || filters.length !== landmarks.length) {
      filters = landmarks.map(() => this.createPointFilter());
      filterMap.set(entityIndex, filters);
    }

    return landmarks.map((point, i) => {
      const filter = filters![i];
      return {
        x: filter.x.filter(point.x, t),
        y: filter.y.filter(point.y, t),
        z: point.z !== undefined ? filter.z.filter(point.z, t) : undefined,
      };
    });
  }

  private createPointFilter(): PointFilter {
    const {minCutoff, beta, dCutoff} = this.config;
    return {
      x: new OneEuroFilter(minCutoff, beta, dCutoff),
      y: new OneEuroFilter(minCutoff, beta, dCutoff),
      z: new OneEuroFilter(minCutoff, beta, dCutoff),
    };
  }
}
