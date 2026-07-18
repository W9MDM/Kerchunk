interface MeterProps {
  value: number;
  label: string;
  tone: 'tx' | 'rx';
}

export function Meter({ value, label, tone }: MeterProps) {
  const width = Math.max(0, Math.min(100, value));
  const colorClass = tone === 'tx' ? 'bg-tx' : 'bg-rx';

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{width.toFixed(0)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] duration-75 ease-out ${colorClass}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
