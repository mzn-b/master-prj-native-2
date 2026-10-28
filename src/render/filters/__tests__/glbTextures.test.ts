import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as THREE from 'three/webgpu';
import {applyGlbTextures, decodeGlbTextures} from '../glbTextures';

/**
 * GLTFLoader cannot decode the images embedded in a .glb under React Native
 * (it wraps them in a Blob), so glbTextures.ts reads them out of the container
 * itself. A mistake here gives a crown without its gold, its gems or its
 * relief, with no error, so the decoding is pinned against the real asset.
 */
const CROWN = readFileSync(join(__dirname, '../../../../assets/filters/crown.glb'));
const crownBuffer = (): ArrayBuffer =>
  CROWN.buffer.slice(CROWN.byteOffset, CROWN.byteOffset + CROWN.byteLength) as ArrayBuffer;

/** Builds a minimal .glb: header, one JSON chunk, optionally one BIN chunk. */
function glb(json: object | null, bin?: Uint8Array): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  // glTF pads the JSON chunk with spaces and the BIN chunk with zeros.
  const chunk = (type: number, data: Uint8Array, pad: number) => {
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4).fill(pad);
    padded.set(data);
    const header = new DataView(new ArrayBuffer(8));
    header.setUint32(0, padded.length, true);
    header.setUint32(4, type, true);
    chunks.push(new Uint8Array(header.buffer), padded);
  };
  if (json) {
    chunk(0x4e4f534a, new TextEncoder().encode(JSON.stringify(json)), 0x20);
  }
  if (bin) {
    chunk(0x004e4942, bin, 0);
  }
  const length = 12 + chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  let at = 12;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

const createImageBitmap = jest.fn(async (bytes: Uint8Array) => ({
  width: 1024,
  height: 1024,
  bytes,
}));

beforeAll(() => {
  (globalThis as unknown as {createImageBitmap: unknown}).createImageBitmap = createImageBitmap;
});

beforeEach(() => createImageBitmap.mockClear());

describe('decodeGlbTextures', () => {
  it('decodes every image embedded in the crown, keyed by image index', async () => {
    const textures = await decodeGlbTextures(crownBuffer());
    expect([...textures.keys()]).toEqual([0, 1, 2]);
    expect(createImageBitmap).toHaveBeenCalledTimes(3);
    for (const texture of textures.values()) {
      expect(texture).toBeInstanceOf(THREE.Texture);
      expect(texture.flipY).toBe(false); // glTF convention
    }
  });

  it('hands createImageBitmap a standalone copy of each PNG, not a view into BIN', async () => {
    await decodeGlbTextures(crownBuffer());
    for (const [bytes] of createImageBitmap.mock.calls) {
      expect(bytes.byteOffset).toBe(0);
      expect(bytes.buffer.byteLength).toBe(bytes.length);
      // PNG signature
      expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it('skips images that are referenced by URI rather than embedded', async () => {
    const buffer = glb({images: [{uri: 'crown.png'}], bufferViews: []});
    const textures = await decodeGlbTextures(buffer);
    expect(textures.size).toBe(0);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects a buffer that is not a .glb container', async () => {
    const notGlb = new Uint8Array(16).buffer;
    await expect(decodeGlbTextures(notGlb)).rejects.toThrow('not a .glb container');
  });

  it('rejects a .glb without a JSON chunk', async () => {
    await expect(decodeGlbTextures(glb(null, new Uint8Array(4)))).rejects.toThrow(
      '.glb has no JSON chunk',
    );
  });
});

describe('applyGlbTextures', () => {
  const meshWith = (name: string) => {
    const material = new THREE.MeshStandardMaterial();
    material.name = name;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    const scene = new THREE.Group();
    scene.add(mesh);
    return {scene, material};
  };

  it('puts each crown texture into its glTF role', async () => {
    const buffer = crownBuffer();
    const textures = await decodeGlbTextures(buffer);
    const {scene, material} = meshWith('Crown');

    const applied = applyGlbTextures(buffer, scene, textures);

    expect(applied).toBe(3);
    // crown.glb: baseColor = image 0, metallicRoughness = image 1, normal = image 2.
    expect(material.map).toBe(textures.get(0));
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.roughnessMap).toBe(textures.get(1));
    expect(material.metalnessMap).toBe(textures.get(1));
    expect(material.normalMap).toBe(textures.get(2));
    // Data textures stay linear.
    expect(material.normalMap?.colorSpace).not.toBe(THREE.SRGBColorSpace);
  });

  it('falls back to the first material definition when the name does not match', async () => {
    const buffer = crownBuffer();
    const textures = await decodeGlbTextures(buffer);
    const {scene, material} = meshWith('renamed by the loader');
    expect(applyGlbTextures(buffer, scene, textures)).toBe(3);
    expect(material.map).toBe(textures.get(0));
  });

  it('leaves a slot empty when its image was not decoded', async () => {
    const buffer = crownBuffer();
    const textures = await decodeGlbTextures(buffer);
    textures.delete(2);
    const {scene, material} = meshWith('Crown');
    expect(applyGlbTextures(buffer, scene, textures)).toBe(2);
    expect(material.normalMap).toBeNull();
  });

  it('ignores objects that are not meshes', async () => {
    const buffer = crownBuffer();
    const textures = await decodeGlbTextures(buffer);
    const scene = new THREE.Group();
    scene.add(new THREE.Group());
    expect(applyGlbTextures(buffer, scene, textures)).toBe(0);
  });
});
