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
  { value: 'system', label: 'System' },
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
    if (!node && !host) {
      log('Enter a node number to link to (or a direct address).');
      return;
    }
    log(`Linking to ${host || `node ${node}`}…`);
    try {
      await getAudioEngine().start();
      await window.electronAPI.connect({
        node: node || undefined,
        host: host || undefined,
        calledNumber: node || undefined,
        username: myNode.trim() || undefined,
        secret: secret || undefined,
      });
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
    });
    log('Node info saved.');
  };

  return (
    <main className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-8 lg:px-8">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground">Kerchunk</p>
              <h1 className="mt-3 text-4xl font-semibold">Self-contained node</h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                A full AllStarLink-style node: link to other nodes by number, conference them together, and talk
                with push-to-talk. Outbound linking only for now.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                label={registered ? 'Registered' : 'Not registered'}
                tone={registered ? 'connected' : 'warning'}
              />
              <StatusBadge
                label={connections.length > 0 ? `${connections.length} linked` : 'No links'}
                tone={connections.length > 0 ? 'connected' : 'disconnected'}
              />
              <StatusBadge label={protocolState} tone="warning" />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => void handleThemeChange(option.value)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  theme.mode === option.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-transparent hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="grid content-start gap-2 rounded-xl border border-border bg-background/60 p-4 sm:grid-cols-2">
              <input
                value={myNode}
                onChange={(event) => setMyNode(event.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="Your node number"
              />
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                type="password"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="Your node secret"
              />
              <input
                value={connectNode}
                onChange={(event) => setConnectNode(event.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="Link to node number"
              />
              <input
                value={connectHost}
                onChange={(event) => setConnectHost(event.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="…or direct address"
              />
            </div>

            <div className="rounded-xl border border-border bg-background/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Audio</span>
                {rxLevel > 2 && (
                  <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-xs font-medium text-green-500">
                    ◉ Receiving
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <Meter value={txLevel} label="Transmit" tone="tx" />
                <Meter value={rxLevel} label="Receive" tone="rx" />
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void handleSaveSettings()}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Save node info
            </button>
            <button
              onClick={() => void handleRegister()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Register
            </button>
            <button
              onClick={() => void handleConnect()}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Link
            </button>
            <button
              onClick={() => void handleDisconnectAll()}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Drop all
            </button>
            <button
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                handleTransmit(true);
              }}
              onPointerUp={() => handleTransmit(false)}
              onPointerCancel={() => handleTransmit(false)}
              className={`ml-auto select-none rounded-lg px-6 py-2 text-sm font-medium transition ${
                transmitting ? 'bg-red-600 text-white' : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {transmitting ? 'Transmitting…' : 'Hold to talk'}
            </button>
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={trace}
              onChange={(event) => void handleTraceToggle(event.target.checked)}
            />
            Show frame-level trace (debugging)
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Node numbers resolve via AllStarLink DNS. Accepting inbound links would require forwarding UDP 4569.
          </p>
        </section>

        <section className="flex flex-col gap-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 text-lg font-semibold">Connected nodes</div>
            {connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No links. Enter a node number and press Link.</p>
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
                      className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-4 py-3"
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
                        className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                      >
                        Disconnect
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {topology && topology.root.children.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold">Network</span>
                  {rxLevel > 2 && (
                    <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-xs font-medium text-green-500">
                      ◉ Receiving
                    </span>
                  )}
                </div>
                <button
                  onClick={() => void refreshTopology()}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                >
                  Refresh
                </button>
              </div>
              <TopologyBranch node={topology.root} depth={0} />
              <p className="mt-4 text-xs text-muted-foreground">
                🔴 = recently keyed per AllStarLink stats (~30s lag; brief keyups may not show). “◉ Receiving”
                above reflects live incoming audio. ⟲ = already listed above.
              </p>
            </div>
          )}

          <MemoActivityLog entries={activity} />
        </section>
      </div>
    </main>
  );
}
