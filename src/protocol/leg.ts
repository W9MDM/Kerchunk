import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import {
  CONTROL_ANSWER,
  CONTROL_RADIO_KEY,
  CONTROL_RADIO_UNKEY,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DTMF,
  FRAME_TYPE_IAX,
  FRAME_TYPE_TEXT,
  FRAME_TYPE_VOICE,
  IAX_ACCEPT,
  IAX_ACK,
  IAX_AUTHREP,
  IAX_AUTHREQ,
  IAX_CALLTOKEN,
  IAX_HANGUP,
  IAX_INVAL,
  IAX_LAGRP,
  IAX_LAGRQ,
  IAX_NEW,
  IAX_PING,
  IAX_PONG,
  IAX_VNAK,
  IAX_REJECT,
  decodeFullFrame,
  decodeMiniFrame,
  encodeFullFrame,
  encodeMiniFrame,
  isFullFrame,
  type FullFrame,
} from './frames.js';
import { CallSession, CallState } from './call.js';
import {
  IE_TYPE_CALLED_NUMBER,
  IE_TYPE_CALLING_NAME,
  IE_TYPE_CALLING_NUMBER,
  IE_TYPE_CALLTOKEN,
  IE_TYPE_CAPABILITY,
  IE_TYPE_CHALLENGE,
  IE_TYPE_FORMAT,
  IE_TYPE_MD5_RESULT,
  IE_TYPE_USERNAME,
  IE_TYPE_VERSION,
  decodeInformationElements,
  encodeInformationElements,
  findInformationElement,
  type InformationElement,
} from './ies.js';

/** IAX2 audio format identifier for G.711 µ-law. */
export const FORMAT_ULAW = 0x04;
const IAX_PROTOCOL_VERSION = 2;

/**
 * app_rpt link-keying handshake (sent as a TEXT frame when the call comes up).
 * Both nodes exchange this; a node that never receives it flips the link out of
 * "voice frames = keyed" mode when its newkeytimer expires — force-unkeying the
 * caller and thereafter requiring RADIO_KEY control frames. Sending it keeps the
 * link permanently in newkey mode, where our voice-presence keying works.
 */
export const NEWKEY1STR = '!NEWKEY1!';

export interface LegOptions {
  /** Call number the owning node assigned to this leg (unique per node socket). */
  localCall: number;
  /** IAX USERNAME IE — the auth identity that must match a user stanza on the peer. */
  username?: string;
  /** CALLING NUMBER IE — our node number, which the peer validates against its IP. */
  callingNumber?: string;
  /** CALLING NAME IE — carries the portal session token in Web Transceiver mode. */
  callingName?: string;
  secret?: string;
  calledNumber?: string;
  /**
   * How PTT is signaled to the far node. 'newkey' (default, node-to-node links):
   * !NEWKEY1! handshake + voice presence keys. 'radiokey' (guest/Web
   * Transceiver): CONTROL RADIO_KEY/UNKEY frames, no NEWKEY handshake — this is
   * what the original applet does.
   */
  keyingMode?: 'newkey' | 'radiokey';
  /** True when this leg represents an inbound call we answer, not one we placed. */
  inbound?: boolean;
}

export interface LegEventMap {
  /** An encoded frame ready to transmit to the peer (the node owns the socket). */
  send: [Buffer];
  /** A G.711 voice payload received from the peer. */
  audio: [Uint8Array];
  dtmf: [string];
  text: [string];
  state: [string];
  up: [];
  hangup: [];
  error: [Error];
}

/**
 * A single IAX2 call leg with no socket of its own. It drives a
 * {@link CallSession} from frames handed to it, emits encoded frames via the
 * `send` event for the owning node to transmit, and emits typed call events. A
 * node holds one leg per connected peer, all multiplexed over a single socket by
 * call number.
 */
export class IaxLeg extends EventEmitter<LegEventMap> {
  readonly localCall: number;
  private remoteCallNumber = 0;
  private oseqno = 0;
  private iseqno = 0;
  private callStartedAt = 0;
  private lastVoiceHigh = -1;
  private lastAudioSentAt = -1;
  private mediaTs = 0;
  private forceFull = false;
  private newkeySent = false;

  private readonly username: string;
  private readonly callingNumber: string;
  private readonly callingName: string;
  private readonly secret: string;
  private readonly calledNumber: string;
  private readonly keyingMode: 'newkey' | 'radiokey';
  private session = new CallSession();

  constructor(options: LegOptions) {
    super();
    this.localCall = options.localCall;
    this.username = options.username ?? '';
    this.callingNumber = options.callingNumber ?? '';
    this.callingName = options.callingName ?? '';
    this.secret = options.secret ?? '';
    this.calledNumber = options.calledNumber ?? '';
    this.keyingMode = options.keyingMode ?? 'newkey';
  }

  get remoteCall(): number {
    return this.remoteCallNumber;
  }

  get callState(): CallState {
    return this.session.currentState;
  }

  get isTerminated(): boolean {
    return this.session.isTerminated;
  }

  /** Originate the outbound call by sending a NEW with the standard IE set. */
  start(): void {
    this.session = new CallSession();
    this.oseqno = 0;
    this.iseqno = 0;
    this.callStartedAt = Date.now();
    this.lastVoiceHigh = -1;
    this.lastAudioSentAt = -1;
    this.mediaTs = 0;
    this.newkeySent = false;

    this.session.dial();
    // An empty CALLTOKEN IE signals call-token support; ASL3 (Asterisk 20+)
    // requires it and rejects a NEW without it. The peer replies with a token we
    // then echo back (see the IAX_CALLTOKEN handler).
    this.sendFull(FRAME_TYPE_IAX, IAX_NEW, this.buildNewIes(Buffer.alloc(0)));
    this.setState('calling');
  }

  /** Build the NEW information-element set, carrying the given call token. */
  private buildNewIes(callToken: Buffer): Buffer {
    const ies: InformationElement[] = [
      { type: IE_TYPE_VERSION, value: IAX_PROTOCOL_VERSION },
      { type: IE_TYPE_CAPABILITY, value: FORMAT_ULAW },
      { type: IE_TYPE_FORMAT, value: FORMAT_ULAW },
    ];
    if (this.calledNumber) {
      ies.push({ type: IE_TYPE_CALLED_NUMBER, value: this.calledNumber });
    }
    if (this.callingNumber) {
      // Our node number; the far node validates it against our registered IP.
      ies.push({ type: IE_TYPE_CALLING_NUMBER, value: this.callingNumber });
    }
    if (this.callingName) {
      // Web Transceiver mode: the portal-issued session token travels here.
      ies.push({ type: IE_TYPE_CALLING_NAME, value: this.callingName });
    }
    if (this.username) {
      // The auth identity — must match a user stanza on the peer (for node-to-node
      // that is the [radio] context, not our node number).
      ies.push({ type: IE_TYPE_USERNAME, value: this.username });
    }
    ies.push({ type: IE_TYPE_CALLTOKEN, value: callToken });
    return encodeInformationElements(ies);
  }

  /** Hand a received datagram (full or mini frame) to this leg. */
  handle(data: Buffer): void {
    if (!isFullFrame(data)) {
      const mini = decodeMiniFrame(data);
      if (mini.payload.length > 0) {
        this.emit('audio', mini.payload);
      }
      return;
    }

    const frame = decodeFullFrame(data);
    if (frame.sourceCall !== 0) {
      this.remoteCallNumber = frame.sourceCall;
    }
    // RFC 5456: ACK, INVAL, VNAK (and the stateless CALLTOKEN response) do NOT
    // consume a sequence slot. Advancing iseqno on them over-acknowledges — our
    // next reliable frame then claims frames the peer never sent, and Asterisk
    // discards it and replies VNAK. Seen live: the peer ACKs our first voice
    // frame, and the next key-up's stream-establishing frame gets dropped.
    const nonSequence =
      frame.frameType === FRAME_TYPE_IAX &&
      (frame.subclass === IAX_ACK ||
        frame.subclass === IAX_INVAL ||
        frame.subclass === IAX_VNAK ||
        frame.subclass === IAX_CALLTOKEN);
    if (!nonSequence) {
      this.iseqno = (frame.oseqno + 1) & 0xff;
    }

    try {
      this.dispatch(frame);
    } catch (error) {
      // Peers can legitimately send frames that race our call state; stay alive.
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Mark that a new local transmission (PTT key-up) is starting; the next voice
   * frame will be a full frame that re-establishes the stream to the peer. */
  markKeyStart(): void {
    this.forceFull = true;
  }

  sendAudio(payload: Buffer | Uint8Array): void {
    if (!this.session.canSendAudio && this.session.currentState !== CallState.Up) {
      return;
    }
    const wall = this.callStartedAt === 0 ? 0 : Date.now() - this.callStartedAt;
    // A long gap since our last voice frame = a fresh transmission (PTT re-key),
    // which needs a new full frame so the peer re-establishes the stream and keys
    // up again. The 300 ms threshold is well above smooth-delivery jitter (tens of
    // ms) but below a human release-and-repress, so it does NOT fire mid-
    // transmission (which would make the stream look like it keeps restarting).
    // A new transmission begins when the app signals a PTT key-up (deterministic)
    // or, as a fallback, when there's been a long gap since our last voice frame.
    const reKey = this.lastAudioSentAt >= 0 && wall - this.lastAudioSentAt > 300;
    const startTx = this.forceFull || reKey;
    this.forceFull = false;
    this.lastAudioSentAt = wall;

    // Media clock: advance the timestamp by exactly one frame per frame so it is
    // monotonic and evenly spaced no matter WHEN the mixer sends (timer jitter, or
    // several frames in one tick). Sync to wall time on the first frame / each
    // key-up so the peer sees the real silence gap. Stamping frames with the wall
    // clock instead gives duplicate/uneven timestamps that wreck the peer's jitter
    // buffer — it drops the audio, and a repeater's COS unkeys after ~1 s.
    const frameMs = Math.max(1, Math.round(payload.length / 8));
    const establish = this.lastVoiceHigh < 0 || startTx;
    if (establish) {
      this.mediaTs = wall;
    } else {
      this.mediaTs += frameMs;
    }
    const timestamp = this.mediaTs;
    const high = Math.floor(timestamp / 0x10000);

    // Full VOICE frame on the first frame, on each key-up, and on 16-bit ts wrap.
    if (establish || high !== this.lastVoiceHigh) {
      this.lastVoiceHigh = high;
      const frame = encodeFullFrame({
        sourceCall: this.localCall,
        destCall: this.remoteCallNumber,
        retransmit: false,
        timestamp,
        oseqno: this.oseqno,
        iseqno: this.iseqno,
        frameType: FRAME_TYPE_VOICE,
        subclass: FORMAT_ULAW,
        payload: Buffer.from(payload),
      });
      this.oseqno = (this.oseqno + 1) & 0xff;
      this.emit('send', frame);
      return;
    }

    this.emit(
      'send',
      encodeMiniFrame({ sourceCall: this.localCall, timestamp: timestamp & 0xffff, payload: Buffer.from(payload) }),
    );
  }

  sendDtmf(digit: string): void {
    this.sendFull(FRAME_TYPE_DTMF, digit.charCodeAt(0), Buffer.alloc(0));
  }

  sendText(text: string): void {
    this.sendFull(FRAME_TYPE_TEXT, 0, Buffer.from(text, 'utf8'));
  }

  hangup(): void {
    if (this.session.isTerminated || this.session.currentState === CallState.Idle) {
      return;
    }
    this.session.hangup();
    this.sendFull(FRAME_TYPE_IAX, IAX_HANGUP, Buffer.from('Normal Clearing'));
    this.setState('hungup');
    this.emit('hangup');
  }

  private dispatch(frame: FullFrame): void {
    switch (frame.frameType) {
      case FRAME_TYPE_VOICE:
        this.ack(frame.timestamp);
        if (frame.payload.length > 0) {
          this.emit('audio', frame.payload);
        }
        return;
      case FRAME_TYPE_TEXT:
        this.ack(frame.timestamp);
        this.emit('text', frame.payload.toString('utf8'));
        return;
      case FRAME_TYPE_DTMF:
        this.ack(frame.timestamp);
        this.emit('dtmf', String.fromCharCode(frame.subclass));
        return;
      case FRAME_TYPE_CONTROL:
        this.handleControl(frame);
        return;
      case FRAME_TYPE_IAX:
        this.handleIax(frame);
        return;
      default:
        this.ack(frame.timestamp);
    }
  }

  private handleControl(frame: FullFrame): void {
    this.ack(frame.timestamp);
    // A retransmitted ANSWER is just re-ACKed; only the first one changes state.
    if (frame.subclass === CONTROL_ANSWER && this.session.currentState !== CallState.Up) {
      if (this.session.canSendAudio) {
        this.session.answer();
      }
      this.setState('up');
      this.emit('up');
      this.sendNewkey();
    }
  }

  /** app_rpt newkey handshake: sent once when the call comes up so the far node
   * keeps the link in "voice frames = keyed" mode instead of force-unkeying us
   * when its newkeytimer expires. Node links only — guest/Web Transceiver
   * connections key with RADIO_KEY controls instead. */
  private sendNewkey(): void {
    if (this.keyingMode !== 'newkey' || this.newkeySent) {
      return;
    }
    this.newkeySent = true;
    this.sendText(NEWKEY1STR);
  }

  /** Guest/Web Transceiver PTT press: signal keying with a RADIO_KEY control
   * frame (what the original applet sends). No-op on node (newkey) links. */
  keyRadio(): void {
    if (this.keyingMode === 'radiokey') {
      this.sendFull(FRAME_TYPE_CONTROL, CONTROL_RADIO_KEY, Buffer.alloc(0));
    }
  }

  /** Guest/Web Transceiver PTT release: RADIO_UNKEY. No-op on node links. */
  unkeyRadio(): void {
    if (this.keyingMode === 'radiokey') {
      this.sendFull(FRAME_TYPE_CONTROL, CONTROL_RADIO_UNKEY, Buffer.alloc(0));
    }
  }

  private handleIax(frame: FullFrame): void {
    const ies = decodeInformationElements(frame.payload);
    switch (frame.subclass) {
      case IAX_NEW:
        this.receiveNew(frame.timestamp);
        return;
      case IAX_ACCEPT:
        this.ack(frame.timestamp);
        this.session.accept();
        this.setState('accepted');
        return;
      case IAX_HANGUP:
        this.ack(frame.timestamp);
        if (!this.session.isTerminated) {
          this.session.hangup();
        }
        this.setState('hungup');
        this.emit('hangup');
        return;
      case IAX_REJECT:
        this.ack(frame.timestamp);
        if (!this.session.isTerminated) {
          this.session.reject();
        }
        this.setState('rejected');
        this.emit('hangup');
        return;
      case IAX_PING:
        this.sendFull(FRAME_TYPE_IAX, IAX_PONG, Buffer.alloc(0));
        return;
      case IAX_LAGRQ:
        // Lag request — echo back a lag reply so the peer can measure the link.
        this.sendFull(FRAME_TYPE_IAX, IAX_LAGRP, Buffer.alloc(0));
        return;
      case IAX_PONG:
      case IAX_LAGRP:
      case IAX_ACK:
        return;
      case IAX_VNAK:
      case IAX_INVAL:
        // Sequence/validity complaints — never ACK these (RFC 5456).
        return;
      case IAX_AUTHREQ:
        this.receiveAuthReq(ies, frame.timestamp);
        return;
      case IAX_CALLTOKEN:
        this.receiveCallToken(ies);
        return;
      default:
        this.ack(frame.timestamp);
    }
  }

  /**
   * The peer issued an anti-spoofing call token (no call is set up yet). Resend
   * the NEW carrying the token; the call is allocated only after this.
   */
  private receiveCallToken(ies: InformationElement[]): void {
    const tokenIe = findInformationElement(ies, IE_TYPE_CALLTOKEN);
    const token = Buffer.isBuffer(tokenIe?.value)
      ? tokenIe.value
      : typeof tokenIe?.value === 'string'
        ? Buffer.from(tokenIe.value, 'binary')
        : Buffer.alloc(0);

    // The token exchange is stateless — no call number is allocated yet, so reset
    // the setup counters and resend NEW as if fresh, now carrying the token.
    this.remoteCallNumber = 0;
    this.oseqno = 0;
    this.iseqno = 0;
    this.sendFull(FRAME_TYPE_IAX, IAX_NEW, this.buildNewIes(token));
    this.setState('calling');
  }

  /** Auto-answer an inbound call (a node accepts links). */
  private receiveNew(timestamp: number): void {
    this.session.incoming();
    this.setState('ringing');

    this.ack(timestamp);
    this.sendFull(
      FRAME_TYPE_IAX,
      IAX_ACCEPT,
      encodeInformationElements([{ type: IE_TYPE_FORMAT, value: FORMAT_ULAW }]),
    );
    this.session.accept();
    this.setState('accepted');

    this.sendFull(FRAME_TYPE_CONTROL, CONTROL_ANSWER, Buffer.alloc(0));
    this.session.answer();
    this.setState('up');
    this.emit('up');
    this.sendNewkey();
  }

  private receiveAuthReq(ies: InformationElement[], timestamp: number): void {
    this.ack(timestamp);
    const challenge = findInformationElement(ies, IE_TYPE_CHALLENGE);
    const challengeText = typeof challenge?.value === 'string' ? challenge.value : '';
    const md5 = createHash('md5').update(challengeText + this.secret).digest('hex');
    this.sendFull(
      FRAME_TYPE_IAX,
      IAX_AUTHREP,
      encodeInformationElements([{ type: IE_TYPE_MD5_RESULT, value: md5 }]),
    );
    this.setState('authenticating');
  }

  /** ACK a received reliable frame. RFC 5456: the ACK MUST echo the timestamp of
   * the frame it acknowledges — Asterisk matches pending retransmits by that
   * timestamp, so an ACK stamped with our own clock never clears its queue and
   * the peer retransmits everything (the duplicate TEXT/PING storms in traces). */
  private ack(timestamp: number): void {
    this.sendFull(FRAME_TYPE_IAX, IAX_ACK, Buffer.alloc(0), false, timestamp);
  }

  private sendFull(
    frameType: number,
    subclass: number,
    payload: Buffer,
    reliable = true,
    timestampOverride?: number,
  ): void {
    const timestamp =
      timestampOverride ?? (this.callStartedAt === 0 ? 0 : Date.now() - this.callStartedAt);
    const frame = encodeFullFrame({
      sourceCall: this.localCall,
      destCall: this.remoteCallNumber,
      retransmit: false,
      timestamp,
      oseqno: this.oseqno,
      iseqno: this.iseqno,
      frameType,
      subclass,
      payload,
    });
    if (reliable) {
      this.oseqno = (this.oseqno + 1) & 0xff;
    }
    this.emit('send', frame);
  }

  private setState(state: string): void {
    this.emit('state', state);
  }
}
