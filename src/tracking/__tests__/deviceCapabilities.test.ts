import {canStartTracking, checkDeviceCapabilities} from '../deviceCapabilities';

const healthy = {hasCameraDevice: true, hasPermission: true, totalMemoryMB: 4096};

describe('checkDeviceCapabilities (F10)', () => {
  it('allows starting on a healthy device', () => {
    const caps = checkDeviceCapabilities(healthy);
    expect(caps.errors).toHaveLength(0);
    expect(canStartTracking(caps)).toBe(true);
  });

  it('blocks starting when no camera device exists', () => {
    const caps = checkDeviceCapabilities({...healthy, hasCameraDevice: false});
    expect(caps.errors.length).toBeGreaterThan(0);
    expect(canStartTracking(caps)).toBe(false);
  });

  it('blocks starting without camera permission', () => {
    const caps = checkDeviceCapabilities({...healthy, hasPermission: false});
    expect(caps.errors.length).toBeGreaterThan(0);
    expect(canStartTracking(caps)).toBe(false);
  });

  it('warns but still allows starting on a low-memory device', () => {
    const caps = checkDeviceCapabilities({...healthy, totalMemoryMB: 900});
    expect(caps.warnings.length).toBeGreaterThan(0);
    expect(caps.errors).toHaveLength(0);
    expect(canStartTracking(caps)).toBe(true);
  });

  it('does not warn when memory is unknown', () => {
    const caps = checkDeviceCapabilities({...healthy, totalMemoryMB: undefined});
    expect(caps.warnings).toHaveLength(0);
    expect(canStartTracking(caps)).toBe(true);
  });

  it('reports every problem at once rather than the first', () => {
    const caps = checkDeviceCapabilities({
      hasCameraDevice: false,
      hasPermission: false,
      totalMemoryMB: 512,
    });
    expect(caps.errors).toHaveLength(2);
    expect(caps.warnings).toHaveLength(1);
  });
});
