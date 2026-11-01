import React from 'react';
import {render, waitFor} from '@testing-library/react-native';
import * as THREE from 'three/webgpu';
import type {RawDetection} from 'tracking-native';
import {Crown3D, prewarmCrownModel} from '../Crown3D';
import type {ViewGeometry} from '../../coordinates';
import {FACE_STRIDE, VALUES_PER_POINT} from '../../../native/landmarkFormat';

/**
 * Everything about the crown except the GPU drawing itself: start-up on the
 * WebGPU surface, the renderer settings shared with the PWA, the scene the
 * crown sits in, its placement and pose on every frame, failure reporting and
 * the release of GPU resources. The WebGPU surface and three's renderer are
 * stand-ins; whether the pixels come out right is checked on the phones.
 */
const mockContext = {configure: jest.fn(), present: jest.fn(), unconfigure: jest.fn()};
function makeDevice() {
  const device = {
    label: 'device',
    destroyed: false,
    destroy: jest.fn(() => {
      device.destroyed = true;
    }),
  };
  return device;
}
/** What useDevice() hands the next crown; a test replaces it to mount another. */
let mockDevice = makeDevice();
let mockSurfaceSize = {width: 400, height: 800};
let mockHasContext = true;
jest.mock('react-native-webgpu', () => ({
  Canvas: () => null,
  useDevice: () => ({device: mockDevice}),
  useSurface: () => ({
    surface: {},
    ref: {
      current: {
        getNativeSurface: () => mockSurfaceSize,
        getContext: () => (mockHasContext ? mockContext : null),
      },
    },
  }),
}));

interface FakeRenderer {
  options: Record<string, unknown>;
  outputColorSpace?: string;
  toneMapping?: number;
  toneMappingExposure?: number;
  setSize: jest.Mock;
  render: jest.Mock;
  dispose: jest.Mock;
}
const mockRenderers: FakeRenderer[] = [];
jest.mock('three/webgpu', () => {
  const actual = jest.requireActual('three/webgpu');
  class WebGPURenderer {
    options: Record<string, unknown>;
    setSize = jest.fn();
    render = jest.fn();
    dispose = jest.fn();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      mockRenderers.push(this as unknown as FakeRenderer);
    }
    init() {
      return mockDevice.destroyed
        ? Promise.reject(new Error('device destroyed'))
        : Promise.resolve();
    }
  }
  return {...actual, WebGPURenderer};
});

const geometry: ViewGeometry = {
  frameWidth: 100,
  frameHeight: 100,
  viewWidth: 400,
  viewHeight: 400,
  rotation: 0,
  mirrorX: false,
  resizeMode: 'cover',
};

/** A face whose placement landmarks sit at known screen positions (x 4, y 4). */
function face(): RawDetection {
  const values = new Float32Array(FACE_STRIDE);
  const set = (index: number, x: number, y: number) => {
    values[index * VALUES_PER_POINT] = x;
    values[index * VALUES_PER_POINT + 1] = y;
  };
  set(234, 0.3, 0.5); // left temple  -> (120, 200)
  set(454, 0.7, 0.5); // right temple -> (280, 200)
  set(10, 0.5, 0.3); // forehead     -> (200, 120)
  set(152, 0.5, 0.8); // chin        -> (200, 320)
  set(33, 0.4, 0.45); // eye corners -> eye midpoint (200, 180)
  set(263, 0.6, 0.45);
  set(1, 0.5, 0.55); // nose tip    -> (200, 220), 40 px below the eyes
  return {
    timestampMs: 0,
    faceCount: 1,
    handCount: 0,
    landmarks: values.buffer,
    blendshapes: new ArrayBuffer(0),
    blendshapeNames: [],
    hands: [],
    inferenceTimeMs: 0,
  };
}

function crownParts(renderer: FakeRenderer) {
  const scene = renderer.render.mock.calls.at(-1)?.[0] as THREE.Scene;
  const camera = renderer.render.mock.calls.at(-1)?.[1] as THREE.OrthographicCamera;
  const screenSpace = scene.children.find(c => c.scale.y === -1) as THREE.Group;
  const clipping = screenSpace.children[0] as THREE.ClippingGroup;
  const pivot = clipping.children[0] as THREE.Group;
  return {scene, camera, screenSpace, clipping, pivot};
}

beforeAll(() => {
  // React Native defines `self` as the global object; three's loaders use it.
  (globalThis as unknown as {self: unknown}).self = globalThis;
  (globalThis as unknown as {navigator: object}).navigator = {
    ...(globalThis.navigator ?? {}),
    gpu: {getPreferredCanvasFormat: () => 'rgba8unorm'},
  };
  (globalThis as unknown as {createImageBitmap: unknown}).createImageBitmap = jest.fn(
    async () => ({width: 1024, height: 1024}),
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  mockRenderers.length = 0;
  mockContext.configure.mockClear();
  mockContext.present.mockClear();
  mockContext.unconfigure.mockClear();
  mockSurfaceSize = {width: 400, height: 800};
  mockHasContext = true;
  mockDevice = makeDevice();
});

async function mount(value: RawDetection | null, onError = jest.fn()) {
  const screen = await render(
    <Crown3D latest={{value} as never} geometry={geometry} onError={onError} />,
  );
  return {screen, onError};
}

describe('Crown3D', () => {
  it('starts up on the WebGPU surface with the PWA’s renderer settings', async () => {
    await mount(face());
    await waitFor(() => expect(mockRenderers[0]?.render).toHaveBeenCalled());
    const renderer = mockRenderers[0];

    expect(mockContext.configure).toHaveBeenCalledWith({
      device: mockDevice,
      format: 'rgba8unorm',
      alphaMode: 'premultiplied',
    });
    expect(renderer.options).toMatchObject({device: mockDevice, alpha: true, antialias: true});
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(2.2);
    expect(renderer.setSize).toHaveBeenCalledWith(400, 800, false);
    expect(mockContext.present).toHaveBeenCalled();
  });

  it('lights the crown like the PWA and keeps the y flip out of the projection', async () => {
    await mount(face());
    await waitFor(() => expect(mockRenderers[0]?.render).toHaveBeenCalled());
    const {scene, camera, screenSpace} = crownParts(mockRenderers[0]);

    const lights = scene.children.filter(c => (c as THREE.Light).isLight);
    expect(lights).toHaveLength(5);
    const handedness = (cam: THREE.Camera) => Math.sign(cam.projectionMatrix.determinant());
    expect(handedness(camera)).toBe(handedness(new THREE.OrthographicCamera()));
    screenSpace.updateMatrixWorld(true);
    expect(screenSpace.matrixWorld.determinant()).toBeLessThan(0);
  });

  it('places and poses the crown on the tracked face', async () => {
    await mount(face());
    await waitFor(() => expect(mockRenderers[0]?.render).toHaveBeenCalled());
    const {pivot} = crownParts(mockRenderers[0]);

    // 1.12 temple distances wide, lifted 0.15 of its width above the forehead.
    const width = 160 * 1.12;
    expect(pivot.visible).toBe(true);
    expect(pivot.scale.x).toBeCloseTo(width);
    expect(pivot.position.x).toBeCloseTo(200);
    expect(pivot.position.y).toBeCloseTo(120 - width * 0.15);
    // Level head, nose centred: no roll, no yaw; nose 0.2 of the face height
    // below the eyes against a neutral 0.38, so a pitch of 0.18 pi.
    expect(pivot.rotation.z).toBeCloseTo(0);
    expect(pivot.rotation.y).toBeCloseTo(0);
    expect(pivot.rotation.x).toBeCloseTo(0.18 * Math.PI);
  });

  it('hides the crown while no face is tracked', async () => {
    await mount(null);
    await waitFor(() => expect(mockRenderers[0]?.render).toHaveBeenCalled());
    expect(crownParts(mockRenderers[0]).pivot.visible).toBe(false);
  });

  it('reports a start-up failure instead of drawing nothing silently', async () => {
    mockHasContext = false;
    const {onError} = await mount(face());
    await waitFor(() => expect(onError).toHaveBeenCalledWith('no webgpu context'));
    expect(mockRenderers).toHaveLength(0);
  });

  it('releases the renderer and the model on unmount', async () => {
    const {screen} = await mount(face());
    await waitFor(() => expect(mockRenderers[0]?.render).toHaveBeenCalled());
    const renderer = mockRenderers[0];
    const {pivot} = crownParts(renderer);
    const meshes: THREE.Mesh[] = [];
    pivot.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        meshes.push(o as THREE.Mesh);
      }
    });
    const geometryDispose = jest.spyOn(meshes[0].geometry, 'dispose');
    const material = meshes[0].material as THREE.MeshStandardMaterial;
    const materialDispose = jest.spyOn(material, 'dispose');
    const mapDispose = material.map ? jest.spyOn(material.map, 'dispose') : undefined;

    await screen.unmount();

    expect(renderer.dispose).toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(mapDispose).toHaveBeenCalled();
  });

  it('destroys a crown’s GPU device when the next crown mounts, not on unmount', async () => {
    // useDevice() creates a new device for every mount and never destroys it,
    // and three leaves a device it was handed alone. Without destroying it
    // every crown run left a whole device behind: the Pixel 7 grew ~75 MB per
    // run over eight runs with no sign of levelling off (2026-11-01).
    // Destroying it on unmount crashed Android on every Stop: the canvas view
    // is detached after the cleanup, and Dawn's Vulkan backend tore down the
    // swapchain through the destroyed device. Unconfiguring the context first
    // did not prevent it.
    const {screen} = await mount(face());
    await waitFor(() => expect(mockRenderers[0]?.render).toHaveBeenCalled());
    const first = mockDevice;
    const renderer = mockRenderers[0];

    await screen.unmount();
    expect(renderer.dispose).toHaveBeenCalled();
    expect(mockContext.unconfigure).toHaveBeenCalled();
    expect(first.destroy).not.toHaveBeenCalled();

    mockDevice = makeDevice();
    const next = await mount(face());
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(mockDevice.destroy).not.toHaveBeenCalled();
    await next.screen.unmount();
  });

  it('retires the device only once a start-up in progress has settled, and reports nothing', async () => {
    // A device given up mid-start-up could still be configured onto the
    // surface by what is left of it. Its failure is the stop, not a filter
    // error to show the operator.
    let finishDecode: () => void = () => {};
    const decoding = new Promise<void>(resolve => {
      finishDecode = resolve;
    });
    const createImageBitmap = globalThis.createImageBitmap as unknown as jest.Mock;
    createImageBitmap.mockImplementation(async () => {
      await decoding;
      return {width: 1024, height: 1024};
    });
    const {screen, onError} = await mount(face());
    const first = mockDevice;
    await screen.unmount();
    expect(mockContext.unconfigure).not.toHaveBeenCalled();
    finishDecode();
    await waitFor(() => expect(mockContext.unconfigure).toHaveBeenCalled());
    createImageBitmap.mockImplementation(async () => ({width: 1024, height: 1024}));
    expect(first.destroy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(mockRenderers.every(renderer => renderer.render.mock.calls.length === 0)).toBe(true);

    mockDevice = makeDevice();
    const next = await mount(face());
    expect(first.destroy).toHaveBeenCalledTimes(1);
    await next.screen.unmount();
  });

  it('can warm the model at any time without side effects', () => {
    expect(() => {
      prewarmCrownModel();
      prewarmCrownModel();
    }).not.toThrow();
  });
});
