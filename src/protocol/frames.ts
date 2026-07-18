/**
 * IAX2 wire-format encoding for full frames and mini frames.
 *
 * Full frame layout (RFC 5456 §8.1):
 *   byte 0-1 : [F=1 | 15-bit source call number]
 *   byte 2-3 : [R (retransmit) | 15-bit destination call number]
 *   byte 4-7 : 32-bit timestamp
 *   byte 8   : outbound sequence number
 *   byte 9   : inbound sequence number
 *   byte 10  : frame type
 *   byte 11  : [C | 7-bit subclass]
 *
 * Mini frame layout (§8.2):
 *   byte 0-1 : [F=0 | 15-bit source call number]
 *   byte 2-3 : 16-bit (truncated) timestamp
 *   byte 4+  : payload
 *
 * The high bit of byte 0 (the "F" bit) is what distinguishes a full frame from
 * a mini frame on the wire — never the packet length.
 */

export const FRAME_TYPE_DTMF = 0x01;
export const FRAME_TYPE_VOICE = 0x02;
export const FRAME_TYPE_VIDEO = 0x03;
export const FRAME_TYPE_CONTROL = 0x04;
export const FRAME_TYPE_NULL = 0x05;
export const FRAME_TYPE_IAX = 0x06;
export const FRAME_TYPE_TEXT = 0x07;
export const FRAME_TYPE_IMAGE = 0x08;
export const FRAME_TYPE_HTML = 0x09;
export const FRAME_TYPE_CNG = 0x0a;

// IAX control subclasses (used with FRAME_TYPE_IAX) that the engine handles.
export const IAX_NEW = 0x01;
export const IAX_PING = 0x02;
export const IAX_PONG = 0x03;
export const IAX_ACK = 0x04;
export const IAX_HANGUP = 0x05;
export const IAX_REJECT = 0x06;
export const IAX_ACCEPT = 0x07;
export const IAX_AUTHREQ = 0x08;
export const IAX_AUTHREP = 0x09;
export const IAX_INVAL = 0x0a;
export const IAX_LAGRQ = 0x0b;
export const IAX_LAGRP = 0x0c;
export const IAX_REGREQ = 0x0d;
export const IAX_REGAUTH = 0x0e;
export const IAX_REGACK = 0x0f;
export const IAX_REGREJ = 0x10;
export const IAX_REGREL = 0x11;
export const IAX_VNAK = 0x12;
export const IAX_CALLTOKEN = 0x28; // 40 — anti-spoofing call-token handshake

// Control-frame subclasses (used with FRAME_TYPE_CONTROL).
export const CONTROL_ANSWER = 0x04;
// Radio keying controls (Asterisk AST_CONTROL_RADIO_KEY/UNKEY) — how guest/
// Web Transceiver clients signal PTT to app_rpt.
export const CONTROL_RADIO_KEY = 0x0c; // 12
export const CONTROL_RADIO_UNKEY = 0x0d; // 13

// Legacy aliases kept so older call sites and tests keep compiling. These map to
// the IAX control subclasses that the engine actually sends.
export const FRAME_TYPE_NEW = IAX_NEW;
export const FRAME_TYPE_ACCEPT = IAX_ACCEPT;
export const FRAME_TYPE_ANSWER = CONTROL_ANSWER;
export const FRAME_TYPE_HANGUP = IAX_HANGUP;

const FULL_FRAME_HEADER_SIZE = 12;
const MINI_FRAME_HEADER_SIZE = 4;
const CALL_NUMBER_MASK = 0x7fff;
const FLAG_BIT = 0x8000;

export interface FullFrame {
  sourceCall: number;
  destCall: number;
  retransmit: boolean;
  timestamp: number;
  oseqno: number;
  iseqno: number;
  frameType: number;
  subclass: number;
  payload: Buffer;
}

export interface MiniFrame {
  sourceCall: number;
  timestamp: number;
  payload: Buffer;
}

function toBuffer(payload: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
}

/** True when the buffer is a full frame (F bit set) rather than a mini frame. */
export function isFullFrame(buf: Buffer): boolean {
  return buf.length >= FULL_FRAME_HEADER_SIZE && (buf.readUInt16BE(0) & FLAG_BIT) !== 0;
}

export function encodeFullFrame(frame: FullFrame): Buffer {
  const payload = toBuffer(frame.payload);
  const buf = Buffer.alloc(FULL_FRAME_HEADER_SIZE + payload.length);
  buf.writeUInt16BE((frame.sourceCall & CALL_NUMBER_MASK) | FLAG_BIT, 0);
  buf.writeUInt16BE((frame.destCall & CALL_NUMBER_MASK) | (frame.retransmit ? FLAG_BIT : 0), 2);
  buf.writeUInt32BE(frame.timestamp >>> 0, 4);
  buf.writeUInt8(frame.oseqno & 0xff, 8);
  buf.writeUInt8(frame.iseqno & 0xff, 9);
  buf.writeUInt8(frame.frameType & 0xff, 10);
  buf.writeUInt8(frame.subclass & 0xff, 11);
  payload.copy(buf, FULL_FRAME_HEADER_SIZE);
  return buf;
}

export function decodeFullFrame(buf: Buffer): FullFrame {
  return {
    sourceCall: buf.readUInt16BE(0) & CALL_NUMBER_MASK,
    destCall: buf.readUInt16BE(2) & CALL_NUMBER_MASK,
    retransmit: (buf.readUInt16BE(2) & FLAG_BIT) !== 0,
    timestamp: buf.readUInt32BE(4),
    oseqno: buf.readUInt8(8),
    iseqno: buf.readUInt8(9),
    frameType: buf.readUInt8(10),
    subclass: buf.readUInt8(11),
    payload: buf.subarray(FULL_FRAME_HEADER_SIZE),
  };
}

export function encodeMiniFrame(frame: MiniFrame): Buffer {
  const payload = toBuffer(frame.payload);
  const buf = Buffer.alloc(MINI_FRAME_HEADER_SIZE + payload.length);
  buf.writeUInt16BE(frame.sourceCall & CALL_NUMBER_MASK, 0);
  buf.writeUInt16BE(frame.timestamp & 0xffff, 2);
  payload.copy(buf, MINI_FRAME_HEADER_SIZE);
  return buf;
}

export function decodeMiniFrame(buf: Buffer): MiniFrame {
  return {
    sourceCall: buf.readUInt16BE(0) & CALL_NUMBER_MASK,
    timestamp: buf.readUInt16BE(2),
    payload: buf.subarray(MINI_FRAME_HEADER_SIZE),
  };
}
