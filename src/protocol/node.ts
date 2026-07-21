import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import {
  FRAME_TYPE_IAX,
  IAX_ACK,
  IAX_INVAL,
  IAX_NEW,
  decodeFullFrame,
  decodeMiniFrame,
  encodeFullFrame,
  isFullFrame,
} from './frames.js';
import { decodeInformationElements } from './ies.js';
import { IaxLeg } from './leg.js';
import { mixMinusOne, type MixInput } from './mixer.js';
import { DEFAULT_IAX_PORT, resolveNode, type ResolvedNode } from './resolver.js';
import { registerNode, type RegistrationResult } from './registration.js';
import { DEFAULT_STATPOST_URL, buildKeyedUrl, buildStatusUrl, sendStatpost, type LinkState } from './stats.js';
import { fetchNodeInfo, fetchNodeStats, type NodeInfo } from './nodeinfo.js';

export type MdcTiming = 'start' | 'end' | 'both';
export interface MdcConfig {
  enabled: boolean;
  unitId: number;
  timing: MdcTiming;
  /** Burst amplitude 0..1 (operator-adjustable level). */
  level: number;
  /** Preamble length in 0x55 bytes (operator-adjustable). */
  preambleBytes: number;
  /** Injected MDC1200 burst encoder (kept out of the protocol layer). */
  encode?: (unitId: number, amplitude: number, preambleBytes: number) => Int16Array;
}

const FRAME_TYPE_NAMES: Record<number, string> = {
  1: 'DTMF',
  2: 'VOICE',
  3: 'VIDEO',
  4: 'CONTROL',
  5: 'NULL',
  6: 'IAX',
  7: 'TEXT',
  8: 'IMAGE',
  9: 'HTML',
  10: 'CNG',
};

const IAX_SUBCLASS_NAMES: Record<number, string> = {
  1: 'NEW',
  2: 'PING',
  3: 'PONG',
  4: 'ACK',
  5: 'HANGUP',
  6: 'REJECT',
  7: 'ACCEPT',
  8: 'AUTHREQ',
  9: 'AUTHREP',
  10: 'INVAL',
  11: 'LAGRQ',
  12: 'LAGRP',
  13: 'REGREQ',
  14: 'REGAUTH',
  15: 'REGACK',
  16: 'REGREJ',
  40: 'CALLTOKEN',
};

const CONTROL_SUBCLASS_NAMES: Record<number, string> = { 3: 'RINGING', 4: 'ANSWER', 5: 'BUSY' };

const IE_NAMES: Record<number, string> = {
  1: 'called',
  2: 'calling',
  3: 'ani',
  4: 'callingname',
  5: 'context',
  6: 'username',
  7: 'password',
  8: 'capability',
  9: 'format',
  10: 'language',
  11: 'version',
  14: 'authmethods',
  15: 'challenge',
  16: 'md5',
  17: 'rsa',
  18: 'apparentaddr',
  19: 'refresh',
  22: 'cause',
  31: 'datetime',
  42: 'causecode',
  54: 'calltoken',
};

/** Decode the information elements of a signaling frame into a readable string. */
function describeIes(payload: Buffer): string {
  try {
    const ies = decodeInformationElements(payload);
    if (ies.length === 0) {
      return '';
    }
    const parts = ies.map((ie) => {
      const name = IE_NAMES[ie.type] ?? `ie${ie.type}`;
      let value: string | number;
      if (Buffer.isBuffer(ie.value)) {
        value = `<${ie.value.length}B>`;
      } else if (typeof ie.value === 'string') {
        value = JSON.stringify(ie.value);
      } else {
        value = ie.value;
      }
      return `${name}=${value}`;
    });
    return ` {${parts.join(', ')}}`;
  } catch {
    return '';
  }
}

/** Short human-readable summary of a full frame for tracing. */
function describeFullFrame(data: Buffer): string {
  const frame = decodeFullFrame(data);
  const type = FRAME_TYPE_NAMES[frame.frameType] ?? `type${frame.frameType}`;
  let sub = String(frame.subclass);
  if (frame.frameType === FRAME_TYPE_IAX) {
    sub = IAX_SUBCLASS_NAMES[frame.subclass] ?? `sub${frame.subclass}`;
  } else if (frame.frameType === 4) {
    sub = CONTROL_SUBCLASS_NAMES[frame.subclass] ?? `sub${frame.subclass}`;
  }
  const ies = frame.frameType === FRAME_TYPE_IAX ? describeIes(frame.payload) : '';
  return `${type}/${sub} src=${frame.sourceCall} dst=${frame.destCall}${ies}`;
}

/** G.711 (or any) codec seam so this module stays pure and testable. */
export interface AudioCodec {
  decode(payload: Uint8Array): Int16Array;
  encode(samples: Int16Array): Uint8Array;
}

export interface NodeOptions {
  /** Our own AllStarLink node number, presented to peers on outbound links. */
  nodeNumber?: string;
  /** Secret used for call-time auth when a peer challenges us. */
  secret?: string;
  /** UDP port to bind (a real node uses 4569). */
  port?: number;
  /** Audio codec for mixing (decode wire payloads to PCM and back). */
  codec: AudioCodec;
  /** Samples per 20 ms frame (8 kHz => 160). */
  frameSize?: number;
  /** Injectable node-number resolver (defaults to AllStarLink DNS). */
  resolve?: (nodeNumber: string) => Promise<ResolvedNode>;
  /** Injectable fetch for HTTP registration (defaults to the global fetch). */
  fetchImpl?: typeof fetch;
  /** Emit per-frame `state` trace lines for signaling frames (debugging). */
  debug?: boolean;
  /**
   * IAX USERNAME presented on outbound links. AllStar's node-to-node inbound
   * context is the `[radio]` user stanza, so this defaults to "radio"; our own
   * node number goes in the CALLING NUMBER IE instead.
   */
  linkUsername?: string;
  /** Report node status to stats.allstarlink.org. Defaults to true. */
  reportStats?: boolean;
  /** Override the statpost endpoint. */
  statpostUrl?: string;
  /** Version string reported as apprptvers. */
  appVersion?: string;
}

const STATS_INTERVAL_MS = 30_000; // app_rpt LINKPOSTTIME / KEYPOSTTIME

export interface ConnectionInfo {
  localCall: number;
  label: string;
  host: string;
  port: number;
  state: string;
  /** True once the call handshake completed (peer answered); false while calling. */
  up: boolean;
  callsign?: string;
  location?: string;
  description?: string;
  frequency?: string;
  tone?: string;
  /** Receive-only link (app_rpt monitor): we hear it but don't transmit to it. */
  monitor?: boolean;
  /** True when this link has carried audio in the last ~1.5 s. */
  keyed?: boolean;
  /** Epoch ms of the last audio frame received on this link (0 if never). */
  lastKeyedAt?: number;
}

export interface TopologyTreeNode {
  node: string;
  callsign?: string;
  location?: string;
  description?: string;
  frequency?: string;
  tone?: string;
  keyed?: boolean;
  isSelf?: boolean;
  truncated?: boolean;
  children: TopologyTreeNode[];
}

export interface NodeTopology {
  root: TopologyTreeNode;
}

export interface NodeEventMap {
  /** Mixed audio for the local speaker (everyone the operator should hear). */
  localAudio: [Uint8Array];
  /** The current connection list changed. */
  connections: [ConnectionInfo[]];
  /** Human-readable status/log line. */
  state: [string];
  /** DTMF received from a connected peer. */
  dtmf: [string];
  /** The result of a registration attempt. */
  registration: [RegistrationResult];
  error: [Error];
}

interface Connection {
  leg: IaxLeg;
  host: string;
  port: number;
  label: string;
  state: string;
  up: boolean;
  rxQueue: Int16Array[];
  info: NodeInfo | null;
  /** Receive-only: don't transmit our audio to this leg. */
  monitor: boolean;
  /** Epoch ms of the last audio frame we received from this leg. */
  lastRxAt: number;
  /** Fires if the peer never answers; cleared once the call comes up. */
  setupTimer?: ReturnType<typeof setTimeout>;
}

/** How long to wait for a peer to answer before giving up on an outbound call. */
const CALL_SETUP_TIMEOUT_MS = 15000;

const MIX_INTERVAL_MS = 20;

// High-frequency frames that should not appear in the signaling trace.
const NOISY_IAX_SUBCLASSES = new Set([2, 3, 4, 11, 12, 18]); // ping, pong, ack, lagrq, lagrp, vnak
const MEDIA_FRAME_TYPES = new Set([5, 7]); // null, text — always filtered
const FRAME_TYPE_VOICE_ID = 2;

/**
 * A self-contained AllStarLink-style node. It owns one UDP socket, demultiplexes
 * incoming frames to per-peer {@link IaxLeg}s by call number, and runs an
 * app_rpt-style conference bridge: audio from every connected peer plus the local
 * port (the operator's mic) is N-1 mixed and distributed each 20 ms.
 *
 * Outbound linking is wired now; the socket and routing are structured so that
 * accepting inbound links is a later addition ({@link setInboundEnabled}).
 */
export class KerchunkNode extends EventEmitter<NodeEventMap> {
  private socket: Socket;
  private reboundEphemeral = false;
  private silent: Int16Array | null = null;
  private readonly boundPort: number;
  private readonly codec: AudioCodec;
  private readonly frameSize: number;
  private nodeNumber: string;
  private secret: string;
  private readonly resolveNodeNumber: (nodeNumber: string) => Promise<ResolvedNode>;
  private readonly fetchImpl?: typeof fetch;
  private debug: boolean;
  private readonly linkUsername: string;

  private registrationPassword = '';
  private registrationTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly byLocalCall = new Map<number, Connection>();
  private readonly byRemoteCall = new Map<number, Connection>();
  private readonly nodeInfoCache = new Map<string, NodeInfo>();
  private nextCall = 1;

  private readonly localQueue: Int16Array[] = [];
  private mixTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private txVoiceCount = 0;
  private rxVoiceCount = 0;
  private loggedTxVoice = false;
  private loggedRxVoice = false;
  private inboundEnabled = false;

  // MDC1200 PTT-ID transmit: config + a real-time burst playout queue (one
  // 20 ms frame per mix tick so the burst goes out at the correct baud).
  private mdc: MdcConfig = { enabled: false, unitId: 0, timing: 'start', level: 0.12, preambleBytes: 24 };
  private mdcTxFrames: Int16Array[] = [];

  // Stats reporting (app_rpt statpost).
  private readonly reportStats: boolean;
  private readonly statpostUrl: string;
  private readonly appVersion: string;
  private readonly startedAt = Date.now();
  private statSeqno = 0;
  private statPostTimer: ReturnType<typeof setInterval> | null = null;
  private keyed = false;
  private lastKeyedAt = 0;
  private totalKeyups = 0;
  private totalTxTimeMs = 0;

  constructor(options: NodeOptions) {
    super();
    this.boundPort = options.port ?? DEFAULT_IAX_PORT;
    this.codec = options.codec;
    this.frameSize = options.frameSize ?? 160;
    this.nodeNumber = options.nodeNumber ?? '';
    this.secret = options.secret ?? '';
    this.resolveNodeNumber = options.resolve ?? ((node) => resolveNode(node));
    this.fetchImpl = options.fetchImpl;
    this.debug = options.debug ?? false;
    this.linkUsername = options.linkUsername ?? 'radio';
    this.reportStats = options.reportStats ?? true;
    this.statpostUrl = options.statpostUrl ?? DEFAULT_STATPOST_URL;
    this.appVersion = options.appVersion ?? '0.9.10';

    this.socket = this.createBoundSocket(this.boundPort);
  }

  private createBoundSocket(port: number): Socket {
    const socket = createSocket('udp4');
    socket.on('message', (data, rinfo) => this.route(data, rinfo));
    socket.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      // Outbound linking works from any local port; if 4569 is taken (another
      // node, a stale instance), fall back to an ephemeral port rather than die.
      if (code === 'EADDRINUSE' && !this.reboundEphemeral) {
        this.reboundEphemeral = true;
        this.emit('state', `UDP ${port} in use — binding an ephemeral port (outbound only)`);
        try {
          socket.close();
        } catch {
          // already closed
        }
        this.socket = this.createBoundSocket(0);
        return;
      }
      this.emit('error', error);
    });
    socket.bind(port);
    return socket;
  }

  /** Start the conference mixing clock. Idempotent. */
  start(): void {
    if (this.mixTimer) {
      return;
    }
    this.mixTimer = setInterval(() => this.mixTick(), MIX_INTERVAL_MS);
    // Periodic audio-flow diagnostics (only surfaced when tracing is on).
    this.statsTimer = setInterval(() => {
      if (this.debug && (this.txVoiceCount > 0 || this.rxVoiceCount > 0)) {
        this.emit('state', `audio: tx ${this.txVoiceCount} rx ${this.rxVoiceCount} frames/2s`);
      }
      this.txVoiceCount = 0;
      this.rxVoiceCount = 0;
    }, 2000);
    // Report node status to AllStarLink so the stats site shows us reporting.
    this.statPostTimer = setInterval(() => {
      void this.postStatus();
      void this.postKeyed();
    }, STATS_INTERVAL_MS);
  }

  private async postStatus(): Promise<void> {
    if (!this.reportStats || !this.nodeNumber) {
      return;
    }
    const nodes = [...this.byLocalCall.values()].map((c) => ({
      state: (c.up ? 'T' : 'C') as LinkState,
      node: c.label,
    }));
    const url = buildStatusUrl(this.statpostUrl, {
      node: this.nodeNumber,
      seqno: ++this.statSeqno,
      timeSec: Math.floor(Date.now() / 1000),
      nodes,
      version: this.appVersion,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      totalKerchunks: 0,
      totalKeyups: this.totalKeyups,
      totalTxTimeSec: Math.floor(this.totalTxTimeMs / 1000),
      timeouts: 0,
      totalExecdCommands: 0,
    });
    await sendStatpost(url, this.fetchImpl);
  }

  private async postKeyed(): Promise<void> {
    if (!this.reportStats || !this.nodeNumber) {
      return;
    }
    const keyTimeSec = this.lastKeyedAt ? Math.floor((Date.now() - this.lastKeyedAt) / 1000) : 0;
    const url = buildKeyedUrl(this.statpostUrl, {
      node: this.nodeNumber,
      seqno: ++this.statSeqno,
      timeSec: Math.floor(Date.now() / 1000),
      keyed: this.keyed,
      keyTimeSec,
    });
    await sendStatpost(url, this.fetchImpl);
  }

  /** Reserved for a future inbound-link phase (accepting NEW with destCall 0). */
  setInboundEnabled(enabled: boolean): void {
    this.inboundEnabled = enabled;
  }

  /** Toggle per-frame signaling trace output. */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
    this.emit('state', `frame tracing ${enabled ? 'on' : 'off'}`);
  }

  /** Update our node identity (used for outbound username and registration). */
  setIdentity(nodeNumber?: string, secret?: string): void {
    if (nodeNumber !== undefined && nodeNumber !== '') {
      this.nodeNumber = nodeNumber;
    }
    if (secret !== undefined && secret !== '') {
      this.secret = secret;
    }
  }

  /**
   * Register this node with AllStarLink over HTTP so peers accept our links, then
   * keep the registration fresh on the interval the registrar asks for.
   */
  async register(password?: string): Promise<RegistrationResult> {
    if (!this.nodeNumber) {
      throw new Error('Set your node number before registering.');
    }
    this.registrationPassword = password ?? this.secret;
    return this.performRegistration();
  }

  private async performRegistration(): Promise<RegistrationResult> {
    this.emit('state', `registering node ${this.nodeNumber}…`);
    const result = await registerNode(this.nodeNumber, this.registrationPassword, {
      advertisePort: this.boundPort,
      fetchImpl: this.fetchImpl,
    });
    if (result.success) {
      this.emit('state', `registered ${this.nodeNumber} @ ${result.ipaddr ?? '?'} (refresh ${result.refresh}s)`);
    } else {
      this.emit('state', `registration failed for ${this.nodeNumber}: ${result.message ?? 'unknown'}`);
    }
    this.emit('registration', result);

    if (this.registrationTimer) {
      clearTimeout(this.registrationTimer);
    }
    const refreshMs = Math.max(30, result.refresh) * 1000;
    this.registrationTimer = setTimeout(() => {
      void this.performRegistration().catch((error) =>
        this.emit('error', error instanceof Error ? error : new Error(String(error))),
      );
    }, refreshMs);

    return result;
  }

  /** Every node currently reachable through our links (direct + downstream). */
  private async reachableNodes(): Promise<Set<string>> {
    const set = new Set<string>();
    for (const c of this.byLocalCall.values()) {
      if (/^[0-9]+$/.test(c.label)) set.add(c.label);
    }
    if (this.byLocalCall.size === 0) return set; // nothing linked → no loop possible
    const topo = await this.getTopology();
    const walk = (node: TopologyTreeNode) => {
      for (const child of node.children) {
        if (!child.isSelf) set.add(child.node);
        walk(child);
      }
    };
    walk(topo.root);
    return set;
  }

  /** True if a node is already linked or reachable downstream (loop risk). */
  async isNodeInNetwork(nodeNumber: string): Promise<boolean> {
    return (await this.reachableNodes()).has(nodeNumber);
  }

  /** Link to another node by number, resolving it to an address via DNS.
   * Refuses if the node is already reachable in our network (loop prevention). */
  async connectToNode(nodeNumber: string, options?: { monitor?: boolean }): Promise<void> {
    if (await this.isNodeInNetwork(nodeNumber)) {
      this.emit('state', `${nodeNumber} is already in your network — not linking (loop prevented)`);
      return;
    }
    this.emit('state', `resolving node ${nodeNumber}`);
    const resolved = await this.resolveNodeNumber(nodeNumber);
    this.emit('state', `resolved ${nodeNumber} → ${resolved.host}:${resolved.port}`);
    this.openLeg(resolved.host, resolved.port, nodeNumber, nodeNumber, { monitor: options?.monitor });
  }

  /** Link directly to a known address (e.g. a hub you run). */
  connectToAddress(host: string, port: number, calledNumber?: string, options?: { monitor?: boolean }): void {
    this.openLeg(host, port ?? DEFAULT_IAX_PORT, calledNumber ?? '', host, { monitor: options?.monitor });
  }

  /**
   * Connect as a guest (Web Transceiver mode) — for operators without a node
   * number. Authenticates with the well-known allstar-public/allstar guest user
   * and carries the AllStarLink-portal session token in the CALLING NAME IE
   * (validated node-side against the portal). PTT is signaled with
   * RADIO_KEY/UNKEY control frames, exactly like the original applet. Only
   * nodes with web-transceiver access enabled accept these connections.
   */
  async connectAsGuest(options: {
    node?: string;
    host?: string;
    port?: number;
    token: string;
    callingNo?: string;
  }): Promise<void> {
    let host = options.host?.trim();
    let port = options.port ?? DEFAULT_IAX_PORT;
    let label = options.node ?? host ?? 'guest';
    if (!host) {
      if (!options.node) {
        throw new Error('Provide a node number or address to connect to.');
      }
      this.emit('state', `resolving node ${options.node}`);
      const resolved = await this.resolveNodeNumber(options.node);
      host = resolved.host;
      port = resolved.port;
      label = options.node;
      this.emit('state', `resolved ${options.node} → ${host}:${port}`);
    }
    this.emit('state', `connecting to ${label} as guest (web transceiver)`);
    // Web-transceiver guests dial the Asterisk start extension "s" in the
    // allstar-public context (NOT the node number — that yields "No such
    // context/extension"). The node number rides in the CALLING NUMBER IE.
    // Verified against DroidStar iax.cpp send_call() (m_wt branch).
    this.openLeg(host, port, 's', label, {
      username: 'allstar-public',
      secret: 'allstar',
      callingNumber: options.callingNo ?? options.node ?? '',
      callingName: options.token,
      keyingMode: 'radiokey',
    });
  }

  private openLeg(
    host: string,
    port: number,
    calledNumber: string,
    label: string,
    overrides?: {
      username?: string;
      secret?: string;
      callingNumber?: string;
      callingName?: string;
      keyingMode?: 'newkey' | 'radiokey';
      monitor?: boolean;
    },
  ): void {
    for (const existing of this.byLocalCall.values()) {
      if (existing.label === label) {
        this.emit('state', `already linked to ${label}`);
        return;
      }
    }

    const localCall = this.allocateCall();
    const leg = new IaxLeg({
      localCall,
      username: overrides?.username ?? (this.linkUsername || undefined),
      callingNumber: overrides?.callingNumber ?? (this.nodeNumber || undefined),
      callingName: overrides?.callingName,
      secret: overrides?.secret ?? (this.secret || undefined),
      calledNumber: calledNumber || undefined,
      keyingMode: overrides?.keyingMode,
    });
    const connection: Connection = {
      leg,
      host,
      port,
      label,
      state: 'idle',
      up: false,
      rxQueue: [],
      info: null,
      monitor: overrides?.monitor ?? false,
      lastRxAt: 0,
    };
    this.byLocalCall.set(localCall, connection);

    leg.on('send', (frame) => {
      this.trace('→', frame, `${host}:${port}`);
      this.logVoice('→', frame);
      this.socket.send(frame, port, host);
    });
    leg.on('state', (state) => {
      connection.state = state;
      this.emit('state', `${label}: ${state}`);
      this.emitConnections();
    });
    leg.on('up', () => {
      connection.up = true;
      if (connection.setupTimer) {
        clearTimeout(connection.setupTimer);
        connection.setupTimer = undefined;
      }
      this.emit('state', `linked to ${label}`);
      this.emitConnections();
      // Fetch directory metadata only after the call is up and well clear of the
      // setup handshake, so the lookup can't hitch call/audio timing.
      setTimeout(() => void this.loadNodeInfo(connection), 4000);
    });
    leg.on('audio', (payload) => {
      connection.rxQueue.push(this.codec.decode(payload));
      if (connection.rxQueue.length > 8) {
        connection.rxQueue.shift(); // bound latency (~160ms)
      }
      connection.lastRxAt = Date.now();
      this.rxVoiceCount += 1;
    });
    leg.on('dtmf', (digit) => this.emit('dtmf', digit));
    leg.on('hangup', () => this.removeConnection(localCall));
    leg.on('error', (error) => this.emit('error', error));

    this.emit('state', `connecting to ${label} (${host}:${port})`);
    leg.start();
    // Give up if the peer never answers (offline node, wrong number, blocked port).
    // removeConnection re-emits the list; the renderer sees a never-up leg vanish
    // and announces the failure.
    connection.setupTimer = setTimeout(() => {
      if (connection.up) return;
      this.emit('state', `call to ${label} timed out (no answer after ${CALL_SETUP_TIMEOUT_MS / 1000}s)`);
      connection.leg.hangup();
      this.removeConnection(localCall);
    }, CALL_SETUP_TIMEOUT_MS);
    this.emitConnections();
  }

  /** Send DTMF command digits to a connected node (or all up links if no label). */
  sendDtmf(digits: string, label?: string): void {
    for (const connection of this.byLocalCall.values()) {
      if (!connection.up) continue;
      if (label && connection.label !== label) continue;
      for (const digit of digits) connection.leg.sendDtmf(digit);
    }
    this.emit('state', `sent DTMF ${digits}${label ? ` to ${label}` : ''}`);
  }

  /** Drop the leg(s) matching a node number / label. */
  disconnectNode(label: string): void {
    for (const [localCall, connection] of this.byLocalCall) {
      if (connection.label === label) {
        connection.leg.hangup();
        this.removeConnection(localCall);
      }
    }
  }

  disconnectAll(): void {
    for (const [localCall, connection] of this.byLocalCall) {
      connection.leg.hangup();
      this.removeConnection(localCall);
    }
  }

  /** The operator keyed up (PTT press): tell every link to re-establish its
   * stream with a full frame so far nodes/repeaters cleanly key up, and send
   * RADIO_KEY on guest (web-transceiver) legs. */
  /** Configure MDC1200 PTT-ID transmit (unit ID + when to send the burst). */
  setMdcConfig(config: MdcConfig): void {
    this.mdc = config;
  }

  /** Queue an MDC1200 burst for real-time playout to all links (mixTick drains it).
   * A key-down (end) ID gets a short silent tail as hang time; a key-up (start)
   * ID gets none so the operator's voice follows immediately without a gap. */
  private enqueueMdcBurst(isEnd: boolean): void {
    if (!this.mdc.enabled || !this.mdc.unitId || !this.mdc.encode) {
      return;
    }
    const burst = this.mdc.encode(this.mdc.unitId, this.mdc.level, this.mdc.preambleBytes);
    for (let i = 0; i < burst.length; i += this.frameSize) {
      const frame = new Int16Array(this.frameSize);
      frame.set(burst.subarray(i, i + this.frameSize));
      this.mdcTxFrames.push(frame);
    }
    if (isEnd) {
      // ~150 ms of hang time so the burst passes fully before we unkey.
      const tailFrames = Math.round((0.15 * 8000) / this.frameSize);
      for (let i = 0; i < tailFrames; i += 1) this.mdcTxFrames.push(new Int16Array(this.frameSize));
    }
    this.emit('state', `MDC1200 PTT ID ${this.mdc.unitId.toString(16).toUpperCase().padStart(4, '0')}`);
  }

  notifyTransmitStart(): void {
    if (this.mdc.timing === 'start' || this.mdc.timing === 'both') {
      this.enqueueMdcBurst(false);
    }
    for (const connection of this.byLocalCall.values()) {
      if (connection.up && !connection.monitor) {
        connection.leg.markKeyStart();
        connection.leg.keyRadio(); // no-op on node (newkey) links
      }
    }
  }

  /** The operator released PTT: RADIO_UNKEY on guest legs (node links unkey
   * implicitly when voice frames stop). */
  notifyTransmitStop(): void {
    if (this.mdc.timing === 'end' || this.mdc.timing === 'both') {
      this.enqueueMdcBurst(true);
    }
    for (const connection of this.byLocalCall.values()) {
      if (connection.up && !connection.monitor) {
        connection.leg.unkeyRadio(); // no-op on node (newkey) links
      }
    }
  }

  /** Feed one 20 ms G.711 frame from the local port (the operator's mic). */
  pushLocalAudio(payload: Uint8Array): void {
    // Queue rather than overwrite: mic frames can arrive bursty (IPC/renderer
    // jitter), and dropping all but the newest per tick loses half our TX. The
    // mixer drains one per tick; cap the buffer so latency stays bounded (~100ms).
    this.localQueue.push(this.codec.decode(payload));
    if (this.localQueue.length > 5) {
      this.localQueue.shift();
    }
  }

  getConnections(): ConnectionInfo[] {
    const now = Date.now();
    return [...this.byLocalCall.values()].map((c) => ({
      localCall: c.leg.localCall,
      label: c.label,
      host: c.host,
      port: c.port,
      state: c.state,
      up: c.up,
      callsign: c.info?.callsign,
      location: c.info?.location,
      description: c.info?.description,
      frequency: c.info?.frequency,
      tone: c.info?.tone,
      monitor: c.monitor,
      keyed: c.lastRxAt > 0 && now - c.lastRxAt < 1500,
      lastKeyedAt: c.lastRxAt,
    }));
  }

  /**
   * Re-fetch directory metadata for every current link and re-emit the
   * connection list, so the Linked Nodes view repopulates on demand (Refresh).
   */
  async refreshConnections(): Promise<void> {
    await Promise.all([...this.byLocalCall.values()].map((c) => this.loadNodeInfo(c)));
    this.emitConnections();
  }

  /** AllStarLink directory metadata for our own node, for the identity header. */
  async getSelfInfo(): Promise<NodeInfo | null> {
    if (!this.nodeNumber) {
      return null;
    }
    const cached = this.nodeInfoCache.get(this.nodeNumber);
    if (cached) {
      return cached;
    }
    const info = await fetchNodeInfo(this.nodeNumber, { fetchImpl: this.fetchImpl });
    if (info) {
      this.nodeInfoCache.set(this.nodeNumber, info);
    }
    return info;
  }

  /**
   * Build a multi-level network map rooted at this node. Crawls the mesh
   * breadth-first: for each node reached, fetch its connection list + keyed state
   * from the AllStarLink stats API (which already carries each linked node's
   * callsign/location, so no extra lookup is needed). Duplicate nodes are marked
   * truncated so cycles don't loop. Bounded by a node budget and a concurrency
   * cap so a big mesh stays within the stats API's rate limit rather than
   * bursting hundreds of requests at once.
   */
  async getTopology(maxDepth = 6): Promise<NodeTopology> {
    const NODE_BUDGET = 400; // max nodes to expand across the whole crawl
    const CONCURRENCY = 6; // simultaneous stats requests
    let budget = NODE_BUDGET;

    const root: TopologyTreeNode = {
      node: this.nodeNumber || 'node',
      isSelf: true,
      keyed: this.keyed,
      truncated: false,
      children: [],
    };

    // enqueued: every node already placed in the tree, so each is expanded once
    // and repeats elsewhere are shown as truncated (⟲) instead of re-crawled.
    const enqueued = new Set<string>([this.nodeNumber]);
    interface Pending {
      treeNode: TopologyTreeNode;
      depth: number;
    }
    let frontier: Pending[] = [];

    // Seed the frontier from our direct links (carry their richer local info).
    for (const c of this.byLocalCall.values()) {
      if (!c.up || !/^[0-9]+$/.test(c.label)) continue;
      const treeNode: TopologyTreeNode = {
        node: c.label,
        callsign: c.info?.callsign,
        location: c.info?.location,
        description: c.info?.description,
        frequency: c.info?.frequency,
        tone: c.info?.tone,
        keyed: false,
        truncated: false,
        children: [],
      };
      root.children.push(treeNode);
      enqueued.add(c.label);
      frontier.push({ treeNode, depth: 1 });
    }

    // Breadth-first, one depth level at a time, CONCURRENCY requests in flight.
    for (let depth = 1; depth <= maxDepth && frontier.length > 0 && budget > 0; depth += 1) {
      const next: Pending[] = [];
      for (let i = 0; i < frontier.length && budget > 0; i += CONCURRENCY) {
        const batch = frontier.slice(i, i + CONCURRENCY).filter(() => budget-- > 0);
        await Promise.all(
          batch.map(async ({ treeNode }) => {
            const stats = await fetchNodeStats(treeNode.node, { fetchImpl: this.fetchImpl });
            treeNode.keyed = stats.keyed;
            for (const link of stats.connections) {
              const child: TopologyTreeNode = {
                node: link.node,
                callsign: link.callsign,
                location: link.location,
                keyed: false,
                truncated: enqueued.has(link.node),
                children: [],
              };
              treeNode.children.push(child);
              if (!child.truncated) {
                enqueued.add(link.node);
                next.push({ treeNode: child, depth: depth + 1 });
              }
            }
          }),
        );
      }
      frontier = next;
    }

    return { root };
  }

  /** Fetch (and cache) AllStarLink metadata for a connection's node number. */
  private async loadNodeInfo(connection: Connection): Promise<void> {
    // Only node numbers have directory metadata; skip direct-address links.
    if (!/^[0-9]+$/.test(connection.label)) {
      return;
    }
    const cached = this.nodeInfoCache.get(connection.label);
    if (cached) {
      connection.info = cached;
      this.emitConnections();
      return;
    }
    const info = await fetchNodeInfo(connection.label, { fetchImpl: this.fetchImpl });
    if (info) {
      this.nodeInfoCache.set(connection.label, info);
      // The connection may have been torn down while we were fetching.
      if (this.byLocalCall.get(connection.leg.localCall) === connection) {
        connection.info = info;
        this.emitConnections();
      }
    }
  }

  async close(): Promise<void> {
    if (this.mixTimer) {
      clearInterval(this.mixTimer);
      this.mixTimer = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.statPostTimer) {
      clearInterval(this.statPostTimer);
      this.statPostTimer = null;
    }
    if (this.registrationTimer) {
      clearTimeout(this.registrationTimer);
      this.registrationTimer = null;
    }
    this.disconnectAll();
    return new Promise((resolve) => {
      this.socket.once('close', () => resolve());
      try {
        this.socket.close();
      } catch {
        resolve();
      }
    });
  }

  /**
   * One conference tick: N-1 mix the latest frame from every up leg plus the
   * local port, send each leg its mix, and emit the local mix for playback.
   * Public so it can be driven deterministically from tests.
   */
  mixTick(): void {
    const upLegs = [...this.byLocalCall.values()].filter((c) => c.up);

    // MDC1200 burst playout: send one 20 ms frame per tick to every link at the
    // correct baud, ahead of (and instead of) the mic for the burst's duration.
    if (this.mdcTxFrames.length > 0) {
      const frame = this.mdcTxFrames.shift()!;
      const encoded = this.codec.encode(frame);
      const legFrames = upLegs.map((c) => c.rxQueue.shift() ?? null);
      // Send the CLEAN MDC burst to every link (never mixed with peer audio, or
      // the far decoder would fail). Do NOT re-key after — the voice continues
      // this same stream so the ID + audio are one transmission.
      for (const c of upLegs) {
        if (!c.monitor) {
          c.leg.sendAudio(encoded);
          this.txVoiceCount += 1;
        }
      }
      // Keep feeding the local speaker so RX isn't lost while the burst plays
      // (e.g. an end-of-transmission ID with someone else talking).
      if (legFrames.some(Boolean)) {
        const inputs: MixInput[] = upLegs.map((c, i) => ({
          id: `leg:${c.leg.localCall}`,
          samples: legFrames[i] ?? this.silentFrame(),
        }));
        inputs.push({ id: 'local', samples: this.silentFrame() });
        const localMix = mixMinusOne(inputs, this.frameSize).get('local');
        if (localMix) this.emit('localAudio', this.codec.encode(localMix));
      }
      return;
    }
    // setInterval ticks slightly slower than the 50 fps audio rate, so process
    // ALL buffered frames each tick (not just one) — otherwise we fall behind and
    // drop frames, underrunning the jitter buffer (choppy audio both ways).
    const MAX_SLOTS = 6;
    for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
      const localFrame = this.localQueue.shift() ?? null;
      const legFrames = upLegs.map((c) => c.rxQueue.shift() ?? null);
      const localActive = Boolean(localFrame);
      const activePeerCount = legFrames.reduce((n, f) => n + (f ? 1 : 0), 0);
      const anyPeerAudio = activePeerCount > 0;

      // Track keyed state / counters for stats: keyed when we TX or hear a peer.
      const keyedNow = localActive || anyPeerAudio;
      if (keyedNow && !this.keyed) {
        this.totalKeyups += 1;
      }
      if (keyedNow) {
        this.lastKeyedAt = Date.now();
      }
      if (localActive) {
        this.totalTxTimeMs += MIX_INTERVAL_MS;
      }
      this.keyed = keyedNow;

      // Every queue drained — nothing left to mix this tick.
      if (!localActive && !anyPeerAudio) {
        break;
      }

      const inputs: MixInput[] = upLegs.map((c, i) => ({
        id: `leg:${c.leg.localCall}`,
        samples: legFrames[i] ?? this.silentFrame(),
      }));
      inputs.push({ id: 'local', samples: localFrame ?? this.silentFrame() });

      const mixes = mixMinusOne(inputs, this.frameSize);
      upLegs.forEach((c, i) => {
        // Monitor links are receive-only: never transmit our audio to them.
        if (c.monitor) {
          return;
        }
        // Only transmit to a peer when SOME OTHER source is active — otherwise
        // we'd stream silence back, holding its receiver keyed and burying our
        // real audio. This gives PTT a clean key-up/key-down the far node relays.
        const legActive = Boolean(legFrames[i]);
        const otherActive = localActive || activePeerCount - (legActive ? 1 : 0) > 0;
        const mix = mixes.get(`leg:${c.leg.localCall}`);
        if (otherActive && mix) {
          c.leg.sendAudio(this.codec.encode(mix));
          this.txVoiceCount += 1;
        }
      });

      // The local speaker hears the conference only when a peer is talking.
      if (anyPeerAudio) {
        const localMix = mixes.get('local');
        if (localMix) {
          this.emit('localAudio', this.codec.encode(localMix));
        }
      }
    }
  }

  private trace(direction: '→' | '←', data: Buffer, addr: string): void {
    if (!this.debug || !isFullFrame(data)) {
      return;
    }
    const frame = decodeFullFrame(data);
    // Keep the trace to call setup/teardown — drop keepalives and media noise.
    if (MEDIA_FRAME_TYPES.has(frame.frameType)) {
      return;
    }
    // Show OUTGOING voice (our key-ups, rare) but not INCOMING voice — a busy
    // peer streams full voice frames 50/s, which would flood the log and starve
    // the renderer (choppy audio).
    if (frame.frameType === FRAME_TYPE_VOICE_ID && direction === '←') {
      return;
    }
    if (frame.frameType === FRAME_TYPE_IAX && NOISY_IAX_SUBCLASSES.has(frame.subclass)) {
      return;
    }
    this.emit('state', `trace ${direction} ${addr} ${describeFullFrame(data)}`);
  }

  /** One-shot detailed log of the first voice frame each way, to compare formats. */
  private logVoice(dir: '→' | '←', data: Buffer): void {
    if (!isFullFrame(data)) {
      return; // mini frames carry no full header to compare
    }
    const f = decodeFullFrame(data);
    if (f.frameType !== FRAME_TYPE_VOICE_ID) {
      return;
    }
    if (dir === '→') {
      if (this.loggedTxVoice) return;
      this.loggedTxVoice = true;
    } else {
      if (this.loggedRxVoice) return;
      this.loggedRxVoice = true;
    }
    const head = Array.from(f.payload.subarray(0, 4)).join(',');
    this.emit(
      'state',
      `voice ${dir} sub=${f.subclass} src=${f.sourceCall} dst=${f.destCall} oseq=${f.oseqno} iseq=${f.iseqno} ts=${f.timestamp} len=${f.payload.length} head=[${head}]`,
    );
  }

  private route(data: Buffer, rinfo: RemoteInfo): void {
    this.trace('←', data, `${rinfo.address}:${rinfo.port}`);
    this.logVoice('←', data);
    if (isFullFrame(data)) {
      const frame = decodeFullFrame(data);
      const connection = this.byLocalCall.get(frame.destCall);
      if (!connection) {
        // No matching leg. An inbound NEW (destCall 0) is a future feature.
        if (
          frame.destCall === 0 &&
          frame.frameType === FRAME_TYPE_IAX &&
          frame.subclass === IAX_NEW
        ) {
          if (!this.inboundEnabled) {
            this.emit('state', `ignored inbound link from ${rinfo.address} (inbound disabled)`);
          }
          return;
        }
        // A stale/zombie call (e.g. a peer still sending after we hung up). Tell it
        // the call number is invalid so it tears down instead of retransmitting.
        this.rejectStaleCall(frame, rinfo);
        return;
      }
      connection.leg.handle(data);
      if (connection.leg.remoteCall) {
        this.byRemoteCall.set(connection.leg.remoteCall, connection);
      }
      return;
    }

    const mini = decodeMiniFrame(data);
    const connection = this.byRemoteCall.get(mini.sourceCall);
    if (connection) {
      connection.leg.handle(data);
    }
  }

  private silentFrame(): Int16Array {
    if (!this.silent || this.silent.length !== this.frameSize) {
      this.silent = new Int16Array(this.frameSize);
    }
    return this.silent;
  }

  /** Tell a peer that a call number it's using is invalid, so it stops/tears down. */
  private rejectStaleCall(frame: ReturnType<typeof decodeFullFrame>, rinfo: RemoteInfo): void {
    // Don't reply to bare acknowledgements or to another INVAL (avoids loops).
    if (frame.frameType === FRAME_TYPE_IAX && (frame.subclass === IAX_ACK || frame.subclass === IAX_INVAL)) {
      return;
    }
    const reply = encodeFullFrame({
      sourceCall: frame.destCall,
      destCall: frame.sourceCall,
      retransmit: false,
      timestamp: frame.timestamp,
      oseqno: 0,
      iseqno: 0,
      frameType: FRAME_TYPE_IAX,
      subclass: IAX_INVAL,
      payload: Buffer.alloc(0),
    });
    this.socket.send(reply, rinfo.port, rinfo.address);
  }

  private allocateCall(): number {
    let call = this.nextCall;
    // Call numbers are 15-bit and must be non-zero and currently unused.
    do {
      call = this.nextCall;
      this.nextCall = (this.nextCall % 0x7fff) + 1;
    } while (call === 0 || this.byLocalCall.has(call));
    return call;
  }

  private removeConnection(localCall: number): void {
    const connection = this.byLocalCall.get(localCall);
    if (!connection) {
      return;
    }
    if (connection.setupTimer) {
      clearTimeout(connection.setupTimer);
      connection.setupTimer = undefined;
    }
    this.byLocalCall.delete(localCall);
    if (connection.leg.remoteCall) {
      this.byRemoteCall.delete(connection.leg.remoteCall);
    }
    this.emitConnections();
  }

  private emitConnections(): void {
    this.emit('connections', this.getConnections());
    // NB: do NOT fetch/post here — emitConnections fires during call setup, and
    // HTTP work on this (audio) process hitches the real-time mixer. Stats post
    // on their own timer instead.
  }
}
