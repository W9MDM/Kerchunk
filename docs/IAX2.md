# IAX2 implementation notes

This document tracks the IAX2 protocol core. The initial wire-format code is now in place under `src/protocol`; the sections below note what is implemented and what remains.

## Frame types

- Full frames covering header fields, payloads, and control messages.
- Mini frames used for voice transport.
- Text and DTMF frames for control signaling.

## Information elements

The first implementation will cover the core set required for registration and call setup: CALLED NUMBER, CALLING NUMBER, CALLING NAME, USERNAME, PASSWORD, CHALLENGE, MD5 RESULT, FORMAT, CAPABILITY, VERSION, REFRESH, APPARENT ADDR, CAUSE, and DATETIME.

## State transitions

- Registration flow: REGREQ, REGAUTH, REGACK, and REGREJ. MD5 challenge/response
  registration is implemented (`md5(challenge + secret)`).
- Call flow: NEW, ACCEPT, ANSWER, ACK, HANGUP, REJECT, PING, and PONG are handled;
  the client auto-answers inbound NEW (ACCEPT + ANSWER) to model a node that
  accepts links. INVAL and VNAK are not yet acted on.
- Voice flow: mini-frame exchange for 20 ms G.711 frames; full VOICE frames are
  accepted on receive.

## Implemented vs. planned

Implemented: full/mini frame codecs (F-bit discrimination), the IE set above,
the call-control state machine, MD5 registration, voice/text/DTMF, and per-frame
ACKs with basic sequence-number tracking.

Not yet implemented / known simplifications:

- No retransmission or full sequence-number recovery; ACKs are sent but not
  awaited.
- The FORMAT information element is encoded as a single byte rather than the
  32-bit bitfield; sufficient for the current loopback and G.711-only path, to be
  widened during real format negotiation.
- Call-number matching between peers is permissive (not strictly validated).
