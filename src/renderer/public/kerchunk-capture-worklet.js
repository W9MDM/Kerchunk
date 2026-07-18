// Kerchunk microphone capture worklet.
//
// Runs on the audio rendering thread and buffers the 128-sample render quanta
// the browser delivers into fixed 160-sample frames (8 kHz × 20 ms), posting
// each complete frame to the main thread. Codec work stays on the main thread.
//
// This is intentionally a self-contained plain-JS asset: AudioWorklet modules
// are loaded by URL and are not part of the Vite module graph, so they cannot
// import from the TypeScript sources. The framing algorithm here mirrors
// FrameAccumulator in ../src/audio/framing.ts, which is unit tested.
const FRAME_SIZE = 160;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(FRAME_SIZE);
    this._filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) {
      return true;
    }

    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(FRAME_SIZE - this._filled, channel.length - offset);
      this._buffer.set(channel.subarray(offset, offset + take), this._filled);
      this._filled += take;
      offset += take;
      if (this._filled === FRAME_SIZE) {
        this.port.postMessage(this._buffer.slice(0, FRAME_SIZE));
        this._filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('kerchunk-capture', CaptureProcessor);
