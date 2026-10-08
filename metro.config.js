const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Kept so a .glb can be require()d, but the crown no longer uses that
    // path: on Android Release the resolved URI is a bare resource name that
    // fetch cannot open, so the model is embedded instead
    // (scripts/embed-assets.mjs).
    assetExts: [...defaultConfig.resolver.assetExts, 'glb'],
  },
};

module.exports = mergeConfig(defaultConfig, config);
