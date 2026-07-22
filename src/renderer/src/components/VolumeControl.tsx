import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon, faVolumeHigh, faVolumeLow, faVolumeXmark } from '../icons';

interface VolumeControlProps {
  /** Output volume 0–100. */
  value: number;
  muted: boolean;
  onChange: (value: number) => void;
  onToggleMute: () => void;
}

/** Speaker button with a popover slider + mute for this app's output volume. */
export function VolumeControl({ value, muted, onChange, onToggleMute }: VolumeControlProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const icon = muted || value === 0 ? faVolumeXmark : value < 50 ? faVolumeLow : faVolumeHigh;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={muted ? 'Muted' : `Output volume: ${value}%`}
        aria-label="Output volume"
        className={`flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition hover:bg-accent hover:text-foreground ${
          muted ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        <FontAwesomeIcon icon={icon} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-60 rounded-xl border border-border bg-card p-3 shadow-card">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>App volume</span>
            <span className="tabular-nums">{muted ? 'Muted' : `${value}%`}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleMute}
              title={muted ? 'Unmute' : 'Mute'}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className={`rounded-md px-2 py-1 transition ${muted ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <FontAwesomeIcon icon={muted ? faVolumeXmark : faVolumeHigh} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              className={`flex-1 accent-primary ${muted ? 'opacity-50' : ''}`}
            />
          </div>
          <button
            onClick={onToggleMute}
            className={`mt-2 w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              muted ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border hover:bg-accent'
            }`}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      )}
    </div>
  );
}
