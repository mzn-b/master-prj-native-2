/* globals jest */

/**
 * Skia resolves a native TurboModule at import time and its own Mock() needs a
 * full CanvasKit instance, which is far too heavy for a smoke test. We only use
 * Canvas, Path and Skia.Path here, so stub exactly that. Real drawing is
 * verified on device.
 */
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const makePath = () => ({
    addCircle: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    close: jest.fn(),
  });
  return {
    Canvas: ({children}) => React.createElement('Canvas', null, children),
    Path: () => null,
    Group: ({children}) => React.createElement('Group', null, children),
    Image: () => null,
    Circle: () => null,
    Skia: {
      Path: {Make: makePath, MakeFromSVGString: makePath},
    },
    useImage: () => null,
  };
});

/* globals jest */

/**
 * Reanimated 4's shipped mock imports the real module, which initialises the
 * worklets runtime and fails under jest. Our components only use these two
 * hooks, so a minimal stand-in is enough — real behaviour is verified on device.
 */
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial) => ({value: initial}),
  useDerivedValue: (factory) => ({value: factory()}),
  useAnimatedReaction: () => undefined,
}));

/** VisionCamera resolves native modules at import time. */
jest.mock('react-native-vision-camera', () => ({
  Camera: () => null,
  NativePreviewView: () => null,
  // jest.fn() so individual tests can override the return value.
  useCameraDevice: jest.fn(() => ({id: 'front', position: 'front'})),
  useCameraPermission: jest.fn(() => ({hasPermission: true, requestPermission: jest.fn()})),
  useFrameOutput: jest.fn(() => ({})),
  useAsyncRunner: jest.fn(() => ({runAsync: () => true})),
  useCamera: jest.fn(() => undefined),
  // The preview stream is a separate output whose resolution the overlay needs;
  // undefined here mirrors a session that has not negotiated one yet, which is
  // the case the geometry must degrade gracefully for.
  usePreviewOutput: jest.fn(() => ({currentResolution: undefined})),
  // Plain data in the real package, but the mock replaces the whole module,
  // so it has to be restated here. Kept in sync by a test in
  // src/tracking/__tests__/captureResolution.test.ts.
  CommonResolutions: {
    VGA_16_9: {width: 480, height: 854},
    HD_16_9: {width: 720, height: 1280},
    FHD_16_9: {width: 1080, height: 1920},
  },
}));

/** Nitro's native module is unavailable under jest; box() is identity here. */
jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    box: (obj) => ({unbox: () => obj}),
    createHybridObject: () => ({}),
  },
}));

/** The Nitro HybridObjects have no JS implementation to load in tests. */
jest.mock('tracking-native', () => ({
  createLandmarkDetector: () => ({
    configure: jest.fn(),
    detect: jest.fn(),
    release: jest.fn(),
    modelLoadTimeMs: 300,
    gpuDelegateActive: true,
  }),
  createNativeMetrics: () => ({snapshot: () => ({})}),
}));
