/**
 * Decodes the PNG/JPEG images embedded in a .glb and returns three Textures
 * keyed by glTF image index.
 *
 * Why this exists: three's GLTFLoader wraps each embedded image in a `Blob`
 * before decoding it. React Native cannot construct a Blob from an
 * ArrayBuffer ("Creating blobs from 'ArrayBuffer' ... are not supported"), so
 * every texture in a .glb fails to load. react-native-webgpu's
 * `createImageBitmap` polyfill accepts raw bytes directly, so we read the
 * image bufferViews out of the container ourselves and skip Blob entirely.
 */
import * as THREE from 'three/webgpu';

interface GlbChunks {
  json: any;
  bin: Uint8Array;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

function splitGlb(buffer: ArrayBuffer): GlbChunks {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('not a .glb container');
  }
  const total = view.getUint32(8, true);
  let json: any = null;
  let bin = new Uint8Array(0);
  let offset = 12;
  while (offset < total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    } else if (type === CHUNK_BIN) {
      bin = new Uint8Array(buffer, start, length);
    }
    offset = start + length;
  }
  if (!json) {
    throw new Error('.glb has no JSON chunk');
  }
  return {json, bin};
}

/** Decode every embedded image, returning a Texture per glTF image index. */
export async function decodeGlbTextures(
  buffer: ArrayBuffer,
): Promise<Map<number, THREE.Texture>> {
  const {json, bin} = splitGlb(buffer);
  const images: any[] = json.images ?? [];
  const bufferViews: any[] = json.bufferViews ?? [];
  const out = new Map<number, THREE.Texture>();

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    if (image.bufferView === undefined) {
      continue;
    }
    const bv = bufferViews[image.bufferView];
    const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    // Copy: createImageBitmap needs a standalone buffer, not a view into BIN.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const bitmap = await createImageBitmap(copy);
    const texture = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    texture.flipY = false; // glTF convention
    texture.needsUpdate = true;
    out.set(i, texture);
  }
  return out;
}

/**
 * Assign decoded textures onto the materials of a parsed glTF scene, following
 * the material definitions in the container's JSON.
 */
export function applyGlbTextures(
  buffer: ArrayBuffer,
  scene: THREE.Object3D,
  textures: Map<number, THREE.Texture>,
): number {
  const {json} = splitGlb(buffer);
  const gltfTextures: any[] = json.textures ?? [];
  const materials: any[] = json.materials ?? [];
  let applied = 0;

  const textureFor = (ref: any): THREE.Texture | undefined => {
    if (!ref || ref.index === undefined) {
      return undefined;
    }
    const source = gltfTextures[ref.index]?.source;
    return source === undefined ? undefined : textures.get(source);
  };

  scene.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      const std = material as THREE.MeshStandardMaterial;
      // Match by name: GLTFLoader preserves the glTF material name.
      const def = materials.find(m => m.name === std.name) ?? materials[0];
      if (!def) {
        continue;
      }
      const pbr = def.pbrMetallicRoughness ?? {};
      const base = textureFor(pbr.baseColorTexture);
      if (base) {
        base.colorSpace = THREE.SRGBColorSpace;
        std.map = base;
        applied++;
      }
      const mr = textureFor(pbr.metallicRoughnessTexture);
      if (mr) {
        std.roughnessMap = mr;
        std.metalnessMap = mr;
        applied++;
      }
      const normal = textureFor(def.normalTexture);
      if (normal) {
        std.normalMap = normal;
        applied++;
      }
      std.needsUpdate = true;
    }
  });
  return applied;
}
