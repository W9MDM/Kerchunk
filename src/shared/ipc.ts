import type { ThemeMode, ThemeState } from './theme';
import type { DirectoryNode } from './nodedirectory';

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
  PROTOCOL_SET_HOTKEY: 'protocol:set-hotkey',
  PROTOCOL_PTT_HOTKEY: 'protocol:ptt-hotkey',
  OVERLAY_SET_VISIBLE: 'overlay:set-visible',
  OVERLAY_PTT: 'overlay:ptt',
  OVERLAY_TX: 'overlay:tx',
  OVERLAY_RX: 'overlay:rx',
  OVERLAY_VISIBILITY: 'overlay:visibility',
  PROTOCOL_AUDIO_TX: 'protocol:audio-tx',
  PROTOCOL_AUDIO_RX: 'protocol:audio-rx',
  PROTOCOL_STATE: 'protocol:state',
  PROTOCOL_CONNECTIONS: 'protocol:connections',
  PROTOCOL_DTMF: 'protocol:dtmf',
  PROTOCOL_TOPOLOGY: 'protocol:topology',
  PROTOCOL_REFRESH_CONNECTIONS: 'protocol:refresh-connections',
  PROTOCOL_NODE_DIRECTORY: 'protocol:node-directory',
  PROTOCOL_NODE_STATUS: 'protocol:node-status',
  PROTOCOL_SEND_DTMF: 'protocol:send-dtmf',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_EXPORT: 'settings:export',
  SETTINGS_IMPORT: 'settings:import',
  WINDOW_SET_ZOOM: 'window:set-zoom',
} as const;

export type { DirectoryNode } from './nodedirectory';

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

export interface Topology {
  root: TopologyTreeNode;
}

/** A saved DTMF command (a named, reusable key sequence). */
export interface DtmfCommand {
  label: string;
  digits: string;
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
  /** Directory metadata retained so the node is recognizable at a glance. */
  callsign?: string;
  description?: string;
  location?: string;
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
  /** Recently connected nodes (most-recent first, capped). Separate from saved. */
  recentNodes?: SavedNode[];
  /** Saved DTMF commands (named, reusable key sequences). */
  dtmfCommands?: DtmfCommand[];
  /** UI zoom factor (text size), e.g. 0.75. Defaults to 0.75. */
  uiScale?: number;
  /** Accent color as #rrggbb. Defaults to #007aff. */
  accent?: string;
  /**
   * PTT hotkey as a '+'-joined combo of KeyboardEvent.code parts, modifiers
   * first (e.g. "Control+Shift+KeyT", or just "Space"). Empty = none.
   */
  pttKey?: string;
  /** How the PTT hotkey behaves: hold to talk, or press to toggle. */
  pttMode?: 'hold' | 'toggle';
  /** Speak connect/disconnect/failure announcements (off by default). */
  ttsEnabled?: boolean;
  /** Show desktop notifications for connect/disconnect/failure (off by default). */
  notificationsEnabled?: boolean;
  /** Selected microphone deviceId ('' / undefined = system default). */
  audioInput?: string;
  /** Selected speaker deviceId ('' / undefined = system default). */
  audioOutput?: string;
  /** App output (speaker) volume, 0–100. Default 100. */
  outputVolume?: number;
  /** Microphone input level, 0–100. Default 100. */
  inputGain?: number;
  /** True once the first-run setup wizard has been completed or skipped. */
  setupComplete?: boolean;
  /** Keep running in the tray when the window is closed (instead of quitting). */
  closeToTray?: boolean;
  /** Launch Kerchunk automatically when you sign in. */
  launchOnStartup?: boolean;
  /** Show the floating always-on-top PTT button over other apps. */
  overlayEnabled?: boolean;
  /** Advanced mode: reveal direct-address linking and IAX link credentials. */
  advancedMode?: boolean;
  /** IAX username for direct links to a private node/hub (advanced). */
  iaxUser?: string;
  /** IAX secret for direct links to a private node/hub (advanced). */
  iaxSecret?: string;
  /** Transmit an MDC1200 PTT-ID burst. */
  mdcEnabled?: boolean;
  /** MDC1200 unit ID as 4-digit hex (e.g. "1234"). */
  mdcUnitId?: string;
  /** When to send the MDC1200 burst. */
  mdcTiming?: 'start' | 'end' | 'both';
  /** MDC1200 burst level, 0–100 (percent of a sane max). */
  mdcLevel?: number;
  /** MDC1200 preamble length in 0x55 bytes. */
  mdcPreamble?: number;
  /** Local talk-permit tone played on key-up: APS/P25, MotoTRBO, or MotoTRBO encrypted. */
  tpt?: 'aps' | 'trbo' | 'trbo-enc';
  /** Last-used connection mode: real node vs. Web Transceiver guest. */
  mode?: 'node' | 'guest';
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
  /** True once the call handshake completed; false while still calling. */
  up?: boolean;
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
  /** Write the given settings to a user-chosen JSON file. Returns false if cancelled. */
  exportSettings(settings: NodeSettings): Promise<boolean>;
  /** Read settings from a user-chosen JSON file (null if cancelled/invalid). */
  importSettings(): Promise<NodeSettings | null>;
  setZoom(factor: number): Promise<void>;
  getTopology(): Promise<Topology>;
  refreshConnections(): Promise<void>;
  /** The full AllStarLink node directory (cached), for the node picker. */
  getNodeDirectory(): Promise<DirectoryNode[]>;
  /** Keyed status for a set of nodes (from the stats API), for live coloring. */
  getNodeStatus(nodes: string[]): Promise<Record<string, boolean>>;
  /** Send DTMF command digits to a connected node (or all up links). */
  sendDtmf(digits: string, label?: string): Promise<void>;
  sendAudioFrame(payload: ProtocolAudioPayload): Promise<void>;
  txStart(): void;
  txStop(): void;
  /** Register the PTT hotkey globally (fires when the window is unfocused). */
  setHotkey(code: string): void;
  /** Global PTT hotkey was pressed (window unfocused). */
  onPttHotkey(callback: () => void): () => void;
  /** Show/hide the floating always-on-top PTT overlay window. */
  setOverlayVisible(visible: boolean): void;
  /** Overlay renderer: PTT pressed (true) / released (false). */
  overlayPtt(down: boolean): void;
  /** Main window: the overlay's PTT button was pressed/released. */
  onOverlayPtt(callback: (down: boolean) => void): () => void;
  /** Main window → overlay: RX (receiving audio) state changed. */
  overlayRx(on: boolean): void;
  /** Overlay window: reflect the live transmit state on the button. */
  onOverlayTx(callback: (on: boolean) => void): () => void;
  /** Overlay window: reflect the live receive state on the button. */
  onOverlayRx(callback: (on: boolean) => void): () => void;
  /** Main window: the overlay's visibility changed (e.g. closed from itself). */
  onOverlayVisibility(callback: (visible: boolean) => void): () => void;
  onProtocolAudio(callback: (payload: ProtocolAudioPayload) => void): () => void;
  onProtocolState(callback: (payload: ProtocolStatePayload) => void): () => void;
  onProtocolConnections(callback: (payload: ProtocolConnectionsPayload) => void): () => void;
  onProtocolDtmf(callback: (payload: ProtocolDtmfPayload) => void): () => void;
}
