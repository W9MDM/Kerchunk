import { describe, expect, it } from 'vitest';
import { decodeAlaw, decodeUlaw, encodeAlaw, encodeUlaw } from './g711';

describe('G.711 codec helpers', () => {
  it('matches standard µ-law reference bytes', () => {
    // Silence encodes to 0xFF and decodes back to 0 (the canonical ITU-T values).
    expect(encodeUlaw(0)).toBe(0xff);
    expect(decodeUlaw(0xff)).toBe(0);
    // Full-scale positive input saturates to the maximum-magnitude positive code.
    expect(encodeUlaw(32767)).toBe(0x80);
    expect(decodeUlaw(0x80)).toBe(32124);
  });

  it('matches standard A-law reference bytes', () => {
    expect(encodeAlaw(0)).toBe(0xd5);
    expect(encodeAlaw(32767)).toBe(0xaa);
    expect(encodeAlaw(-32768)).toBe(0x2a);
  });

  it('round-trips µ-law within quantization error and preserves sign', () => {
    for (const sample of [-32768, -12000, -1000, -1, 0, 1, 1000, 12000, 32767]) {
      const decoded = decodeUlaw(encodeUlaw(sample));
      expect(Math.sign(decoded) === Math.sign(sample) || decoded === 0).toBe(true);
      // µ-law step near full scale is coarse; allow generous quantization headroom.
      expect(Math.abs(decoded - sample)).toBeLessThan(2000);
    }
  });

  it('round-trips A-law preserving sign for non-zero samples', () => {
    for (const sample of [-32000, -5000, -100, 100, 5000, 32000]) {
      const decoded = decodeAlaw(encodeAlaw(sample));
      expect(Math.sign(decoded)).toBe(Math.sign(sample));
    }
  });
});
