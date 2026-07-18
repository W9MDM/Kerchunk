import { describe, expect, it } from 'vitest';
import { FRAME_SIZE, FrameAccumulator, floatFrameToPcm16, frameLevel } from './framing';

describe('FrameAccumulator', () => {
  it('emits 160-sample frames from 128-sample worklet quanta', () => {
    const accumulator = new FrameAccumulator();
    const quantum = new Float32Array(128).fill(0.5);

    // First 128-sample quantum: not enough for a full 160-sample frame yet.
    expect(accumulator.push(quantum)).toHaveLength(0);
    // Second quantum (256 total) crosses one 160-sample boundary.
    const frames = accumulator.push(quantum);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(FRAME_SIZE);
  });

  it('preserves total sample count across many frames', () => {
    const accumulator = new FrameAccumulator();
    let emitted = 0;
    for (let i = 0; i < 100; i += 1) {
      emitted += accumulator.push(new Float32Array(128)).length;
    }
    // 100 × 128 = 12800 samples → floor(12800 / 160) = 80 complete frames.
    expect(emitted).toBe(80);
  });

  it('converts float samples to clamped 16-bit PCM', () => {
    const pcm = floatFrameToPcm16(new Float32Array([0, 1, -1, 2, -2]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(32767);
    expect(pcm[2]).toBe(-32767);
    expect(pcm[3]).toBe(32767); // clamped
    expect(pcm[4]).toBe(-32767); // clamped
  });

  it('reports a scaled peak level', () => {
    expect(frameLevel(new Float32Array([0, 0, 0]))).toBe(0);
    expect(frameLevel(new Float32Array([0, 0.5, -0.25]))).toBe(50);
    expect(frameLevel(new Float32Array([1]))).toBe(100);
  });
});
