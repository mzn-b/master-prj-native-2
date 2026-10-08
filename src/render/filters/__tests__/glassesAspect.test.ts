import fs from 'fs';
import path from 'path';

/**
 * The glasses image is stretched to whatever height the filter computes, so the
 * aspect it uses has to match the asset. It was hard-coded at 0.42 against a
 * 955x350 PNG (0.366), which drew the frames ~15% too tall on both platforms.
 *
 * The filter now reads the aspect off the decoded image at runtime; this guards
 * the fallback used before the image has loaded, which is the one value that can
 * still drift from the asset.
 */
function pngSize(file: string): {width: number; height: number} {
  const header = fs.readFileSync(file).subarray(0, 33);
  return {width: header.readUInt32BE(16), height: header.readUInt32BE(20)};
}

describe('glasses aspect', () => {
  const asset = path.join(__dirname, '../../../../assets/filters/sunglasses.png');
  const source = fs.readFileSync(
    path.join(__dirname, '../GlassesFilter.tsx'),
    'utf8',
  );

  it('takes its fallback straight from the asset dimensions', () => {
    const {width, height} = pngSize(asset);
    const match = source.match(/const FALLBACK_ASPECT = (\d+) \/ (\d+);/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(height);
    expect(Number(match![2])).toBe(width);
  });

  it('derives the live aspect from the image rather than a constant', () => {
    expect(source).toMatch(/image\.height\(\)\s*\/\s*image\.width\(\)/);
    // The old hard-coded value must not come back.
    expect(source).not.toMatch(/const ASPECT = 0\.42/);
  });
});
