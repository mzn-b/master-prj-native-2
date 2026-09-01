import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Camera, useCameraDevice, useCameraPermission} from 'react-native-vision-camera';
import {Platform, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
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
import {DEFAULT_ACTIVE_FILTERS, type ActiveFilters, type FilterId} from '../render/filters/types';
import {DebugHud} from '../ui/DebugHud';
import {FilterBar} from '../ui/FilterBar';
import {ModeSelector} from '../ui/ModeSelector';
import {PerformanceHud} from '../ui/PerformanceHud';
import {SessionControls} from '../ui/SessionControls';
import {SettingsSheet} from '../ui/SettingsSheet';

type AppMode = 'landmarks' | 'filters';

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
  const [showPerformance, setShowPerformance] = useState(true);
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
  });
  const {isRunning, latest, frameSize, metrics, currentFrameSkip, frameOutput} = tracking;

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
      viewWidth: preview.width,
      viewHeight: preview.height,
      rotation: FRAME_ROTATION,
      mirrorX: true, // front camera, selfie convention
      resizeMode: 'cover',
    }),
    [frameDims, preview],
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
        await submitTrackingSession(effectiveMode, sessionMetrics, filters);
      } finally {
        setIsUploading(false);
      }
    },
    [effectiveMode],
  );

  const activeFilterIds = useCallback(
    () => (Object.keys(activeFiltersRef.current) as FilterId[]).filter(id => activeFiltersRef.current[id]),
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
      setActiveFilters(prev => ({...prev, [id]: !prev[id]}));
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

  const handleSetting = useCallback(
    (key: string, value: boolean) => {
      const setters: Record<string, (next: boolean) => void> = {
        smoothingEnabled: setSmoothingEnabled,
        dynamicInferenceEnabled: setDynamicInferenceEnabled,
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
        {device && hasPermission && isRunning ? (
          // Bound only while a session runs: an idle screen should not hold the
          // camera open, and an unsupported configuration must surface as a
          // message rather than take the app down.
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            outputs={[frameOutput]}
            onError={error => setCameraError(error.message)}
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

        {isRunning && preview.width > 0 && (
          appMode === 'landmarks' ? (
            <LandmarkOverlay latest={latest} geometry={geometry} mode={effectiveMode} />
          ) : (
            <FilterLayer activeFilters={activeFilters} latest={latest} geometry={geometry} />
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
        {capabilities.warnings.map(warning => (
          <Text key={warning} style={styles.warning}>
            {warning}
          </Text>
        ))}

        <View style={styles.row}>
          {(['landmarks', 'filters'] as AppMode[]).map(candidate => (
            <Text
              key={candidate}
              onPress={() => !isRunning && setAppMode(candidate)}
              style={[styles.tab, appMode === candidate && styles.tabActive]}>
              {candidate === 'landmarks' ? 'Landmarks' : 'Filters'}
            </Text>
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
  tab: {
    color: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#374151',
    overflow: 'hidden',
  },
  tabActive: {backgroundColor: '#4f46e5', fontWeight: '700'},
  error: {color: '#fca5a5'},
  warning: {color: '#fcd34d'},
});
