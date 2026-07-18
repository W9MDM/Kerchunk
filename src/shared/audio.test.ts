import { describe, expect, it } from 'vitest';
import { decodeG711Chunk, encodeG711Chunk } from './audio';

describe('audio codec helpers', () => {
  it('encodes and decodes PCM samples without losing the basic waveform shape', () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767, -32768]);

    const encoded = encodeG711Chunk(pcm);
    const decoded = decodeG711Chunk(encoded);

    expect(encoded.length).toBe(pcm.length);
    expect(decoded.length).toBe(pcm.length);
    expect(decoded[0]).toBe(0);
    expect(decoded[4]).toBeLessThanOrEqual(0);
  });
});
