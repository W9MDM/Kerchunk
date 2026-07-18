/**
 * Conference audio mixing for an app_rpt-style node bridge.
 *
 * A node is a conference: every connected peer and the local port (the operator's
 * mic) is a source. Each source must hear the sum of *every other* source but not
 * itself (otherwise it hears its own audio delayed back — "N-1 mixing"). This is
 * the core of what makes Kerchunk a node rather than a single call.
 *
 * Pure PCM in / PCM out — no codec dependency — so it is fully unit-testable.
 */

const SAMPLE_MIN = -32768;
const SAMPLE_MAX = 32767;

/** One 20 ms frame of 16-bit PCM from a named source (a peer leg or 'local'). */
export interface MixInput {
  id: string;
  /** Samples for this frame; a short/empty array is treated as trailing silence. */
  samples: Int16Array;
}

function clip(value: number): number {
  if (value > SAMPLE_MAX) return SAMPLE_MAX;
  if (value < SAMPLE_MIN) return SAMPLE_MIN;
  return value;
}

/**
 * N-1 conference mix. For each input `id`, returns the summed samples of every
 * *other* input (what that participant should hear), clipped to 16-bit.
 */
export function mixMinusOne(inputs: MixInput[], frameSize = 160): Map<string, Int16Array> {
  const output = new Map<string, Int16Array>();
  if (inputs.length === 0) {
    return output;
  }

  // Sum all inputs once in 32-bit headroom, then subtract each source for its mix.
  const total = new Int32Array(frameSize);
  for (const input of inputs) {
    const samples = input.samples;
    const count = Math.min(frameSize, samples.length);
    for (let i = 0; i < count; i += 1) {
      total[i] += samples[i];
    }
  }

  for (const input of inputs) {
    const samples = input.samples;
    const mix = new Int16Array(frameSize);
    for (let i = 0; i < frameSize; i += 1) {
      const own = i < samples.length ? samples[i] : 0;
      mix[i] = clip(total[i] - own);
    }
    output.set(input.id, mix);
  }

  return output;
}
