# master-prj-native-2

React Native CLI half of the master's thesis comparison *"PWAs vs. Native AR Filters"*.
Real-time face and hand tracking with MediaPipe Tasks Vision through native Swift and
Kotlin plugins, three demo filters, and metrics submission to the shared Spring Boot
backend.

This app **replaces `master-prj-native`** as the native contender. The `Platform` values
(`IOS_NATIVE` / `ANDROID_NATIVE`), the DTO and the backend contract are unchanged, so
sessions from either generation land in the same buckets.

See `../ARCHITECTURE.md` for the system-level architecture and measurement methodology,
and `../docs/superpowers/specs/2026-09-01-master-prj-native-2-design.md` for the design
this implements.

## Status

| | Android | iOS |
|---|---|---|
| Builds | yes | yes |
| Landmarks (F2–F4) | verified on Pixel 7 | verified on iPhone SE (3rd gen) |
| Crown / glasses / sparkles | verified | built, not yet visually verified |
| Session submit | implemented | implemented |

120 unit tests. `npx tsc --noEmit` and `npm run lint` clean.

## Prerequisites

- Node ≥ 22.11 (the RN 0.87 template requires it), watchman, Ruby + bundler
- **iOS:** Xcode 16+, an Apple ID signed in to Xcode (Settings → Accounts) for device
  builds, and a physical device — the Simulator's camera cannot do frame analysis
- **Android:** SDK 37, JDK 17, a physical device. **The emulator cannot run this app's
  camera**: it rejects `ImageAnalysis` at 1280x720 with "PRIVATE format ... not
  supported". The emulator is still useful for everything except the camera.

## Install and run

```bash
npm install
cd ios && bundle install && bundle exec pod install && cd ..

npm start                 # Metro
npm run android           # or: npx react-native run-android --device <serial>
npm run ios               # or build/install via Xcode for a physical device
npm run nitrogen          # regenerate native specs after editing any *.nitro.ts
npm test && npx tsc --noEmit && npm run lint
```

### iOS: the packaged-bundle trap

A debug `.app` contains a packaged `main.jsbundle` and **silently falls back to it when
Metro is unreachable**, which on iOS means "not on the same Wi-Fi as the Mac" — there is
no `adb reverse` equivalent. Reopening the app is therefore *not* enough to pick up a
JavaScript change: either confirm the device can reach the Mac's IP (baked into
`ip.txt` in the bundle at build time), or rebuild. Several hours were lost to this;
Android does not have the problem because Metro is forwarded over USB.

## Layout

```
src/
  domain/tracking.dto.ts        contract shared with the PWA and backend (F7)
  native/
    landmarkFormat.ts           packed Float32 layout + offsets
  tracking/
    useTracking.ts              camera -> detect -> smooth -> publish, session lifecycle
    decodeDetection.ts          packed buffer -> TrackingDTO
    dropoutGrace.ts             NF7, 150 ms hold, worklet-safe
    LandmarkSmoother.ts         One Euro filter (F9)
    DynamicInferenceController  frame-skip governor (F15)
    PerformanceTracker.ts       metrics (F8, F11)
    deviceCapabilities.ts       pre-start checks (F10)
  render/
    coordinates.ts              THE normalized -> view-pixel transform
    headPose.ts                 pose from landmarks
    LandmarkOverlay.tsx         Skia landmarks (F4)
    filters/                    Crown3D (three.js/WebGPU), Glasses, Sparkles, FilterLayer
  metrics/nativeMetrics.ts      CPU / memory / thermal / battery
  api/                          backend client
  ui/                           presentational components
  screens/CameraScreen.tsx      composition only
modules/tracking-native/        local Nitro module: Swift + Kotlin, MediaPipe, models
```

## How the pipeline works

1. `<Camera>` stays mounted and is driven by `isActive`. Its frame output requests
   `pixelFormat: 'rgb'`.
2. `onFrame` (worklet) applies the F15 frame-skip, then hands the frame to
   `useAsyncRunner`, a single dedicated thread. If the runner is busy the frame is
   disposed and counted as dropped — real backpressure, and a measured number rather
   than an estimate.
3. The async worklet calls the `LandmarkDetector` Nitro HybridObject, which runs
   MediaPipe and returns landmarks packed as one `Float32Array`.
4. Reanimated's UI runtime applies NF7 dropout grace and publishes to a SharedValue.
5. Skia and three.js read that value directly. **No React state is updated per frame.**
6. Every 500 ms the metrics tick drains accumulated measurements onto the
   `PerformanceTracker` and updates the HUD.

### Things that are load-bearing

Each of these caused a silent failure — compiling cleanly and producing no error:

- **`pixelFormat: 'rgb'` is required on both platforms.** Android's native format is a
  GPU-side PRIVATE buffer that the CPU cannot read (so `toBitmap()` fails and every
  detection returns empty); iOS cannot feed its native buffer to `MPImage` either.
- **The app supplies its own millisecond timestamp.** `frame.timestamp` is in seconds on
  iOS and already millisecond-scaled on Android; MediaPipe's VIDEO mode silently returns
  nothing when the integer millisecond value does not strictly increase.
- **MediaPipe tasks are built lazily on the thread that calls `detect`.** A GPU delegate
  belongs to its creating thread; building on the JS thread and detecting elsewhere
  segfaults on Android and stalls on iOS.
- **`detect` / `configure` / `release` are mutually exclusive.** Closing a task while a
  detection is in flight is a use-after-free.
- **Pure helpers called from worklets need the `'worklet'` directive**, and a Nitro
  HybridObject must be **boxed** (`NitroModules.box`) to cross into another runtime.
- **Frame rotation must be passed to MediaPipe**, or the face arrives sideways and is
  never found.
- **`<Camera>` must stay mounted.** Unmounting it per session trips an AVFoundation
  assertion on iOS and aborts the app.

## Measurements so far

Face-only, GPU delegate, both devices:

| Device | Inference | Detections/sec |
|---|---|---|
| iPhone SE (3rd gen, A15) | 20–21 ms | 30 |
| Pixel 7 (Tensor G2) | ~95 ms | ~7 |

**Do not quote this yet.** It is a single unmatched sample: face-only on iOS, and the
Android path converts `ImageProxy → Bitmap → MPImage` per frame while iOS passes the
`CMSampleBuffer` straight in. Part of the gap may be that asymmetry in this codebase
rather than a platform property. A matched run (same mode, same duration, same lighting)
is needed first, and the conversion asymmetry belongs in the limitations section.

## Running a comparison benchmark

1. Start the backend (`docker compose up` in `../master-prj-backend`).
2. Point `src/api/config.ts` at `http://<your-LAN-IP>:8080`; the phone cannot reach
   `localhost`.
3. Install on a **physical device** on both platforms.
4. Put both apps in the **same state**: same tracking mode, and the same F9 smoothing and
   F15 dynamic-inference settings. These change the numbers and must match.
5. Start, run for a fixed duration, Stop — the session submits automatically. Toggling a
   filter also submits and starts a new measurement window, so each filter combination is
   its own session.
6. `SELECT * FROM tracking_sessions ORDER BY recorded_at DESC LIMIT 5;`

## Build stamping

`scripts/stamp-build.mjs` writes `src/config/buildInfo.ts` with
`version+gitsha[-dirty]`, which is submitted with every session as `appVersion`.
It runs automatically before `npm run start|android|ios` via npm pre-scripts.

**A build started directly from Xcode or Gradle carries whatever stamp was
written last** — run `npm run stamp` first in that case. A `-dirty` suffix means
the build corresponds to no commit, which is acceptable for a pilot but not for
runs that end up in the thesis.

## Participant consent

`src/ui/ConsentGate.tsx` gates the whole app until consent is given, so the
camera cannot be reached without it. The notice text lives in
`src/ui/consentText.ts` and is **byte-identical to the PWA's copy**, which a test
asserts. Consent is deliberately not persisted: study sessions are supervised
individually on a shared device, so every launch asks again.

While the controller block in `consentText.ts` still contains `TODO`, the gate
replaces the accept button with a warning and the app refuses to proceed.
