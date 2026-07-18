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
  disconnect: (payload: ProtocolDisconnectPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_DISCONNECT, payload),
  register: (payload: ProtocolRegisterPayload) => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_REGISTER, payload),
  setDebug: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_SET_DEBUG, enabled),
  hangup: () => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_HANGUP),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  saveSettings: (settings: NodeSettings) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),
  getTopology: () => ipcRenderer.invoke(IPC_CHANNELS.PROTOCOL_TOPOLOGY),
  sendAudioFrame: (payload: ProtocolAudioPayload) => {
    // Fire-and-forget: a 50/s audio stream shouldn't pay for an invoke round-trip.
    ipcRenderer.send(IPC_CHANNELS.PROTOCOL_AUDIO_TX, payload);
    return Promise.resolve();
  },
  txStart: () => ipcRenderer.send(IPC_CHANNELS.PROTOCOL_TX_START),
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
