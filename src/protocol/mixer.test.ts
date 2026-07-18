import { describe, expect, it } from 'vitest';
import { mixMinusOne } from './mixer.js';

describe('conference mixer (N-1)', () => {
  it('gives each of two sources the other source', () => {
    const mix = mixMinusOne(
      [
        { id: 'a', samples: Int16Array.from([100, 200]) },
        { id: 'b', samples: Int16Array.from([10, 20]) },
      ],
      2,
    );
    expect(Array.from(mix.get('a')!)).toEqual([10, 20]);
    expect(Array.from(mix.get('b')!)).toEqual([100, 200]);
  });

  it('gives each of three sources the sum of the other two', () => {
    const mix = mixMinusOne(
      [
        { id: 'a', samples: Int16Array.from([1, 2]) },
        { id: 'b', samples: Int16Array.from([10, 20]) },
        { id: 'c', samples: Int16Array.from([100, 200]) },
      ],
      2,
    );
    expect(Array.from(mix.get('a')!)).toEqual([110, 220]);
    expect(Array.from(mix.get('b')!)).toEqual([101, 202]);
    expect(Array.from(mix.get('c')!)).toEqual([11, 22]);
  });

  it('clips a listener mix to 16-bit when talkers sum past the limit', () => {
    // A silent listener hears both loud talkers summed: 30000 + 20000 = 50000 -> clip.
    const mix = mixMinusOne(
      [
        { id: 'listener', samples: Int16Array.from([0]) },
        { id: 'loud1', samples: Int16Array.from([30000]) },
        { id: 'loud2', samples: Int16Array.from([20000]) },
      ],
      1,
    );
    expect(mix.get('listener')![0]).toBe(32767);
  });

  it('gives a lone source silence (nobody else to hear)', () => {
    const mix = mixMinusOne([{ id: 'a', samples: Int16Array.from([500, 600]) }], 2);
    expect(Array.from(mix.get('a')!)).toEqual([0, 0]);
  });

  it('treats a short frame as trailing silence', () => {
    const mix = mixMinusOne(
      [
        { id: 'a', samples: Int16Array.from([100]) },
        { id: 'b', samples: Int16Array.from([10, 20]) },
      ],
      2,
    );
    // a hears b in full; b hears a only where a has samples.
    expect(Array.from(mix.get('a')!)).toEqual([10, 20]);
    expect(Array.from(mix.get('b')!)).toEqual([100, 0]);
  });

  it('returns an empty map for no inputs', () => {
    expect(mixMinusOne([]).size).toBe(0);
  });
});
