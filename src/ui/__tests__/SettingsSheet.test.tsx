import React from 'react';
import {Linking} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';
import {SettingsSheet, type SettingsSheetProps} from '../SettingsSheet';

/**
 * The full build's settings. Every switch that moves the numbers is recorded
 * with the session, so each must report its own key; the GPU delegate is read
 * when a session starts and is locked while one runs. The survey build, which
 * shows none of them, is covered in CameraScreen.survey.test.tsx.
 */
const props = (overrides: Partial<SettingsSheetProps> = {}): SettingsSheetProps => ({
  smoothingEnabled: true,
  gpuDelegateEnabled: true,
  showPerformance: false,
  showDebug: false,
  onChange: jest.fn(),
  ...overrides,
});

const LABELS = [
  ['F9: Glättung (One Euro)', 'smoothingEnabled'],
  ['GPU-Delegate', 'gpuDelegateEnabled'],
  ['Performance-HUD', 'showPerformance'],
  ['F14: Debug-HUD', 'showDebug'],
] as const;

describe('SettingsSheet (full build)', () => {
  it('offers every setting, each reporting its own key', async () => {
    const p = props();
    const {getAllByRole, getByText} = await render(<SettingsSheet {...p} />);
    const switches = getAllByRole('switch');
    expect(switches).toHaveLength(LABELS.length);
    for (const [index, [label, key]] of LABELS.entries()) {
      expect(getByText(label)).toBeTruthy();
      await fireEvent(switches[index], 'valueChange', false);
      expect(p.onChange).toHaveBeenLastCalledWith(key, false);
    }
  });

  it('locks the GPU delegate while a session runs, and nothing else', async () => {
    const {getAllByRole} = await render(<SettingsSheet {...props({settingsLocked: true})} />);
    const disabled = getAllByRole('switch').map(s => Boolean(s.props.disabled));
    expect(disabled).toEqual([false, true, false, false]);
  });

  it('shows no survey button while no survey URL is configured', async () => {
    const {queryByText} = await render(<SettingsSheet {...props()} />);
    expect(queryByText('UX Feedback')).toBeNull();
  });

  it('opens the configured survey, tagged with the platform', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    let Sheet: typeof SettingsSheet | undefined;
    jest.isolateModules(() => {
      jest.doMock('../../config/survey', () => ({UX_SURVEY_URL: 'https://forms.example/x?id=1'}));
      Sheet = require('../SettingsSheet').SettingsSheet;
    });
    const Component = Sheet as typeof SettingsSheet;
    const {getByText} = await render(<Component {...props()} />);
    await fireEvent.press(getByText('UX Feedback'));
    expect(openURL).toHaveBeenCalledWith('https://forms.example/x?id=1&platform=NATIVE');
    openURL.mockRestore();
  });
});
