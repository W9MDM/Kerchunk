# Architecture

## Layer overview

Kerchunk uses an Electron application structure with a clear separation between processes.

- Main process: window management, native theme handling, IPC bridge, and future protocol engine coordination.
- Preload process: typed bridge that exposes a narrow allowlist of APIs to the renderer.
- Renderer process: React + Vite UI, theming, audio device interaction, and user-facing controls.
- Shared layer: typed contracts used by both the main and renderer processes.
- Protocol layer: pure TypeScript IAX2 engine that remains importable from plain Node and does not depend on Electron.

## IPC boundaries

The renderer never opens UDP sockets or speaks protocol details directly. It sends user actions and audio frames to the main process over a typed IPC surface. The main process owns the network stack and forwards state updates back to the renderer.

The IPC contract lives in `src/shared/ipc.ts` as the `KerchunkBridge` interface. The preload script implements that interface exactly, and the renderer's `window.electronAPI` is typed against it, so the bridge has a single source of truth. Renderer → main channels carry connect/register/hang-up requests, outbound audio, and text/DTMF. Main → renderer channels carry protocol state, inbound audio, and inbound text/DTMF.

## Protocol engine

`src/protocol` is a pure-TypeScript IAX2 implementation with no Electron imports, so it runs and is tested directly under Node/Vitest:

- `frames.ts` — full-frame and mini-frame wire codecs. Full frames are identified by the F bit (high bit of the first octet), never by length.
- `ies.ts` — information-element encode/decode plus list helpers.
- `call.ts` — a guarded `CallSession` state machine (idle → calling/ringing → accepted → up → hangup) that throws on illegal transitions.
- `client.ts` — `IaxClient`, which owns one UDP socket, drives a `CallSession` from received frames, acknowledges reliable full frames, performs MD5 registration, and emits typed `audio`/`state`/`callState`/`text`/`dtmf`/`registered` events.

The main process is a thin adapter: it instantiates one `IaxClient`, forwards IPC calls to it, and relays its events to the renderer.

## Audio path

Microphone capture runs through an AudioWorklet (`src/renderer/public/kerchunk-capture-worklet.js`) that buffers the browser's 128-sample render quanta into fixed 8 kHz / 20 ms (160-sample) frames. The main-thread `AudioEngine` (`src/renderer/src/audio/engine.ts`) G.711-encodes each frame and hands it to the bridge; inbound frames are decoded and scheduled back-to-back for gap-free playback. The pure framing logic is factored into `framing.ts` so it can be unit tested without Web Audio.

## Theming

The renderer uses Tailwind theme tokens backed by CSS variables in a shared stylesheet. The main process reads the current system preference and forwards the resolved theme to the renderer before the first paint and on changes.
