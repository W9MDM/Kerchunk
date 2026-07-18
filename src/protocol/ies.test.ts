import { describe, expect, it } from 'vitest';
import {
  IE_TYPE_CALLING_NUMBER,
  IE_TYPE_FORMAT,
  decodeInformationElement,
  encodeInformationElement,
} from './ies.js';

describe('information elements', () => {
  it('round-trips text and numeric information elements', () => {
    const text = encodeInformationElement({ type: IE_TYPE_CALLING_NUMBER, value: 'alice' });
    const numeric = encodeInformationElement({ type: IE_TYPE_FORMAT, value: 4 });

    expect(decodeInformationElement(text)).toEqual({ type: IE_TYPE_CALLING_NUMBER, value: 'alice' });
    expect(decodeInformationElement(numeric)).toEqual({ type: IE_TYPE_FORMAT, value: 4 });
  });
});
