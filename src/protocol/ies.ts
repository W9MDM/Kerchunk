// IAX2 Information Element type assignments (RFC 5456 §8.6 / Asterisk iax2.h).
// These MUST match the spec exactly to interoperate with a real Asterisk peer.
export const IE_TYPE_CALLED_NUMBER = 0x01; // 1
export const IE_TYPE_CALLING_NUMBER = 0x02; // 2
export const IE_TYPE_CALLING_ANI = 0x03; // 3
export const IE_TYPE_CALLING_NAME = 0x04; // 4
export const IE_TYPE_CALLED_CONTEXT = 0x05; // 5
export const IE_TYPE_USERNAME = 0x06; // 6
export const IE_TYPE_PASSWORD = 0x07; // 7
export const IE_TYPE_CAPABILITY = 0x08; // 8
export const IE_TYPE_FORMAT = 0x09; // 9
export const IE_TYPE_LANGUAGE = 0x0a; // 10
export const IE_TYPE_VERSION = 0x0b; // 11
export const IE_TYPE_ADSICPE = 0x0c; // 12
export const IE_TYPE_DNID = 0x0d; // 13
export const IE_TYPE_AUTHMETHODS = 0x0e; // 14
export const IE_TYPE_CHALLENGE = 0x0f; // 15
export const IE_TYPE_MD5_RESULT = 0x10; // 16
export const IE_TYPE_RSA_RESULT = 0x11; // 17
export const IE_TYPE_APPARENT_ADDR = 0x12; // 18
export const IE_TYPE_REFRESH = 0x13; // 19
export const IE_TYPE_CAUSE = 0x16; // 22
export const IE_TYPE_DATETIME = 0x1f; // 31
export const IE_TYPE_CALLTOKEN = 0x36; // 54 — opaque anti-spoofing token

// Bit flags carried by the AUTHMETHODS IE (RFC 5456 §8.6.13).
export const AUTH_METHOD_PLAINTEXT = 0x01;
export const AUTH_METHOD_MD5 = 0x02;
export const AUTH_METHOD_RSA = 0x04;

// Numeric IEs have fixed on-wire widths; everything else is a UTF-8 string or an
// opaque buffer. Absent from this table => single byte for a numeric value.
const IE_NUMERIC_WIDTHS: Record<number, number> = {
  [IE_TYPE_CAPABILITY]: 4,
  [IE_TYPE_FORMAT]: 4,
  [IE_TYPE_VERSION]: 2,
  [IE_TYPE_REFRESH]: 2,
  [IE_TYPE_AUTHMETHODS]: 2,
};

export interface InformationElement {
  type: number;
  value: string | number | Buffer;
}

export function encodeInformationElement(ie: InformationElement): Buffer {
  let value: Buffer;
  if (typeof ie.value === 'string') {
    value = Buffer.from(ie.value, 'utf8');
  } else if (Buffer.isBuffer(ie.value)) {
    value = ie.value;
  } else {
    const width = IE_NUMERIC_WIDTHS[ie.type] ?? 1;
    value = Buffer.alloc(width);
    value.writeUIntBE(ie.value, 0, width);
  }
  const buf = Buffer.alloc(2 + value.length);
  buf.writeUInt8(ie.type, 0);
  buf.writeUInt8(value.length, 1);
  value.copy(buf, 2);
  return buf;
}

export function decodeInformationElement(buf: Buffer): InformationElement {
  const type = buf.readUInt8(0);
  const length = buf.readUInt8(1);
  const value = buf.subarray(2, 2 + length);

  // The call token is opaque binary; preserve raw bytes so we can echo it back.
  if (type === IE_TYPE_CALLTOKEN) {
    return { type, value: Buffer.from(value) };
  }

  const width = IE_NUMERIC_WIDTHS[type];
  if (width !== undefined) {
    const readable = Math.min(width, value.length);
    return { type, value: readable === 0 ? 0 : value.readUIntBE(0, readable) };
  }

  return { type, value: value.toString('utf8') };
}

/** Encode a list of information elements into a single contiguous buffer. */
export function encodeInformationElements(ies: InformationElement[]): Buffer {
  return Buffer.concat(ies.map(encodeInformationElement));
}

/** Decode a buffer containing zero or more concatenated information elements. */
export function decodeInformationElements(buf: Buffer): InformationElement[] {
  const elements: InformationElement[] = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const length = buf.readUInt8(offset + 1);
    const end = offset + 2 + length;
    if (end > buf.length) {
      break;
    }
    elements.push(decodeInformationElement(buf.subarray(offset, end)));
    offset = end;
  }
  return elements;
}

/** Look up the first information element of a given type, if present. */
export function findInformationElement(
  ies: InformationElement[],
  type: number,
): InformationElement | undefined {
  return ies.find((ie) => ie.type === type);
}
