import { memo, useEffect, useRef, useState } from 'react';
import type { ThemeMode, ThemeState } from '../../shared/theme';
import type { ProtocolConnectionInfo, Topology, TopologyTreeNode } from '../../shared/ipc';
import { AudioEngine } from './audio/engine';
import { ActivityLog } from './components/ActivityLog';
import { Meter } from './components/Meter';
import { StatusBadge } from './components/StatusBadge';

// Memoized so audio-level re-renders (50/s) don't re-render this recursive tree,
// which would starve the renderer's main thread and drop outbound mic frames.
const MemoActivityLog = memo(ActivityLog);

/** Shared input styling — Apple-native rounded field with a focus ring. */
const inputClass =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/30';

function SignalGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
      <path d="M4.5 12.5a10.5 10.5 0 0 1 15 0" />
      <path d="M8 15.5a6 6 0 0 1 8 0" />
      <circle cx="12" cy="18.5" r="1.3" fill="white" stroke="none" />
    </svg>
  );
}

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

const TopologyBranch = memo(function TopologyBranch({ node, depth }: { node: TopologyTreeNode; depth: number }) {
  return (
    <div className={depth > 0 ? 'border-l border-border pl-4' : ''}>
      <div className={`text-sm ${node.isSelf ? 'font-semibold' : 'font-medium'}`}>
        {node.keyed && !node.isSelf ? <span title="recently keyed (stats, ~30s)">🔴 </span> : ''}
        {node.node}
        {node.isSelf ? <span className="text-muted-foreground"> (you)</span> : ''}
        {node.callsign ? ` · ${node.callsign}` : ''}
        {node.location ? <span className="text-muted-foreground"> — {node.location}</span> : ''}
        {node.truncated ? <span className="text-muted-foreground" title="shown above"> ⟲</span> : ''}
      </div>
      {node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <TopologyBranch key={`${child.node}-${depth}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});

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

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function App() {
  const [theme, setTheme] = useState<ThemeState>({ mode: 'system', resolved: 'light' });
  const [protocolState, setProtocolState] = useState('idle');
  const [myNode, setMyNode] = useState('');
  const [secret, setSecret] = useState('');
  const [connectNode, setConnectNode] = useState('');
  const [connectHost, setConnectHost] = useState('');
  const [mode, setMode] = useState<'node' | 'guest'>('node');
  const [callsign, setCallsign] = useState('');
  const [wtPassword, setWtPassword] = useState('');
  const [connections, setConnections] = useState<ProtocolConnectionInfo[]>([]);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [registered, setRegistered] = useState(false);
  const [activity, setActivity] = useState<string[]>(['Kerchunk node ready.']);
  const [txLevel, setTxLevel] = useState(0);
  const [rxLevel, setRxLevel] = useState(0);
  const [transmitting, setTransmitting] = useState(false);
  const [trace, setTraceEnabled] = useState(false);
  const audioEngineRef = useRef<AudioEngine | null>(null);

  const log = (message: string) => setActivity((current) => [message, ...current].slice(0, 60));

  const getAudioEngine = () => {
    if (!audioEngineRef.current) {
      // Throttle level→state updates: the meters don't need 50 fps, and updating
      // React state that often re-renders the app and starves mic-frame handoff.
      audioEngineRef.current = new AudioEngine({
        onTxFrame: (frame) => void window.electronAPI.sendAudioFrame({ frame }),
        onTxLevel: throttleLevel(setTxLevel),
        onRxLevel: throttleLevel(setRxLevel),
      });
    }
    return audioEngineRef.current;
  };

  useEffect(() => {
    void window.electronAPI.getSettings().then((settings) => {
      if (settings.myNode) setMyNode(settings.myNode);
      if (settings.secret) setSecret(settings.secret);
      if (settings.connectHost) setConnectHost(settings.connectHost);
      if (settings.callsign) setCallsign(settings.callsign);
      if (settings.wtPassword) setWtPassword(settings.wtPassword);
    });
    void window.electronAPI.getThemeState().then(setTheme);
    const disposers = [
      window.electronAPI.onThemeChange(setTheme),
      window.electronAPI.onProtocolState((payload) => {
        setProtocolState(payload.state);
        log(payload.state);
      }),
      window.electronAPI.onProtocolConnections((payload) => setConnections(payload.connections)),
      window.electronAPI.onProtocolAudio((payload) => getAudioEngine().playFrame(payload.frame)),
      window.electronAPI.onProtocolDtmf((payload) => log(`DTMF from peer: ${payload.digit}`)),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme.resolved === 'dark');
    document.documentElement.style.colorScheme = theme.resolved;
  }, [theme.resolved]);

  const refreshTopology = async () => {
    try {
      setTopology(await window.electronAPI.getTopology());
    } catch {
      // leave the previous topology in place
    }
  };

  useEffect(() => {
    if (connections.length === 0) {
      setTopology(null);
      return;
    }
    // One deferred fetch well clear of call setup; refresh is manual after that.
    // (Topology does many stats lookups; running it on a timer hitches audio.)
    const id = setTimeout(() => void refreshTopology(), 6000);
    return () => clearTimeout(id);
  }, [connections.length]);

  const handleThemeChange = async (mode: ThemeMode) => {
    setTheme(await window.electronAPI.setThemeMode(mode));
  };

  const handleConnect = async () => {
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
    log(`Linking to ${host || `node ${node}`}${guestMode ? ' as guest' : ''}…`);
    try {
      await getAudioEngine().start();
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
        });
      }
      setConnectNode('');
      setConnectHost('');
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
    setTransmitting(on);
    if (on) {
      window.electronAPI.txStart(); // re-establish the stream on each key-up
    } else {
      window.electronAPI.txStop(); // RADIO_UNKEY on guest (web transceiver) links
    }
  };

  const handleTraceToggle = async (enabled: boolean) => {
    setTraceEnabled(enabled);
    await window.electronAPI.setDebug(enabled);
  };

  const handleSaveSettings = async () => {
    await window.electronAPI.saveSettings({
      myNode: myNode.trim(),
      secret,
      connectHost: connectHost.trim(),
      callsign: callsign.trim(),
      wtPassword,
    });
    log('Node info saved.');
  };

  const linked = connections.length > 0;
  const receiving = rxLevel > 2;

  return (
    <main className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-5 py-7">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#5b62f0] to-[#8b5cf6] shadow-card">
              <SignalGlyph />
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">Kerchunk</h1>
              <p className="text-xs text-muted-foreground">Self-contained AllStar node</p>
            </div>
          </div>
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => void handleThemeChange(option.value)}
                className={`rounded-md px-3 py-1 font-medium transition ${
                  theme.mode === option.value
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        {/* Connection */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Connection</h2>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge
                label={registered ? 'Registered' : 'Not registered'}
                tone={registered ? 'connected' : 'warning'}
              />
              <StatusBadge label={linked ? `${connections.length} linked` : 'No links'} tone={linked ? 'connected' : 'disconnected'} />
            </div>
          </div>

          <div className="flex rounded-lg bg-muted p-0.5">
            {([
              { value: 'node', label: 'Node mode', hint: 'Use your ASL node number' },
              { value: 'guest', label: 'Web Transceiver', hint: 'No node number — callsign only' },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                onClick={() => setMode(tab.value)}
                title={tab.hint}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  mode === tab.value
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-2.5">
            {mode === 'node' ? (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  value={myNode}
                  onChange={(event) => setMyNode(event.target.value)}
                  inputMode="numeric"
                  className={inputClass}
                  placeholder="Your node number"
                />
                <input
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  type="password"
                  className={inputClass}
                  placeholder="Your node secret"
                />
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  value={callsign}
                  onChange={(event) => setCallsign(event.target.value)}
                  className={inputClass}
                  placeholder="Your callsign (portal login)"
                />
                <input
                  value={wtPassword}
                  onChange={(event) => setWtPassword(event.target.value)}
                  type="password"
                  className={inputClass}
                  placeholder="allstarlink.org portal password"
                />
              </div>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                value={connectNode}
                onChange={(event) => setConnectNode(event.target.value)}
                inputMode="numeric"
                className={inputClass}
                placeholder="Link to node number"
              />
              <input
                value={connectHost}
                onChange={(event) => setConnectHost(event.target.value)}
                disabled={mode === 'guest'}
                className={`${inputClass} disabled:opacity-40`}
                placeholder={mode === 'guest' ? 'node number required' : '…or direct address'}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleConnect()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              Link
            </button>
            {mode === 'node' && (
              <button
                onClick={() => void handleRegister()}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Register
              </button>
            )}
            <button
              onClick={() => void handleSaveSettings()}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent"
            >
              Save
            </button>
            {linked && (
              <button
                onClick={() => void handleDisconnectAll()}
                className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10"
              >
                Drop all
              </button>
            )}
          </div>
        </section>

        {/* Transmit */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Transmit</h2>
            {receiving && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rx/15 px-2.5 py-1 text-xs font-medium text-rx">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rx" />
                Receiving
              </span>
            )}
          </div>

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
              transmitting
                ? 'bg-tx text-white shadow-ptt'
                : 'bg-accent text-foreground hover:bg-accent/70'
            }`}
          >
            <MicGlyph />
            {transmitting ? 'Transmitting…' : 'Hold to Talk'}
          </button>
        </section>

        {/* Connected nodes */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-3 text-sm font-semibold">Connected nodes</div>
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No links yet. Enter a node number above and press Link.</p>
          ) : (
            <ul className="space-y-2">
              {connections.map((connection) => {
                const subtitle =
                  [connection.description, connection.location].filter(Boolean).join(' — ') ||
                  `${connection.host}:${connection.port}`;
                const freq = connection.frequency
                  ? `${connection.frequency}${connection.tone ? ` / ${connection.tone}` : ''}`
                  : null;
                return (
                  <li
                    key={connection.localCall}
                    className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {connection.label}
                        {connection.callsign ? ` · ${connection.callsign}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">{subtitle}</div>
                      <div className="text-xs text-muted-foreground">
                        {connection.state}
                        {freq ? ` · ${freq}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleDisconnect(connection.label)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                    >
                      Disconnect
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Network */}
        {topology && topology.root.children.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">Network</span>
                {receiving && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rx/15 px-2.5 py-1 text-xs font-medium text-rx">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rx" />
                    Receiving
                  </span>
                )}
              </div>
              <button
                onClick={() => void refreshTopology()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
              >
                Refresh
              </button>
            </div>
            <TopologyBranch node={topology.root} depth={0} />
            <p className="mt-4 text-xs text-muted-foreground">
              🔴 = recently keyed per AllStarLink stats (~30s lag; brief keyups may not show). “Receiving”
              reflects live incoming audio. ⟲ = already listed above.
            </p>
          </section>
        )}

        <MemoActivityLog entries={activity} />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={trace}
              onChange={(event) => void handleTraceToggle(event.target.checked)}
            />
            Frame-level trace
          </label>
          <span className="rounded-full border border-border bg-card px-2.5 py-1">{protocolState}</span>
        </div>

        <footer className="pb-2 text-center text-xs text-muted-foreground">
          Kerchunk — Copyright © 2026 W9MDM · MIT License · Not affiliated with AllStarLink
        </footer>
      </div>
    </main>
  );
}
