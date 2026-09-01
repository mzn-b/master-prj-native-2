/**
 * F10 — check the device can do the job before tracking starts.
 *
 * A pure function over an input struct: the caller supplies what VisionCamera
 * and the native metrics module report, which keeps this testable without a
 * device and keeps camera APIs out of the tracking layer.
 */

export interface CapabilityInput {
  /** A front camera was found by useCameraDevice. */
  hasCameraDevice: boolean;
  /** Camera permission has been granted. */
  hasPermission: boolean;
  /** Physical device RAM, when the native metrics module can report it. */
  totalMemoryMB?: number;
}

export interface DeviceCapabilities {
  hasCamera: boolean;
  hasPermission: boolean;
  hasSufficientMemory: boolean;
  /** Blocking problems — tracking cannot start. */
  errors: string[];
  /** Non-blocking; shown to the user but tracking may proceed. */
  warnings: string[];
}

/** Below this the app runs, but inference will likely thrash. */
const LOW_MEMORY_MB = 1024;

export function checkDeviceCapabilities(input: CapabilityInput): DeviceCapabilities {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.hasCameraDevice) {
    errors.push('Keine Kamera gefunden.');
  }
  if (!input.hasPermission) {
    errors.push('Kamerazugriff wurde nicht erteilt.');
  }

  const hasSufficientMemory =
    input.totalMemoryMB === undefined || input.totalMemoryMB >= LOW_MEMORY_MB;
  if (!hasSufficientMemory) {
    warnings.push(
      `Wenig Arbeitsspeicher verfügbar (${Math.round(input.totalMemoryMB!)} MB). ` +
        'Die Bildrate kann darunter leiden.',
    );
  }

  return {
    hasCamera: input.hasCameraDevice,
    hasPermission: input.hasPermission,
    hasSufficientMemory,
    errors,
    warnings,
  };
}

export function canStartTracking(capabilities: DeviceCapabilities): boolean {
  return capabilities.errors.length === 0;
}
