import { useEffect, useState } from 'react';
import type { ThemeMode, ThemeState } from '../../../shared/theme';

/** Friendly label for a KeyboardEvent.code. */
function keyLabel(code: string): string {
  if (!code) return 'None';
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5);
  return code
    .replace('Left', ' L')
    .replace('Right', ' R')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/30';

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
  mdcEnabled: boolean;
  mdcUnitId: string;
  mdcTiming: 'start' | 'end' | 'both';
  mdcLevel: number;
  onMdcEnabledChange: (on: boolean) => void;
  onMdcUnitIdChange: (id: string) => void;
  onMdcTimingChange: (t: 'start' | 'end' | 'both') => void;
  onMdcLevelChange: (level: number) => void;
  registered: boolean;
  onRegister: () => void;
  onSave: () => void;
  trace: boolean;
  onTraceToggle: (enabled: boolean) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const { open, onClose } = props;
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // While capturing, the next key press becomes the PTT hotkey.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== 'Escape') props.onPttKeyChange(e.code);
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mt-8 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5">
          {/* Node identity */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your node</h3>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  props.registered
                    ? 'border-connected/40 bg-connected/10 text-connected'
                    : 'border-warning/40 bg-warning/10 text-warning'
                }`}
              >
                {props.registered ? 'Registered' : 'Not registered'}
              </span>
            </div>
            <div className="grid gap-2.5">
              <input
                value={props.myNode}
                onChange={(e) => props.setMyNode(e.target.value)}
                inputMode="numeric"
                className={inputClass}
                placeholder="Your AllStarLink node number"
              />
              <input
                value={props.secret}
                onChange={(e) => props.setSecret(e.target.value)}
                type="password"
                className={inputClass}
                placeholder="Node secret"
              />
              <input
                value={props.operatorName}
                onChange={(e) => props.setOperatorName(e.target.value)}
                className={inputClass}
                placeholder="Your name (shown on the node card)"
              />
              <button
                onClick={props.onRegister}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
              >
                Register with AllStarLink
              </button>
            </div>
          </div>

          {/* Web Transceiver */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Web Transceiver (no node number)
            </h3>
            <div className="grid gap-2.5">
              <input
                value={props.callsign}
                onChange={(e) => props.setCallsign(e.target.value)}
                className={inputClass}
                placeholder="Your callsign (portal login)"
              />
              <input
                value={props.wtPassword}
                onChange={(e) => props.setWtPassword(e.target.value)}
                type="password"
                className={inputClass}
                placeholder="allstarlink.org portal password"
              />
            </div>
          </div>

          {/* Appearance */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Appearance</h3>
            <div className="flex rounded-lg bg-muted p-0.5 text-sm">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => props.onThemeChange(option.value)}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                    props.theme.mode === option.value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Accent color */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accent color</h3>
            <div className="flex flex-wrap items-center gap-2">
              {accentPresets.map((hex) => {
                const selected = props.accent.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={hex}
                    onClick={() => props.onAccentChange(hex)}
                    title={hex}
                    style={{ backgroundColor: hex }}
                    className={`h-7 w-7 rounded-full transition ${
                      selected ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground/40' : 'hover:scale-110'
                    }`}
                  />
                );
              })}
              <label className="relative ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border text-xs text-muted-foreground">
                +
                <input
                  type="color"
                  value={props.accent}
                  onChange={(e) => props.onAccentChange(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  title="Custom color"
                />
              </label>
            </div>
          </div>

          {/* Text size */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Text size</h3>
            <div className="flex rounded-lg bg-muted p-0.5 text-sm">
              {scaleOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => props.onScaleChange(option.value)}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                    Math.abs(props.uiScale - option.value) < 0.001
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* PTT hotkey */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">PTT hotkey</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCapturing((c) => !c)}
                className={`min-w-[7rem] rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  capturing
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background hover:bg-accent'
                }`}
              >
                {capturing ? 'Press a key…' : keyLabel(props.pttKey)}
              </button>
              {props.pttKey && !capturing && (
                <button
                  onClick={() => props.onPttKeyChange('')}
                  className="rounded-lg px-2 py-2 text-xs text-muted-foreground transition hover:text-destructive"
                >
                  Clear
                </button>
              )}
              <div className="ml-auto flex rounded-lg bg-muted p-0.5 text-sm">
                {(['hold', 'toggle'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => props.onPttModeChange(mode)}
                    className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${
                      props.pttMode === mode
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {props.pttMode === 'hold'
                ? 'Hold the key to transmit; release to stop. Works when the window is focused.'
                : 'Press the key to start transmitting; press again to stop.'}
            </p>
          </div>

          {/* MDC1200 PTT ID */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">MDC1200 PTT ID</h3>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={props.mdcEnabled}
                  onChange={(e) => props.onMdcEnabledChange(e.target.checked)}
                />
                Enable
              </label>
            </div>
            {props.mdcEnabled && (
              <div className="grid gap-2.5">
                <input
                  value={props.mdcUnitId}
                  onChange={(e) => props.onMdcUnitIdChange(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 4))}
                  className={inputClass}
                  placeholder="Unit ID (4 hex digits, e.g. 1234)"
                />
                <div className="flex rounded-lg bg-muted p-0.5 text-sm">
                  {(['start', 'end', 'both'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => props.onMdcTimingChange(t)}
                      className={`flex-1 rounded-md px-3 py-1.5 font-medium capitalize transition ${
                        props.mdcTiming === t
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t === 'start' ? 'On key-up' : t === 'end' ? 'On key-down' : 'Both'}
                    </button>
                  ))}
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Burst level</span>
                    <span className="tabular-nums">{props.mdcLevel}%</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={props.mdcLevel}
                    onChange={(e) => props.onMdcLevelChange(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Sends your Motorola MDC1200 unit ID as a data burst {props.mdcTiming === 'both' ? 'at the start and end of' : props.mdcTiming === 'end' ? 'at the end of' : 'at the start of'} each transmission.
                </p>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={props.trace} onChange={(e) => props.onTraceToggle(e.target.checked)} />
            Show frame-level trace (debugging)
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            Close
          </button>
          <button
            onClick={props.onSave}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
