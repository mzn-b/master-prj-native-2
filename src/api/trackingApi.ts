import {Dimensions, Platform} from 'react-native';
import type {PerformanceMetricsDTO, TrackingMode} from '../domain/tracking.dto';
import {getNativeMetrics} from '../metrics/nativeMetrics';
import {API_BASE_URL} from './config';
// Generated per build by scripts/stamp-build.mjs so a session can be traced
// back to the code that produced it.
import {APP_VERSION} from '../config/buildInfo';

export type PlatformName = 'IOS_PWA' | 'ANDROID_PWA' | 'IOS_NATIVE' | 'ANDROID_NATIVE';

export interface DeviceInfo {
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  screenWidth?: number;
  screenHeight?: number;
  browserInfo?: string;
}

export interface TrackingSessionResponse {
  id: number;
  sessionId: string;
  platform: PlatformName;
  recordedAt: string;
  message: string;
}


function currentPlatform(): PlatformName {
  return Platform.OS === 'ios' ? 'IOS_NATIVE' : 'ANDROID_NATIVE';
}

function deviceInfo(): DeviceInfo {
  const {width, height} = Dimensions.get('window');
  return {
    // The real handset — "Google Pixel 7", "iPhone14,6" — read through the
    // Nitro metrics module. This used to be the literal string "Android device",
    // which made every native row impossible to attribute to a device in a study
    // whose whole point is comparing devices.
    deviceModel: getNativeMetrics().deviceModel ?? `${Platform.OS} device`,
    osVersion: `${Platform.OS} ${String(Platform.Version)}`,
    appVersion: APP_VERSION,
    screenWidth: Math.round(width),
    screenHeight: Math.round(height),
  };
}

/** RFC 4122 v4, without pulling in a uuid dependency. */
function sessionId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += '-';
    } else if (i === 14) {
      out += '4';
    } else if (i === 19) {
      // RFC 4122 requires the variant bits here; bitwise is the definition.
      // eslint-disable-next-line no-bitwise
      out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    } else {
      out += hex[Math.floor(Math.random() * 16)];
    }
  }
  return out;
}

/**
 * Submit one measurement session.
 *
 * Never throws: a failed submission must not interrupt tracking, and losing a
 * session to a flaky network is preferable to losing the run.
 */
export async function submitTrackingSession(
  mode: TrackingMode,
  metrics: PerformanceMetricsDTO,
  activeFilters: string[],
): Promise<TrackingSessionResponse | null> {
  const request = {
    platform: currentPlatform(),
    deviceInfo: deviceInfo(),
    sessionId: sessionId(),
    mode: mode.toUpperCase(),
    metrics,
    recordedAt: new Date().toISOString(),
    activeFilters,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/tracking/sessions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as TrackingSessionResponse;
  } catch {
    return null;
  }
}
