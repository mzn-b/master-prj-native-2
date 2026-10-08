import {projectNormalized, projectPoint, type ViewGeometry} from '../coordinates';

const base: ViewGeometry = {
  frameWidth: 100,
  frameHeight: 100,
  viewWidth: 200,
  viewHeight: 200,
  rotation: 0,
  mirrorX: false,
  resizeMode: 'cover',
};

describe('projectPoint', () => {
  it('maps a centre point to the view centre', () => {
    expect(projectPoint({x: 0.5, y: 0.5}, base)).toEqual({x: 100, y: 100});
  });

  it('maps the normalized origin to the view origin when unrotated', () => {
    expect(projectPoint({x: 0, y: 0}, base)).toEqual({x: 0, y: 0});
  });

  it('mirrors x when mirrorX is set', () => {
    expect(projectPoint({x: 0, y: 0}, {...base, mirrorX: true})).toEqual({x: 200, y: 0});
  });

  it('rotates 90 degrees: (0,0) becomes the top-right corner', () => {
    expect(projectPoint({x: 0, y: 0}, {...base, rotation: 90})).toEqual({x: 200, y: 0});
  });

  it('rotates 180 degrees: (0,0) becomes the bottom-right corner', () => {
    expect(projectPoint({x: 0, y: 0}, {...base, rotation: 180})).toEqual({x: 200, y: 200});
  });

  it('rotates 270 degrees: (0,0) becomes the bottom-left corner', () => {
    expect(projectPoint({x: 0, y: 0}, {...base, rotation: 270})).toEqual({x: 0, y: 200});
  });

  it('composes rotation and mirroring in the documented order', () => {
    // rotate 90 -> (1,0); then mirror x -> (0,0) -> view origin
    expect(projectPoint({x: 0, y: 0}, {...base, rotation: 90, mirrorX: true})).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('letterboxes with contain when aspect ratios differ', () => {
    const g: ViewGeometry = {...base, frameWidth: 100, frameHeight: 200, resizeMode: 'contain'};
    // frame 1:2 into a 1:1 view -> scale 1.0, drawn 100x200, x offset 50
    expect(projectPoint({x: 0, y: 0}, g)).toEqual({x: 50, y: 0});
    expect(projectPoint({x: 1, y: 1}, g)).toEqual({x: 150, y: 200});
  });

  it('crops with cover when aspect ratios differ', () => {
    const g: ViewGeometry = {...base, frameWidth: 100, frameHeight: 200, resizeMode: 'cover'};
    // scale 2.0 -> drawn 200x400, y offset -100
    expect(projectPoint({x: 0, y: 0}, g)).toEqual({x: 0, y: -100});
    expect(projectPoint({x: 0.5, y: 0.5}, g)).toEqual({x: 100, y: 100});
  });

  it('swaps frame dimensions for 90/270 rotation when fitting', () => {
    const g: ViewGeometry = {...base, frameWidth: 100, frameHeight: 200, rotation: 90, resizeMode: 'contain'};
    // rotated frame is 200x100 (2:1) into a 200x200 view -> scale 1.0, y offset 50
    expect(projectPoint({x: 0, y: 0}, g)).toEqual({x: 200, y: 50});
  });

  it('keeps the centre at the view centre under every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(projectPoint({x: 0.5, y: 0.5}, {...base, rotation})).toEqual({x: 100, y: 100});
    }
  });
});

// The analysis stream and the preview stream are separate camera outputs whose
// aspect ratios routinely differ (VisionCamera negotiates the preview "ignoring
// aspect ratio"). Landmarks are normalized to the analysis frame, so they have
// to be re-normalized into the preview's field of view or every overlay renders
// uniformly too large — the Android scaling bug.
describe('preview field of view', () => {
  const previewBase = {
    viewWidth: 411,
    viewHeight: 614,
    rotation: 270 as const,
    mirrorX: true,
    resizeMode: 'cover' as const,
  };

  it('is a no-op when no preview size is known', () => {
    const withPreview = {...previewBase, frameWidth: 1280, frameHeight: 720};
    const centre = projectNormalized(0.5, 0.5, withPreview);
    expect(centre.x).toBeCloseTo(previewBase.viewWidth / 2, 6);
    expect(centre.y).toBeCloseTo(previewBase.viewHeight / 2, 6);
  });

  it('is a no-op when both streams share an aspect ratio', () => {
    const same = {
      ...previewBase,
      frameWidth: 1280,
      frameHeight: 720,
      previewWidth: 1920,
      previewHeight: 1080,
    };
    const only = {...previewBase, frameWidth: 1280, frameHeight: 720};
    for (const [x, y] of [[0.2, 0.3], [0.5, 0.5], [0.9, 0.1]]) {
      const a = projectNormalized(x, y, same);
      const b = projectNormalized(x, y, only);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
  });

  it('keeps the centre fixed regardless of the mismatch', () => {
    const g = {
      ...previewBase,
      frameWidth: 1280,
      frameHeight: 720,
      previewWidth: 1440,
      previewHeight: 1080,
    };
    const centre = projectNormalized(0.5, 0.5, g);
    expect(centre.x).toBeCloseTo(previewBase.viewWidth / 2, 6);
    expect(centre.y).toBeCloseTo(previewBase.viewHeight / 2, 6);
  });

  it('shrinks a wider frame onto a 4:3 preview, the Android case', () => {
    // 16:9 analysis (1.778) inside a 4:3 preview (1.333): the frame is the wider
    // one, so it is a vertical centre-crop and only y is rescaled.
    const g = {
      ...previewBase,
      frameWidth: 1280,
      frameHeight: 720,
      previewWidth: 1440,
      previewHeight: 1080,
    };
    const plain = {...previewBase, frameWidth: 1280, frameHeight: 720};

    // A point away from the centre must land closer to the centre than the
    // uncorrected projection put it — that is the oversize being removed.
    const corrected = projectNormalized(0.5, 0.9, g);
    const uncorrected = projectNormalized(0.5, 0.9, plain);
    const centre = previewBase.viewWidth / 2;
    expect(Math.abs(corrected.x - centre)).toBeLessThan(
      Math.abs(uncorrected.x - centre),
    );
  });

  it('rescales only the axis the streams disagree on', () => {
    // 4:3 frame (1.333) inside a 16:9 preview (1.778): the frame is narrower,
    // so it is a horizontal crop and y passes through untouched.
    const g = {
      ...previewBase,
      rotation: 0 as const,
      mirrorX: false,
      frameWidth: 1440,
      frameHeight: 1080,
      previewWidth: 1280,
      previewHeight: 720,
    };
    const plain = {
      ...previewBase,
      rotation: 0 as const,
      mirrorX: false,
      frameWidth: 1280,
      frameHeight: 720,
    };
    // y is the shared axis here, so it must match the plain projection exactly.
    expect(projectNormalized(0.5, 0.8, g).y).toBeCloseTo(
      projectNormalized(0.5, 0.8, plain).y,
      6,
    );
  });
});
