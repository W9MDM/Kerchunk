# Kerchunk — Presentation Brief

A complete content and design brief for building a PowerPoint (or Google Slides /
Keynote) deck about Kerchunk. Hand this whole file to Claude (or any designer)
and ask for a deck; everything needed — messaging, slide-by-slide content,
speaker notes, visual direction, and verified facts — is here. Nothing in the
deck should contradict the **Fact sheet** at the bottom.

---

## 1. What we're presenting

**Product:** Kerchunk — a native, cross-platform desktop client that runs a
full AllStarLink-style node with **no radio hardware, no Raspberry Pi, and no
VM**. It speaks real IAX2 to real Asterisk/app_rpt nodes on the actual
AllStarLink network.

**One-liner:** *"A complete AllStarLink node in a desktop app — install, enter
your credentials, and you're on the air in a minute."*

**Elevator pitch (30 s):** Getting on AllStarLink normally means building a
node: a Pi or server, an Asterisk install, config files, port forwarding.
Kerchunk collapses all of that into one desktop app. It implements the IAX2
protocol, AllStarLink registration, and an app_rpt-style conference bridge in
pure TypeScript — so a ham with a node number (or just a free portal account,
via Web Transceiver mode) can link to any node on the network, talk with
push-to-talk, and hear everything, from Windows, Linux, or macOS. Outbound-only
networking means it works from behind any home firewall with zero port
forwarding.

**Required disclaimer (must appear in the deck, e.g. title-slide footnote):**
Kerchunk is an independent project and is **not affiliated with or endorsed by
AllStarLink, Inc.** It is © 2026 W9MDM, released under the PolyForm
Noncommercial License 1.0.0 (free to use/modify/share noncommercially; may not
be sold).

## 2. Audience & tone

Primary audience: **amateur radio operators** — club presentations, hamfest
talks, net announcements. They know what AllStarLink and a "node" are; they do
*not* care about TypeScript internals until the "under the hood" section.
Secondary audience: technically curious developers (the architecture slides
serve them).

Tone: practical, plain-spoken, a little playful (the name is ham slang — a
"kerchunk" is keying up a repeater just to see if it's there). Confident but
honest: builds are unsigned, inbound links aren't supported yet — say so.

## 3. Visual direction

- **Look:** dark "radio console" aesthetic. Near-black slate background
  (#0f172a-ish), light text, one **amber/signal-orange accent** (think TX
  indicator lamp) used sparingly for emphasis, keyed states, and the PTT motif.
  A green secondary accent for RX/"link up" states in diagrams.
- **Typography:** a clean geometric sans (Inter, Segoe UI, or similar) for
  body; optionally a monospace face for node numbers, DTMF strings, and
  protocol terms (`*3 51018`, `IAX2`, `G.711`) to give it an operator feel.
- **Iconography:** simple line icons (the app itself uses Font Awesome —
  tower-cell, microphone, headset, network-wired, gear). No clip-art radios.
- **Imagery:** real app screenshots are the hero visuals (see §6). Avoid stock
  photos of handhelds/people; the product *is* the screen.
- **Motif:** push-to-talk. A recurring round PTT-button element can carry
  section-divider slides ("Press to continue" energy, used tastefully).
- **Slide density:** max ~5 bullets/slide, one idea per slide; put depth in
  speaker notes, not on the slide.

## 4. Deck outline (16 slides)

### Slide 1 — Title
- **On slide:** Kerchunk logo/app icon · "A full AllStarLink-style node, on your desktop." · presenter name/callsign · version (0.10.2) · the non-affiliation + license footnote.
- **Notes:** Introduce yourself. "Kerchunk" = keying a repeater just to check it's alive; the name promises zero-friction key-ups.

### Slide 2 — The problem
- **On slide:** What it takes to get on AllStarLink today: a Pi/server → Asterisk + app_rpt install → config files → port forwarding → maintenance. "A weekend project before your first QSO."
- **Visual:** a 5-step chain of hurdles, styled as a breadcrumb of pain.
- **Notes:** Emphasize the audience segment locked out by this: new hams, operators in restrictive housing/HOA, anyone without a spare Pi or the Linux appetite.

### Slide 3 — The idea
- **On slide:** One app replaces the whole stack. Kerchunk implements *in-app* what Asterisk + chan_iax2 + app_rpt do: the IAX2 protocol, registration, and an N-1 conference bridge.
- **Visual:** left = the traditional stack (Pi, Asterisk, app_rpt, router config), right = a single laptop with the Kerchunk icon; an equals sign between them.
- **Notes:** This is not a remote-control front end for someone else's node — it *is* the node. It talks native IAX2 to real Asterisk peers on the real network.

### Slide 4 — Two ways to connect
- **On slide:** **Node mode** — you have an issued node number + secret: register, then link anywhere. **Web Transceiver mode** — just a callsign + free allstarlink.org portal account: Kerchunk fetches a guest session token, no node number needed.
- **Visual:** two side-by-side cards; each mode unlocks only when its credentials are set.
- **Notes:** Web TX mode is the on-ramp for the ham who's never touched AllStarLink — the barrier to first QSO is a free portal signup.

### Slide 5 — On the air in a minute
- **On slide:** First-run setup wizard: mode → credentials → audio. Re-runnable from the menu. Everything persists across restarts.
- **Visual:** screenshot of the wizard, or a 3-step horizontal stepper.
- **Notes:** Live-demo insertion point if presenting with the app installed.

### Slide 6 — Finding people to talk to
- **On slide:** 📡 **Node directory** — the full AllStarLink database, searchable, grouped by country and US state, one-click linking. **Favorites** with live "keyed" coloring from the stats API. **Recent nodes**, one click to relink.
- **Visual:** screenshot of the directory popup.
- **Notes:** Saving is deliberate (a Save button) — connecting only adds to Recent, so the saved list stays curated.

### Slide 7 — Talking: PTT everywhere
- **On slide:** On-screen hold-to-talk · global hotkey with multi-key combos (Ctrl+Shift+T) · **floating always-on-top PTT overlay** that hovers over any app · TX/RX level meters.
- **Visual:** screenshot with the floating overlay over some unrelated window — the money shot for this feature.
- **Notes:** The overlay means you can key up while logging, browsing, or working; drag it anywhere.

### Slide 8 — Radio-grade extras
- **On slide:** **MDC1200 PTT-ID** (clean-room encoder, confirmed decoding on app_rpt, Motorola-style talk-permit tone) · **DTMF keypad + saved `*` commands** · optional spoken/desktop **announcements** for connect/disconnect events.
- **Notes:** MDC1200 sends your unit ID on key-up/key-down like a commercial radio; saved DTMF commands turn multi-digit app_rpt sequences into one tap.

### Slide 9 — Lives on your desktop properly
- **On slide:** System tray + close-to-tray + launch at startup · auto-update from GitHub Releases with changelog · settings/saved-nodes **backup & migrate** (JSON export/import) · tabbed Settings; window size, theme, everything remembered · live network-topology tree of the mesh you're linked into.
- **Notes:** Grab-bag slide — pick the three that land best with your audience and demote the rest to notes.

### Slide 10 — Section divider: Under the hood
- **On slide:** just the PTT motif + "Under the hood". 
- **Notes:** Warn the non-technical: two slides of engineering, then back to practical matters. (Skippable for a pure operators' audience.)

### Slide 11 — Architecture
- **On slide:** simplified layer diagram (spec in §5): React UI → typed IPC bridge → main process → pure-TypeScript IAX2 engine → UDP 4569 → AllStarLink network.
- **Notes:** The protocol engine has zero Electron dependencies — it runs and is tested under plain Node. The renderer never touches sockets; a single typed contract (`KerchunkBridge`) is the source of truth for the IPC surface.

### Slide 12 — A real protocol implementation
- **On slide:** RFC 5456-compliant IAX2 (interoperates with real Asterisk) · MD5 auth for calls & registration · app_rpt-style **N-1 conference bridge** (everyone hears everyone but themselves) · ITU-T G.711 µ-law/A-law · AudioWorklet mic capture at 8 kHz / 20 ms frames · Vitest suite covering codecs, wire format, state machine, mixer, and an end-to-end node test over real UDP.
- **Visual:** N-1 mixer diagram (spec in §5).
- **Notes:** "Clean-room" matters: the MDC1200 codec is an original implementation, not GPL-derived. The unanswered-call timeout (15 s) is an example of the operator-experience polish layered on the protocol.

### Slide 13 — Network posture
- **On slide:** **Outbound-only.** AllStarLink DNS + registration/portal HTTPS + IAX2 on UDP 4569 out. **No inbound ports, no port forwarding, no static IP.** Works from behind any home router/CGNAT.
- **Visual:** home network diagram with arrows only pointing out through the router.
- **Notes:** This is a headline benefit for HOA/apartment/CGNAT operators, not just a security note. Registration publishes node → public IP so other nodes accept your links.

### Slide 14 — Getting it
- **On slide:** Windows: Setup.exe installer or Portable.exe (no install) · Linux: `.deb` from CI (tarball from Windows builds) · macOS: `.dmg` · auto-updates after that. Honest note: builds are unsigned → SmartScreen prompt on first run ("More info → Run anyway").
- **Visual:** three platform tiles + the GitHub Releases URL / QR code.
- **Notes:** Don't bury the SmartScreen caveat — owning it builds trust; code-signing is on the roadmap.

### Slide 15 — Roadmap
- **On slide:** Inbound-link support · reliable full-frame delivery (retransmission/sequence recovery) · courtesy tones + CW/voice node ID · codec negotiation beyond G.711 · code-signing.
- **Notes:** Outbound-only is a current scope choice, not an architectural limit — the socket is already structured for an inbound toggle later.

### Slide 16 — Close / Q&A
- **On slide:** the one-liner again · GitHub: `github.com/W9MDM/Kerchunk` (QR) · free for noncommercial use · 73 de W9MDM.
- **Notes:** Invite questions; offer a live demo of linking to a node if network allows.

## 5. Diagram specs

**Architecture (slide 11)** — five horizontal layers, top→bottom:
1. *Renderer* (React + Vite UI, AudioWorklet mic/playback, MDC decode worker)
2. *Preload* (typed `KerchunkBridge` allowlist)
3. *Main process* (window/tray/hotkey, node-directory cache, owns the engine)
4. *Protocol engine* (`KerchunkNode`: IAX2 frames/IEs, call state machine, per-peer legs, N-1 mixer, registration, DNS resolver — "pure TypeScript, no Electron")
5. *Network* (UDP 4569 → AllStarLink nodes; HTTPS → register/portal/stats; DNS → nodes.allstarlink.org)

Voice flows down the left edge (mic → G.711 → UDP) and up the right edge
(UDP → mix → speaker); use the amber accent for TX, green for RX.

**N-1 mixer (slide 12)** — central "bridge" circle with 4 spokes: three remote
nodes + the local operator ("port"). Caption: *each participant receives the
sum of everyone except themselves* — annotate one spoke to show its own audio
excluded from its return feed.

## 6. Assets & screenshots to capture

- App icon: `build/icon.png` (generated by the build; run a build if absent).
- Screenshots to take from a running app (`npm run dev`), dark theme, at a
  clean window size: main window while linked (meters live), setup wizard,
  node-directory popup, Settings → Audio, the floating PTT overlay hovering
  over another app, network-topology tree.
- Badges/URLs: `github.com/W9MDM/Kerchunk` releases page for the QR code.
- Do **not** use AllStarLink, Inc. logos or trademarks anywhere in the deck.

## 7. Fact sheet (verified against the repo — do not improvise beyond this)

| Fact | Value |
|---|---|
| Product / version | Kerchunk 0.10.2 |
| Author / copyright | © 2026 W9MDM |
| License | PolyForm Noncommercial 1.0.0 — free noncommercial use; **no selling** |
| Affiliation | None — independent; not endorsed by AllStarLink, Inc. |
| Platforms | Windows (Setup + Portable exe), Linux (.deb via CI / tarball), macOS (.dmg) |
| Stack | Electron 35, TypeScript, React 18, Vite, Tailwind, Vitest |
| Protocol | IAX2 per RFC 5456, pure TypeScript, interoperates with real Asterisk/app_rpt |
| Audio | G.711 µ-law/A-law, 8 kHz / 20 ms frames, AudioWorklet capture/playback |
| Bridge | app_rpt-style N-1 conference mixer in-app |
| Registration | ASL3 HTTP (`register.allstarlink.org`) with auto-refresh |
| Directory | Full AllStarLink DB (`allmondb`), cached 6 h, grouped by country/US state |
| Network | Outbound-only: DNS, HTTPS, UDP 4569; no inbound ports required |
| Modes | Node (number + secret) and Web Transceiver (callsign + portal password) |
| Signature status | Builds are **not code-signed** (SmartScreen prompt; roadmap item) |
| Not yet supported | Inbound links, codecs beyond G.711, courtesy tones / node ID |
