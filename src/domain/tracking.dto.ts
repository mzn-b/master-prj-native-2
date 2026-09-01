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
    gpuUsagePercent?: number;
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
    trackingConfidence?: number;
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
};
