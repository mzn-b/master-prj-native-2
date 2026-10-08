/* eslint-disable no-bitwise -- base64 is defined in terms of 6-bit groups;
   expressing the regrouping without shifts and masks would be slower and far
   less readable than the arithmetic it replaces. */
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const LOOKUP = new Uint8Array(256)
for (let i = 0; i < ALPHABET.length; i++) {
  LOOKUP[ALPHABET.charCodeAt(i)] = i
}

/**
 * Decodes base64 to raw bytes.
 *
 * Hand-written because Hermes ships no `atob` and no `Buffer`, and the crown's
 * GLB is embedded as base64 (see scripts/embed-assets.mjs). Runs once per
 * crown initialisation, not per frame.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  let length = base64.length
  // Padding does not contribute bytes.
  while (length > 0 && base64[length - 1] === '=') {
    length--
  }
  const byteLength = Math.floor((length * 3) / 4)
  const bytes = new Uint8Array(byteLength)

  let byte = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < length; i++) {
    acc = (acc << 6) | LOOKUP[base64.charCodeAt(i)]
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[byte++] = (acc >> bits) & 0xff
    }
  }
  return bytes.buffer
}
