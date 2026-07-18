import { memo, useEffect, useRef, useState } from 'react';
import type { ThemeMode, ThemeState } from '../../shared/theme';
import type { DtmfCommand, NodeInfoDto, NodeSettings, ProtocolConnectionInfo, SavedNode, Topology } from '../../shared/ipc';
import { AudioEngine } from './audio/engine';
import { ActivityLog } from './components/ActivityLog';
import { CollapsibleSection } from './components/CollapsibleSection';
import { LinkedNodes, type SortMode } from './components/LinkedNodes';
import { Meter } from './components/Meter';
import { NetworkTree } from './components/NetworkTree';
import { NodeIdentity } from './components/NodeIdentity';
import { SettingsModal } from './components/SettingsModal';
import { NodeDirectory } from './components/NodeDirectory';
import { DtmfPad } from './components/DtmfPad';
import { AppMenu } from './components/AppMenu';
import kerchunkIcon from './assets/kerchunk-icon.png';
import { decodeG711Chunk } from '../../shared/audio';
import MdcDecoderWorker from './audio/mdcDecoder.worker?worker';
import { FontAwesomeIcon, faTowerBroadcast, faMicrophone, faMagnifyingGlass, faFloppyDisk } from './icons';

const MAX_RECENTS = 10;

/** Match a live keydown against a stored '+'-combo (modifiers first, key last). */
function comboMatches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+').filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  return (
    event.code === key &&
    event.ctrlKey === mods.has('Control') &&
    event.altKey === mods.has('Alt') &&
    event.shiftKey === mods.has('Shift') &&
    event.metaKey === mods.has('Meta')
  );
}

// Memoized so audio-level re-renders (~12/s) don't re-render these subtrees,
// which would starve the renderer's main thread and drop outbound mic frames.
const MemoActivityLog = memo(ActivityLog);

/** Shared input styling — Apple-native rounded field with a focus ring.
 * w-full + min-w-0 lets fields shrink inside grid/flex cells (no overflow). */
const inputClass =
  'w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/30';

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

/** Speak a short announcement via the browser's TTS (connect/disconnect cues). */
function speak(text: string): void {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    // TTS unavailable — ignore
  }
}

/** Read a node number digit-by-digit so TTS is clear ("1 2 3 4 5"). */
function spellNode(label: string): string {
  return /^[0-9]+$/.test(label) ? label.split('').join(' ') : label;
}

/** Recolor the accent (primary + focus ring) app-wide from a hex color. */
function applyAccent(hex: string): void {
  const triple = hexToHslTriple(hex);
  if (!triple) return;
  const root = document.documentElement;
  root.style.setProperty('--primary', triple);
  root.style.setProperty('--ring', triple);
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
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [keyedNumbers, setKeyedNumbers] = useState<Set<string>>(new Set());
  const [uiScale, setUiScale] = useState(0.75);
  const [accent, setAccent] = useState('#007aff');
  const [pttKey, setPttKey] = useState('');
  const [pttMode, setPttMode] = useState<'hold' | 'toggle'>('hold');
  const [mdcEnabled, setMdcEnabled] = useState(false);
  const [mdcUnitId, setMdcUnitId] = useState('');
  const [mdcTiming, setMdcTiming] = useState<'start' | 'end' | 'both'>('start');
  const [mdcLevel, setMdcLevel] = useState(52);
  const [mdcPreamble, setMdcPreamble] = useState(24);
  const [heardMdc, setHeardMdc] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [audioInput, setAudioInput] = useState('');
  const [audioOutput, setAudioOutput] = useState('');
  const [recentNodes, setRecentNodes] = useState<SavedNode[]>([]);
  const [dtmfCommands, setDtmfCommands] = useState<DtmfCommand[]>([]);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [iaxUser, setIaxUser] = useState('');
  const [iaxSecret, setIaxSecret] = useState('');
  const [closeToTray, setCloseToTray] = useState(false);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const ttsEnabledRef = useRef(false);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const didAutoLink = useRef(false);
  const transmittingRef = useRef(false);
  const handleTransmitRef = useRef<(on: boolean) => void>(() => {});
  const rxMdcBuffer = useRef<number[]>([]);
  const rxMdcSeen = useRef<Map<number, number>>(new Map());
  const prevConnRef = useRef<Set<string> | null>(null);
  const prevUpRef = useRef<Set<string> | null>(null);
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
    mdcPreamble,
    mode,
    ttsEnabled,
    audioInput,
    audioOutput,
    recentNodes,
    dtmfCommands,
    advancedMode,
    iaxUser,
    iaxSecret,
    closeToTray,
    launchOnStartup,
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

  /** Push a settings object into all the UI state (used on load and on import). */
  const applyLoadedSettings = (settings: NodeSettings) => {
    if (settings.myNode !== undefined) setMyNode(settings.myNode);
    if (settings.secret !== undefined) setSecret(settings.secret);
    if (settings.connectHost !== undefined) setConnectHost(settings.connectHost);
    if (settings.callsign !== undefined) setCallsign(settings.callsign);
    if (settings.operatorName !== undefined) setOperatorName(settings.operatorName);
    if (settings.wtPassword !== undefined) setWtPassword(settings.wtPassword);
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
      window.electronAPI.setHotkey(settings.pttKey); // register global hotkey
    }
    if (settings.pttMode) setPttMode(settings.pttMode);
    if (typeof settings.mdcEnabled === 'boolean') setMdcEnabled(settings.mdcEnabled);
    if (settings.mdcUnitId !== undefined) setMdcUnitId(settings.mdcUnitId);
    if (settings.mdcTiming) setMdcTiming(settings.mdcTiming);
    if (typeof settings.mdcLevel === 'number') setMdcLevel(settings.mdcLevel);
    if (typeof settings.mdcPreamble === 'number') setMdcPreamble(settings.mdcPreamble);
    if (settings.mode) setMode(settings.mode);
    if (typeof settings.ttsEnabled === 'boolean') {
      setTtsEnabled(settings.ttsEnabled);
      ttsEnabledRef.current = settings.ttsEnabled;
    }
    if (settings.audioInput !== undefined) setAudioInput(settings.audioInput);
    if (settings.audioOutput !== undefined) setAudioOutput(settings.audioOutput);
    if (settings.audioInput || settings.audioOutput) {
      void getAudioEngine().setDevices(settings.audioInput ?? '', settings.audioOutput ?? '');
    }
    if (settings.recentNodes) setRecentNodes(settings.recentNodes);
    if (settings.dtmfCommands) setDtmfCommands(settings.dtmfCommands);
    if (typeof settings.advancedMode === 'boolean') setAdvancedMode(settings.advancedMode);
    if (settings.iaxUser !== undefined) setIaxUser(settings.iaxUser);
    if (settings.iaxSecret !== undefined) setIaxSecret(settings.iaxSecret);
    if (typeof settings.closeToTray === 'boolean') setCloseToTray(settings.closeToTray);
    if (typeof settings.launchOnStartup === 'boolean') setLaunchOnStartup(settings.launchOnStartup);
    if (settings.myNode) void window.electronAPI.getNodeInfo(settings.myNode).then(setSelfInfo);
  };

  useEffect(() => {
    void window.electronAPI.getSettings().then(applyLoadedSettings);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Live keyed status for saved nodes (poll the stats API, ~45s).
  const savedKey = savedNodes.map((n) => n.number).join(',');
  useEffect(() => {
    if (!savedKey) {
      setKeyedNumbers(new Set());
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await window.electronAPI.getNodeStatus(savedKey.split(','));
        if (!cancelled) {
          setKeyedNumbers(new Set(Object.entries(status).filter(([, v]) => v).map(([k]) => k)));
        }
      } catch {
        // ignore
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 45000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [savedKey]);

  // One-shot metadata backfill: fill in callsign/location/description for saved
  // nodes that were remembered before we captured "who they are" (e.g. via Link).
  const backfilledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const n of savedNodes) {
      if (n.callsign || !/^\d+$/.test(n.number) || backfilledRef.current.has(n.number)) continue;
      backfilledRef.current.add(n.number);
      void window.electronAPI.getNodeInfo(n.number).then((info) => {
        if (!info) return;
        const patch: Partial<SavedNode> = {};
        if (info.callsign) patch.callsign = info.callsign;
        if (info.location) patch.location = info.location;
        if (info.description) patch.description = info.description;
        if (Object.keys(patch).length > 0) updateSaved(n.number, patch);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedNodes]);

  // Speak connect/disconnect/failure announcements as links come and go.
  // "Connected" only fires once a call is actually up (not while still calling);
  // a leg that vanishes without ever coming up is a failed call, not a disconnect.
  useEffect(() => {
    const allNow = new Set(connections.map((c) => c.label));
    const upNow = new Set(connections.filter((c) => c.up).map((c) => c.label));
    const prevAll = prevConnRef.current;
    const prevUp = prevUpRef.current;
    // Bookkeeping runs regardless; only the spoken cue is gated on the TTS setting
    // (so turning TTS on later doesn't replay a backlog of past events).
    const say = (text: string) => {
      if (ttsEnabledRef.current) speak(text);
    };
    if (prevAll && prevUp) {
      for (const label of upNow) if (!prevUp.has(label)) say(`Connected to ${spellNode(label)}`);
      for (const label of prevAll) {
        if (allNow.has(label)) continue;
        if (prevUp.has(label)) say(`${spellNode(label)} disconnected`);
        else say(`Call to ${spellNode(label)} failed`);
      }
    }
    prevConnRef.current = allNow;
    prevUpRef.current = upNow;
  }, [connections]);

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
    // Backfill "who they are" from the stats API when the caller didn't supply it
    // (e.g. remembered via Link rather than the directory's Save button).
    if (/^\d+$/.test(number) && !extra?.callsign) {
      void window.electronAPI.getNodeInfo(number).then((info) => {
        if (!info) return;
        const patch: Partial<SavedNode> = {};
        if (info.callsign) patch.callsign = info.callsign;
        if (info.location) patch.location = info.location;
        if (info.description) patch.description = info.description;
        if (Object.keys(patch).length > 0) updateSaved(number, patch);
      });
    }
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

  /** Record a node in the recents list (most-recent first, capped). Connecting
   * adds here — NOT to saved — so the saved list stays curated by the operator. */
  const addRecent = (number: string, extra?: Partial<SavedNode>) => {
    if (!number) return;
    setRecentNodes((prev) => {
      const existing = prev.find((n) => n.number === number);
      const merged: SavedNode = { number, ...existing, ...extra };
      const next = [merged, ...prev.filter((n) => n.number !== number)].slice(0, MAX_RECENTS);
      void window.electronAPI.saveSettings(buildSettings({ recentNodes: next }));
      return next;
    });
    if (/^\d+$/.test(number) && !extra?.callsign) {
      void window.electronAPI.getNodeInfo(number).then((info) => {
        if (!info) return;
        setRecentNodes((prev) => {
          const next = prev.map((n) =>
            n.number === number
              ? { ...n, callsign: info.callsign ?? n.callsign, location: info.location ?? n.location, description: info.description ?? n.description }
              : n,
          );
          void window.electronAPI.saveSettings(buildSettings({ recentNodes: next }));
          return next;
        });
      });
    }
  };

  /** Save button (Link controls): explicitly add the typed node to saved nodes. */
  const saveCurrentNode = () => {
    const number = connectNode.trim();
    if (!number) {
      log('Enter a node number to save.');
      return;
    }
    const known = recentNodes.find((n) => n.number === number);
    rememberNode(number, known ? { callsign: known.callsign, location: known.location, description: known.description } : undefined);
    log(`Saved node ${number}.`);
  };

  const addDtmfCommand = (command: DtmfCommand) => {
    setDtmfCommands((prev) => {
      const next = [...prev.filter((c) => c.label !== command.label), command];
      void window.electronAPI.saveSettings(buildSettings({ dtmfCommands: next }));
      return next;
    });
  };
  const removeDtmfCommand = (label: string) => {
    setDtmfCommands((prev) => {
      const next = prev.filter((c) => c.label !== label);
      void window.electronAPI.saveSettings(buildSettings({ dtmfCommands: next }));
      return next;
    });
  };

  const handleTtsToggle = (on: boolean) => {
    setTtsEnabled(on);
    ttsEnabledRef.current = on;
    void persist({ ttsEnabled: on });
  };
  const handleAudioInputChange = (deviceId: string) => {
    setAudioInput(deviceId);
    void getAudioEngine().setDevices(deviceId, audioOutput);
    void persist({ audioInput: deviceId });
  };
  const handleAudioOutputChange = (deviceId: string) => {
    setAudioOutput(deviceId);
    void getAudioEngine().setDevices(audioInput, deviceId);
    void persist({ audioOutput: deviceId });
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

  const handleConnect = async (monitor: boolean, nodeOverride?: string) => {
    const node = (nodeOverride ?? connectNode).trim();
    const host = nodeOverride ? '' : connectHost.trim();
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
        // Direct-address links can use dedicated IAX credentials (advanced), else
        // fall back to the node's own number/secret.
        await window.electronAPI.connect({
          node: node || undefined,
          host: host || undefined,
          calledNumber: node || undefined,
          username: (host && iaxUser.trim()) || myNode.trim() || undefined,
          secret: (host && iaxSecret) || secret || undefined,
          monitor,
        });
      }
      if (node) addRecent(node);
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
  const handleModeChange = (next: 'node' | 'guest') => {
    setMode(next);
    void window.electronAPI.saveSettings(buildSettings({ mode: next }));
  };
  const handleAdvancedToggle = () => {
    setAdvancedMode((prev) => {
      const next = !prev;
      void window.electronAPI.saveSettings(buildSettings({ advancedMode: next }));
      log(next ? 'Advanced mode on — direct linking & IAX credentials enabled.' : 'Advanced mode off.');
      return next;
    });
  };
  const handleIaxUserChange = (v: string) => {
    setIaxUser(v);
    void persist({ iaxUser: v });
  };
  const handleIaxSecretChange = (v: string) => {
    setIaxSecret(v);
    void persist({ iaxSecret: v });
  };
  const handleCloseToTrayToggle = (on: boolean) => {
    setCloseToTray(on);
    void persist({ closeToTray: on });
  };
  const handleLaunchOnStartupToggle = (on: boolean) => {
    setLaunchOnStartup(on);
    void persist({ launchOnStartup: on });
  };
  const handleExportSettings = async () => {
    const ok = await window.electronAPI.exportSettings(buildSettings());
    if (ok) log('Settings exported.');
  };
  const handleImportSettings = async () => {
    const imported = await window.electronAPI.importSettings();
    if (!imported) return;
    applyLoadedSettings(imported);
    log('Settings imported.');
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
  const handleMdcPreambleChange = (bytes: number) => {
    setMdcPreamble(bytes);
    void persist({ mdcPreamble: bytes });
  };

  // PTT hotkey: hold-to-talk or press-to-toggle, ignored while typing in a field.
  useEffect(() => {
    if (!pttKey) return;
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    };
    const mainKey = pttKey.split('+').filter(Boolean).pop() ?? pttKey;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTyping() || !comboMatches(event, pttKey)) return;
      event.preventDefault();
      if (pttMode === 'toggle') handleTransmitRef.current(!transmittingRef.current);
      else if (!transmittingRef.current) handleTransmitRef.current(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // Releasing the combo's main key ends hold-to-talk (modifiers may lift first).
      if (pttMode !== 'hold' || event.code !== mainKey) return;
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
      addRecent(n.number, { callsign: n.callsign, location: n.location, description: n.description });
    } catch (error) {
      log(error instanceof Error ? error.message : `Unable to link ${n.number}.`);
    }
  };

  const guestMode = mode === 'guest';
  const receiving = rxLevel > 2;
  const identityNode = guestMode ? callsign || '—' : myNode || '—';
  const hasNodeCreds = Boolean(myNode.trim() && secret);
  const hasGuestCreds = Boolean(callsign.trim() && wtPassword);

  /** A mode's credentials are missing — nudge the operator to Settings. */
  const openCredsHint = (which: 'node' | 'guest') => {
    log(
      which === 'node'
        ? 'Set your node number and secret in Settings to use Node mode.'
        : 'Set your callsign and portal password in Settings to use Web Transceiver.',
    );
    setSettingsOpen(true);
  };

  const handleAbout = () => {
    log('Kerchunk — self-contained AllStarLink desktop node · © 2026 W9MDM · MIT License.');
  };

  return (
    <main className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-2.5 px-3 py-3">
        {/* Header */}
        <header className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src={kerchunkIcon} alt="Kerchunk" className="h-9 w-9 shrink-0 rounded-[10px] shadow-card" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight">Kerchunk</h1>
              <p className="truncate text-xs text-muted-foreground">Self-contained AllStar node</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
              <button
                onClick={() => (hasNodeCreds ? handleModeChange('node') : openCredsHint('node'))}
                title={hasNodeCreds ? 'Operate as your registered node' : 'Set your node number & secret in Settings'}
                className={`rounded-md px-2.5 py-1.5 transition ${
                  mode === 'node' ? 'bg-connected text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                } ${hasNodeCreds ? '' : 'opacity-50'}`}
              >
                Node
              </button>
              <button
                onClick={() => (hasGuestCreds ? handleModeChange('guest') : openCredsHint('guest'))}
                title={hasGuestCreds ? 'Operate as a Web Transceiver guest' : 'Set your callsign & portal password in Settings'}
                className={`rounded-md px-2.5 py-1.5 transition ${
                  mode === 'guest' ? 'bg-tx text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                } ${hasGuestCreds ? '' : 'opacity-50'}`}
              >
                Web TX
              </button>
            </div>
            <AppMenu
              onSettings={() => setSettingsOpen(true)}
              onDirectory={() => setDirectoryOpen(true)}
              onRegister={() => void handleRegister()}
              onRefresh={() => void handleRefresh()}
              onDisconnectAll={() => void handleDisconnectAll()}
              onAbout={handleAbout}
              canDisconnect={connections.length > 0}
              advancedMode={advancedMode}
              onToggleAdvanced={handleAdvancedToggle}
            />
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
          registered={registered}
          heardMdc={heardMdc}
        />

        {/* Transmit */}
        <CollapsibleSection
          id="transmit"
          title="Transmit"
          icon={faMicrophone}
          right={(open) =>
            open ? null : (
              <button
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  handleTransmit(true);
                }}
                onPointerUp={() => handleTransmit(false)}
                onPointerCancel={() => handleTransmit(false)}
                title={transmitting ? 'Transmitting…' : 'Hold to talk'}
                aria-label="Push to talk"
                className={`flex select-none items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  transmitting ? 'bg-tx text-white shadow-ptt' : 'bg-accent text-foreground hover:bg-accent/70'
                }`}
              >
                <FontAwesomeIcon icon={faMicrophone} />
                {transmitting ? 'TX' : 'PTT'}
              </button>
            )
          }
        >
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
            className={`mt-3 flex w-full select-none items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold transition ${
              transmitting ? 'bg-tx text-white shadow-ptt' : 'bg-accent text-foreground hover:bg-accent/70'
            }`}
          >
            <FontAwesomeIcon icon={faMicrophone} />
            {transmitting ? 'Transmitting…' : 'Hold to Talk'}
          </button>
        </CollapsibleSection>

        {/* Link controls */}
        <CollapsibleSection
          id="link"
          title="Link a node"
          icon={faTowerBroadcast}
          right={<span className="text-xs font-medium text-muted-foreground">{mode === 'node' ? 'Node mode' : 'Web Transceiver'}</span>}
        >
          {/* Prominent directory search — the easiest way to find a node */}
          <button
            onClick={() => setDirectoryOpen(true)}
            className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/10"
          >
            <FontAwesomeIcon icon={faMagnifyingGlass} /> Search the node directory
          </button>

          <div className={`grid gap-2.5 ${advancedMode ? 'sm:grid-cols-2' : ''}`}>
            <input value={connectNode} onChange={(e) => setConnectNode(e.target.value)} inputMode="numeric" className={inputClass} placeholder="Link to node number" />
            {advancedMode && (
              <input
                value={connectHost}
                onChange={(e) => setConnectHost(e.target.value)}
                disabled={mode === 'guest'}
                className={`${inputClass} disabled:opacity-40`}
                placeholder={mode === 'guest' ? 'node number required' : '…or direct address (host:port)'}
              />
            )}
          </div>

          {(savedNodes.length > 0 || recentNodes.length > 0) && (
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
              <select
                value=""
                onChange={(e) => e.target.value && setConnectNode(e.target.value)}
                className={inputClass}
                disabled={savedNodes.length === 0}
                title="Saved nodes"
              >
                <option value="">{savedNodes.length ? 'Saved nodes…' : 'No saved nodes'}</option>
                {savedNodes.map((n) => {
                  const who = [n.callsign, n.note || n.description, n.location].filter(Boolean).join(' · ');
                  return (
                    <option key={n.number} value={n.number}>
                      {n.number}
                      {who ? ` — ${who}` : ''}
                    </option>
                  );
                })}
              </select>
              <select
                value=""
                onChange={(e) => e.target.value && setConnectNode(e.target.value)}
                className={inputClass}
                disabled={recentNodes.length === 0}
                title="Recently connected nodes"
              >
                <option value="">{recentNodes.length ? 'Recent…' : 'No recent nodes'}</option>
                {recentNodes.map((n) => {
                  const who = [n.callsign, n.description, n.location].filter(Boolean).join(' · ');
                  return (
                    <option key={n.number} value={n.number}>
                      {n.number}
                      {who ? ` — ${who}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
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
            <button
              onClick={saveCurrentNode}
              disabled={!connectNode.trim()}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-40"
              title="Save this node to your saved list"
            >
              <FontAwesomeIcon icon={faFloppyDisk} /> Save
            </button>
            {mode === 'guest' && !hasGuestCreds && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="ml-auto text-xs font-medium text-primary hover:underline"
              >
                Set portal login in Settings →
              </button>
            )}
          </div>
        </CollapsibleSection>

        {/* Linked nodes (Direct — actionable) */}
        <LinkedNodes
          connections={connections}
          sortMode={sortMode}
          onSort={setSortMode}
          onUnlink={(label) => void handleDisconnect(label)}
          onUnlinkAll={() => void handleDisconnectAll()}
          onRefresh={() => void handleRefresh()}
          onSave={(c) => {
            rememberNode(c.label, { callsign: c.callsign, location: c.location, description: c.description });
            log(`Saved node ${c.label}.`);
          }}
          savedNumbers={new Set(savedNodes.map((n) => n.number))}
        />

        {/* Network map (tree of the mesh you're linked into) */}
        <NetworkTree topology={topology} onRefresh={() => void handleRefresh()} />

        {/* DTMF command sender */}
        <DtmfPad
          connected={connections.length > 0}
          onSend={(digits) => void window.electronAPI.sendDtmf(digits)}
          commands={dtmfCommands}
          onAddCommand={addDtmfCommand}
          onRemoveCommand={removeDtmfCommand}
        />

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
        ttsEnabled={ttsEnabled}
        onTtsToggle={handleTtsToggle}
        audioInput={audioInput}
        audioOutput={audioOutput}
        onAudioInputChange={handleAudioInputChange}
        onAudioOutputChange={handleAudioOutputChange}
        advancedMode={advancedMode}
        iaxUser={iaxUser}
        iaxSecret={iaxSecret}
        onIaxUserChange={handleIaxUserChange}
        onIaxSecretChange={handleIaxSecretChange}
        closeToTray={closeToTray}
        launchOnStartup={launchOnStartup}
        onCloseToTrayToggle={handleCloseToTrayToggle}
        onLaunchOnStartupToggle={handleLaunchOnStartupToggle}
        onExportSettings={() => void handleExportSettings()}
        onImportSettings={() => void handleImportSettings()}
        mdcEnabled={mdcEnabled}
        mdcUnitId={mdcUnitId}
        mdcTiming={mdcTiming}
        mdcLevel={mdcLevel}
        mdcPreamble={mdcPreamble}
        onMdcEnabledChange={handleMdcEnabledChange}
        onMdcUnitIdChange={handleMdcUnitIdChange}
        onMdcTimingChange={handleMdcTimingChange}
        onMdcLevelChange={handleMdcLevelChange}
        onMdcPreambleChange={handleMdcPreambleChange}
        savedNodes={savedNodes}
        linkedNumbers={new Set(connections.map((c) => c.label))}
        keyedNumbers={keyedNumbers}
        onUpdateSaved={updateSaved}
        onRemoveSaved={removeSaved}
        onConnectSaved={(n) => void handleConnectSaved(n)}
        registered={registered}
        onRegister={() => void handleRegister()}
        onSave={() => void handleSaveSettings()}
        trace={trace}
        onTraceToggle={(enabled) => void handleTraceToggle(enabled)}
      />

      <NodeDirectory
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        savedNumbers={new Set(savedNodes.map((n) => n.number))}
        onConnect={(node) => void handleConnect(false, node)}
        onSave={(n) =>
          rememberNode(n.number, {
            note: n.note,
            callsign: n.callsign,
            description: n.description,
            location: n.location,
          })
        }
      />
    </main>
  );
}
