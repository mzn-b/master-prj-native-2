/**
 * NF3 — appStartupMs must be absent rather than wrong.
 *
 * requestAnimationFrame does not fire while the app is backgrounded, so an idle
 * gap before first use lands in the measurement. On 2026-10-13 every Android
 * session reported 139,181 ms because the build launched the app and it sat
 * untouched; iOS read 30 ms in the same batch only because it was picked up
 * immediately. 139 seconds is not a slow startup, it is a different quantity,
 * and a schema that reports it as startup is lying.
 */
let mockAppStateHandler: ((s: string) => void) | undefined;
let mockCurrentState = 'active';

jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockCurrentState;
    },
    addEventListener: (_: string, fn: (s: string) => void) => {
      mockAppStateHandler = fn;
      return {remove: () => {}};
    },
  },
}));

describe('appStartupMs', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAppStateHandler = undefined;
    mockCurrentState = 'active';
  });

  it('reports a value when the app stayed foregrounded', () => {
    const {markInteractive, getAppStartupMs} = require('../startup');
    markInteractive();
    expect(getAppStartupMs()).toBeGreaterThanOrEqual(0);
  });

  it('reports nothing before the first frame', () => {
    const {getAppStartupMs} = require('../startup');
    expect(getAppStartupMs()).toBeUndefined();
  });

  it('reports nothing if the app was backgrounded before the first frame', () => {
    const {markInteractive, getAppStartupMs} = require('../startup');
    mockAppStateHandler?.('background');
    markInteractive();
    expect(getAppStartupMs()).toBeUndefined();
  });

  it('still reports if the app is backgrounded only after the first frame', () => {
    // Backgrounding later says nothing about how long startup took.
    const {markInteractive, getAppStartupMs} = require('../startup');
    markInteractive();
    mockAppStateHandler?.('background');
    expect(getAppStartupMs()).toBeGreaterThanOrEqual(0);
  });

  it('reports a value for an iOS launch, which begins inactive', () => {
    // iOS launches through UIApplicationStateInactive, which React Native
    // reports as 'inactive'. Treating that as "not foregrounded" voided every
    // iOS native startup time (sessions 24-26, 2026-10-29).
    mockCurrentState = 'inactive';
    const {markInteractive, getAppStartupMs} = require('../startup');
    mockAppStateHandler?.('active');
    markInteractive();
    expect(getAppStartupMs()).toBeGreaterThanOrEqual(0);
  });

  it('still reports after an inactive spell that never reached the background', () => {
    // A notification banner or Control Center makes an iOS app inactive while
    // it stays on screen and keeps drawing frames.
    const {markInteractive, getAppStartupMs} = require('../startup');
    mockAppStateHandler?.('inactive');
    mockAppStateHandler?.('active');
    markInteractive();
    expect(getAppStartupMs()).toBeGreaterThanOrEqual(0);
  });

  it('reports nothing when the app did not start in the foreground', () => {
    mockCurrentState = 'background';
    const {markInteractive, getAppStartupMs} = require('../startup');
    markInteractive();
    expect(getAppStartupMs()).toBeUndefined();
  });
});
