import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  NativePreviewView,
  useCamera,
  useCameraDevice,
  useCameraPermission,
  usePreviewOutput,
} from 'react-native-vision-camera';
import {Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent} from 'react-native';
import type {PerformanceMetricsDTO, TrackingDTO, TrackingMode} from '../domain/tracking.dto';
import {submitTrackingSession} from '../api/trackingApi';
import {getNativeMetrics} from '../metrics/nativeMetrics';
import {decodeDetection} from '../tracking/decodeDetection';
import {
  canStartTracking,
  checkDeviceCapabilities,
  type DeviceCapabilities,
} from '../tracking/deviceCapabilities';
import {useTracking} from '../tracking/useTracking';
import {LandmarkOverlay} from '../render/LandmarkOverlay';
import type {Rotation, ViewGeometry} from '../render/coordinates';
import {FilterLayer} from '../render/filters/FilterLayer';
import {prewarmCrownModel} from '../render/filters/Crown3D';
import {APP_VERSION, SURVEY_BUILD} from '../config/buildInfo';
import {
  DEFAULT_ACTIVE_FILTERS,
  drawnRenderBackend,
  submittedFilters,
  type ActiveFilters,
  type AppMode,
  type FilterId,
} from '../render/filters/types';
import {DebugHud} from '../ui/DebugHud';
import {FilterBar} from '../ui/FilterBar';
import {ModeSelector} from '../ui/ModeSelector';
import {PerformanceHud} from '../ui/PerformanceHud';
import {SessionControls} from '../ui/SessionControls';
import {SettingsSheet} from '../ui/SettingsSheet';


/** MediaPipe returns landmarks in the frame's own orientation. */
const FRAME_ROTATION: Rotation = Platform.OS === 'ios' ? 90 : 270;

export function CameraScreen(): React.JSX.Element {
  const device = useCameraDevice('front');
  const {hasPermission, requestPermission} = useCameraPermission();

  const [mode, setMode] = useState<TrackingMode>('combined');
  const [appMode, setAppMode] = useState<AppMode>('landmarks');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(DEFAULT_ACTIVE_FILTERS);
  const [smoothingEnabled, setSmoothingEnabled] = useState(true);
  const [dynamicInferenceEnabled, setDynamicInferenceEnabled] = useState(true);
  /**
   * Requests the MediaPipe GPU delegate. Default on, matching how every
   * session so far was recorded.
   *
   * Exposed so the delegate can be tested rather than assumed: the
   * gpuDelegateActive column says the delegate was requested and built, not
   * that inference ran on the GPU. Toggle it off and run the same condition
   * again — if nothing moves, the delegate was never doing anything.
   */
  const [gpuDelegateEnabled, setGpuDelegateEnabled] = useState(true);
  const [showPerformance, setShowPerformance] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [debugTracking, setDebugTracking] = useState<TrackingDTO | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState({width: 0, height: 0});

  // Filter mode always tracks both modalities so filters work without a restart.
  const effectiveMode: TrackingMode = appMode === 'filters' ? 'combined' : mode;

  const tracking = useTracking({
    mode: effectiveMode,
    smoothingEnabled,
    dynamicInferenceEnabled,
    gpuDelegateEnabled,
  });
  const {isRunning, latest, frameSize, metrics, currentFrameSkip, frameOutput} = tracking;

  // A filter that fails to initialise draws nothing and says nothing. Shown in
  // the warning area so a run is never recorded believing a filter was active.
  const [filterError, setFilterError] = useState<string | null>(null);

  const appModeRef = useRef(appMode);
  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  const activeFiltersRef = useRef(activeFilters);
  useEffect(() => {
    activeFiltersRef.current = activeFilters;
  }, [activeFilters]);

  const capabilities: DeviceCapabilities = useMemo(
    () =>
      checkDeviceCapabilities({
        hasCameraDevice: device != null,
        hasPermission,
        totalMemoryMB: getNativeMetrics().totalMemoryMB,
      }),
    [device, hasPermission],
  );

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  /**
   * The preview is its own camera output, negotiated separately from the frame
   * output and — per VisionCamera's docs — without regard for aspect ratio. We
   * own it here rather than letting <Camera> create one internally, because the
   * overlay has to know the size of what is actually on screen: projecting
   * landmarks with the analysis frame's dimensions scales them against the wrong
   * field of view and every overlay lands uniformly too large.
   */
  const previewOutput = usePreviewOutput();
  useCamera({
    // The hook cannot be conditional, so fall back to the position when the
    // device list has not resolved yet; it resolves to the same camera.
    device: device ?? 'front',
    isActive: isRunning,
    outputs: [previewOutput, frameOutput],
    onError: error => setCameraError(error.message),
  });

  const [previewDims, setPreviewDims] = useState<{width: number; height: number} | null>(null);
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    // currentResolution is only populated once the session has negotiated, so
    // poll alongside the frame size rather than reading it once on start.
    const id = setInterval(() => {
      const r = previewOutput.currentResolution;
      if (r && r.width > 0) {
        setPreviewDims(current =>
          current && current.width === r.width && current.height === r.height
            ? current
            : {width: r.width, height: r.height},
        );
      }
    }, 500);
    return () => clearInterval(id);
  }, [isRunning, previewOutput]);

  // Frame dimensions come from the frames themselves rather than a requested
  // format, so the overlay matches what the camera actually delivered.
  const [frameDims, setFrameDims] = useState({width: 1280, height: 720});
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const id = setInterval(() => {
      const size = frameSize.value;
      if (size.width > 0) {
        setFrameDims(current =>
          current.width === size.width && current.height === size.height ? current : size,
        );
      }
    }, 500);
    return () => clearInterval(id);
  }, [isRunning, frameSize]);

  /** One geometry, shared by every overlay, so they cannot disagree. */
  const geometry: ViewGeometry = useMemo(
    () => ({
      frameWidth: frameDims.width,
      frameHeight: frameDims.height,
      previewWidth: previewDims?.width,
      previewHeight: previewDims?.height,
      viewWidth: preview.width,
      viewHeight: preview.height,
      rotation: FRAME_ROTATION,
      mirrorX: true, // front camera, selfie convention
      resizeMode: 'cover',
    }),
    [frameDims, previewDims, preview],
  );

  const onPreviewLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setPreview({width, height});
  }, []);

  const submit = useCallback(
    async (sessionMetrics: PerformanceMetricsDTO, filters: FilterId[]) => {
      if (sessionMetrics.frameCount === 0) {
        return;
      }
      setIsUploading(true);
      try {
        // What drew this session, resolved at submission like the filters
        // themselves. The crown has no WebGL path here: react-native-webgpu
        // supplies the GPUDevice its renderer is built on.
        const renderBackend = drawnRenderBackend(
          appModeRef.current,
          activeFiltersRef.current,
          {landmarks: 'skia', flat: 'skia', crown: 'webgpu'},
        );
        await submitTrackingSession(
          effectiveMode,
          {...sessionMetrics, renderBackend},
          filters,
        );
      } finally {
        setIsUploading(false);
      }
    },
    [effectiveMode],
  );

  // Reports what was DRAWN, not what was selected: landmarks mode never mounts
  // FilterLayer, and the selection survives a mode switch. See
  // submittedFilters() for the defect this closes.
  const activeFilterIds = useCallback(
    () => submittedFilters(appModeRef.current, activeFiltersRef.current),
    [],
  );

  // A camera failure ends the session rather than leaving it half-running.
  useEffect(() => {
    if (cameraError && isRunning) {
      tracking.stop();
    }
  }, [cameraError, isRunning, tracking]);

  const handleStop = useCallback(async () => {
    const final = tracking.stop();
    if (final) {
      await submit(final, activeFilterIds());
    }
  }, [tracking, submit, activeFilterIds]);

  /**
   * A filter toggle closes the current measurement window: submit what was
   * measured with the previous filter set, then start a fresh session. Matches
   * the existing apps so per-filter costs stay comparable.
   */
  const handleFilterToggle = useCallback(
    async (id: FilterId) => {
      if (isRunning && metrics && metrics.frameCount > 0) {
        await submit(metrics, activeFilterIds());
        tracking.resetSession();
      }
      setActiveFilters(prev => {
        const next = {...prev, [id]: !prev[id]};
        // Decode the crown now rather than when the session starts, so the
        // first run of a launch measures the same work as every later one.
        if (next.crown) {
          prewarmCrownModel();
        }
        return next;
      });
    },
    [isRunning, metrics, submit, activeFilterIds, tracking],
  );

  // F14 — decode a DTO only when the debug HUD is actually showing.
  useEffect(() => {
    if (!showDebug || !isRunning) {
      return;
    }
    const id = setInterval(() => {
      const detection = latest.value;
      setDebugTracking(detection ? decodeDetection(detection, effectiveMode) : null);
    }, 500);
    return () => clearInterval(id);
  }, [showDebug, isRunning, latest, effectiveMode]);

  /**
   * Switching surface clears the filter selection.
   *
   * The two are independent state and only `appMode` gates rendering, so a
   * selection left behind in landmarks mode is invisible but still submitted.
   * Clearing here keeps the state honest; submittedFilters() keeps the report
   * honest even if it is not.
   */
  const handleAppMode = useCallback(
    (next: AppMode) => {
      if (isRunning) {
        return;
      }
      setAppMode(next);
      setActiveFilters(DEFAULT_ACTIVE_FILTERS);
      setFilterError(null);
    },
    [isRunning],
  );

  const handleSetting = useCallback(
    (key: string, value: boolean) => {
      const setters: Record<string, (next: boolean) => void> = {
        smoothingEnabled: setSmoothingEnabled,
        dynamicInferenceEnabled: setDynamicInferenceEnabled,
        gpuDelegateEnabled: setGpuDelegateEnabled,
        showPerformance: setShowPerformance,
        showDebug: setShowDebug,
      };
      setters[key]?.(value);
    },
    [],
  );

  return (
    <View style={styles.root}>
      <View style={styles.preview} onLayout={onPreviewLayout}>
        {device && hasPermission ? (
          // Stays mounted and is controlled by isActive. Mounting and
          // unmounting per session tears the capture session down each time,
          // which trips an AVFoundation assertion on iOS
          // (detachFromFigCaptureSession) and aborts the app.
          <NativePreviewView
            style={StyleSheet.absoluteFill}
            previewOutput={previewOutput}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {!device
                ? 'Keine Kamera gefunden'
                : !hasPermission
                  ? 'Kamerazugriff erforderlich'
                  : 'Bereit — Start drücken'}
            </Text>
          </View>
        )}

        {/*
          Mounted only while running, deliberately.

          Mounting the filter layer during setup (to warm the crown) crashed
          both platforms: the Skia filters run worklets that read the tracking
          runtime, and bringing them up before tracking.start() produced
          "TypeError: undefined is not a function" inside
          shopify_ContainerNative on a worklets thread. The crown is warmed
          instead by prewarmCrownModel(), which does the expensive decode and
          parse without creating any GPU surface.
        */}
        {isRunning && preview.width > 0 && (
          appMode === 'landmarks' ? (
            <LandmarkOverlay latest={latest} geometry={geometry} mode={effectiveMode} />
          ) : (
            <FilterLayer
              activeFilters={activeFilters}
              latest={latest}
              geometry={geometry}
              onFilterError={setFilterError}
            />
          )
        )}

        <View style={styles.hudLayer} pointerEvents="none">
          {showPerformance && (
            <PerformanceHud metrics={metrics} currentFrameSkip={currentFrameSkip} />
          )}
          {showDebug && <DebugHud tracking={debugTracking} />}
        </View>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <SessionControls
          isRunning={isRunning}
          canStart={canStartTracking(capabilities)}
          isUploading={isUploading}
          onStart={() => {
            setCameraError(null);
            tracking.start();
          }}
          onStop={handleStop}
        />

        {cameraError && <Text style={styles.error}>Kamera: {cameraError}</Text>}
        {capabilities.errors.map(error => (
          <Text key={error} style={styles.error}>
            {error}
          </Text>
        ))}
        {/*
          The running build, matching the PWA.

          SURVEY-PROCEDURE.md asks for the build stamp per session, and on
          2026-10-08 a device was reporting behaviour from a build that was not
          the one running. Reading it off the screen settles that in a second
          instead of by inference.
        */}
        <Text style={styles.buildStamp}>{`Build ${APP_VERSION}${SURVEY_BUILD ? ' (Studie)' : ''}`}</Text>
        {capabilities.warnings.map(warning => (
          <Text key={warning} style={styles.warning}>
            {warning}
          </Text>
        ))}
        {filterError !== null && (
          <Text style={styles.warning}>{`Filter-Fehler: ${filterError}`}</Text>
        )}

        <View style={styles.row}>
          {/*
            TouchableOpacity rather than <Text onPress>. The bare Text produced
            no touch target on Android — it never appeared as a Button in the
            view hierarchy, and tapping it did nothing, while every other
            control in this app (all TouchableOpacity) responded normally.
            Reproduced on a Pixel 7 on 2026-10-08: landmarks -> filters worked,
            filters -> landmarks was dead across tap, long press and every
            position in the element.
          */}
          {(['landmarks', 'filters'] as AppMode[]).map(candidate => (
            <TouchableOpacity
              key={candidate}
              accessibilityRole="button"
              disabled={isRunning}
              onPress={() => handleAppMode(candidate)}
              style={[styles.tab, appMode === candidate && styles.tabActive]}>
              <Text style={styles.tabLabel}>
                {candidate === 'landmarks' ? 'Landmarks' : 'Filters'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {appMode === 'landmarks' ? (
          <ModeSelector mode={mode} disabled={isRunning} onChange={setMode} />
        ) : (
          <FilterBar activeFilters={activeFilters} onToggle={handleFilterToggle} />
        )}

        <SettingsSheet
          smoothingEnabled={smoothingEnabled}
          dynamicInferenceEnabled={dynamicInferenceEnabled}
          gpuDelegateEnabled={gpuDelegateEnabled}
          settingsLocked={isRunning}
          showPerformance={showPerformance}
          showDebug={showDebug}
          onChange={handleSetting}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b0b0f'},
  preview: {flex: 1, overflow: 'hidden'},
  placeholder: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center'},
  placeholderText: {color: '#9ca3af', fontSize: 16},
  hudLayer: {position: 'absolute', top: 12, left: 12, right: 12, gap: 8},
  panel: {maxHeight: 300, backgroundColor: '#111827'},
  panelContent: {padding: 12, gap: 10},
  row: {flexDirection: 'row', gap: 6},
  tabLabel: {color: '#fff'},
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#374151',
    overflow: 'hidden',
  },
  tabActive: {backgroundColor: '#4f46e5', fontWeight: '700'},
  error: {color: '#fca5a5'},
  warning: {color: '#fcd34d'},
  buildStamp: {color: '#6b7280', fontSize: 11},
});
