/**
 * ITU-T G.711 companding codecs (µ-law and A-law).
 *
 * These are the standard telephony implementations used by Asterisk and
 * AllStarLink, operating on 16-bit signed linear PCM. The byte values produced
 * here are wire-compatible with a real IAX2 peer, which the previous
 * float-based approximation was not.
 */

const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;
const ALAW_CLIP = 32635;

/** Encode a single 16-bit linear PCM sample to a µ-law byte. */
export function encodeUlaw(sample: number): number {
  const sign = (sample >> 8) & 0x80;
  let magnitude = sign !== 0 ? -sample : sample;
  if (magnitude > ULAW_CLIP) {
    magnitude = ULAW_CLIP;
  }
  magnitude += ULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; exponent -= 1, mask >>= 1) {
    // Locate the segment (exponent) by finding the highest set bit.
  }

  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Decode a µ-law byte back to a 16-bit linear PCM sample. */
export function decodeUlaw(code: number): number {
  const inverted = ~code & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  const magnitude = (((mantissa << 3) + ULAW_BIAS) << exponent) - ULAW_BIAS;
  return sign !== 0 ? -magnitude : magnitude;
}

/** Encode a single 16-bit linear PCM sample to an A-law byte. */
export function encodeAlaw(sample: number): number {
  let value = sample;
  if (value > ALAW_CLIP) {
    value = ALAW_CLIP;
  } else if (value < -ALAW_CLIP) {
    value = -ALAW_CLIP;
  }

  let magnitude = value >> 3;
  let mask: number;
  if (magnitude >= 0) {
    mask = 0xd5;
  } else {
    mask = 0x55;
    magnitude = -magnitude - 1;
  }

  const segmentEnds = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];
  let segment = 8;
  for (let index = 0; index < segmentEnds.length; index += 1) {
    if (magnitude <= segmentEnds[index]) {
      segment = index;
      break;
    }
  }

  if (segment >= 8) {
    return (0x7f ^ mask) & 0xff;
  }

  let aval = segment << 4;
  aval |= segment < 2 ? (magnitude >> 1) & 0x0f : (magnitude >> segment) & 0x0f;
  return (aval ^ mask) & 0xff;
}

/** Decode an A-law byte back to a 16-bit linear PCM sample. */
export function decodeAlaw(code: number): number {
  const value = (code ^ 0x55) & 0xff;
  let magnitude = (value & 0x0f) << 4;
  const segment = (value & 0x70) >> 4;
  if (segment === 0) {
    magnitude += 8;
  } else if (segment === 1) {
    magnitude += 0x108;
  } else {
    magnitude += 0x108;
    magnitude <<= segment - 1;
  }
  return (value & 0x80) !== 0 ? magnitude : -magnitude;
}
