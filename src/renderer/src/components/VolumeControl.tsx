import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon, faVolumeHigh, faVolumeLow, faVolumeXmark } from '../icons';

interface VolumeControlProps {
  /** Output volume 0–100. */
  value: number;
  onChange: (value: number) => void;
}

/** Speaker button with a popover slider for this app's output volume. */
export function VolumeControl({ value, onChange }: VolumeControlProps) {
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

  const icon = value === 0 ? faVolumeXmark : value < 50 ? faVolumeLow : faVolumeHigh;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={`Output volume: ${value}%`}
        aria-label="Output volume"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <FontAwesomeIcon icon={icon} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-56 rounded-xl border border-border bg-card p-3 shadow-card">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>App volume</span>
            <span className="tabular-nums">{value}%</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChange(0)}
              title="Mute"
              aria-label="Mute"
              className="text-muted-foreground transition hover:text-foreground"
            >
              <FontAwesomeIcon icon={faVolumeXmark} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <FontAwesomeIcon icon={faVolumeHigh} className="text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  );
}
