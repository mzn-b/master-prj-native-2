module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Must stay last: the worklets plugin rewrites function bodies marked
  // 'worklet', and Reanimated 4 delegates its own transform to it.
  plugins: ['react-native-worklets/plugin'],
};
