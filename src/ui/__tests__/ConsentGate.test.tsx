import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {ConsentGate} from '../ConsentGate';
import * as consentText from '../consentText';
import {
  CONSENT_ACCEPT,
  CONSENT_DECLINE,
  CONSENT_DECLINED_MESSAGE,
  CONSENT_SECTIONS,
  CONSENT_TITLE,
} from '../consentText';

/**
 * The consent gate is the one component whose failure has consequences outside
 * the repository: it stands between a participant and the camera. Same
 * properties as the PWA's tests, since participants must meet the same gate in
 * both apps: nothing starts without an explicit action, a refusal stores
 * nothing, and an unfinished notice cannot be accepted.
 */
describe('ConsentGate', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the whole notice before anything else happens', async () => {
    const onAccept = jest.fn();
    const {getByText} = await render(<ConsentGate onAccept={onAccept} />);
    expect(getByText(CONSENT_TITLE)).toBeTruthy();
    for (const section of CONSENT_SECTIONS) {
      expect(getByText(section.heading)).toBeTruthy();
    }
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('names the controller, which Art. 13 requires', async () => {
    const {getByText} = await render(<ConsentGate onAccept={() => {}} />);
    expect(getByText(/Verantwortlich für die Verarbeitung/)).toBeTruthy();
    expect(getByText(/Hochschule Campus Wien/)).toBeTruthy();
  });

  it('calls onAccept exactly once when consent is given', async () => {
    const onAccept = jest.fn();
    // Guarded: an incomplete notice has no button, and a silent no-op here
    // would look like a passing test.
    expect(consentText.consentIsIncomplete()).toBe(false);
    const {getByText} = await render(<ConsentGate onAccept={onAccept} />);
    await fireEvent.press(getByText(CONSENT_ACCEPT));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('declining replaces the notice and never calls onAccept', async () => {
    const onAccept = jest.fn();
    const {getByText, queryByText} = await render(<ConsentGate onAccept={onAccept} />);
    await fireEvent.press(getByText(CONSENT_DECLINE));
    expect(onAccept).not.toHaveBeenCalled();
    expect(queryByText(CONSENT_TITLE)).toBeNull();
    expect(getByText(CONSENT_DECLINED_MESSAGE)).toBeTruthy();
  });

  it('refuses to collect consent against an unfinished notice', async () => {
    jest.spyOn(consentText, 'consentIsIncomplete').mockReturnValue(true);
    const onAccept = jest.fn();
    const {getByTestId, queryByText} = await render(<ConsentGate onAccept={onAccept} />);
    expect(getByTestId('consent-incomplete')).toBeTruthy();
    expect(queryByText(CONSENT_ACCEPT)).toBeNull();
    expect(queryByText(CONSENT_DECLINE)).toBeNull();
  });
});
