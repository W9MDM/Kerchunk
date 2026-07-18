// Kerchunk RX playback worklet.
//
// Runs on the audio rendering thread. The main thread posts decoded 8 kHz PCM
// (Float32) frames into a ring buffer; process() drains that buffer to the
// output at the audio clock. This replaces creating an AudioBufferSourceNode per
// 20 ms frame on the main thread (50/s) — that churn competed with microphone
// capture on the same thread and starved outbound audio. A small prime threshold
// gives a jitter buffer that absorbs delivery timing wobble; underruns re-prime.
//
// Self-contained plain-JS asset: AudioWorklet modules load by URL and cannot
// import from the TypeScript sources.
const CAPACITY = 8000; // 1 s at 8 kHz — hard cap; drops oldest on overflow
const PRIME = 480; // ~60 ms buffered before playback starts / after an underrun

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(CAPACITY);
    this._read = 0;
    this._write = 0;
    this._count = 0;
    this._playing = false;
    this.port.onmessage = (event) => {
      const frame = event.data;
      for (let i = 0; i < frame.length; i += 1) {
        this._buf[this._write] = frame[i];
        this._write = (this._write + 1) % CAPACITY;
        if (this._count < CAPACITY) {
          this._count += 1;
        } else {
          this._read = (this._read + 1) % CAPACITY; // overwrite oldest
        }
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) {
      return true;
    }
    if (!this._playing && this._count >= PRIME) {
      this._playing = true;
    }
    for (let i = 0; i < out.length; i += 1) {
      if (this._playing && this._count > 0) {
        out[i] = this._buf[this._read];
        this._read = (this._read + 1) % CAPACITY;
        this._count -= 1;
      } else {
        out[i] = 0;
        this._playing = false; // underrun — wait for the buffer to re-prime
      }
    }
    return true;
  }
}

registerProcessor('kerchunk-playback', PlaybackProcessor);
