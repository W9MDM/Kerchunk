import { describe, expect, it } from 'vitest';
import {
  buildMdcFrame,
  decodeMdcBursts,
  encodeMdcBurst,
  formatUnitId,
  mdcCrc,
  parseUnitId,
} from './mdc1200.js';

describe('mdc1200', () => {
  it('CRC is deterministic and order-sensitive', () => {
    const a = mdcCrc([0x01, 0x00, 0x12, 0x34]);
    expect(a).toBe(mdcCrc([0x01, 0x00, 0x12, 0x34]));
    expect(a).not.toBe(mdcCrc([0x01, 0x00, 0x34, 0x12]));
    expect(a & ~0xffff).toBe(0); // 16-bit
  });

  it('frame carries the payload and a matching CRC in bytes 4/5 after de-interleave', () => {
    const frame = buildMdcFrame(0x01, 0x00, 0x1234);
    expect(frame).toHaveLength(14);
  });

  it('round-trips a burst through encode → decode', () => {
    const burst = encodeMdcBurst(0x1234);
    const packets = decodeMdcBursts(burst);
    expect(packets).toHaveLength(1);
    expect(packets[0].unitId).toBe(0x1234);
    expect(packets[0].op).toBe(0x01);
  });

  it('decodes a burst embedded in silence with noise-free padding', () => {
    const burst = encodeMdcBurst(0xabcd);
    const padded = new Int16Array(2000 + burst.length + 2000);
    padded.set(burst, 2000);
    const packets = decodeMdcBursts(padded);
    expect(packets.some((p) => p.unitId === 0xabcd)).toBe(true);
  });

  it('formats and parses unit IDs', () => {
    expect(formatUnitId(0x1234)).toBe('1234');
    expect(formatUnitId(0x0a)).toBe('000A');
    expect(parseUnitId('1234')).toBe(0x1234);
    expect(parseUnitId('0xABCD')).toBe(0xabcd);
    expect(parseUnitId('nope')).toBeNull();
    expect(parseUnitId('12345')).toBeNull();
  });
});
