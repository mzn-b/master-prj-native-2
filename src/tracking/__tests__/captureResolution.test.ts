import {CommonResolutions} from 'react-native-vision-camera';

// jest.setup.js replaces the whole VisionCamera module, so the resolution
// constants there are a hand-written copy. Read the real ones off disk and
// assert the copy still matches — otherwise the app could pin one resolution
// and the tests assert another.
const REAL_HD_16_9 = {width: 720, height: 1280};

describe('capture resolution (NF4)', () => {
  it('pins 720p, the resolution both apps are measured at', () => {
    expect(CommonResolutions.HD_16_9).toEqual(REAL_HD_16_9);
  });

  it('agrees with the value the installed VisionCamera actually ships', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../../node_modules/react-native-vision-camera/src/utils/CommonResolutions.ts',
      ),
      'utf8',
    );
    const match = source.match(/HD_16_9:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/);
    expect(match).not.toBeNull();
    expect({width: Number(match![1]), height: Number(match![2])}).toEqual(REAL_HD_16_9);
  });
});
