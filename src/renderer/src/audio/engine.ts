import { decodeG711Chunk, encodeG711Chunk } from '../../../shared/audio';
import { SAMPLE_RATE, floatFrameToPcm16, frameLevel } from './framing';

export interface AudioEngineCallbacks {
  /** A completed, G.711-encoded 20 ms TX frame ready for the IPC bridge. */
  onTxFrame: (frame: ArrayBuffer) => void;
  onTxLevel: (level: number) => void;
  onRxLevel: (level: number) => void;
}

type AudioContextConstructor = typeof AudioContext;

/**
 * Owns the renderer-side audio path: microphone capture framed to 20 ms by an
 * AudioWorklet, G.711 encoding of TX frames, and gap-free scheduled playback of
 * decoded RX frames. Kept out of the React component so the UI stays declarative.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private playback: AudioWorkletNode | null = null;
  private transmitting = false;
  private inputDeviceId = '';
  private outputDeviceId = '';

  constructor(private readonly callbacks: AudioEngineCallbacks) {}

  /** Choose the microphone / speaker devices (deviceId; '' = system default). */
  async setDevices(input: string, output: string): Promise<void> {
    const inputChanged = input !== this.inputDeviceId;
    const outputChanged = output !== this.outputDeviceId;
    this.inputDeviceId = input;
    this.outputDeviceId = output;
    if (!this.context) return; // applied on start()
    if (outputChanged) await this.applyOutputDevice();
    if (inputChanged) await this.applyInputDevice();
  }

  private micConstraints(): MediaStreamConstraints {
    const base: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (this.inputDeviceId) base.deviceId = { exact: this.inputDeviceId };
    return { audio: base };
  }

  /** Route playback to the chosen speaker (Chromium AudioContext.setSinkId). */
  private async applyOutputDevice(): Promise<void> {
    const ctx = this.context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return; // unsupported — stays on the default device
    try {
      await ctx.setSinkId(this.outputDeviceId);
    } catch {
      // fall back to the default output
    }
  }

  /** Swap the microphone input on a running context without a full restart. */
  private async applyInputDevice(): Promise<void> {
    const context = this.context;
    if (!context || !this.worklet) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(this.micConstraints());
      this.source?.disconnect();
      this.stream?.getTracks().forEach((track) => track.stop());
      const source = context.createMediaStreamSource(stream);
      source.connect(this.worklet);
      this.stream = stream;
      this.source = source;
    } catch {
      // keep the previous input if the new device can't be opened
    }
  }

  /** Gate microphone TX (push-to-talk). While false, no audio leaves the app. */
  setTransmitting(on: boolean): void {
    this.transmitting = on;
    if (!on) {
      this.callbacks.onTxLevel(0);
    }
  }

  /**
   * Play the Motorola P25 talk-permit tone locally (operator sidetone only — not
   * transmitted): 910 Hz 30 ms, gap 20 ms, 910 Hz 30 ms, gap 20 ms, 910 Hz 50 ms.
   */
  playTalkPermitTone(): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    const beeps = [
      { at: 0.0, dur: 0.03 },
      { at: 0.05, dur: 0.03 },
      { at: 0.1, dur: 0.05 },
    ];
    for (const beep of beeps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 910;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = now + beep.at;
      const t1 = t0 + beep.dur;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.22, t0 + 0.004);
      gain.gain.setValueAtTime(0.22, t1 - 0.004);
      gain.gain.linearRampToValueAtTime(0, t1);
      osc.start(t0);
      osc.stop(t1 + 0.005);
    }
  }

  async start(): Promise<void> {
    if (this.context) {
      await this.resume();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not supported in this environment.');
    }

    const AudioContextClass: AudioContextConstructor | undefined =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AudioContext is not available.');
    }

    const context = new AudioContextClass({ sampleRate: SAMPLE_RATE });
    // The worklet ships as a static asset (see src/renderer/public); resolve it
    // relative to the loaded document so it works under both the dev server and
    // Electron's file:// production load.
    const workletUrl = new URL('kerchunk-capture-worklet.js', window.location.href);
    await context.audioWorklet.addModule(workletUrl.href);
    const playbackUrl = new URL('kerchunk-playback-worklet.js', window.location.href);
    await context.audioWorklet.addModule(playbackUrl.href);

    const stream = await navigator.mediaDevices.getUserMedia(this.micConstraints());
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'kerchunk-capture');
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      // Push-to-talk: while un-keyed, capture stays local — no level, no frames.
      if (!this.transmitting) {
        return;
      }
      const frame = event.data;
      this.callbacks.onTxLevel(frameLevel(frame));
      const encoded = encodeG711Chunk(floatFrameToPcm16(frame));
      const copy = new Uint8Array(encoded);
      this.callbacks.onTxFrame(copy.buffer);
    };

    // Capture only: the worklet is intentionally not wired to destination so the
    // operator does not hear their own microphone.
    source.connect(worklet);

    // RX playback runs in its own worklet with a jitter buffer, fed by playFrame.
    const playback = new AudioWorkletNode(context, 'kerchunk-playback');
    playback.connect(context.destination);

    this.context = context;
    this.stream = stream;
    this.source = source;
    this.worklet = worklet;
    this.playback = playback;
    if (this.outputDeviceId) await this.applyOutputDevice();
    await this.resume();
  }

  playFrame(data: ArrayBuffer): void {
    const playback = this.playback;
    if (!playback) {
      return;
    }

    const samples = decodeG711Chunk(new Uint8Array(data));
    const floats = new Float32Array(samples.length);
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index] / 32768;
      floats[index] = value;
      const magnitude = Math.abs(value);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    this.callbacks.onRxLevel(Math.min(100, Math.round(peak * 100)));

    // Hand the frame to the playback worklet's ring buffer (cheap, off the audio
    // scheduling path). Transfer the buffer to avoid a copy.
    playback.port.postMessage(floats, [floats.buffer]);
  }

  async stop(): Promise<void> {
    this.transmitting = false;
    this.worklet?.disconnect();
    this.playback?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context) {
      await this.context.close();
    }
    this.context = null;
    this.stream = null;
    this.source = null;
    this.worklet = null;
    this.playback = null;
  }

  private async resume(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }
}
