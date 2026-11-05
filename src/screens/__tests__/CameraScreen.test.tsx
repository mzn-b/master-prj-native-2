import React from 'react';
import {render} from '@testing-library/react-native';
import {CameraScreen} from '../CameraScreen';
import * as VisionCamera from 'react-native-vision-camera';

jest.mock('../../render/filters/Crown3D', () => ({Crown3D: () => null}));
jest.mock('../../config/buildInfo', () => ({
  APP_VERSION: '0.0.1+test',
  BUILT_AT: '2026-10-28T00:00:00.000Z',
  SURVEY_BUILD: false,
}));
// A device warning, so the tests can see whether the build shows the list
// (audit3 CODE1-6: hidden in survey builds, shown in full builds).
jest.mock('../../tracking/deviceCapabilities', () => {
  const actual = jest.requireActual('../../tracking/deviceCapabilities');
  return {
    ...actual,
    checkDeviceCapabilities: (input: unknown) => ({
      ...actual.checkDeviceCapabilities(input),
      warnings: ['Wenig Arbeitsspeicher verfügbar (900 MB). Die Bildrate kann darunter leiden.'],
    }),
  };
});

describe('CameraScreen', () => {
  afterEach(() => {
    (VisionCamera.useCameraDevice as jest.Mock).mockReturnValue({id: 'front', position: 'front'});
    (VisionCamera.useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: true,
      requestPermission: jest.fn(),
    });
  });

  it('renders the idle state with controls', async () => {
    const {getByText} = await render(<CameraScreen />);
    expect(getByText('Start')).toBeTruthy();
    expect(getByText('Tracking gestoppt')).toBeTruthy();
  });

  it('shows the device warnings in the full build', async () => {
    const {getByText} = await render(<CameraScreen />);
    expect(getByText(/Wenig Arbeitsspeicher/)).toBeTruthy();
  });

  it('offers the mode selector before a session starts', async () => {
    const {getByText} = await render(<CameraScreen />);
    expect(getByText('combined')).toBeTruthy();
  });

  it('asks for camera permission when it has not been granted', async () => {
    (VisionCamera.useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: false,
      requestPermission: jest.fn(),
    });
    const {getAllByText} = await render(<CameraScreen />);
    // Both the preview placeholder and the capability error mention it.
    expect(getAllByText(/Kamerazugriff/).length).toBeGreaterThan(0);
  });

  it('blocks starting when no camera device is available (F10)', async () => {
    (VisionCamera.useCameraDevice as jest.Mock).mockReturnValue(undefined);
    const {getAllByText, getByText} = await render(<CameraScreen />);
    expect(getAllByText(/Keine Kamera gefunden/).length).toBeGreaterThan(0);
    expect(getByText('Gerät nicht bereit')).toBeTruthy();
  });
});
