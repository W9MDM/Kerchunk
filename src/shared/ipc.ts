import type { ThemeMode, ThemeState } from './theme';

export const IPC_CHANNELS = {
  THEME_GET_STATE: 'theme:get-state',
  THEME_SET_MODE: 'theme:set-mode',
  THEME_STATE_CHANGED: 'theme:state-changed',
  PROTOCOL_CONNECT: 'protocol:connect',
  PROTOCOL_CONNECT_GUEST: 'protocol:connect-guest',
  PROTOCOL_NODE_INFO: 'protocol:node-info',
  PROTOCOL_DISCONNECT: 'protocol:disconnect',
  PROTOCOL_REGISTER: 'protocol:register',
  PROTOCOL_SET_DEBUG: 'protocol:set-debug',
  PROTOCOL_HANGUP: 'protocol:hangup',
  PROTOCOL_TX_START: 'protocol:tx-start',
  PROTOCOL_TX_STOP: 'protocol:tx-stop',
  PROTOCOL_AUDIO_TX: 'protocol:audio-tx',
  PROTOCOL_AUDIO_RX: 'protocol:audio-rx',
  PROTOCOL_STATE: 'protocol:state',
  PROTOCOL_CONNECTIONS: 'protocol:connections',
  PROTOCOL_DTMF: 'protocol:dtmf',
  PROTOCOL_TOPOLOGY: 'protocol:topology',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
} as const;

export interface TopologyTreeNode {
  node: string;
  callsign?: string;
  location?: string;
  keyed?: boolean;
  isSelf?: boolean;
  truncated?: boolean;
  children: TopologyTreeNode[];
}

export interface Topology {
  root: TopologyTreeNode;
}

/** A node the operator has saved to their list (favorites / remembered links). */
export interface SavedNode {
  /** AllStarLink node number (or direct address). */
  number: string;
  /** Optional short label the operator gives it. */
  note?: string;
  /** Auto-reconnect this node on startup and keep it linked. */
  permanent?: boolean;
  /** Connect receive-only (monitor). */
  monitor?: boolean;
}

/** Persisted node identity + connection defaults. */
export interface NodeSettings {
  /** Your AllStarLink node number. */
  myNode?: string;
  /** Your node's AllStarLink password (stored locally). */
  secret?: string;
  /** Optional direct address of a node you run. */
  connectHost?: string;
  /** Operator callsign (guest / web-transceiver mode). */
  callsign?: string;
  /** Operator full name, shown on the node identity header. */
  operatorName?: string;
  /** AllStarLink portal password for guest token fetch (stored locally). */
  wtPassword?: string;
  /** The operator's saved node list (favorites / remembered links). */
  savedNodes?: SavedNode[];
}

/** AllStarLink directory metadata for a node (identity header, list rows). */
export interface NodeInfoDto {
  node: string;
  callsign?: string;
  location?: string;
  description?: string;
  frequency?: string;
  tone?: string;
  status?: string;
}

/** Guest (Web Transceiver) connection — for operators without a node number. */
export interface ProtocolGuestConnectPayload {
  /** Node number to connect to (resolved via DNS) … */
  node?: string;
  /** … or a direct address. */
  host?: string;
  port?: number;
  /** Portal (allstarlink.org) account callsign for the token fetch. */
  callsign: string;
  /** Portal account password. */
  password: string;
  /** Pre-acquired session token (skips the portal fetch when set). */
  token?: string;
}

export interface ProtocolConnectPayload {
  /** Direct address of a node to link to (e.g. a hub you run). */
  host?: string;
  port?: number;
  /** AllStarLink node number; resolved to an address via DNS when no host given. */
  node?: string;
  /** Called number / extension at the far end; defaults to `node`. */
  calledNumber?: string;
  /** Our own node number, presented to peers as the username. */
  username?: string;
  /** Shared secret for call-time MD5 authentication. */
  secret?: string;
  /** Connect receive-only (app_rpt monitor) — hear it but don't transmit to it. */
  monitor?: boolean;
}

export interface ProtocolDisconnectPayload {
  /** The connection label (node number or host) to drop. */
  label: string;
}

export interface ProtocolRegisterPayload {
  /** Our node number to register. */
  node: string;
  /** The node's AllStarLink password. */
  password: string;
}

export interface ProtocolRegistrationResult {
  success: boolean;
  ipaddr?: string;
  refresh: number;
  message?: string;
}

export interface ProtocolAudioPayload {
  frame: ArrayBuffer;
}

export interface ProtocolStatePayload {
  state: string;
}

export interface ProtocolConnectionInfo {
  localCall: number;
  label: string;
  host: string;
  port: number;
  state: string;
  callsign?: string;
  location?: string;
  description?: string;
  frequency?: string;
  tone?: string;
  monitor?: boolean;
  keyed?: boolean;
  lastKeyedAt?: number;
}

export interface ProtocolConnectionsPayload {
  connections: ProtocolConnectionInfo[];
}

export interface ProtocolDtmfPayload {
  digit: string;
}

/**
 * The full surface exposed to the renderer through the preload bridge. Declared
 * here in the shared layer so the preload implementation and the renderer's
 * `window` typing share a single source of truth.
 */
export interface KerchunkBridge {
  getThemeState(): Promise<ThemeState>;
  setThemeMode(mode: ThemeMode): Promise<ThemeState>;
  onThemeChange(callback: (state: ThemeState) => void): () => void;
  connect(payload: ProtocolConnectPayload): Promise<void>;
  connectGuest(payload: ProtocolGuestConnectPayload): Promise<void>;
  getNodeInfo(node: string): Promise<NodeInfoDto | null>;
  disconnect(payload: ProtocolDisconnectPayload): Promise<void>;
  register(payload: ProtocolRegisterPayload): Promise<ProtocolRegistrationResult>;
  setDebug(enabled: boolean): Promise<void>;
  hangup(): Promise<void>;
  getSettings(): Promise<NodeSettings>;
  saveSettings(settings: NodeSettings): Promise<void>;
  getTopology(): Promise<Topology>;
  sendAudioFrame(payload: ProtocolAudioPayload): Promise<void>;
  txStart(): void;
  txStop(): void;
  onProtocolAudio(callback: (payload: ProtocolAudioPayload) => void): () => void;
  onProtocolState(callback: (payload: ProtocolStatePayload) => void): () => void;
  onProtocolConnections(callback: (payload: ProtocolConnectionsPayload) => void): () => void;
  onProtocolDtmf(callback: (payload: ProtocolDtmfPayload) => void): () => void;
}
