import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type KerchunkBridge,
  type NodeSettings,
  type ProtocolAudioPayload,
  type ProtocolConnectPayload,
  type ProtocolConnectionsPayload,
  type ProtocolDisconnectPayload,
  type ProtocolDtmfPayload,
  type ProtocolGuestConnectPayload,
  type ProtocolRegisterPayload,
  type ProtocolStatePayload,
} from '../shared/ipc.js';
import { THEME_CHANNELS, type ThemeMode, type ThemeState } from '../shared/theme.js';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const electronAPI: KerchunkBridge = {
  getThemeState: () => ipcRenderer.invoke(THEME_CHANNELS.GET_STATE),
  setThemeMode: (mode: ThemeMode) => ipcRenderer.invoke(THEME_CHANNELS.SET_MODE, mode),
  onThemeChange: (callback: (state: ThemeState) => void) =>
    subscribe(THEME_CHANNELS.STATE_CHANGED, callback),
  connect: (payload: ProtocolConnectPayload) => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_CONNECT, payload),
  connectGuest: (payload: ProtocolGuestConnectPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_CONNECT_GUEST, payload),
  getNodeInfo: (node: string) => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_NODE_INFO, node),
  disconnect: (payload: ProtocolDisconnectPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_DISCONNECT, payload),
  register: (payload: ProtocolRegisterPayload) => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_REGISTER, payload),
  setDebug: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_SET_DEBUG, enabled),
  hangup: () => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_HANGUP),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  saveSettings: (settings: NodeSettings) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),
  exportSettings: (settings: NodeSettings) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_EXPORT, settings),
  importSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_IMPORT),
  setZoom: (factor: number) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_ZOOM, factor),
  getTopology: () => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_TOPOLOGY),
  refreshConnections: () => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_REFRESH_CONNECTIONS),
  getNodeDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_NODE_DIRECTORY),
  getNodeStatus: (nodes: string[]) => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_NODE_STATUS, nodes),
  sendDtmf: (digits: string, label?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_SEND_DTMF, { digits, label }),
  sendAudioFrame: (payload: ProtocolAudioPayload) => {
    // Fire-and-forget: a 50/s audio stream shouldn't pay for an invoke round-trip.
    ipcRenderer.send(IPC_CHANNELS.PROTOCOL_AUDIO_TX, payload);
    return Promise.resolve();
  },
  txStart: () => ipcRenderer.send(IPC_CHANNELS.PROTOCOL_TX_START),
  txStop: () => ipcRenderer.send(IPC_CHANNELS.PROTOCOL_TX_STOP),
  setHotkey: (code: string) => ipcRenderer.send(IPC_CHANNELS.PROTOCOL_SET_HOTKEY, code),
  onPttHotkey: (callback: () => void) => subscribe(IPC_CHANNELS.PROTOCOL_PTT_HOTKEY, callback),
  setOverlayVisible: (visible: boolean) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_SET_VISIBLE, visible),
  overlayPtt: (down: boolean) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_PTT, down),
  onOverlayPtt: (callback: (down: boolean) => void) => subscribe(IPC_CHANNELS.OVERLAY_PTT, callback),
  overlayRx: (on: boolean) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_RX, on),
  onOverlayTx: (callback: (on: boolean) => void) => subscribe(IPC_CHANNELS.OVERLAY_TX, callback),
  onOverlayRx: (callback: (on: boolean) => void) => subscribe(IPC_CHANNELS.OVERLAY_RX, callback),
  overlayMute: () => ipcRenderer.send(IPC_CHANNELS.OVERLAY_MUTE),
  onOverlayMute: (callback: () => void) => subscribe(IPC_CHANNELS.OVERLAY_MUTE, callback),
  overlayMuted: (on: boolean) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_MUTED, on),
  onOverlayMuted: (callback: (on: boolean) => void) => subscribe(IPC_CHANNELS.OVERLAY_MUTED, callback),
  onOverlayVisibility: (callback: (visible: boolean) => void) => subscribe(IPC_CHANNELS.OVERLAY_VISIBILITY, callback),
  checkForUpdate: (manual: boolean) => ipcRenderer.send(IPC_CHANNELS.UPDATE_CHECK, manual),
  downloadUpdate: () => ipcRenderer.send(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.send(IPC_CHANNELS.UPDATE_INSTALL),
  openExternal: (url: string) => ipcRenderer.send(IPC_CHANNELS.OPEN_EXTERNAL, url),
  onUpdateAvailable: (callback) => subscribe(IPC_CHANNELS.UPDATE_AVAILABLE, callback),
  onUpdateNone: (callback) => subscribe(IPC_CHANNELS.UPDATE_NONE, callback),
  onUpdateProgress: (callback) => subscribe(IPC_CHANNELS.UPDATE_PROGRESS, callback),
  onUpdateDownloaded: (callback) => subscribe(IPC_CHANNELS.UPDATE_DOWNLOADED, callback),
  onUpdateError: (callback) => subscribe(IPC_CHANNELS.UPDATE_ERROR, callback),
  onProtocolAudio: (callback: (payload: ProtocolAudioPayload) => void) =>
    subscribe(IPC_CHANNELS.PROTOCOL_AUDIO_RX, callback),
  onProtocolState: (callback: (payload: ProtocolStatePayload) => void) =>
    subscribe(IPC_CHANNELS.PROTOCOL_STATE, callback),
  onProtocolConnections: (callback: (payload: ProtocolConnectionsPayload) => void) =>
    subscribe(IPC_CHANNELS.PROTOCOL_CONNECTIONS, callback),
  onProtocolDtmf: (callback: (payload: ProtocolDtmfPayload) => void) =>
    subscribe(IPC_CHANNELS.PROTOCOL_DTMF, callback),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
