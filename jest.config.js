module.exports = {
  preset: '@react-native/jest-preset',
  // @testing-library/react-native >= 12.4 registers its matchers automatically,
  // so no setupFilesAfterEnv entry is needed.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|react-native-worklets|react-native-reanimated|@shopify/react-native-skia|react-native-vision-camera|react-native-vision-camera-worklets|react-native-webgpu|react-native-nitro-modules|three)/)',
  ],
};
