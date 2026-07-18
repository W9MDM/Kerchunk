# Architecture

## Layer overview

Kerchunk uses an Electron application structure with a clear separation between processes.

- Main process: window management, native theme handling, the IPC bridge, the global PTT hotkey, the node-directory fetch/cache, and ownership of the `KerchunkNode` protocol engine.
- Preload process: typed bridge that exposes a narrow allowlist of APIs to the renderer.
- Renderer process: React + Vite UI, theming, audio device interaction, MDC RX decode (in a Web Worker), voice announcements, and user-facing controls.
- Shared layer: typed contracts and codecs used by both the main and renderer processes (IPC types, G.711, the MDC1200 codec, the node-directory parser).
- Protocol layer: pure TypeScript IAX2 engine that remains importable from plain Node and does not depend on Electron.

## IPC boundaries

The renderer never opens UDP sockets or speaks protocol details directly. It sends user actions and audio frames to the main process over a typed IPC surface. The main process owns the network stack and forwards state updates back to the renderer.

The IPC contract lives in `src/shared/ipc.ts` as the `KerchunkBridge` interface. The preload script implements that interface exactly, and the renderer's `window.electronAPI` is typed against it, so the bridge has a single source of truth. Renderer → main channels carry connect/register/hang-up requests, outbound audio, text/DTMF, hotkey registration, MDC config, and node-directory/stats lookups. Main → renderer channels carry protocol state, inbound audio, inbound text/DTMF, the live connection list (each entry exposes an `up` flag distinguishing "calling" from an established link), and PTT-hotkey events.

## Protocol engine

`src/protocol` is a pure-TypeScript IAX2 implementation with no Electron imports, so it runs and is tested directly under Node/Vitest:

- `frames.ts` — full-frame and mini-frame wire codecs. Full frames are identified by the F bit (high bit of the first octet), never by length.
- `ies.ts` — information-element encode/decode plus list helpers.
- `call.ts` — a guarded `CallSession` state machine (idle → calling/ringing → accepted → up → hangup) that throws on illegal transitions.
- `leg.ts` — `IaxLeg`, one peer call: it drives a `CallSession` from received frames, acknowledges reliable full frames, runs the `!NEWKEY1!` / RADIO_KEY handshakes, and emits `audio`/`state`/`up`/`hangup`/`dtmf`/`error`.
- `node.ts` — `KerchunkNode`, the self-contained node. It owns one UDP socket, demultiplexes incoming frames to per-peer `IaxLeg`s by call number, runs an app_rpt-style N-1 conference bridge (`mixer.ts`) so everyone hears everyone but themselves, injects MDC1200 bursts, sends DTMF, and enforces a call-setup timeout (an unanswered outbound call is torn down rather than left "calling").
- `registration.ts` / `resolver.ts` — ASL3 HTTP registration with refresh, and `nodes.allstarlink.org` DNS resolution.
- `nodeinfo.ts` / `stats.ts` — AllStarLink stats API: per-node metadata (callsign/location) and keyed status.
- `wtportal.ts` — Web Transceiver guest session-token fetch.
- `client.ts` — the earlier single-call `IaxClient`, retained for tests/reference.

The main process is a thin adapter: it instantiates one `KerchunkNode`, forwards IPC calls to it, and relays its events to the renderer.

## Audio path

Microphone capture runs through an AudioWorklet (`src/renderer/public/kerchunk-capture-worklet.js`) that buffers the browser's 128-sample render quanta into fixed 8 kHz / 20 ms (160-sample) frames. The main-thread `AudioEngine` (`src/renderer/src/audio/engine.ts`) G.711-encodes each frame and hands it to the bridge; inbound frames are decoded and scheduled back-to-back for gap-free playback (`kerchunk-playback-worklet.js`). The pure framing logic is factored into `framing.ts` so it can be unit tested without Web Audio.

Inbound MDC1200 decoding runs in a Web Worker (`src/renderer/src/audio/mdcDecoder.worker.ts`) so its brute-force burst search never blocks the main thread (which would starve the mic handoff). The MDC1200 encoder/decoder itself lives in `src/shared/mdc1200.ts` (clean-room MIT implementation).

## Node directory

`src/shared/nodedirectory.ts` parses the full AllStarLink database (`allmondb.allstarlink.org`) into typed records and classifies each node by country (ITU callsign prefix) and US state (location text). The main process fetches and caches it (6 h) behind an IPC call; the renderer's directory popup filters and searches it for one-click linking.

## Theming

The renderer uses Tailwind theme tokens backed by CSS variables in a shared stylesheet. The main process reads the current system preference and forwards the resolved theme to the renderer before the first paint and on changes.
