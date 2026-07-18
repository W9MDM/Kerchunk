import { decodeUlaw, encodeUlaw } from './g711';

export function encodeG711Chunk(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    bytes[index] = encodeUlaw(samples[index]);
  }
  return bytes;
}

export function decodeG711Chunk(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    samples[index] = decodeUlaw(bytes[index]);
  }
  return samples;
}
