const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Stamp the build and embed assets HERE rather than in npm pre* hooks.
//
// Those hooks only fire for `npm run ios` / `npm run android`; invoking the CLI
// directly (`npx react-native run-ios`) bypasses npm lifecycle entirely, so the
// stamp silently went stale — every build on 2026-10-08 reported the commit
// from whenever the script had last been run by hand, while bundling newer
// code. A session would then name a commit it was not built from, which is the
// one thing appVersion exists to prevent.
//
// Metro evaluates this file for every bundle, however the build was started, so
// this is the only place the generation cannot be skipped.
for (const script of ['scripts/stamp-build.mjs', 'scripts/embed-assets.mjs']) {
  execFileSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
  });
}

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
