import {readFileSync} from 'fs';
import {join} from 'path';

/**
 * Skia has to register its worklets serializer before react-native-webgpu.
 *
 * Both register one when their module first evaluates, and the first one
 * registered wins. react-native-webgpu's claims any object with native state
 * and a Symbol.toStringTag, which includes every Skia object. Metro's inline
 * requires evaluate a module on first use, so a launch whose first filter was
 * the crown registered WebGPU's first. Skia's recorder then reached the UI
 * runtime without its methods and the next Skia filter canvas aborted the app
 * ("undefined is not a function" in shopify_ContainerNative). Reproduced on
 * both phones on 2026-10-29: crown run, Stop, glasses, Start. Glasses first
 * did not crash.
 *
 * Importing Skia at the entry point makes the order the same on every launch.
 */
describe('index.js', () => {
  const source = readFileSync(join(__dirname, '../../index.js'), 'utf8');

  it('loads Skia before the app can load react-native-webgpu', () => {
    const skia = source.indexOf("import '@shopify/react-native-skia';");
    const app = source.indexOf("from './App'");
    expect(skia).toBeGreaterThanOrEqual(0);
    expect(app).toBeGreaterThan(skia);
  });
});
