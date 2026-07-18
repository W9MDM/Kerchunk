# Kerchunk

Kerchunk is a native, cross-platform desktop client for operating a full AllStarLink-style node without radio hardware, a Pi, or a VM. It is built with Electron and TypeScript and targets Windows, Linux, and macOS.

The project is independent and is not affiliated with or endorsed by AllStarLink, Inc.

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

## Roadmap

1. Inbound-link support (accept NEW; UDP 4569 forwarding / reachability check).
2. Reliable delivery for full frames (retransmission, sequence recovery).
3. app_rpt niceties: connect/disconnect telemetry, courtesy tones, node ID.
4. Full 32-bit format negotiation and codec fallback beyond G.711.
5. Desktop settings, persistence, and tray integration.
6. Packaging and release automation.

## License

Kerchunk is licensed under the GNU General Public License v3.0.
