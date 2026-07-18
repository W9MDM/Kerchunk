/**
 * Pure audio framing helpers shared between the capture AudioWorklet and the
 * renderer. Kept free of any Web Audio / DOM types so the framing logic can be
 * unit tested in plain Node.
 */

export const SAMPLE_RATE = 8000;
export const FRAME_DURATION_MS = 20;
/** 8 kHz × 20 ms = 160 samples per frame. */
export const FRAME_SIZE = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000;

/**
 * Accumulates arbitrary-length sample chunks (the AudioWorklet delivers 128 at a
 * time) and emits fixed-size frames as soon as enough samples are buffered.
 */
export class FrameAccumulator {
  private readonly buffer: Float32Array;
  private filled = 0;

  constructor(private readonly frameSize: number = FRAME_SIZE) {
    this.buffer = new Float32Array(frameSize);
  }

  /** Push a chunk and return any complete frames it produced. */
  push(chunk: Float32Array): Float32Array[] {
    const frames: Float32Array[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(this.frameSize - this.filled, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSize) {
        frames.push(this.buffer.slice(0, this.frameSize));
        this.filled = 0;
      }
    }
    return frames;
  }
}

/** Convert a [-1, 1] float frame to 16-bit signed PCM. */
export function floatFrameToPcm16(frame: Float32Array): Int16Array {
  const pcm = new Int16Array(frame.length);
  for (let index = 0; index < frame.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, frame[index]));
    pcm[index] = Math.round(clamped * 32767);
  }
  return pcm;
}

/** Peak absolute amplitude of a float frame, scaled to a 0-100 meter value. */
export function frameLevel(frame: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const magnitude = Math.abs(frame[index]);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  return Math.min(100, Math.round(peak * 100));
}
