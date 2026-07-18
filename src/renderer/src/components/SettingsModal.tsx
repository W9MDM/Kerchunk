import { useEffect, useState } from 'react';
import type { ThemeMode, ThemeState } from '../../../shared/theme';
import type { SavedNode } from '../../../shared/ipc';
import {
  FontAwesomeIcon,
  faXmark,
  faUser,
  faListUl,
  faKeyboard,
  faTowerBroadcast,
  faSliders,
  faThumbtack,
  faTrash,
  faVolumeHigh,
  faSatelliteDish,
  faFloppyDisk,
  faClockRotateLeft,
} from '../icons';

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** Friendly label for a single KeyboardEvent.code (the combo's main key). */
function singleKeyLabel(code: string): string {
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5);
  return code.replace('Left', ' L').replace('Right', ' R').replace(/([A-Z])/g, ' $1').trim();
}

const MODIFIER_LABEL: Record<string, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

/** Friendly label for a '+'-joined combo (e.g. "Control+Shift+KeyT" → "Ctrl + Shift + T"). */
function keyLabel(combo: string): string {
  if (!combo) return 'None';
  const parts = combo.split('+').filter(Boolean);
  const main = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => MODIFIER_LABEL[m] ?? m);
  return [...mods, singleKeyLabel(main)].join(' + ');
}

const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/30';
const sectionLabel = 'mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const scaleOptions: Array<{ value: number; label: string }> = [
  { value: 0.65, label: 'Small' },
  { value: 0.75, label: 'Default' },
  { value: 0.85, label: 'Large' },
  { value: 1.0, label: 'X-Large' },
];
const accentPresets = ['#007aff', '#5b62f0', '#8b5cf6', '#14b8a6', '#34c759', '#ff9500', '#ff3b30', '#ff2d92'];

type Tab = 'node' | 'saved' | 'hotkey' | 'audio' | 'mdc' | 'appearance' | 'general';
const TABS: Array<{ id: Tab; label: string; icon: typeof faUser }> = [
  { id: 'node', label: 'Node', icon: faUser },
  { id: 'saved', label: 'Saved', icon: faListUl },
  { id: 'hotkey', label: 'Hotkey', icon: faKeyboard },
  { id: 'audio', label: 'Audio', icon: faVolumeHigh },
  { id: 'mdc', label: 'MDC1200', icon: faTowerBroadcast },
  { id: 'appearance', label: 'Appearance', icon: faSliders },
  { id: 'general', label: 'General', icon: faSatelliteDish },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  myNode: string;
  setMyNode: (v: string) => void;
  secret: string;
  setSecret: (v: string) => void;
  operatorName: string;
  setOperatorName: (v: string) => void;
  callsign: string;
  setCallsign: (v: string) => void;
  wtPassword: string;
  setWtPassword: (v: string) => void;
  theme: ThemeState;
  onThemeChange: (mode: ThemeMode) => void;
  uiScale: number;
  onScaleChange: (factor: number) => void;
  accent: string;
  onAccentChange: (hex: string) => void;
  pttKey: string;
  pttMode: 'hold' | 'toggle';
  onPttKeyChange: (code: string) => void;
  onPttModeChange: (mode: 'hold' | 'toggle') => void;
  ttsEnabled: boolean;
  onTtsToggle: (on: boolean) => void;
  audioInput: string;
  audioOutput: string;
  onAudioInputChange: (deviceId: string) => void;
  onAudioOutputChange: (deviceId: string) => void;
  advancedMode: boolean;
  iaxUser: string;
  iaxSecret: string;
  onIaxUserChange: (v: string) => void;
  onIaxSecretChange: (v: string) => void;
  closeToTray: boolean;
  launchOnStartup: boolean;
  onCloseToTrayToggle: (on: boolean) => void;
  onLaunchOnStartupToggle: (on: boolean) => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
  mdcEnabled: boolean;
  mdcUnitId: string;
  mdcTiming: 'start' | 'end' | 'both';
  mdcLevel: number;
  mdcPreamble: number;
  onMdcEnabledChange: (on: boolean) => void;
  onMdcUnitIdChange: (id: string) => void;
  onMdcTimingChange: (t: 'start' | 'end' | 'both') => void;
  onMdcLevelChange: (level: number) => void;
  onMdcPreambleChange: (bytes: number) => void;
  savedNodes: SavedNode[];
  linkedNumbers: Set<string>;
  keyedNumbers: Set<string>;
  onUpdateSaved: (number: string, patch: Partial<SavedNode>) => void;
  onRemoveSaved: (number: string) => void;
  onConnectSaved: (node: SavedNode) => void;
  registered: boolean;
  onRegister: () => void;
  onSave: () => void;
  trace: boolean;
  onTraceToggle: (enabled: boolean) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const { open, onClose } = props;
  const [tab, setTab] = useState<Tab>('node');
  const [capturing, setCapturing] = useState(false);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Enumerate audio devices when the Audio tab opens (labels need mic permission,
  // which the app already holds once audio has started).
  useEffect(() => {
    if (!open || tab !== 'audio' || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      if (cancelled) return;
      setInputs(devices.filter((d) => d.kind === 'audioinput'));
      setOutputs(devices.filter((d) => d.kind === 'audiooutput'));
    });
    return () => {
      cancelled = true;
    };
  }, [open, tab]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(false);
        return;
      }
      // Wait for a non-modifier main key; capture the modifiers held with it.
      if (MODIFIER_CODES.has(e.code)) return;
      const mods: string[] = [];
      if (e.ctrlKey) mods.push('Control');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push('Meta');
      props.onPttKeyChange([...mods, e.code].join('+'));
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-8 flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} title="Close" aria-label="Close settings" className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        {/* Tab bar — fills when wide, scrolls horizontally when the window is narrow */}
        <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-xs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 grow basis-0 flex-col items-center gap-1 rounded-md px-1.5 py-1.5 font-medium transition ${
                tab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{ minWidth: '3.25rem' }}
            >
              <FontAwesomeIcon icon={t.icon} />
              <span className="max-w-full truncate">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {tab === 'node' && (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className={sectionLabel + ' mb-0'}>Your node</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${props.registered ? 'border-connected/40 bg-connected/10 text-connected' : 'border-warning/40 bg-warning/10 text-warning'}`}>
                    {props.registered ? 'Registered' : 'Not registered'}
                  </span>
                </div>
                <div className="grid gap-2.5">
                  <input value={props.myNode} onChange={(e) => props.setMyNode(e.target.value)} inputMode="numeric" className={inputClass} placeholder="Your AllStarLink node number" />
                  <input value={props.secret} onChange={(e) => props.setSecret(e.target.value)} type="password" className={inputClass} placeholder="Node secret" />
                  <input value={props.operatorName} onChange={(e) => props.setOperatorName(e.target.value)} className={inputClass} placeholder="Your name (shown on the node card)" />
                  <button onClick={props.onRegister} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90">
                    Register with AllStarLink
                  </button>
                </div>
              </div>
              <div>
                <h3 className={sectionLabel}>Web Transceiver (no node number)</h3>
                <div className="grid gap-2.5">
                  <input value={props.callsign} onChange={(e) => props.setCallsign(e.target.value)} className={inputClass} placeholder="Your callsign (portal login)" />
                  <input value={props.wtPassword} onChange={(e) => props.setWtPassword(e.target.value)} type="password" className={inputClass} placeholder="allstarlink.org portal password" />
                </div>
              </div>
              {props.advancedMode && (
                <div>
                  <h3 className={sectionLabel}>IAX link credentials (advanced)</h3>
                  <div className="grid gap-2.5">
                    <input value={props.iaxUser} onChange={(e) => props.onIaxUserChange(e.target.value)} className={inputClass} placeholder="IAX username (for direct links)" />
                    <input value={props.iaxSecret} onChange={(e) => props.onIaxSecretChange(e.target.value)} type="password" className={inputClass} placeholder="IAX secret (for direct links)" />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Used only when linking to a direct address (a private node/hub you run). Leave blank to reuse your node number and secret.
                  </p>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={props.trace} onChange={(e) => props.onTraceToggle(e.target.checked)} />
                Show frame-level trace (debugging)
              </label>
              {!props.advancedMode && (
                <p className="text-xs text-muted-foreground">
                  Tip: enable <span className="font-medium text-foreground">Advanced mode</span> from the menu to link to a direct address with custom IAX credentials.
                </p>
              )}
            </div>
          )}

          {tab === 'saved' && (
            <div>
              <h3 className={sectionLabel}>Saved nodes</h3>
              {props.savedNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved nodes yet. Link a node or add one from the directory to save it here.</p>
              ) : (
                <ul className="space-y-2">
                  {props.savedNodes.map((n) => {
                    const linked = props.linkedNumbers.has(n.number);
                    const meta = [n.callsign, n.location].filter(Boolean).join(' · ');
                    return (
                      <li key={n.number} className="rounded-xl border border-border bg-background p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            {props.keyedNumbers.has(n.number) && (
                              <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-tx align-middle" title="recently keyed" />
                            )}
                            <span className="text-sm font-semibold tabular-nums">{n.number}</span>
                            {n.description ? <span className="text-sm text-muted-foreground"> · {n.description}</span> : ''}
                            {linked && <span className="ml-2 rounded-full bg-connected/15 px-2 py-0.5 text-[11px] text-connected">linked</span>}
                            {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {!linked && (
                              <button onClick={() => props.onConnectSaved(n)} className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90">
                                Link
                              </button>
                            )}
                            <button onClick={() => props.onRemoveSaved(n.number)} title="Remove from saved nodes" aria-label="Remove saved node" className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </div>
                        </div>
                        <input
                          value={n.note ?? ''}
                          onChange={(e) => props.onUpdateSaved(n.number, { note: e.target.value })}
                          className={`${inputClass} mt-2 py-1.5`}
                          placeholder="Label / note"
                        />
                        <div className="mt-2 flex gap-2 text-xs">
                          <button
                            onClick={() => props.onUpdateSaved(n.number, { permanent: !n.permanent })}
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition ${n.permanent ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
                          >
                            <FontAwesomeIcon icon={faThumbtack} /> Permanent
                          </button>
                          <button
                            onClick={() => props.onUpdateSaved(n.number, { monitor: !n.monitor })}
                            className={`rounded-full border px-2.5 py-1 font-medium transition ${n.monitor ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
                          >
                            Monitor
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === 'hotkey' && (
            <div>
              <h3 className={sectionLabel}>PTT hotkey</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCapturing((c) => !c)}
                  className={`min-w-[7rem] rounded-lg border px-3 py-2 text-sm font-medium transition ${capturing ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'}`}
                >
                  {capturing ? 'Press a key…' : keyLabel(props.pttKey)}
                </button>
                {props.pttKey && !capturing && (
                  <button onClick={() => props.onPttKeyChange('')} className="rounded-lg px-2 py-2 text-xs text-muted-foreground transition hover:text-destructive">
                    Clear
                  </button>
                )}
                <div className="ml-auto flex rounded-lg bg-muted p-0.5 text-sm">
                  {(['hold', 'toggle'] as const).map((mode) => (
                    <button key={mode} onClick={() => props.onPttModeChange(mode)} className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${props.pttMode === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {props.pttMode === 'hold' ? 'Hold the key to transmit; release to stop.' : 'Press the key to start transmitting; press again to stop.'} Combos work too — hold Ctrl/Alt/Shift and press a key. A combo (e.g. Ctrl+Shift+T) is the most reliable for background/global PTT, where it acts as a toggle.
              </p>
            </div>
          )}

          {tab === 'audio' && (
            <div className="space-y-5">
              <div>
                <h3 className={sectionLabel}>Voice announcements</h3>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={props.ttsEnabled} onChange={(e) => props.onTtsToggle(e.target.checked)} />
                  Speak connect / disconnect / call-failed events
                </label>
              </div>
              <div>
                <h3 className={sectionLabel}>Microphone (input)</h3>
                <select value={props.audioInput} onChange={(e) => props.onAudioInputChange(e.target.value)} className={inputClass}>
                  <option value="">System default</option>
                  {inputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <h3 className={sectionLabel}>Speaker (output)</h3>
                <select value={props.audioOutput} onChange={(e) => props.onAudioOutputChange(e.target.value)} className={inputClass}>
                  <option value="">System default</option>
                  {outputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Speaker ${i + 1}`}
                    </option>
                  ))}
                </select>
                {outputs.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">Output selection isn't available on this system; playback uses the default device.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'mdc' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className={sectionLabel + ' mb-0'}>MDC1200 PTT ID</h3>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={props.mdcEnabled} onChange={(e) => props.onMdcEnabledChange(e.target.checked)} />
                  Enable
                </label>
              </div>
              {props.mdcEnabled ? (
                <div className="grid gap-2.5">
                  <input value={props.mdcUnitId} onChange={(e) => props.onMdcUnitIdChange(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 4))} className={inputClass} placeholder="Unit ID (4 hex digits, e.g. 1234)" />
                  <div className="flex rounded-lg bg-muted p-0.5 text-sm">
                    {(['start', 'end', 'both'] as const).map((t) => (
                      <button key={t} onClick={() => props.onMdcTimingChange(t)} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${props.mdcTiming === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        {t === 'start' ? 'On key-up' : t === 'end' ? 'On key-down' : 'Both'}
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Burst level</span>
                      <span className="tabular-nums">{props.mdcLevel}%</span>
                    </div>
                    <input type="range" min={5} max={100} value={props.mdcLevel} onChange={(e) => props.onMdcLevelChange(Number(e.target.value))} className="w-full accent-primary" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Preamble</span>
                      <span className="tabular-nums">{props.mdcPreamble} bytes · {Math.round((props.mdcPreamble * 8) / 1.2)} ms</span>
                    </div>
                    <input type="range" min={7} max={64} value={props.mdcPreamble} onChange={(e) => props.onMdcPreambleChange(Number(e.target.value))} className="w-full accent-primary" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sends your Motorola MDC1200 unit ID as a data burst {props.mdcTiming === 'both' ? 'at the start and end of' : props.mdcTiming === 'end' ? 'at the end of' : 'at the start of'} each transmission.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Transmit your Motorola MDC1200 unit ID as a data burst on PTT. Enable to configure.</p>
              )}
            </div>
          )}

          {tab === 'appearance' && (
            <div className="space-y-5">
              <div>
                <h3 className={sectionLabel}>Theme</h3>
                <div className="flex rounded-lg bg-muted p-0.5 text-sm">
                  {themeOptions.map((option) => (
                    <button key={option.value} onClick={() => props.onThemeChange(option.value)} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${props.theme.mode === option.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h3 className={sectionLabel}>Accent color</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {accentPresets.map((hex) => (
                    <button
                      key={hex}
                      onClick={() => props.onAccentChange(hex)}
                      title={hex}
                      style={{ backgroundColor: hex }}
                      className={`h-7 w-7 rounded-full transition ${props.accent.toLowerCase() === hex.toLowerCase() ? 'ring-2 ring-foreground/40 ring-offset-2 ring-offset-card' : 'hover:scale-110'}`}
                    />
                  ))}
                  <label className="relative ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border text-xs text-muted-foreground">
                    +
                    <input type="color" value={props.accent} onChange={(e) => props.onAccentChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" title="Custom color" />
                  </label>
                </div>
              </div>
              <div>
                <h3 className={sectionLabel}>Text size</h3>
                <div className="flex rounded-lg bg-muted p-0.5 text-sm">
                  {scaleOptions.map((option) => (
                    <button key={option.value} onClick={() => props.onScaleChange(option.value)} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${Math.abs(props.uiScale - option.value) < 0.001 ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'general' && (
            <div className="space-y-5">
              <div>
                <h3 className={sectionLabel}>Background &amp; startup</h3>
                <div className="space-y-2.5">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={props.launchOnStartup} onChange={(e) => props.onLaunchOnStartupToggle(e.target.checked)} />
                    Launch Kerchunk when I sign in
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={props.closeToTray} onChange={(e) => props.onCloseToTrayToggle(e.target.checked)} />
                    Keep running in the tray when the window is closed
                  </label>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  With tray mode on, closing the window hides it (your links stay up); use the tray icon to reopen or quit.
                </p>
              </div>
              <div>
                <h3 className={sectionLabel}>Backup</h3>
                <div className="flex gap-2">
                  <button onClick={props.onExportSettings} className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-accent">
                    <FontAwesomeIcon icon={faFloppyDisk} /> Export…
                  </button>
                  <button onClick={props.onImportSettings} className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-accent">
                    <FontAwesomeIcon icon={faClockRotateLeft} /> Import…
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Export your settings and saved nodes to a JSON file for backup, or to move Kerchunk to another machine.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button onClick={onClose} className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent">
            Close
          </button>
          <button onClick={props.onSave} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
