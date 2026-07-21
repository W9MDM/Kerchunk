# Kerchunk

Kerchunk is a native, cross-platform desktop client for operating a full AllStarLink-style node without radio hardware, a Pi, or a VM. It is built with Electron and TypeScript and targets Windows, Linux, and macOS.

The project is independent and is not affiliated with or endorsed by AllStarLink, Inc.

Copyright © 2026 W9MDM. Released under the [PolyForm Noncommercial License 1.0.0](./LICENSE)
— free to use, modify, and share for any noncommercial purpose; **selling it is not permitted**.

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

The Node / Web TX choice, like the rest of your settings, is remembered
across restarts.

## Features

- **First-run setup wizard** — a step-by-step walkthrough on first launch
  (mode → credentials → audio) so you're on the air in a minute. Re-runnable
  any time from the menu.

- **Node directory** (📡 button by the gear) — searches the full AllStarLink
  node database, grouped by country and US state, so you can find and one-click
  link a node without knowing its number. Saving a node keeps its callsign,
  description, and location.
- **Favorites / saved nodes** — a quick-pick dropdown and an editable list in
  Settings, with live "keyed" coloring polled from the AllStarLink stats API so
  you can see which of your favorites are active. A **Save** button keeps a node
  deliberately (connecting only adds to **Recent**, so the saved list stays yours).
- **Recent nodes** — the last several nodes you connected to, one click to relink.
- **MDC1200 PTT-ID** — clean-room encoder that sends your unit ID over the air
  on key-up/key-down (confirmed decoding on app_rpt), with a local Motorola-style
  talk-permit tone and adjustable level/preamble.
- **DTMF commands** — a keypad and free-form sender for app_rpt `*` commands,
  plus **saved commands** you can name and re-send with one tap.
- **Announcements** — optional spoken and/or desktop-notification alerts for
  connect / disconnect / call-failed events (off by default; Settings → Audio).
- **Push-to-talk** — on-screen hold-to-talk, a global PTT hotkey that supports
  **multi-key combos** (e.g. Ctrl+Shift+T), and a **floating PTT overlay** — a
  small always-on-top button that hovers over any other application (toggle it
  from the menu; drag it anywhere).
- **Audio device selection & levels** — pick your microphone and speaker and set
  input/output levels in Settings → Audio, plus a speaker button in the header for
  quick app-volume control.
- **Network topology** — a live tree of the mesh you're linked into.
- **Collapsible sections** — every panel minimizes (state remembered); the
  Transmit panel keeps a compact PTT button even when collapsed.
- **In-app menu** — a Font Awesome menu (directory, register, refresh,
  disconnect all, advanced mode, settings, about).
- **Runs in the background** — optional system-tray icon with close-to-tray and
  launch-at-startup (Settings → General).
- **Backup / migrate** — export and import your settings and saved nodes as JSON
  (Settings → General).
- **Advanced mode** — reveals direct-address linking and custom IAX link
  credentials for private nodes/hubs (off by default).
- **Tabbed Settings** — Node, Saved nodes, Hotkey, Audio, MDC1200, and
  Appearance; everything persists, including the window size and Node/Web-TX mode.

Node and Web Transceiver modes each unlock only once their credentials are set,
so you can't accidentally pick a mode you can't use.

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
  is a later toggle. Outbound calls that go unanswered time out after 15 s
  (instead of hanging in "calling" forever) and announce the failure.
- ASL3 HTTP registration (`register.allstarlink.org`) with automatic refresh, so
  the node publishes its number → public IP and other nodes accept its links.
- Standard ITU-T G.711 µ-law/A-law codecs, wire-compatible with Asterisk.
- A renderer audio path: AudioWorklet microphone capture framed to 8 kHz / 20 ms
  frames, G.711 encoding over the IPC bridge, push-to-talk gating, and scheduled
  playback of the node's mixed RX audio.
- The desktop UI exposes node identity, link-by-number (or address), a live
  connected-nodes list with per-link disconnect, drop-all, and push-to-talk,
  plus TX/RX level meters and an activity log. Icons throughout are Font Awesome
  (bundled inline; no webfont fetch), with tooltips and screen-reader labels on
  icon-only controls.
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
npm run dist:linux   # Linux build (packaged as a tarball; see note below)
npm test             # run the Vitest suite
```

Build artifacts land in `release/`. The app icon is generated into
`build/icon.png` and electron-builder derives the per-platform icons from it.

> **Linux packaging note:** the `.deb` can't be assembled on Windows
> (`mksquashfs` isn't available), so a local Windows workflow ships Linux as a
> `Kerchunk-x.y.z-linux-x64.tar.gz` tarball built from `release/linux-unpacked`
> (with a `run.sh` launcher). CI builds the native `.deb` on Linux. (The AppImage
> target was dropped: at ~112 MB it exceeded the 100 MB upload cap of the
> Cloudflare proxy in front of the Gitea release host.)

## Roadmap

1. Inbound-link support (accept NEW; UDP 4569 forwarding / reachability check).
2. Reliable delivery for full frames (retransmission, sequence recovery).
3. Remaining app_rpt niceties: courtesy tones, CW/voice node ID.
4. Full 32-bit format negotiation and codec fallback beyond G.711.
5. Tray integration and background operation.
6. Code-signing for signed, SmartScreen-clean installers.

## License

Kerchunk is copyright © 2026 W9MDM and released under the **PolyForm Noncommercial
License 1.0.0**: you may use, modify, and share it for any noncommercial purpose,
but you may **not sell it** or use it commercially. See [LICENSE](./LICENSE) for
the full text and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for the
open-source components it builds on (which keep their own permissive licenses).
