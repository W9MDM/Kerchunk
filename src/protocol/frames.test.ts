import { describe, expect, it } from 'vitest';
import {
  FRAME_TYPE_IAX,
  IAX_NEW,
  decodeFullFrame,
  decodeMiniFrame,
  encodeFullFrame,
  encodeMiniFrame,
  isFullFrame,
} from './frames.js';

describe('IAX2 frame wire format', () => {
  it('round-trips a full frame including the retransmit flag', () => {
    const frame = {
      sourceCall: 1234,
      destCall: 4321,
      retransmit: true,
      timestamp: 0x0a0b0c0d,
      oseqno: 7,
      iseqno: 9,
      frameType: FRAME_TYPE_IAX,
      subclass: IAX_NEW,
      payload: Buffer.from('hello'),
    };

    const decoded = decodeFullFrame(encodeFullFrame(frame));
    expect(decoded).toEqual(frame);
  });

  it('sets the F bit on full frames and clears it on mini frames', () => {
    const full = encodeFullFrame({
      sourceCall: 1,
      destCall: 2,
      retransmit: false,
      timestamp: 1,
      oseqno: 0,
      iseqno: 0,
      frameType: FRAME_TYPE_IAX,
      subclass: IAX_NEW,
      payload: Buffer.alloc(0),
    });
    const mini = encodeMiniFrame({ sourceCall: 1, timestamp: 1, payload: Buffer.alloc(160) });

    expect(isFullFrame(full)).toBe(true);
    expect(isFullFrame(mini)).toBe(false);
  });

  it('does not confuse a 160-byte voice mini frame for a full frame', () => {
    // A 20 ms G.711 frame is 160 payload bytes — comfortably larger than the
    // 12-byte full header, so length-based discrimination would misclassify it.
    const payload = Buffer.alloc(160, 0x7f);
    const mini = encodeMiniFrame({ sourceCall: 5, timestamp: 40, payload });

    expect(isFullFrame(mini)).toBe(false);
    const decoded = decodeMiniFrame(mini);
    expect(decoded.sourceCall).toBe(5);
    expect(decoded.timestamp).toBe(40);
    expect(decoded.payload).toEqual(payload);
  });

  it('masks the call-number flag bits out on decode', () => {
    const full = encodeFullFrame({
      sourceCall: 0x7fff,
      destCall: 0x7fff,
      retransmit: true,
      timestamp: 0,
      oseqno: 0,
      iseqno: 0,
      frameType: FRAME_TYPE_IAX,
      subclass: IAX_NEW,
      payload: Buffer.alloc(0),
    });
    const decoded = decodeFullFrame(full);
    expect(decoded.sourceCall).toBe(0x7fff);
    expect(decoded.destCall).toBe(0x7fff);
    expect(decoded.retransmit).toBe(true);
  });
});
