import { memo, useEffect, useRef, useState } from 'react';
import type { ThemeMode, ThemeState } from '../../shared/theme';
import type { NodeInfoDto, NodeSettings, ProtocolConnectionInfo, SavedNode, Topology } from '../../shared/ipc';
import { AudioEngine } from './audio/engine';
import { ActivityLog } from './components/ActivityLog';
import { LinkedNodes, type SortMode } from './components/LinkedNodes';
import { Meter } from './components/Meter';
import { NetworkTree } from './components/NetworkTree';
import { NodeIdentity } from './components/NodeIdentity';
import { SettingsModal } from './components/SettingsModal';
import kerchunkIcon from './assets/kerchunk-icon.png';
import { decodeG711Chunk } from '../../shared/audio';
import MdcDecoderWorker from './audio/mdcDecoder.worker?worker';

// Memoized so audio-level re-renders (~12/s) don't re-render these subtrees,
// which would starve the renderer's main thread and drop outbound mic frames.
const MemoActivityLog = memo(ActivityLog);

/** Shared input styling — Apple-native rounded field with a focus ring. */
const inputClass =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/30';

function MicGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/** Rate-limit level→state updates (~12/s); pass 0 through instantly so meters settle. */
function throttleLevel(setter: (value: number) => void): (value: number) => void {
  let last = 0;
  return (value: number) => {
    const now = performance.now();
    if (value === 0 || now - last >= 80) {
      last = now;
      setter(value);
    }
  };
}

/** Convert #rrggbb to the "H S% L%" triple our CSS tokens (hsl(var(--x))) expect. */
function hexToHslTriple(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Recolor the accent (primary + focus ring) app-wide from a hex color. */
function applyAccent(hex: string): void {
  const triple = hexToHslTriple(hex);
  if (!triple) return;
  const root = document.documentElement;
  root.style.setProperty('--primary', triple);
  root.style.setProperty('--ring', triple);
}

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeState>({ mode: 'system', resolved: 'light' });
  const [protocolState, setProtocolState] = useState('idle');
  const [myNode, setMyNode] = useState('');
  const [secret, setSecret] = useState('');
  const [connectNode, setConnectNode] = useState('');
  const [connectHost, setConnectHost] = useState('');
  const [mode, setMode] = useState<'node' | 'guest'>('node');
  const [callsign, setCallsign] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [wtPassword, setWtPassword] = useState('');
  const [permanent, setPermanent] = useState(false);
  const [savedNodes, setSavedNodes] = useState<SavedNode[]>([]);
  const [selfInfo, setSelfInfo] = useState<NodeInfoDto | null>(null);
  const [connections, setConnections] = useState<ProtocolConnectionInfo[]>([]);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('keyed');
  const [registered, setRegistered] = useState(false);
  const [activity, setActivity] = useState<string[]>(['Kerchunk node ready.']);
  const [txLevel, setTxLevel] = useState(0);
  const [rxLevel, setRxLevel] = useState(0);
  const [transmitting, setTransmitting] = useState(false);
  const [trace, setTraceEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiScale, setUiScale] = useState(0.75);
  const [accent, setAccent] = useState('#007aff');
  const [pttKey, setPttKey] = useState('');
  const [pttMode, setPttMode] = useState<'hold' | 'toggle'>('hold');
  const [mdcEnabled, setMdcEnabled] = useState(false);
  const [mdcUnitId, setMdcUnitId] = useState('');
  const [mdcTiming, setMdcTiming] = useState<'start' | 'end' | 'both'>('start');
  const [mdcLevel, setMdcLevel] = useState(52);
  const [heardMdc, setHeardMdc] = useState<string | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const didAutoLink = useRef(false);
  const transmittingRef = useRef(false);
  const handleTransmitRef = useRef<(on: boolean) => void>(() => {});
  const rxMdcBuffer = useRef<number[]>([]);
  const rxMdcSeen = useRef<Map<number, number>>(new Map());
  const heardMdcTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const log = (message: string) => setActivity((current) => [message, ...current].slice(0, 60));

  const getAudioEngine = () => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new AudioEngine({
        onTxFrame: (frame) => void window.electronAPI.sendAudioFrame({ frame }),
        onTxLevel: throttleLevel(setTxLevel),
        onRxLevel: throttleLevel(setRxLevel),
      });
    }
    return audioEngineRef.current;
  };

  /** Snapshot current identity + list into a settings object for persistence. */
  const buildSettings = (overrides?: Partial<NodeSettings>): NodeSettings => ({
    myNode: myNode.trim(),
    secret,
    connectHost: connectHost.trim(),
    callsign: callsign.trim(),
    operatorName: operatorName.trim(),
    wtPassword,
    savedNodes,
    uiScale,
    accent,
    pttKey,
    pttMode,
    mdcEnabled,
    mdcUnitId,
    mdcTiming,
    mdcLevel,
    ...overrides,
  });

  const persist = (patch: Partial<NodeSettings>) => window.electronAPI.saveSettings(buildSettings(patch));

  const handleScaleChange = (factor: number) => {
    setUiScale(factor);
    void window.electronAPI.setZoom(factor);
    void window.electronAPI.saveSettings(buildSettings({ uiScale: factor }));
  };

  const handleAccentChange = (hex: string) => {
    setAccent(hex);
    applyAccent(hex);
    void window.electronAPI.saveSettings(buildSettings({ accent: hex }));
  };

  useEffect(() => {
    void window.electronAPI.getSettings().then((settings) => {
      if (settings.myNode) setMyNode(settings.myNode);
      if (settings.secret) setSecret(settings.secret);
      if (settings.connectHost) setConnectHost(settings.connectHost);
      if (settings.callsign) setCallsign(settings.callsign);
      if (settings.operatorName) setOperatorName(settings.operatorName);
      if (settings.wtPassword) setWtPassword(settings.wtPassword);
      if (settings.savedNodes) setSavedNodes(settings.savedNodes);
      if (settings.uiScale) {
        setUiScale(settings.uiScale);
        void window.electronAPI.setZoom(settings.uiScale);
      }
      if (settings.accent) {
        setAccent(settings.accent);
        applyAccent(settings.accent);
      }
      if (settings.pttKey !== undefined) {
        setPttKey(settings.pttKey);
        window.electronAPI.setHotkey(settings.pttKey); // register global hotkey on load
      }
      if (settings.pttMode) setPttMode(settings.pttMode);
      if (settings.mdcEnabled) setMdcEnabled(settings.mdcEnabled);
      if (settings.mdcUnitId) setMdcUnitId(settings.mdcUnitId);
      if (settings.mdcTiming) setMdcTiming(settings.mdcTiming);
      if (typeof settings.mdcLevel === 'number') setMdcLevel(settings.mdcLevel);
      if (settings.myNode) void window.electronAPI.getNodeInfo(settings.myNode).then(setSelfInfo);
    });
    void window.electronAPI.getThemeState().then(setTheme);
    const disposers = [
      window.electronAPI.onThemeChange(setTheme),
      window.electronAPI.onProtocolState((payload) => {
        setProtocolState(payload.state);
        log(payload.state);
      }),
      window.electronAPI.onProtocolConnections((payload) => setConnections(payload.connections)),
      window.electronAPI.onProtocolAudio((payload) => {
        getAudioEngine().playFrame(payload.frame);
        // Buffer RX PCM for MDC1200 decode (bounded to ~2 s).
        const pcm = decodeG711Chunk(new Uint8Array(payload.frame));
        const buf = rxMdcBuffer.current;
        for (let i = 0; i < pcm.length; i += 1) buf.push(pcm[i]);
        if (buf.length > 16000) buf.splice(0, buf.length - 16000);
      }),
      window.electronAPI.onProtocolDtmf((payload) => log(`DTMF from peer: ${payload.digit}`)),
      // Global hotkey (window unfocused) toggles transmit.
      window.electronAPI.onPttHotkey(() => handleTransmitRef.current(!transmittingRef.current)),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme.resolved === 'dark');
    document.documentElement.style.colorScheme = theme.resolved;
  }, [theme.resolved]);

  // Decode incoming MDC1200 PTT-ID bursts in a Web Worker so the (CRC-gated)
  // search never blocks the main thread / mic handoff. Dedupe within 8 s.
  useEffect(() => {
    const worker = new MdcDecoderWorker();
    worker.onmessage = (event: MessageEvent<string[]>) => {
      const now = performance.now();
      for (const id of event.data) {
        const key = parseInt(id, 16);
        const last = rxMdcSeen.current.get(key) ?? -Infinity;
        if (now - last > 8000) log(`MDC1200 ID received: ${id}`);
        rxMdcSeen.current.set(key, now);
        setHeardMdc(id);
        clearTimeout(heardMdcTimer.current);
        heardMdcTimer.current = setTimeout(() => setHeardMdc(null), 15000);
      }
    };
    const timer = setInterval(() => {
      const buf = rxMdcBuffer.current;
      if (buf.length < 1400) return;
      const samples = Int16Array.from(buf);
      if (buf.length > 2000) buf.splice(0, buf.length - 2000); // keep a little overlap
      worker.postMessage(samples, [samples.buffer]);
    }, 1000);
    return () => {
      clearInterval(timer);
      worker.terminate();
    };
  }, []);

  // Auto-reconnect permanent saved nodes once, on first load.
  useEffect(() => {
    if (didAutoLink.current || savedNodes.length === 0) return;
    const permanentNodes = savedNodes.filter((n) => n.permanent);
    if (permanentNodes.length === 0) return;
    didAutoLink.current = true;
    void getAudioEngine().start();
    // Auto-register (node mode) so permanent links are accepted.
    const node = myNode.trim();
    const registerFirst =
      node && secret
        ? window.electronAPI
            .register({ node, password: secret })
            .then((r) => setRegistered(r.success))
            .catch(() => undefined)
        : Promise.resolve();
    void registerFirst.then(() => {
    for (const n of permanentNodes) {
      log(`Auto-linking permanent node ${n.number}…`);
      void window.electronAPI
        .connect({
          node: n.number,
          calledNumber: n.number,
          username: myNode.trim() || undefined,
          secret: secret || undefined,
          monitor: n.monitor,
        })
        .catch((error) => log(error instanceof Error ? error.message : `Could not auto-link ${n.number}.`));
    }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedNodes]);

  const refreshTopology = async () => {
    try {
      setTopology(await window.electronAPI.getTopology());
    } catch {
      // leave the previous topology in place
    }
  };

  /** Refresh button: re-sync the direct links (repopulate + re-fetch info) and
   * the network map. */
  const handleRefresh = async () => {
    try {
      await window.electronAPI.refreshConnections();
    } catch {
      // ignore — topology refresh still runs below
    }
    await refreshTopology();
  };

  useEffect(() => {
    if (connections.length === 0) {
      setTopology(null);
      return;
    }
    // One deferred fetch well clear of call setup; refresh is manual after that.
    const id = setTimeout(() => void refreshTopology(), 6000);
    return () => clearTimeout(id);
  }, [connections.length]);

  const handleThemeChange = async (mode: ThemeMode) => {
    setTheme(await window.electronAPI.setThemeMode(mode));
  };

  /** Add or update a node in the saved list and persist. */
  const rememberNode = (number: string, extra?: Partial<SavedNode>) => {
    setSavedNodes((prev) => {
      const existing = prev.find((n) => n.number === number);
      const merged: SavedNode = { number, ...existing, ...extra };
      const next = [merged, ...prev.filter((n) => n.number !== number)];
      void window.electronAPI.saveSettings(buildSettings({ savedNodes: next }));
      return next;
    });
  };

  const updateSaved = (number: string, patch: Partial<SavedNode>) => {
    setSavedNodes((prev) => {
      const next = prev.map((n) => (n.number === number ? { ...n, ...patch } : n));
      void window.electronAPI.saveSettings(buildSettings({ savedNodes: next }));
      return next;
    });
  };

  const removeSaved = (number: string) => {
    setSavedNodes((prev) => {
      const next = prev.filter((n) => n.number !== number);
      void window.electronAPI.saveSettings(buildSettings({ savedNodes: next }));
      return next;
    });
  };

  /** Register with AllStarLink if we haven't yet (best-effort, node mode). */
  const ensureRegistered = async () => {
    if (registered) return;
    const node = myNode.trim();
    if (!node || !secret) {
      log('To register, set your node number and secret in Settings (gear icon).');
      return;
    }
    log(`Registering node ${node} with AllStarLink…`);
    try {
      const result = await window.electronAPI.register({ node, password: secret });
      setRegistered(result.success);
      log(
        result.success
          ? `Registered ${node} @ ${result.ipaddr ?? '?'} (refresh ${result.refresh}s).`
          : `Registration failed: ${result.message ?? 'unknown error'}.`,
      );
    } catch (error) {
      log(error instanceof Error ? error.message : 'Registration error.');
    }
  };

  const handleConnect = async (monitor: boolean) => {
    const node = connectNode.trim();
    const host = connectHost.trim();
    const guestMode = mode === 'guest';
    if (!node && !host) {
      log('Enter a node number to link to (or a direct address).');
      return;
    }
    if (guestMode && (!callsign.trim() || !wtPassword)) {
      log('Web Transceiver needs your callsign and allstarlink.org portal password.');
      return;
    }
    if (guestMode && !node) {
      log('Web Transceiver needs a node number (the portal issues a token per node).');
      return;
    }
    log(`${monitor ? 'Monitoring' : 'Linking to'} ${host || `node ${node}`}${guestMode ? ' as guest' : ''}…`);
    try {
      await getAudioEngine().start();
      if (!guestMode) await ensureRegistered(); // node mode auto-registers on Link
      if (guestMode) {
        await window.electronAPI.connectGuest({
          node: node || undefined,
          host: host || undefined,
          callsign: callsign.trim(),
          password: wtPassword,
        });
      } else {
        await window.electronAPI.connect({
          node: node || undefined,
          host: host || undefined,
          calledNumber: node || undefined,
          username: myNode.trim() || undefined,
          secret: secret || undefined,
          monitor,
        });
      }
      if (node) rememberNode(node, { permanent: permanent || undefined, monitor: monitor || undefined });
      setConnectNode('');
    } catch (error) {
      log(error instanceof Error ? error.message : 'Unable to link.');
    }
  };

  const handleRegister = async () => {
    const node = myNode.trim();
    if (!node || !secret) {
      log('Enter your node number and secret to register.');
      return;
    }
    log(`Registering node ${node} with AllStarLink…`);
    try {
      const result = await window.electronAPI.register({ node, password: secret });
      setRegistered(result.success);
      log(
        result.success
          ? `Registered — visible at ${result.ipaddr ?? '?'} (refresh ${result.refresh}s).`
          : `Registration failed: ${result.message ?? 'unknown error'}.`,
      );
      void window.electronAPI.getNodeInfo(node).then(setSelfInfo);
    } catch (error) {
      log(error instanceof Error ? error.message : 'Unable to register.');
    }
  };

  const handleDisconnect = async (label: string) => {
    await window.electronAPI.disconnect({ label });
    log(`Disconnected ${label}.`);
  };

  const handleDisconnectAll = async () => {
    handleTransmit(false);
    await window.electronAPI.hangup();
    log('Dropped all links.');
  };

  const handleTransmit = (on: boolean) => {
    audioEngineRef.current?.setTransmitting(on);
    transmittingRef.current = on;
    setTransmitting(on);
    if (on) {
      // Local talk-permit tone while the MDC PTT-ID goes out over the air.
      if (mdcEnabled && (mdcTiming === 'start' || mdcTiming === 'both')) {
        audioEngineRef.current?.playTalkPermitTone();
      }
      window.electronAPI.txStart(); // re-establish the stream on each key-up
    } else {
      window.electronAPI.txStop(); // RADIO_UNKEY on guest (web transceiver) links
    }
  };
  handleTransmitRef.current = handleTransmit; // keep the ref current for effects

  const handlePttKeyChange = (code: string) => {
    setPttKey(code);
    window.electronAPI.setHotkey(code); // register globally (fires when unfocused)
    void window.electronAPI.saveSettings(buildSettings({ pttKey: code }));
  };
  const handlePttModeChange = (mode: 'hold' | 'toggle') => {
    setPttMode(mode);
    void window.electronAPI.saveSettings(buildSettings({ pttMode: mode }));
  };
  const handleMdcEnabledChange = (on: boolean) => {
    setMdcEnabled(on);
    void persist({ mdcEnabled: on });
  };
  const handleMdcUnitIdChange = (id: string) => {
    setMdcUnitId(id);
    void persist({ mdcUnitId: id });
  };
  const handleMdcTimingChange = (t: 'start' | 'end' | 'both') => {
    setMdcTiming(t);
    void persist({ mdcTiming: t });
  };
  const handleMdcLevelChange = (level: number) => {
    setMdcLevel(level);
    void persist({ mdcLevel: level });
  };

  // PTT hotkey: hold-to-talk or press-to-toggle, ignored while typing in a field.
  useEffect(() => {
    if (!pttKey) return;
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== pttKey || event.repeat || isTyping()) return;
      event.preventDefault();
      if (pttMode === 'toggle') handleTransmitRef.current(!transmittingRef.current);
      else if (!transmittingRef.current) handleTransmitRef.current(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== pttKey || pttMode !== 'hold') return;
      if (transmittingRef.current) handleTransmitRef.current(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pttKey, pttMode]);

  const handleTraceToggle = async (enabled: boolean) => {
    setTraceEnabled(enabled);
    await window.electronAPI.setDebug(enabled);
  };

  const handleSaveSettings = async () => {
    await window.electronAPI.saveSettings(buildSettings());
    if (myNode.trim()) void window.electronAPI.getNodeInfo(myNode.trim()).then(setSelfInfo);
    setSettingsOpen(false);
    log('Settings saved.');
  };

  /** Link a specific saved node (per-row Link button). */
  const handleConnectSaved = async (n: SavedNode) => {
    log(`${n.monitor ? 'Monitoring' : 'Linking to'} node ${n.number}…`);
    try {
      await getAudioEngine().start();
      await ensureRegistered(); // saved-node links are node-mode → auto-register
      await window.electronAPI.connect({
        node: n.number,
        calledNumber: n.number,
        username: myNode.trim() || undefined,
        secret: secret || undefined,
        monitor: n.monitor,
      });
    } catch (error) {
      log(error instanceof Error ? error.message : `Unable to link ${n.number}.`);
    }
  };

  const guestMode = mode === 'guest';
  const receiving = rxLevel > 2;
  const identityNode = guestMode ? callsign || '—' : myNode || '—';

  return (
    <main className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-4 py-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={kerchunkIcon} alt="Kerchunk" className="h-10 w-10 rounded-[10px] shadow-card" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">Kerchunk</h1>
              <p className="text-xs text-muted-foreground">Self-contained AllStar node</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
              <button
                onClick={() => setMode('node')}
                className={`rounded-md px-3 py-1.5 transition ${
                  mode === 'node' ? 'bg-connected text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Node
              </button>
              <button
                onClick={() => setMode('guest')}
                className={`rounded-md px-3 py-1.5 transition ${
                  mode === 'guest' ? 'bg-tx text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Web TX
              </button>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <GearGlyph />
            </button>
          </div>
        </header>

        {/* Node identity */}
        <NodeIdentity
          node={identityNode}
          callsign={guestMode ? callsign : selfInfo?.callsign ?? callsign}
          description={guestMode ? undefined : selfInfo?.description}
          location={guestMode ? undefined : selfInfo?.location}
          operatorName={operatorName}
          linkedCount={connections.length}
          state={protocolState}
          transmitting={transmitting}
          receiving={receiving}
          guest={guestMode}
          heardMdc={heardMdc}
        />

        {/* Transmit */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="grid gap-2.5">
            <Meter value={txLevel} label="Transmit" tone="tx" />
            <Meter value={rxLevel} label="Receive" tone="rx" />
          </div>
          <button
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              handleTransmit(true);
            }}
            onPointerUp={() => handleTransmit(false)}
            onPointerCancel={() => handleTransmit(false)}
            className={`mt-4 flex w-full select-none items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold transition ${
              transmitting ? 'bg-tx text-white shadow-ptt' : 'bg-accent text-foreground hover:bg-accent/70'
            }`}
          >
            <MicGlyph />
            {transmitting ? 'Transmitting…' : 'Hold to Talk'}
          </button>
        </section>

        {/* Link controls */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Link a node</h2>
            <span className="text-xs font-medium text-muted-foreground">
              {mode === 'node' ? 'Node mode' : 'Web Transceiver'}
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <input value={connectNode} onChange={(e) => setConnectNode(e.target.value)} inputMode="numeric" className={inputClass} placeholder="Link to node number" />
            {savedNodes.length > 0 ? (
              <select value="" onChange={(e) => e.target.value && setConnectNode(e.target.value)} className={inputClass}>
                <option value="">Choose a saved node…</option>
                {savedNodes.map((n) => (
                  <option key={n.number} value={n.number}>
                    {n.number}
                    {n.note ? ` — ${n.note}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={connectHost}
                onChange={(e) => setConnectHost(e.target.value)}
                disabled={mode === 'guest'}
                className={`${inputClass} disabled:opacity-40`}
                placeholder={mode === 'guest' ? 'node number required' : '…or direct address'}
              />
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleConnect(false)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              Link
            </button>
            <button
              onClick={() => void handleConnect(true)}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent"
              title="Connect receive-only"
            >
              Monitor
            </button>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
              Permanent
            </label>
            {mode === 'guest' && !callsign && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="ml-auto text-xs font-medium text-primary hover:underline"
              >
                Set portal login in Settings →
              </button>
            )}
          </div>
        </section>

        {/* Linked nodes (Direct — actionable) */}
        <LinkedNodes
          connections={connections}
          sortMode={sortMode}
          onSort={setSortMode}
          onUnlink={(label) => void handleDisconnect(label)}
          onUnlinkAll={() => void handleDisconnectAll()}
          onRefresh={() => void handleRefresh()}
        />

        {/* Network map (tree of the mesh you're linked into) */}
        <NetworkTree topology={topology} onRefresh={() => void handleRefresh()} />

        {/* Saved nodes */}
        {savedNodes.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <h2 className="mb-3 text-sm font-semibold">Saved nodes</h2>
            <ul className="space-y-1.5">
              {savedNodes.map((n) => {
                const isLinked = connections.some((c) => c.label === n.number);
                return (
                  <li
                    key={n.number}
                    className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm">
                        <span className="font-semibold tabular-nums">{n.number}</span>
                        {n.note ? <span className="text-muted-foreground"> {n.note}</span> : ''}
                        {n.monitor && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">monitor</span>}
                        {isLinked && <span className="ml-2 rounded-full bg-connected/15 px-2 py-0.5 text-[11px] text-connected">linked</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => updateSaved(n.number, { permanent: !n.permanent })}
                        title={n.permanent ? 'Permanent (auto-links on start)' : 'Make permanent'}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                          n.permanent
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        📌 Permanent
                      </button>
                      {!isLinked && (
                        <button
                          onClick={() => {
                            setConnectNode(n.number);
                            void handleConnectSaved(n);
                          }}
                          className="rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:bg-accent"
                        >
                          Link
                        </button>
                      )}
                      <button
                        onClick={() => removeSaved(n.number)}
                        title="Remove from list"
                        className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <MemoActivityLog entries={activity} />

        <footer className="pb-2 text-center text-xs text-muted-foreground">
          Kerchunk — Copyright © 2026 W9MDM · MIT License · Not affiliated with AllStarLink
        </footer>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        myNode={myNode}
        setMyNode={setMyNode}
        secret={secret}
        setSecret={setSecret}
        operatorName={operatorName}
        setOperatorName={setOperatorName}
        callsign={callsign}
        setCallsign={setCallsign}
        wtPassword={wtPassword}
        setWtPassword={setWtPassword}
        theme={theme}
        onThemeChange={(m) => void handleThemeChange(m)}
        uiScale={uiScale}
        onScaleChange={handleScaleChange}
        accent={accent}
        onAccentChange={handleAccentChange}
        pttKey={pttKey}
        pttMode={pttMode}
        onPttKeyChange={handlePttKeyChange}
        onPttModeChange={handlePttModeChange}
        mdcEnabled={mdcEnabled}
        mdcUnitId={mdcUnitId}
        mdcTiming={mdcTiming}
        mdcLevel={mdcLevel}
        onMdcEnabledChange={handleMdcEnabledChange}
        onMdcUnitIdChange={handleMdcUnitIdChange}
        onMdcTimingChange={handleMdcTimingChange}
        onMdcLevelChange={handleMdcLevelChange}
        registered={registered}
        onRegister={() => void handleRegister()}
        onSave={() => void handleSaveSettings()}
        trace={trace}
        onTraceToggle={(enabled) => void handleTraceToggle(enabled)}
      />
    </main>
  );
}
