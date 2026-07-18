# Kerchunk

Kerchunk is a native, cross-platform desktop client for operating a full AllStarLink-style node without radio hardware, a Pi, or a VM. It is built with Electron and TypeScript and targets Windows, Linux, and macOS.

The project is independent and is not affiliated with or endorsed by AllStarLink, Inc.

Copyright © 2026 W9MDM. Released under the MIT License (see [LICENSE](./LICENSE)).

## Install (Windows)

Grab a build from the `release/` folder (or from whoever sent it to you):

- **Kerchunk-x.y.z-Setup.exe** — installer. Run it, pick a folder, and it adds
  Start Menu and desktop shortcuts.
- **Kerchunk-x.y.z-Portable.exe** — no install; double-click to run.

These builds are not code-signed, so Windows SmartScreen will show a
"Windows protected your PC" prompt the first time. Click **More info →
Run anyway**. Kerchunk only makes outbound connections (AllStarLink DNS,
registration/portal HTTPS, and IAX2 on UDP 4569) — no inbound ports needed.

### Two ways to connect

- **Node mode** — for operators with an issued AllStarLink node number.
  Enter your node number and secret, Register, then link to any node.
- **Web Transceiver** — for anyone with a callsign and a free
  allstarlink.org portal account, no node number required. Enter your
  callsign and portal password; Kerchunk fetches a per-node session token
  from the portal and connects as a guest.

## Why Kerchunk exists

The original AllCall concept aimed to give users a practical way to participate in AllStarLink-style linking from a desktop environment. Kerchunk carries that idea forward with a modern desktop application that keeps the node experience local, focused, and testable.

## Current status

- The Electron shell (main, preload, renderer) and the theme bridge are in place.
- Kerchunk is a self-contained node: it implements in-app what Asterisk +
  chan_iax2 + app_rpt do. `KerchunkNode` owns one UDP socket, demultiplexes
  incoming frames to per-peer call legs by call number, and runs an app_rpt-style
  conference bridge (N-1 mixing) so every linked node plus the local port (the
  operator's mic) hears everyone but itself.
- A pure-TypeScript IAX2 protocol engine underneath: full/mini frame codecs,
  RFC 5456-compliant information elements (correct type numbers and field widths,
  so it interoperates with real Asterisk peers), a guarded call-control state
  machine, call-time and registration MD5 authentication, and voice/DTMF/text
  handling. No Electron dependency; exercised entirely from Node tests.
- Node-number linking over AllStarLink DNS (`nodes.allstarlink.org` SRV/A/TXT):
  link to a node by number, or to a direct address (a node/hub you run).
  Outbound linking only for now; the socket is structured so accepting inbound
  is a later toggle.
- ASL3 HTTP registration (`register.allstarlink.org`) with automatic refresh, so
  the node publishes its number → public IP and other nodes accept its links.
- Standard ITU-T G.711 µ-law/A-law codecs, wire-compatible with Asterisk.
- A renderer audio path: AudioWorklet microphone capture framed to 8 kHz / 20 ms
  frames, G.711 encoding over the IPC bridge, push-to-talk gating, and scheduled
  playback of the node's mixed RX audio.
- The desktop UI exposes node identity, link-by-number (or address), a live
  connected-nodes list with per-link disconnect, drop-all, and push-to-talk,
  plus TX/RX level meters and an activity log.
- Vitest covers the codecs, frame wire format, IE handling, the call state
  machine, the framing helper, DNS resolution, the conference mixer, the call
  leg, and the node end-to-end (bidirectional conference over real UDP).

## Build from source

Requires Node.js 20+ and npm.

```sh
npm install
npm run dev          # run in development
npm run dist:win     # build the Windows installer + portable .exe → release/
npm run dist:mac     # macOS .dmg (must run on macOS)
npm run dist:linux   # Linux AppImage + .deb
npm test             # run the Vitest suite
```

Build artifacts land in `release/`. The app icon is generated into
`build/icon.png` and electron-builder derives the per-platform icons from it.

## Roadmap

1. Inbound-link support (accept NEW; UDP 4569 forwarding / reachability check).
2. Reliable delivery for full frames (retransmission, sequence recovery).
3. app_rpt niceties: connect/disconnect telemetry, courtesy tones, node ID.
4. Full 32-bit format negotiation and codec fallback beyond G.711.
5. Desktop settings, persistence, and tray integration.
6. Code-signing for signed, SmartScreen-clean installers.

## License

Kerchunk is copyright © 2026 W9MDM and released under the MIT License. See
[LICENSE](./LICENSE) for the full text and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)
for the open-source components it builds on.
