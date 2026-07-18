import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KerchunkNode, type AudioCodec } from '../protocol/node.js';
import { DEFAULT_IAX_PORT } from '../protocol/resolver.js';
import { fetchWebTransceiverToken } from '../protocol/wtportal.js';
import { fetchNodeInfo } from '../protocol/nodeinfo.js';
import { decodeG711Chunk, encodeG711Chunk } from '../shared/audio.js';
import {
  IPC_CHANNELS,
  type ProtocolAudioPayload,
  type ProtocolConnectPayload,
  type NodeSettings,
  type ProtocolConnectionsPayload,
  type ProtocolDisconnectPayload,
  type ProtocolGuestConnectPayload,
  type ProtocolRegisterPayload,
  type ProtocolStatePayload,
} from '../shared/ipc.js';
import { resolveTheme, THEME_CHANNELS, type ThemeMode } from '../shared/theme.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let protocolNode: KerchunkNode | null = null;
const preferencesPath = path.join(app.getPath('userData'), 'preferences.json');

const g711Codec: AudioCodec = {
  decode: (payload) => decodeG711Chunk(payload),
  encode: (samples) => encodeG711Chunk(samples),
};

interface Preferences {
  themeMode?: ThemeMode;
  nodeSettings?: NodeSettings;
}

function readPreferences(): Preferences {
  try {
    return JSON.parse(readFileSync(preferencesPath, 'utf8')) as Preferences;
  } catch {
    return {};
  }
}

function writePreferences(prefs: Preferences) {
  mkdirSync(path.dirname(preferencesPath), { recursive: true });
  writeFileSync(preferencesPath, JSON.stringify(prefs, null, 2));
}

function readThemePreference(): ThemeMode {
  const mode = readPreferences().themeMode;
  return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
}

function writeThemePreference(mode: ThemeMode) {
  writePreferences({ ...readPreferences(), themeMode: mode });
}

function readNodeSettings(): NodeSettings {
  return readPreferences().nodeSettings ?? {};
}

function writeNodeSettings(settings: NodeSettings) {
  writePreferences({ ...readPreferences(), nodeSettings: settings });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // Sized to the app's content column at 75% zoom (see setZoomFactor below),
    // Transceive-style compact window.
    width: 560,
    height: 760,
    minWidth: 340,
    minHeight: 460,
    useContentSize: true,
    title: 'Kerchunk',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#19191c' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // electron-vite serves the renderer from a dev server and exposes its URL via
  // ELECTRON_RENDERER_URL. In a packaged/built app that variable is absent and we
  // load the bundled HTML from disk instead.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Render the UI at the operator's saved text size (defaults to 75%).
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(readNodeSettings().uiScale ?? 0.75);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function broadcastTheme(mode: ThemeMode = readThemePreference()) {
  if (!mainWindow) {
    return;
  }

  const resolved = resolveTheme(mode, nativeTheme.shouldUseDarkColors);
  mainWindow.webContents.send(THEME_CHANNELS.STATE_CHANGED, { mode, resolved });
}

function sendProtocolState(state: string) {
  const payload: ProtocolStatePayload = { state };
  mainWindow?.webContents.send(IPC_CHANNELS.PROTOCOL_STATE, payload);
}

function ensureNode(identity?: { username?: string; secret?: string }) {
  if (!protocolNode) {
    protocolNode = new KerchunkNode({
      codec: g711Codec,
      nodeNumber: identity?.username,
      secret: identity?.secret,
      debug: false,
    });
    protocolNode.on('localAudio', (payload) => {
      const frame = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
      ) as ArrayBuffer;
      const message: ProtocolAudioPayload = { frame };
      mainWindow?.webContents.send(IPC_CHANNELS.PROTOCOL_AUDIO_RX, message);
    });
    protocolNode.on('connections', (connections) => {
      const message: ProtocolConnectionsPayload = { connections };
      mainWindow?.webContents.send(IPC_CHANNELS.PROTOCOL_CONNECTIONS, message);
    });
    protocolNode.on('state', (state) => sendProtocolState(state));
    protocolNode.on('dtmf', (digit) => {
      mainWindow?.webContents.send(IPC_CHANNELS.PROTOCOL_DTMF, { digit });
    });
    protocolNode.on('error', (error) => sendProtocolState(`error: ${error.message}`));
    protocolNode.start();
  }
  // Keep identity current even if the node already existed from an earlier action.
  protocolNode.setIdentity(identity?.username, identity?.secret);
  return protocolNode;
}

app.whenReady().then(() => {
  // No File/Edit/View… menu — Kerchunk is a single-window app.
  Menu.setApplicationMenu(null);
  createWindow();

  ipcMain.handle(THEME_CHANNELS.GET_STATE, () => {
    const mode = readThemePreference();
    return {
      mode,
      resolved: resolveTheme(mode, nativeTheme.shouldUseDarkColors),
    };
  });

  ipcMain.handle(THEME_CHANNELS.SET_MODE, (_event, mode: ThemeMode) => {
    writeThemePreference(mode);
    const resolved = resolveTheme(mode, nativeTheme.shouldUseDarkColors);
    nativeTheme.themeSource = mode === 'system' ? 'system' : mode;
    broadcastTheme(mode);
    return { mode, resolved };
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_CONNECT, async (_event, payload: ProtocolConnectPayload) => {
    const node = ensureNode({ username: payload.username, secret: payload.secret });

    // A direct host links to a node you run; otherwise the node number is
    // resolved to an address via AllStarLink DNS.
    const host = payload.host?.trim();
    if (host) {
      node.connectToAddress(host, payload.port ?? DEFAULT_IAX_PORT, payload.calledNumber ?? payload.node, {
        monitor: payload.monitor,
      });
    } else if (payload.node?.trim()) {
      await node.connectToNode(payload.node.trim(), { monitor: payload.monitor });
    } else {
      throw new Error('Provide a node number or address to connect to.');
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_NODE_INFO, async (_event, node: string) => {
    const trimmed = String(node ?? '').trim();
    if (!trimmed) {
      return null;
    }
    // Reuse the running node's cache when the request is for our own number;
    // otherwise do a direct directory lookup.
    if (protocolNode && trimmed === readNodeSettings().myNode?.trim()) {
      return protocolNode.getSelfInfo();
    }
    return fetchNodeInfo(trimmed);
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_CONNECT_GUEST, async (_event, payload: ProtocolGuestConnectPayload) => {
    const node = ensureNode();
    const targetNode = payload.node?.trim() || undefined;
    // Fetch the session token from the AllStarLink portal (DroidStar-style)
    // unless one was supplied directly.
    let token = payload.token?.trim();
    if (!token) {
      if (!targetNode) {
        throw new Error('Guest mode needs a node number (the portal issues tokens per node).');
      }
      sendProtocolState(`fetching web-transceiver token for ${targetNode}…`);
      token = await fetchWebTransceiverToken(payload.callsign, payload.password, targetNode);
      sendProtocolState('web-transceiver token acquired');
    }
    await node.connectAsGuest({
      node: targetNode,
      host: payload.host?.trim() || undefined,
      port: payload.port,
      token,
    });
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_DISCONNECT, (_event, payload: ProtocolDisconnectPayload) => {
    protocolNode?.disconnectNode(payload.label);
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_REGISTER, async (_event, payload: ProtocolRegisterPayload) => {
    const node = ensureNode({ username: payload.node, secret: payload.password });
    const result = await node.register(payload.password);
    return {
      success: result.success,
      ipaddr: result.ipaddr,
      refresh: result.refresh,
      message: result.message,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_TOPOLOGY, async () => {
    return protocolNode ? await protocolNode.getTopology() : { node: '', connections: [] };
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_REFRESH_CONNECTIONS, async () => {
    await protocolNode?.refreshConnections();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => readNodeSettings());

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, settings: NodeSettings) => {
    writeNodeSettings(settings);
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_ZOOM, (_event, factor: number) => {
    const clamped = Math.max(0.5, Math.min(1.5, Number(factor) || 0.75));
    mainWindow?.webContents.setZoomFactor(clamped);
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_SET_DEBUG, (_event, enabled: boolean) => {
    ensureNode().setDebug(enabled);
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_HANGUP, () => {
    protocolNode?.disconnectAll();
  });

  ipcMain.on(IPC_CHANNELS.PROTOCOL_TX_START, () => {
    protocolNode?.notifyTransmitStart();
  });

  ipcMain.on(IPC_CHANNELS.PROTOCOL_TX_STOP, () => {
    protocolNode?.notifyTransmitStop();
  });

  ipcMain.on(IPC_CHANNELS.PROTOCOL_AUDIO_TX, (_event, payload: ProtocolAudioPayload) => {
    // Local mic frame → the node's local conference port (fire-and-forget).
    protocolNode?.pushLocalAudio(new Uint8Array(payload.frame));
  });

  nativeTheme.on('updated', () => {
    broadcastTheme();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
