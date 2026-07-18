# Protocol invariants — DO NOT CHANGE without live-node testing

This file records the hard-won, live-verified protocol behaviors that make
Kerchunk work against real AllStarLink nodes (confirmed working 2026-07-17:
registration, node-number linking, two-way audio, and sustained + repeatable
keying of a live repeater). Every one of these was the root cause of a real
failure at some point. **Changing any of them requires re-testing against a
live repeater — a parrot node is NOT sufficient** (a parrot echoes raw audio
and masks keying/stream-establishment bugs).

## 1. The `!NEWKEY1!` handshake (leg.ts `sendNewkey`)

Send the TEXT frame `!NEWKEY1!` exactly once when a call reaches `up`.

app_rpt puts every new link in "newkey" mode (voice frames = keyed) and starts
`newkeytimer`. If it never receives `!NEWKEY1!` from us, the timer expires, the
link falls back to RADIO_KEY mode and app_rpt **force-unkeys us** ("need to
unkey or we will be stuck keyed up") — after which our audio never keys the far
node again. Symptom when broken: a brief "break-in" on the repeater that dies
after ~1–2 s, then nothing, while a parrot still works.

## 2. ACKs echo the acknowledged frame's timestamp (leg.ts `ack(ts)`)

RFC 5456: an ACK carries the timestamp of the frame it acknowledges. Asterisk
clears its retransmission queue by matching that timestamp — ACKs stamped with
our own clock never clear anything, causing endless retransmit storms
(duplicate TEXT/PING/HANGUP frames).

## 3. ACK/INVAL/VNAK/CALLTOKEN do not consume sequence slots (leg.ts `handle`)

RFC 5456: these frames do not increment sequence counts. Advancing `iseqno` on
a received ACK over-acknowledges; our next reliable frame then claims frames
the peer never sent, and Asterisk discards it and replies VNAK (IAX subclass
18). Symptom when broken: first key-up works, second key-up is silently dead.
Also: never ACK a VNAK or INVAL.

## 4. Media-clock timestamps on voice (leg.ts `sendAudio`)

Voice frame timestamps advance by exactly one frame duration (20 ms) per frame
— monotonic and evenly spaced — regardless of when the mixer actually sends
(timer jitter, multi-frame bursts). Re-sync to wall time only at transmission
start. Wall-clock stamping produces uneven/duplicate timestamps that the far
node's jitter buffer discards. Symptom when broken: repeater keys ~1 s then
drops mid-transmission.

## 5. Full VOICE frame at the start of every transmission (leg.ts `sendAudio`)

A full VOICE frame (re)establishes codec + 32-bit timestamp base; mini frames
are uninterpretable without it. Send one on the first frame, on every PTT
key-up (deterministic via `markKeyStart()` from the UI, with a >300 ms gap as
fallback), and on 16-bit timestamp wrap (~65 s). But NOT mid-transmission —
extra full frames mid-stream look like restarts and break COS latching.

## 6. Call-token handshake (leg.ts `receiveCallToken`)

ASL3 (Asterisk 20+) rejects NEW without call-token support. First NEW carries
an empty CALLTOKEN IE; on the CALLTOKEN reply, reset call-setup counters and
resend NEW echoing the token verbatim.

## 7. Link identity (leg.ts `buildNewIes`)

`USERNAME = "radio"` (matches app_rpt's node-to-node user stanza) and
`CALLING NUMBER = our node number` (validated by the far node against our
registered IP). Sending the node number as USERNAME yields
REJECT "No authority found".

## 8. Never let anything share the audio path's time

- No HTTP fetches during call setup or on the connections-changed path
  (node-info lookups are deferred 4 s after `up`; topology is manual/deferred).
- Renderer: audio-level state updates are throttled (~12/s) and heavy UI
  (topology tree, activity log) is memoized — 50/s re-renders starve mic-frame
  delivery (symptom: tx counter ~0 while keyed, choppy RX).
- RX playback runs in the ring-buffer AudioWorklet (`kerchunk-playback-worklet`)
  — never per-frame `AudioBufferSourceNode`s on the main thread.
- The mixer drains ALL queued frames per tick (`mixTick` multi-slot) because
  `setInterval(20ms)` ticks slower than the 50 fps audio rate.

## 9. Conference send discipline (node.ts `mixTick`)

Only transmit to a peer when some OTHER source is active that tick — never
stream silence back at the only talker (it holds their receiver keyed and
buries real audio; symptom: continuous tx counter while idle, far node never
hears a clean key-up).
