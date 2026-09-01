import {projectPoint, type ViewGeometry} from '../coordinates';

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
