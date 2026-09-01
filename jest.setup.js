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
}));

/** VisionCamera resolves native modules at import time. */
jest.mock('react-native-vision-camera', () => ({
  Camera: () => null,
  useCameraDevice: () => ({id: 'front', position: 'front'}),
  useCameraPermission: () => ({hasPermission: true, requestPermission: jest.fn()}),
  useCameraFormat: () => undefined,
  useFrameOutput: () => ({}),
  useAsyncRunner: () => ({runAsync: () => true}),
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
