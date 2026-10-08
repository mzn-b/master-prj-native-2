import fs from 'fs';
import path from 'path';
import {
  CONSENT_CONTROLLER,
  CONSENT_SECTIONS,
  consentIsIncomplete,
} from '../consentText';

const nativeText = path.join(__dirname, '../consentText.ts');
const pwaText = path.resolve(
  __dirname,
  '../../../../master-prj-pwa/src/ui/consentText.ts',
);

/**
 * Participants read this before either app starts, and the two apps are rated
 * against each other. If the texts diverge, the two groups consented to
 * different things and the comparison is no longer between platforms.
 */
describe('consent text', () => {
  it("is byte-identical to the PWA's copy, apart from the cross-reference", () => {
    if (!fs.existsSync(pwaText)) {
      return; // PWA repo not checked out
    }
    const normalise = (s: string) => s.replace(/master-prj-(pwa|native-2)/g, 'APP');
    expect(normalise(fs.readFileSync(nativeText, 'utf8'))).toBe(
      normalise(fs.readFileSync(pwaText, 'utf8')),
    );
  });

  it('names a controller, a purpose, a legal basis and a retention period', () => {
    const all = CONSENT_SECTIONS.map(s => s.body).join(' ');
    expect(all).toMatch(/Art\. 6 Abs\. 1 lit\. a DSGVO/);
    expect(all).toMatch(/freiwillig/i);
    expect(all).toMatch(/widerruf/i);
    expect(all).toMatch(/gelöscht/i);
    expect(all).toMatch(/Datenschutzbehörde/);
    expect(CONSENT_CONTROLLER.body).toMatch(/FH Campus Wien/);
  });

  it('states plainly that the camera image never leaves the device', () => {
    const all = CONSENT_SECTIONS.map(s => s.body).join(' ');
    expect(all).toMatch(/nicht aufgezeichnet/);
    expect(all).toMatch(/nicht gespeichert/);
    expect(all).toMatch(/verlässt das Gerät zu keinem Zeitpunkt/);
  });

  it('reports itself incomplete while the controller block has placeholders', () => {
    expect(consentIsIncomplete()).toBe(CONSENT_CONTROLLER.body.includes('TODO'));
  });
});
