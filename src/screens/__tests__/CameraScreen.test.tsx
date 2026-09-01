import React from 'react';
import {render} from '@testing-library/react-native';
import {CameraScreen} from '../CameraScreen';
import * as VisionCamera from 'react-native-vision-camera';

jest.mock('../../render/filters/Crown3D', () => ({Crown3D: () => null}));

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
