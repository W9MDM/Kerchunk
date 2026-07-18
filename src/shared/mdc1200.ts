/**
 * MDC1200 burst encoder/decoder — a clean-room, MIT-licensed implementation of
 * Motorola's MDC1200 signaling, written from the documented wire format:
 *
 *   - Payload: op, arg, unitID(hi), unitID(lo)  (4 bytes)
 *   - CRC-16 poly 0x1021, reflected in/out, final XOR 0xffff, over the 4 bytes
 *   - 7-stage convolutional FEC (feedback taps 0,2,5,6) → 7 parity bytes
 *   - bit interleave with a stride of 16 across the 14 bytes (112 bits)
 *   - leader: 0x55 × 7 (clock) + sync 0x07 0x09 0x2a 0x44 0x6f
 *   - modulation: 1200 baud differential MSK, 1200 Hz (no change) / 1800 Hz
 *     (change), continuous phase, bits sent MSB-first.
 *
 * NOT derived from any GPL source — implemented independently from the protocol
 * description. Interoperates with itself (round-trip tested); verify against a
 * real Motorola radio before relying on off-air interop.
 */

/** Common MDC1200 opcode/arg for a PTT ID (unit identifies itself). */
export const MDC_OP_PTT_ID = 0x01;
export const MDC_ARG_PTT_ID = 0x00;

const CIRCLE = 2 ** 32; // 32-bit phase accumulator range
const BAUD = 1200;
const FREQ_SAME = 1200; // bit == previous bit
const FREQ_DIFF = 1800; // bit != previous bit
const LEADER = [0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x07, 0x09, 0x2a, 0x44, 0x6f];
const SYNC = [0x07, 0x09, 0x2a, 0x44, 0x6f];

function reverseBits(value: number, bits: number): number {
  let out = 0;
  for (let i = 0; i < bits; i += 1) out = (out << 1) | ((value >> i) & 1);
  return out >>> 0;
}

/** MDC1200 CRC: CRC-16/1021, input bytes reflected, output reflected then inverted. */
export function mdcCrc(bytes: number[]): number {
  let crc = 0;
  for (const raw of bytes) {
    const c = reverseBits(raw & 0xff, 8);
    for (let j = 0x80; j; j >>= 1) {
      let bit = crc & 0x8000;
      crc = (crc << 1) & 0xffff;
      if (c & j) bit ^= 0x8000;
      if (bit) crc ^= 0x1021;
    }
  }
  return (reverseBits(crc & 0xffff, 16) ^ 0xffff) & 0xffff;
}

/** Per-source-bit → transmitted-position map for the stride-16 interleaver. */
function interleaveMap(): number[] {
  const map = new Array(112).fill(0);
  let k = 0;
  let m = 0;
  for (let source = 0; source < 112; source += 1) {
    map[source] = k;
    k += 16;
    if (k > 111) k = (m += 1);
  }
  return map;
}
const INTERLEAVE = interleaveMap();

/** Build the 14 transmitted bytes (FEC + interleave) for a packet. */
export function buildMdcFrame(op: number, arg: number, unitId: number): number[] {
  const data = new Array(14).fill(0);
  data[0] = op & 0xff;
  data[1] = arg & 0xff;
  data[2] = (unitId >> 8) & 0xff;
  data[3] = unitId & 0xff;
  const crc = mdcCrc(data.slice(0, 4));
  data[4] = crc & 0xff;
  data[5] = (crc >> 8) & 0xff;
  data[6] = 0;

  // 7-stage convolutional encoder, taps at 0,2,5,6, over bytes 0..6 → 7..13.
  const csr = new Array(7).fill(0);
  for (let i = 0; i < 7; i += 1) {
    data[i + 7] = 0;
    for (let j = 0; j <= 7; j += 1) {
      for (let s = 6; s > 0; s -= 1) csr[s] = csr[s - 1];
      csr[0] = (data[i] >> j) & 1;
      const b = csr[0] + csr[2] + csr[5] + csr[6];
      data[i + 7] |= (b & 1) << j;
    }
  }

  // Interleave the 112 source bits (LSB-first within each byte) by stride 16,
  // then repack MSB-first so modulation transmits them in interleaved order.
  const src: number[] = [];
  for (let i = 0; i < 14; i += 1) for (let j = 0; j <= 7; j += 1) src.push((data[i] >> j) & 1);
  const tx = new Array(112).fill(0);
  for (let source = 0; source < 112; source += 1) tx[INTERLEAVE[source]] = src[source];
  const out = new Array(14).fill(0);
  for (let i = 0; i < 14; i += 1) for (let b = 0; b <= 7; b += 1) out[i] |= tx[i * 8 + b] << (7 - b);
  return out;
}

/**
 * Encode an MDC1200 burst to PCM (Int16) at the given sample rate.
 *
 * `amplitude` is kept below voice level so the burst isn't "hot" into a
 * repeater. `tailMs` appends trailing silence; the caller adds a tail only for
 * an end-of-transmission ID (never between a key-up ID and the following voice).
 */
export function encodeMdcBurst(
  unitId: number,
  op: number = MDC_OP_PTT_ID,
  arg: number = MDC_ARG_PTT_ID,
  sampleRate = 8000,
  amplitude = 0.18,
  tailMs = 0,
): Int16Array {
  const bytes = LEADER.concat(buildMdcFrame(op, arg, unitId));
  const incrSame = Math.round((FREQ_SAME / sampleRate) * CIRCLE);
  const incrDiff = Math.round((FREQ_DIFF / sampleRate) * CIRCLE);
  const samplesPerBit = sampleRate / BAUD;
  const out: number[] = [];
  let phase = 0;
  let lastBit = 0;
  let emitted = 0;
  let boundary = 0; // absolute cumulative sample target, so the baud stays exact
  for (const byte of bytes) {
    for (let ipos = 0; ipos < 8; ipos += 1) {
      const bit = (byte >> (7 - ipos)) & 1;
      const incr = bit !== lastBit ? incrDiff : incrSame;
      lastBit = bit;
      boundary += samplesPerBit;
      while (emitted < boundary) {
        phase = (phase + incr) % CIRCLE;
        out.push(Math.round(Math.sin((phase / CIRCLE) * 2 * Math.PI) * amplitude * 32767));
        emitted += 1;
      }
    }
  }
  const tail = Math.max(0, Math.round((tailMs / 1000) * sampleRate));
  for (let i = 0; i < tail; i += 1) out.push(0);
  return Int16Array.from(out);
}

export interface MdcPacket {
  op: number;
  arg: number;
  unitId: number;
}

/**
 * FFSK discriminator: mix the signal to baseband around the 1500 Hz center,
 * smooth, and take the per-sample phase advance. Positive advance ⇒ 1800 Hz
 * (a bit change), negative ⇒ 1200 Hz (no change). Returns the discriminator
 * signal, integrated per bit by the caller.
 */
function discriminator(samples: Float32Array, sampleRate: number): Float32Array {
  const n = samples.length;
  const center = (FREQ_SAME + FREQ_DIFF) / 2; // 1500 Hz
  const iq = new Float32Array(n * 2);
  for (let k = 0; k < n; k += 1) {
    const ph = (2 * Math.PI * center * k) / sampleRate;
    iq[k * 2] = samples[k] * Math.cos(ph);
    iq[k * 2 + 1] = -samples[k] * Math.sin(ph);
  }
  // 3-tap moving-average low-pass on I and Q to reject the sum-frequency image.
  const si = new Float32Array(n);
  const sq = new Float32Array(n);
  for (let k = 0; k < n; k += 1) {
    let ri = 0;
    let rq = 0;
    for (let t = -2; t <= 2; t += 1) {
      const j = k + t;
      if (j >= 0 && j < n) {
        ri += iq[j * 2];
        rq += iq[j * 2 + 1];
      }
    }
    si[k] = ri;
    sq[k] = rq;
  }
  const d = new Float32Array(n);
  for (let k = 1; k < n; k += 1) {
    // Imag / Real of z[k]·conj(z[k-1]) → phase advance between samples.
    const cross = sq[k] * si[k - 1] - si[k] * sq[k - 1];
    const dot = si[k] * si[k - 1] + sq[k] * sq[k - 1];
    d[k] = Math.atan2(cross, dot);
  }
  return d;
}

/** Demodulate to a bit stream at a given start offset and symbol period. */
function demodulate(disc: Float32Array, sampleRate: number, offset: number, samplesPerBit: number): number[] {
  const bits: number[] = [];
  let lastBit = 0;
  const nbits = Math.floor((disc.length - offset) / samplesPerBit);
  for (let k = 0; k < nbits; k += 1) {
    const start = Math.round(offset + k * samplesPerBit);
    const end = Math.round(offset + (k + 1) * samplesPerBit);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += disc[i];
    const bit = sum > 0 ? lastBit ^ 1 : lastBit; // 1800 Hz (positive) = change
    bits.push(bit);
    lastBit = bit;
  }
  return bits;
}

function bitsToByte(bits: number[], at: number): number {
  let v = 0;
  for (let b = 0; b < 8; b += 1) v = (v << 1) | (bits[at + b] ?? 0);
  return v;
}

/** Hamming distance between the bit stream at `at` and a target byte sequence. */
function syncErrors(bits: number[], at: number, target: number[]): number {
  let errors = 0;
  for (let i = 0; i < target.length; i += 1) {
    const got = bitsToByte(bits, at + i * 8);
    let x = got ^ target[i];
    while (x) {
      errors += x & 1;
      x >>= 1;
    }
  }
  return errors;
}

/** Recover a packet from 112 transmitted bits starting at `at` (post-sync). */
function decodeFrame(bits: number[], at: number): MdcPacket | null {
  if (at + 112 > bits.length) return null;
  const tx = bits.slice(at, at + 112);
  const src = new Array(112).fill(0);
  for (let source = 0; source < 112; source += 1) src[source] = tx[INTERLEAVE[source]];
  const data = new Array(14).fill(0);
  for (let i = 0; i < 14; i += 1) for (let j = 0; j <= 7; j += 1) data[i] |= src[i * 8 + j] << j;
  const expected = mdcCrc(data.slice(0, 4));
  const got = data[4] | (data[5] << 8);
  if (expected !== got) return null;
  return { op: data[0], arg: data[1], unitId: (data[2] << 8) | data[3] };
}

/**
 * Scan a block of audio for MDC1200 bursts. Brute-forces the sub-bit start
 * offset and validates via CRC, so only correctly-decoded packets are returned.
 */
export function decodeMdcBursts(input: Int16Array | Float32Array, sampleRate = 8000): MdcPacket[] {
  const samples =
    input instanceof Float32Array
      ? input
      : Float32Array.from(input, (v) => v / 32768);
  const nominal = sampleRate / BAUD;
  const disc = discriminator(samples, sampleRate);
  const found: MdcPacket[] = [];
  const seen = new Set<string>();
  // Brute-force symbol timing (offset + period) — every hit is CRC-validated, so
  // false locks can't slip through. Tolerates small clock error in real signals.
  for (let spb = nominal - 0.2; spb <= nominal + 0.2 && found.length === 0; spb += 0.1) {
    for (let o = 0; o < nominal; o += 1) {
      const bits = demodulate(disc, sampleRate, o, spb);
      for (let i = 0; i + 40 + 112 <= bits.length; i += 1) {
        if (syncErrors(bits, i, SYNC) <= 3) {
          const packet = decodeFrame(bits, i + 40);
          if (packet) {
            const key = `${packet.op}:${packet.arg}:${packet.unitId}`;
            if (!seen.has(key)) {
              seen.add(key);
              found.push(packet);
            }
          }
        }
      }
      if (found.length > 0) break;
    }
  }
  return found;
}

/** Format a unit ID as the conventional 4-digit uppercase hex. */
export function formatUnitId(unitId: number): string {
  return unitId.toString(16).toUpperCase().padStart(4, '0');
}

/** Parse a user-entered unit ID ("1234" hex) to a number, or null if invalid. */
export function parseUnitId(text: string): number | null {
  const trimmed = text.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,4}$/i.test(trimmed)) return null;
  const value = parseInt(trimmed, 16);
  return value >= 0 && value <= 0xffff ? value : null;
}
