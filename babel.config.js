module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // three 0.185 ships static class blocks, which the React Native preset
    // does not enable; without this Metro fails to parse three.core.js.
    '@babel/plugin-transform-class-static-block',
    // Must stay last: the worklets plugin rewrites function bodies marked
    // 'worklet', and Reanimated 4 delegates its own transform to it.
    'react-native-worklets/plugin',
  ],
};
