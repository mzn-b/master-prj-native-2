module.exports = {
  preset: '@react-native/jest-preset',
  // Skia and Reanimated resolve native modules at import time; their own jest
  // setups provide the stand-ins. @testing-library/react-native >= 12.4
  // registers its matchers automatically, so it needs no setup entry.
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|react-native-worklets|react-native-reanimated|@shopify/react-native-skia|react-native-vision-camera|react-native-vision-camera-worklets|react-native-webgpu|react-native-nitro-modules|three)/)',
  ],
};
