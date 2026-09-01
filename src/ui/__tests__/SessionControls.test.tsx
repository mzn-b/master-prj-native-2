import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {SessionControls} from '../SessionControls';

describe('SessionControls (NF6)', () => {
  it('shows the stopped state when idle', async () => {
    const {getByText} = await render(
      <SessionControls isRunning={false} canStart onStart={jest.fn()} onStop={jest.fn()} />,
    );
    expect(getByText('Start')).toBeTruthy();
    expect(getByText('Tracking gestoppt')).toBeTruthy();
  });

  it('shows the running state while tracking', async () => {
    const {getByText} = await render(
      <SessionControls isRunning canStart onStart={jest.fn()} onStop={jest.fn()} />,
    );
    expect(getByText('Stop')).toBeTruthy();
    expect(getByText('Tracking aktiv')).toBeTruthy();
  });

  it('reports an unsupported device instead of offering to start', async () => {
    const onStart = jest.fn();
    const {getByText} = await render(
      <SessionControls isRunning={false} canStart={false} onStart={onStart} onStop={jest.fn()} />,
    );
    expect(getByText('Gerät nicht bereit')).toBeTruthy();
    fireEvent.press(getByText('Start'));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('surfaces the upload state', async () => {
    const {getByText} = await render(
      <SessionControls isRunning={false} canStart isUploading onStart={jest.fn()} onStop={jest.fn()} />,
    );
    expect(getByText('Sende Daten…')).toBeTruthy();
  });
});
