import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import {
  CONTROL_ANSWER,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DTMF,
  FRAME_TYPE_IAX,
  FRAME_TYPE_TEXT,
  FRAME_TYPE_VOICE,
  IAX_ACCEPT,
  IAX_ACK,
  IAX_AUTHREP,
  IAX_AUTHREQ,
  IAX_HANGUP,
  IAX_NEW,
  IAX_PING,
  IAX_PONG,
  IAX_REGACK,
  IAX_REGAUTH,
  IAX_REGREJ,
  IAX_REGREQ,
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
  IE_TYPE_CAPABILITY,
  IE_TYPE_CHALLENGE,
  IE_TYPE_FORMAT,
  IE_TYPE_MD5_RESULT,
  IE_TYPE_REFRESH,
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
const DEFAULT_PORT = 4569;

export interface IaxClientOptions {
  port?: number;
}

export interface ConnectOptions {
  host: string;
  port?: number;
  username?: string;
  calledNumber?: string;
  /** Shared secret for a node's [iaxrpt]-style user; drives call-time MD5 auth. */
  secret?: string;
}

export interface RegisterOptions {
  host: string;
  port?: number;
  username: string;
  secret?: string;
  refresh?: number;
}

export interface AudioEvent {
  frame: Uint8Array;
}

export interface ClientEventMap {
  audio: [AudioEvent];
  state: [string];
  callState: [CallState];
  text: [string];
  dtmf: [string];
  registered: [];
  error: [Error];
}

/**
 * A minimal but functional IAX2 client. It owns a single UDP socket and a
 * single active call leg, drives a {@link CallSession} from received frames,
 * acknowledges reliable full frames, and emits typed events. It is pure Node —
 * no Electron dependency — so it is fully exercisable from Vitest.
 */
export class IaxClient extends EventEmitter<ClientEventMap> {
  private readonly socket: Socket;
  private readonly boundPort: number;
  private peerHost = '127.0.0.1';
  private peerPort = DEFAULT_PORT;

  private session = new CallSession();
  private localCall = 0;
  private remoteCall = 0;
  private oseqno = 0;
  private iseqno = 0;
  private callStartedAt = 0;

  private username = '';
  private secret = '';
  private refresh = 60;

  constructor(options: IaxClientOptions = {}) {
    super();
    this.boundPort = options.port ?? DEFAULT_PORT;
    this.socket = createSocket('udp4');
    this.socket.on('message', (data, rinfo) => this.handleMessage(data, rinfo));
    this.socket.on('error', (error) => this.emit('error', error));
    void this.socket.bind(this.boundPort);
  }

  get callState(): CallState {
    return this.session.currentState;
  }

  /** Originate an outbound call, sending a NEW with the standard IE set. */
  async connect(options: ConnectOptions): Promise<void> {
    this.peerHost = options.host;
    this.peerPort = options.port ?? DEFAULT_PORT;
    this.session = new CallSession();
    this.localCall = 1;
    this.remoteCall = 0;
    this.oseqno = 0;
    this.iseqno = 0;
    this.callStartedAt = Date.now();
    this.username = options.username ?? '';
    this.secret = options.secret ?? '';

    const ies: InformationElement[] = [
      { type: IE_TYPE_VERSION, value: IAX_PROTOCOL_VERSION },
      { type: IE_TYPE_CAPABILITY, value: FORMAT_ULAW },
      { type: IE_TYPE_FORMAT, value: FORMAT_ULAW },
    ];
    if (options.calledNumber) {
      ies.push({ type: IE_TYPE_CALLED_NUMBER, value: options.calledNumber });
    }
    if (options.username) {
      ies.push({ type: IE_TYPE_USERNAME, value: options.username });
    }

    this.session.dial();
    this.sendFull(FRAME_TYPE_IAX, IAX_NEW, encodeInformationElements(ies));
    this.setState('calling');
  }

  /** Begin a registration handshake (REGREQ → REGAUTH → REGREQ+MD5 → REGACK). */
  async register(options: RegisterOptions): Promise<void> {
    this.peerHost = options.host;
    this.peerPort = options.port ?? DEFAULT_PORT;
    this.localCall = 1;
    this.remoteCall = 0;
    this.oseqno = 0;
    this.iseqno = 0;
    this.callStartedAt = Date.now();
    this.username = options.username;
    this.secret = options.secret ?? '';
    this.refresh = options.refresh ?? 60;

    this.sendFull(FRAME_TYPE_IAX, IAX_REGREQ, this.encodeRegistrationRequest());
    this.setState('registering');
  }

  async hangup(): Promise<void> {
    if (this.session.isTerminated || this.session.currentState === CallState.Idle) {
      return;
    }
    this.session.hangup();
    this.sendFull(FRAME_TYPE_IAX, IAX_HANGUP, Buffer.from('Normal Clearing'));
    this.emitCallState();
    this.setState('hungup');
  }

  sendText(text: string): void {
    this.sendFull(FRAME_TYPE_TEXT, 0, Buffer.from(text, 'utf8'));
  }

  sendDtmf(digit: string): void {
    const subclass = digit.charCodeAt(0);
    this.sendFull(FRAME_TYPE_DTMF, subclass, Buffer.alloc(0));
  }

  /** Send a 20 ms voice payload as a mini frame. */
  sendAudio(frame: Buffer | Uint8Array): void {
    const timestamp = this.callStartedAt === 0 ? 0 : Date.now() - this.callStartedAt;
    this.send(encodeMiniFrame({ sourceCall: this.localCall, timestamp, payload: Buffer.from(frame) }));
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.once('close', () => resolve());
      try {
        this.socket.close();
      } catch {
        resolve();
      }
    });
  }

  private encodeRegistrationRequest(md5?: string): Buffer {
    const ies: InformationElement[] = [
      { type: IE_TYPE_USERNAME, value: this.username },
      { type: IE_TYPE_REFRESH, value: this.refresh },
    ];
    if (md5) {
      ies.push({ type: IE_TYPE_MD5_RESULT, value: md5 });
    }
    return encodeInformationElements(ies);
  }

  private handleMessage(data: Buffer, rinfo: RemoteInfo): void {
    this.peerHost = rinfo.address;
    this.peerPort = rinfo.port;

    if (!isFullFrame(data)) {
      const mini = decodeMiniFrame(data);
      if (mini.payload.length > 0) {
        this.emit('audio', { frame: mini.payload });
      }
      return;
    }

    const frame = decodeFullFrame(data);
    if (frame.sourceCall !== 0) {
      this.remoteCall = frame.sourceCall;
    }
    this.iseqno = (frame.oseqno + 1) & 0xff;

    try {
      this.dispatchFullFrame(frame);
    } catch (error) {
      // A protocol peer can legitimately send frames that don't fit our current
      // call state (races, retransmits). Surface it but stay alive.
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private dispatchFullFrame(frame: FullFrame): void {
    switch (frame.frameType) {
      case FRAME_TYPE_VOICE:
        this.ack();
        if (frame.payload.length > 0) {
          this.emit('audio', { frame: frame.payload });
        }
        return;
      case FRAME_TYPE_TEXT:
        this.ack();
        this.emit('text', frame.payload.toString('utf8'));
        return;
      case FRAME_TYPE_DTMF:
        this.ack();
        this.emit('dtmf', String.fromCharCode(frame.subclass));
        return;
      case FRAME_TYPE_CONTROL:
        this.handleControl(frame);
        return;
      case FRAME_TYPE_IAX:
        this.handleIax(frame);
        return;
      default:
        this.ack();
    }
  }

  private handleControl(frame: FullFrame): void {
    if (frame.subclass === CONTROL_ANSWER) {
      this.ack();
      if (this.session.canSendAudio) {
        this.session.answer();
      }
      this.emitCallState();
      this.setState('up');
    } else {
      this.ack();
    }
  }

  private handleIax(frame: FullFrame): void {
    const ies = decodeInformationElements(frame.payload);
    switch (frame.subclass) {
      case IAX_NEW:
        this.receiveNew();
        return;
      case IAX_ACCEPT:
        this.ack();
        this.session.accept();
        this.emitCallState();
        this.setState('accepted');
        return;
      case IAX_HANGUP:
        this.ack();
        if (!this.session.isTerminated) {
          this.session.hangup();
        }
        this.emitCallState();
        this.setState('hungup');
        return;
      case IAX_REJECT:
        this.ack();
        if (!this.session.isTerminated) {
          this.session.reject();
        }
        this.emitCallState();
        this.setState('rejected');
        return;
      case IAX_PING:
        this.sendFull(FRAME_TYPE_IAX, IAX_PONG, Buffer.alloc(0));
        return;
      case IAX_PONG:
      case IAX_ACK:
        return;
      case IAX_AUTHREQ:
        this.receiveAuthReq(ies);
        return;
      case IAX_REGAUTH:
        this.receiveRegAuth(ies);
        return;
      case IAX_REGACK:
        this.ack();
        this.emit('registered');
        this.setState('registered');
        return;
      case IAX_REGREJ:
        this.ack();
        this.setState('register-rejected');
        return;
      default:
        this.ack();
    }
  }

  private receiveNew(): void {
    // Auto-answer inbound calls: this client models a node that accepts links.
    this.session.incoming();
    this.emitCallState();
    this.setState('ringing');

    this.ack();
    this.sendFull(FRAME_TYPE_IAX, IAX_ACCEPT, encodeInformationElements([{ type: IE_TYPE_FORMAT, value: FORMAT_ULAW }]));
    this.session.accept();
    this.emitCallState();
    this.setState('accepted');

    this.sendFull(FRAME_TYPE_CONTROL, CONTROL_ANSWER, Buffer.alloc(0));
    this.session.answer();
    this.emitCallState();
    this.setState('up');
  }

  private receiveAuthReq(ies: InformationElement[]): void {
    // A secured node challenges an outbound call before accepting it. Answer the
    // MD5 method the same way registration does: md5(challenge + secret).
    this.ack();
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

  private receiveRegAuth(ies: InformationElement[]): void {
    this.ack();
    const challenge = findInformationElement(ies, IE_TYPE_CHALLENGE);
    const challengeText = typeof challenge?.value === 'string' ? challenge.value : '';
    const md5 = createHash('md5').update(challengeText + this.secret).digest('hex');
    this.sendFull(FRAME_TYPE_IAX, IAX_REGREQ, this.encodeRegistrationRequest(md5));
  }

  private ack(): void {
    this.sendFull(FRAME_TYPE_IAX, IAX_ACK, Buffer.alloc(0), false);
  }

  private sendFull(frameType: number, subclass: number, payload: Buffer, reliable = true): void {
    const timestamp = this.callStartedAt === 0 ? 0 : Date.now() - this.callStartedAt;
    const frame = encodeFullFrame({
      sourceCall: this.localCall,
      destCall: this.remoteCall,
      retransmit: false,
      timestamp,
      oseqno: this.oseqno,
      iseqno: this.iseqno,
      frameType,
      subclass,
      payload,
    });
    // ACKs do not consume an outbound sequence number.
    if (reliable) {
      this.oseqno = (this.oseqno + 1) & 0xff;
    }
    this.send(frame);
  }

  private send(data: Buffer): void {
    this.socket.send(data, this.peerPort, this.peerHost);
  }

  private emitCallState(): void {
    this.emit('callState', this.session.currentState);
  }

  private setState(state: string): void {
    this.emit('state', state);
  }
}
