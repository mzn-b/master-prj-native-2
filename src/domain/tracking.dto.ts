export type TrackingMode = "face" | "hand" | "combined";

export type NormalizedPoint = {
    x: number;
    y: number;
    z?: number;
};

export type BlendshapeCategory = {
    categoryName: string;
    score: number;
};

export type FaceLandmarksDTO = {
    faces: Array<{
        landmarks: NormalizedPoint[];
        // F12 — MediaPipe FaceLandmarker blendshapes (~52 morph-target weights per face)
        blendshapes?: BlendshapeCategory[];
    }>;
};

export type HandLandmarksDTO = {
    hands: Array<{
        handedness?: "Left" | "Right" | "Unknown";
        landmarks: NormalizedPoint[];
        // F13 — top gesture label from MediaPipe GestureRecognizer.
        // One of: "None" | "Closed_Fist" | "Open_Palm" | "Pointing_Up" |
        //         "Thumb_Down" | "Thumb_Up" | "Victory" | "ILoveYou"
        gesture?: string;
        gestureScore?: number;
    }>;
};

export type TrackingDTO = {
    timestampMs: number;
    mode: TrackingMode;
    face?: FaceLandmarksDTO;
    hand?: HandLandmarksDTO;
};


export type PerformanceMetricsDTO = {
    // Frame timing metrics
    fps: number;
    avgFps: number;
    minFps: number | null;
    maxFps: number | null;
    inferenceTimeMs: number;
    avgInferenceTimeMs: number;
    frameProcessingTimeMs: number;
    avgFrameProcessingTimeMs: number;

    // Memory metrics
    memoryUsageMB?: number;
    totalMemoryMB?: number;
    availableMemoryMB?: number;
    heapLimitMB?: number;

    // CPU metrics
    cpuUsagePercent?: number;
    cpuCores?: number;
    threadCount?: number;

    // GPU metrics
    gpuVendor?: string;
    gpuRenderer?: string;

    // Thermal metrics
    thermalState?: string;

    // Power metrics
    batteryLevel?: number;
    batteryCharging?: boolean;
    // Battery consumption over the session (start - end, positive = used)
    batteryLevelStart?: number;
    batteryLevelEnd?: number;
    batteryDeltaPercent?: number;

    // Network metrics
    networkType?: string;
    networkDownlinkMbps?: number;
    networkRttMs?: number;

    // Detection metrics
    facesDetectedAvg?: number;
    handsDetectedAvg?: number;
    detectionRate?: number;

    // Model metrics
    modelLoadTimeMs?: number;

    // Session metrics
    frameCount: number;
    droppedFrames: number;
    sessionDurationMs: number;
    warmupComplete: boolean;
    trackingLostCount: number;

    // Stability metrics
    peakMemoryUsageMB?: number;
    // Memory consumption over the session (end - start, positive = grew)
    memoryUsageStartMB?: number;
    memoryUsageEndMB?: number;
    memoryDeltaMB?: number;
    gpuDelegateActive?: boolean;
    trackingRecoveryTimeMs?: number;
    consecutiveTrackingLossMax?: number;
    errorCount?: number;

    // ---- Run conditions ----
    // NF4: what a row means depends on how the session was configured. Without
    // these, two rows that differ only in capture resolution or threading model
    // are indistinguishable, and the platform comparison silently mixes them.

    // Capture resolution actually delivered by the camera, not the one requested.
    frameWidth?: number;
    frameHeight?: number;

    // Which graphics backend drew the overlay.
    // PWA: "webgpu" | "webgl2" | "webgl". Native: "skia".
    renderBackend?: string;

    // Where inference ran relative to the UI.
    // PWA: "main" | "worker". Native: "async-runner".
    inferenceThreading?: string;

    // NF3 — milliseconds from tracking start to the first frame with a detection.
    timeToFirstDetectionMs?: number;

    // ── Timing distribution (F8, NF1) ────────────────────────────────────────
    // Means hide what users feel. A steady 50 ms reads as smoother than a 40 ms
    // mean punctuated by 200 ms spikes, and NF1 asks about "flüssige
    // Echtzeit-Interaktion", not about average throughput. Percentiles are taken
    // over every frame of the session, not a rolling window.
    inferenceTimeP50Ms?: number;
    inferenceTimeP95Ms?: number;
    inferenceTimeP99Ms?: number;
    /** Wall time between consecutive delivered frames — the jitter a user sees. */
    frameIntervalP50Ms?: number;
    frameIntervalP95Ms?: number;
    frameIntervalP99Ms?: number;

    // ── Rendering (F4, F11) — PWA only ───────────────────────────────────────
    // Drawing was previously invisible: frameProcessingTimeMs spans the detect
    // call, so the draw stack went unmeasured entirely.
    //
    // **Not symmetric, and must not be compared across arms.** The PWA has an
    // imperative draw call to bracket; native renders declaratively through Skia
    // and Reanimated on the UI runtime, where there is no equivalent hook. So
    // this says what fraction of a PWA frame is spent drawing — useful in its own
    // right — but native cannot supply the same number. The mirror image of
    // memory and CPU, which only native can supply.
    avgRenderTimeMs?: number;
    renderTimeP95Ms?: number;


    // ── Adaptive inference behaviour (F15, NF4) ──────────────────────────────
    // The F15 governor moves a frame-skip divider between 1 and 10 on both
    // apps, and until now it left no trace in the data. Two consequences:
    //
    // 1. **F15 had no evidence.** It is a requirement, and nothing submitted
    //    showed whether the governor ever engaged, how far it climbed, or
    //    whether it behaved the same way on both implementations.
    // 2. **`avgFps` was not comparable without it.** An arm holding 15 fps at
    //    skip 1 and an arm holding 15 fps at skip 5 are doing entirely
    //    different amounts of work. The mean divider is what separates them.
    //
    // Sampled per camera frame, so the mean is time-weighted rather than
    // weighted by completed inferences.
    avgFrameSkip?: number;
    maxFrameSkip?: number;

    // `droppedFrames` is the total and keeps its meaning: a frame reached the
    // pipeline and produced no inference. But it merges two causes that mean
    // opposite things about the device —
    //
    //   governor — F15 skipped it deliberately. The system working as designed;
    //              at skip 5 this is 80 % of frames and is not a fault.
    //   busy     — inference was still running and the frame could not be
    //              accepted. This is the device being overwhelmed (NF1).
    //
    // Without the split, a high `droppedFrames` is uninterpretable: it reads as
    // failure when it may be the governor doing its job. Both apps count at the
    // same two sites, so the split means the same thing in both datasets.
    droppedFramesGovernor?: number;
    droppedFramesBusy?: number;

    // ── Feature toggles that change what is measured (F9, F15, NF4) ──────────
    // Both are user-facing switches, both default to on, and neither was
    // recorded — so two sessions of the same arm could differ structurally with
    // nothing in the data to say so. Same class of hole as the frame-skip
    // columns above: a run condition that moves the numbers must be submitted
    // with them.
    //
    // `smoothingEnabled` is load-bearing for `landmarkStability`: One Euro
    // exists to suppress exactly the jitter that metric measures, so on/off
    // differ by a large factor. Recording it also makes F9 *evaluable* — matched
    // on/off pairs turn the jitter column into a measurement of what the filter
    // actually buys, which is the requirement's whole claim.
    //
    // `dynamicInferenceEnabled` disambiguates `avgFrameSkip`: a mean of 1.0
    // means "governor on, device coping" when true and "governor off entirely"
    // when false. Opposite findings, identical column.
    smoothingEnabled?: boolean;
    dynamicInferenceEnabled?: boolean;

    // ── Startup (NF3) ────────────────────────────────────────────────────────
    // modelLoadTimeMs starts after the app is already running, which hides the
    // difference this study exists to measure: a PWA boots a JS engine and pulls
    // a ~26 MB precache, a native app runs an installed binary.
    //
    // Measured as "the app's own startup" on both sides, which is the closest
    // honest pairing but not an identical span: the PWA counts navigation start
    // to `domInteractive`, native counts JS bundle evaluation to the first
    // interactive frame. Neither includes OS process spawn. Report the two with
    // their definitions rather than as one number.
    appStartupMs?: number;

    // ── Detection quality — what MediaPipe itself reports ────────────────────
    // Everything else here measures speed. The iOS orientation defect degraded
    // tracking accuracy for weeks while every timing metric looked healthy, so a
    // quality axis is not optional.
    /** Mean MediaPipe confidence of the top gesture, over frames with a hand. */
    avgGestureConfidence?: number;
    /** Mean of the strongest blendshape score per frame — how hard the face model fires. */
    avgBlendshapeActivation?: number;
    /**
     * Landmark jitter: mean frame-to-frame movement of the nose tip, in
     * normalized units, while tracking is held. Low is stable. Measures what F9
     * smoothing buys and would have exposed the orientation defect.
     */
    landmarkStability?: number;

};
