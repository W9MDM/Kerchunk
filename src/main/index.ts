import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, shell, Tray } from 'electron';
import electronUpdater from 'electron-updater';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KerchunkNode, type AudioCodec } from '../protocol/node.js';
import { DEFAULT_IAX_PORT } from '../protocol/resolver.js';
import { fetchWebTransceiverToken } from '../protocol/wtportal.js';
import { fetchNodeInfo, fetchNodeStats } from '../protocol/nodeinfo.js';
import { parseAstdb, type DirectoryNode } from '../shared/nodedirectory.js';
import { encodeMdcBurst, parseUnitId } from '../shared/mdc1200.js';
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
import { BRAND } from '../shared/brand.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let protocolNode: KerchunkNode | null = null;
let tray: Tray | null = null;
let isQuitting = false;
// Computed lazily (after app is ready) — calling app.getPath() at module top
// level is fragile and can throw during startup.
const preferencesPath = () => path.join(app.getPath('userData'), 'preferences.json');

// Startup diagnostics → %APPDATA%/kerchunk/kerchunk-main.log, so packaged-app
// failures (which have no console) are inspectable.
function logMain(message: string) {
  try {
    const logPath = path.join(app.getPath('userData'), 'kerchunk-main.log');
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { flag: 'a' });
  } catch {
    // best-effort
  }
}
process.on('uncaughtException', (error) => logMain(`uncaughtException: ${error.stack ?? error}`));
process.on('unhandledRejection', (reason) => logMain(`unhandledRejection: ${String(reason)}`));

const g711Codec: AudioCodec = {
  decode: (payload) => decodeG711Chunk(payload),
  encode: (samples) => encodeG711Chunk(samples),
};

interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

interface Preferences {
  themeMode?: ThemeMode;
  nodeSettings?: NodeSettings;
  windowBounds?: WindowBounds;
  overlayBounds?: WindowBounds;
}

function readPreferences(): Preferences {
  try {
    return JSON.parse(readFileSync(preferencesPath(), 'utf8')) as Preferences;
  } catch {
    return {};
  }
}

function writePreferences(prefs: Preferences) {
  mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  writeFileSync(preferencesPath(), JSON.stringify(prefs, null, 2));
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

function readWindowBounds(): WindowBounds | undefined {
  return readPreferences().windowBounds;
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | undefined;
/** Persist the current window size/position (debounced), so it reopens as left. */
function saveWindowBounds() {
  if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return;
  const { width, height, x, y } = mainWindow.getBounds();
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    writePreferences({ ...readPreferences(), windowBounds: { width, height, x, y } });
  }, 400);
}

/** Show the window on-screen and bring it to the front. Recenters if it somehow
 * landed outside every connected display (the "only in the taskbar" case). */
function revealWindow() {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  const onScreen = screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y;
  });
  if (!onScreen) mainWindow.center();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
}

function createWindow() {
  const saved = readWindowBounds();
  mainWindow = new BrowserWindow({
    // Sized to the app's content column at 75% zoom (see setZoomFactor below),
    // Transceive-style compact window. Reopens at the operator's last size/spot.
    width: saved?.width ?? 560,
    height: saved?.height ?? 760,
    x: saved?.x,
    y: saved?.y,
    minWidth: 360,
    minHeight: 480,
    center: !saved,
    title: BRAND.name,
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

  const indexHtml = path.join(__dirname, '../renderer/index.html');
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(indexHtml).catch((error) => logMain(`loadFile failed: ${String(error)}`));
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
    logMain(`did-fail-load ${code} ${desc} ${url}`),
  );

  // Render the UI at the operator's saved text size (defaults to 75%) and show.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(readNodeSettings().uiScale ?? 0.75);
    revealWindow();
  });

  mainWindow.once('ready-to-show', () => revealWindow());

  // Fallback: never leave the window stuck hidden if the events don't fire.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) revealWindow();
  }, 4000);

  // The global hotkey is only active while unfocused; the renderer owns it when
  // focused (so hold-to-talk works there).
  mainWindow.on('focus', () => globalShortcut.unregisterAll());
  mainWindow.on('blur', () => registerGlobalHotkey());

  // Remember the window size/position across restarts.
  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);
  mainWindow.on('close', (event) => {
    clearTimeout(saveBoundsTimer);
    if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      const { width, height, x, y } = mainWindow.getBounds();
      writePreferences({ ...readPreferences(), windowBounds: { width, height, x, y } });
    }
    // Close-to-tray: hide the window and keep the node running in the background.
    if (!isQuitting && readNodeSettings().closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Resolve the tray/app icon path (dev vs packaged). */
function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png');
}

/** System-tray icon with show/hide/quit, so the app can run in the background. */
function createTray() {
  if (tray) return;
  try {
    let image = nativeImage.createFromPath(iconPath());
    if (image.isEmpty()) return; // no icon available — skip the tray rather than show a blank
    image = image.resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip(BRAND.name);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Show ${BRAND.name}`, click: () => revealWindow() },
        { label: 'Hide', click: () => mainWindow?.hide() },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
      ]),
    );
    tray.on('click', () => {
      if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else revealWindow();
    });
  } catch (error) {
    logMain(`tray init failed: ${String(error)}`);
  }
}

/** Apply the "launch at login" preference (best-effort; unsupported on some Linux). */
function applyLoginItem(enabled: boolean) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (error) {
    logMain(`setLoginItemSettings failed: ${String(error)}`);
  }
}

/** Floating, always-on-top PTT button that hovers over other applications. */
function createOverlay() {
  if (overlayWindow) {
    overlayWindow.show();
    return;
  }
  const saved = readPreferences().overlayBounds;
  overlayWindow = new BrowserWindow({
    width: saved?.width ?? 150,
    height: saved?.height ?? 98,
    x: saved?.x,
    y: saved?.y,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    // Solid dark, frameless window (no transparency — avoids the white-corner
    // artifact transparent windows show on Windows). Win11 rounds the corners.
    backgroundColor: '#171719',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Float above normal windows (and fullscreen apps where the OS allows it).
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void overlayWindow.loadURL(`${rendererUrl}#overlay`);
  } else {
    overlayWindow
      .loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
      .catch((error) => logMain(`overlay load failed: ${String(error)}`));
  }

  overlayWindow.on('moved', () => {
    if (!overlayWindow) return;
    const { width, height, x, y } = overlayWindow.getBounds();
    writePreferences({ ...readPreferences(), overlayBounds: { width, height, x, y } });
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function destroyOverlay() {
  if (overlayWindow) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
}

function broadcastTheme(mode: ThemeMode = readThemePreference()) {
  if (!mainWindow) {
    return;
  }

  const resolved = resolveTheme(mode, nativeTheme.shouldUseDarkColors);
  mainWindow.webContents.send(THEME_CHANNELS.STATE_CHANGED, { mode, resolved });
}

// ---- Global PTT hotkey ------------------------------------------------------
// globalShortcut fires only when the window is UNFOCUSED (while focused, the
// renderer's own keydown/keyup handles hold + toggle). It can't detect key
// release, so an unfocused press toggles transmit. A multi-key combo (e.g.
// Ctrl+Shift+T) registers far more reliably as a global accelerator than a bare
// key, which is why background PTT works best with a modifier.
let pttAccelerator: string | null = null;

const MODIFIER_ACCEL: Record<string, string> = {
  Control: 'Control',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Super',
};

/** Map a single KeyboardEvent.code (the combo's main key) to an accelerator. */
function keyCodeToAccelerator(code: string): string | null {
  if (!code) return null;
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad') && /Numpad[0-9]/.test(code)) return `num${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Tab: 'Tab',
  };
  return named[code] ?? null;
}

/**
 * Map a '+'-joined combo (modifiers first, main key last — e.g.
 * "Control+Shift+KeyT") to an Electron accelerator, or null if unmappable.
 */
function comboToAccelerator(combo: string): string | null {
  const parts = (combo ?? '').split('+').filter(Boolean);
  if (parts.length === 0) return null;
  const main = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => MODIFIER_ACCEL[m]).filter(Boolean);
  const key = keyCodeToAccelerator(main);
  if (!key) return null;
  return [...mods, key].join('+');
}

function registerGlobalHotkey() {
  globalShortcut.unregisterAll();
  if (!pttAccelerator || mainWindow?.isFocused()) return;
  try {
    globalShortcut.register(pttAccelerator, () => {
      mainWindow?.webContents.send(IPC_CHANNELS.PROTOCOL_PTT_HOTKEY);
    });
  } catch {
    // unsupported accelerator — the focused (renderer) handler still works
  }
}

function sendProtocolState(state: string) {
  const payload: ProtocolStatePayload = { state };
  mainWindow?.webContents.send(IPC_CHANNELS.PROTOCOL_STATE, payload);
}

// ---- Auto-update (electron-updater against GitHub Releases) -----------------
const { autoUpdater } = electronUpdater;
const RELEASES_URL = 'https://github.com/W9MDM/Kerchunk/releases';
let updateWired = false;
let updateCheckManual = false;

/** Fetch a release's notes from the GitHub API (public repo, best-effort). */
async function fetchReleaseNotes(version: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/W9MDM/Kerchunk/releases/tags/v${version}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { body?: string };
    return (data.body ?? '').trim();
  } catch {
    return '';
  }
}

function setupAutoUpdater() {
  if (updateWired) return;
  updateWired = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    void (async () => {
      const notes =
        (typeof info.releaseNotes === 'string' ? info.releaseNotes : '') || (await fetchReleaseNotes(info.version));
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_AVAILABLE, {
        version: info.version,
        notes,
        releasesUrl: RELEASES_URL,
      });
    })();
  });
  autoUpdater.on('update-not-available', () => {
    if (updateCheckManual) mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_NONE);
  });
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_PROGRESS, Math.round(p.percent));
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOADED, {
      version: info.version,
      notes: '',
      releasesUrl: RELEASES_URL,
    });
  });
  autoUpdater.on('error', (err) => {
    // Only surface errors on a manual check — auto-checks (and unsupported
    // targets like portable/.deb, which lack app-update.yml) fail quietly.
    if (updateCheckManual) mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_ERROR, err?.message ?? String(err));
    logMain(`autoUpdater error: ${err?.stack ?? err}`);
  });
}

function checkForUpdates(manual: boolean) {
  if (BRAND.id !== 'kerchunk') {
    // White-label builds (e.g. TNARA) share the Kerchunk GitHub release; auto-
    // updating would replace their branding. Point them at manual downloads.
    if (manual) mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_ERROR, 'This build updates manually — download the latest from your provider.');
    return;
  }
  if (!app.isPackaged) {
    if (manual) mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_ERROR, 'Updates are only available in a packaged build.');
    return;
  }
  setupAutoUpdater();
  updateCheckManual = manual;
  autoUpdater.checkForUpdates().catch((err) => {
    if (manual) mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_ERROR, err?.message ?? String(err));
    logMain(`checkForUpdates failed: ${String(err)}`);
  });
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
  applyMdcConfig();
  return protocolNode;
}

// AllStarLink node directory (astdb.txt), fetched once and cached ~6 h.
let nodeDirectory: DirectoryNode[] | null = null;
let nodeDirectoryAt = 0;
async function getNodeDirectory(): Promise<DirectoryNode[]> {
  if (nodeDirectory && Date.now() - nodeDirectoryAt < 6 * 60 * 60 * 1000) {
    return nodeDirectory;
  }
  try {
    const res = await fetch('http://allmondb.allstarlink.org/', { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      nodeDirectory = parseAstdb(await res.text());
      nodeDirectoryAt = Date.now();
    }
  } catch (error) {
    logMain(`node directory fetch failed: ${String(error)}`);
  }
  return nodeDirectory ?? [];
}

/** Push the operator's MDC1200 settings into the running node. */
function applyMdcConfig() {
  if (!protocolNode) return;
  const s = readNodeSettings();
  // Map the 0–100 UI level to a peak amplitude (100 ≈ 0.3). Default 65 ≈ 0.19 to
  // match a real radio's received level — lower levels arrive too weak and the
  // data codeword picks up bit errors that fail CRC even with app_rpt's FEC.
  const level = ((s.mdcLevel ?? 52) / 100) * 0.3;
  protocolNode.setMdcConfig({
    enabled: Boolean(s.mdcEnabled),
    unitId: parseUnitId(s.mdcUnitId ?? '') ?? 0,
    timing: s.mdcTiming ?? 'start',
    level,
    preambleBytes: s.mdcPreamble ?? 24,
    encode: (id, amplitude, preambleBytes) =>
      encodeMdcBurst(id, undefined, undefined, 8000, amplitude, 0, 250, preambleBytes),
  });
}

app.whenReady().then(() => {
  // The app uses an in-app icon menu (renderer); no native menu bar.
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  applyLoginItem(readNodeSettings().launchOnStartup ?? false);
  if (readNodeSettings().overlayEnabled) createOverlay();
  // Quietly check GitHub for an update shortly after launch (packaged only).
  setTimeout(() => checkForUpdates(false), 5000);

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

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_NODE_DIRECTORY, () => getNodeDirectory());

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_NODE_STATUS, async (_event, nodes: string[]) => {
    const status: Record<string, boolean> = {};
    // Respect the stats API rate limit — cap how many we poll per call.
    for (const node of (nodes ?? []).slice(0, 20)) {
      try {
        status[node] = (await fetchNodeStats(node)).keyed;
      } catch {
        // leave unknown
      }
    }
    return status;
  });

  ipcMain.handle(IPC_CHANNELS.PROTOCOL_SEND_DTMF, (_event, payload: { digits: string; label?: string }) => {
    protocolNode?.sendDtmf(payload.digits, payload.label);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => readNodeSettings());

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, settings: NodeSettings) => {
    writeNodeSettings(settings);
    applyMdcConfig();
    applyLoginItem(settings.launchOnStartup ?? false);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT, async (_event, settings: NodeSettings) => {
    const options = {
      title: 'Export Kerchunk settings',
      defaultPath: 'kerchunk-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, JSON.stringify(settings ?? readNodeSettings(), null, 2));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT, async () => {
    const options = {
      title: 'Import Kerchunk settings',
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const parsed = JSON.parse(readFileSync(result.filePaths[0], 'utf8')) as NodeSettings;
      if (!parsed || typeof parsed !== 'object') return null;
      writeNodeSettings(parsed);
      applyMdcConfig();
      applyLoginItem(parsed.launchOnStartup ?? false);
      return parsed;
    } catch (error) {
      logMain(`settings import failed: ${String(error)}`);
      return null;
    }
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
    overlayWindow?.webContents.send(IPC_CHANNELS.OVERLAY_TX, true);
  });

  ipcMain.on(IPC_CHANNELS.PROTOCOL_TX_STOP, () => {
    protocolNode?.notifyTransmitStop();
    overlayWindow?.webContents.send(IPC_CHANNELS.OVERLAY_TX, false);
  });

  // Floating PTT overlay: show/hide, and relay its button presses to the main
  // window (which owns the microphone / audio engine).
  ipcMain.on(IPC_CHANNELS.OVERLAY_SET_VISIBLE, (_event, visible: boolean) => {
    if (visible) createOverlay();
    else destroyOverlay();
    // Persist here so the choice survives restarts regardless of the renderer.
    writeNodeSettings({ ...readNodeSettings(), overlayEnabled: visible });
    mainWindow?.webContents.send(IPC_CHANNELS.OVERLAY_VISIBILITY, visible);
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_PTT, (_event, down: boolean) => {
    mainWindow?.webContents.send(IPC_CHANNELS.OVERLAY_PTT, down);
  });

  ipcMain.on(IPC_CHANNELS.UPDATE_CHECK, (_event, manual: boolean) => checkForUpdates(Boolean(manual)));
  ipcMain.on(IPC_CHANNELS.UPDATE_DOWNLOAD, () => {
    autoUpdater.downloadUpdate().catch((err) => {
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_ERROR, err?.message ?? String(err));
    });
  });
  ipcMain.on(IPC_CHANNELS.UPDATE_INSTALL, () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
  ipcMain.on(IPC_CHANNELS.OPEN_EXTERNAL, (_event, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_RX, (_event, on: boolean) => {
    overlayWindow?.webContents.send(IPC_CHANNELS.OVERLAY_RX, on);
  });
  ipcMain.on(IPC_CHANNELS.OVERLAY_MUTE, () => {
    mainWindow?.webContents.send(IPC_CHANNELS.OVERLAY_MUTE);
  });
  ipcMain.on(IPC_CHANNELS.OVERLAY_MUTED, (_event, on: boolean) => {
    overlayWindow?.webContents.send(IPC_CHANNELS.OVERLAY_MUTED, on);
  });

  ipcMain.on(IPC_CHANNELS.PROTOCOL_SET_HOTKEY, (_event, code: string) => {
    pttAccelerator = comboToAccelerator(code);
    registerGlobalHotkey();
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

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
