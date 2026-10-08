import {base64ToArrayBuffer} from '../base64';

/**
 * Hermes has neither `atob` nor `Buffer`, so this decoder is the only path
 * from the embedded crown asset to the bytes GLTFLoader parses. A wrong byte
 * here is a corrupt model with no error message.
 */
const encode = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const decode = (b64: string) => Array.from(new Uint8Array(base64ToArrayBuffer(b64)));

describe('base64ToArrayBuffer', () => {
  it('round-trips every byte value', () => {
    const all = Array.from({length: 256}, (_, i) => i);
    expect(decode(encode(all))).toEqual(all);
  });

  it('handles each padding case', () => {
    // Lengths 3n, 3n+1, 3n+2 produce 0, 2 and 1 padding characters.
    for (const n of [3, 4, 5, 6, 7]) {
      const bytes = Array.from({length: n}, (_, i) => (i * 37) % 256);
      expect(decode(encode(bytes))).toEqual(bytes);
    }
  });

  it('decodes an empty string to no bytes', () => {
    expect(decode('')).toEqual([]);
  });

  it('preserves a GLB magic header', () => {
    // 'glTF' — if this is wrong, GLTFLoader rejects the model outright.
    const glb = [0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00];
    expect(decode(encode(glb))).toEqual(glb);
  });
});
