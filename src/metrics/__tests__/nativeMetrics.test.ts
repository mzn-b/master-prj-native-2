/**
 * OS-level metrics are best-effort: a platform that cannot supply them, or a
 * native call that throws, must never break a tracking session.
 */
describe('getNativeMetrics', () => {
  afterEach(() => jest.resetModules());

  it('returns the native snapshot and creates the native object once', () => {
    const snapshot = jest.fn(() => ({memoryUsedMB: 512, thermalState: 'nominal'}));
    const create = jest.fn(() => ({snapshot}));
    jest.isolateModules(() => {
      jest.doMock('tracking-native', () => ({createNativeMetrics: create}));
      const {getNativeMetrics} = require('../nativeMetrics');
      expect(getNativeMetrics()).toEqual({memoryUsedMB: 512, thermalState: 'nominal'});
      getNativeMetrics();
      expect(create).toHaveBeenCalledTimes(1);
      expect(snapshot).toHaveBeenCalledTimes(2);
    });
  });

  it('returns an empty snapshot when the native side fails', () => {
    jest.isolateModules(() => {
      jest.doMock('tracking-native', () => ({
        createNativeMetrics: () => {
          throw new Error('module not linked');
        },
      }));
      const {getNativeMetrics} = require('../nativeMetrics');
      expect(getNativeMetrics()).toEqual({});
    });
  });
});
