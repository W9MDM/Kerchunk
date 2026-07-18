interface StatusBadgeProps {
  label: string;
  tone: 'connected' | 'disconnected' | 'warning';
}

const dotColor = {
  connected: 'bg-connected',
  disconnected: 'bg-disconnected',
  warning: 'bg-warning',
} as const;

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground/80">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor[tone]}`} />
      {label}
    </span>
  );
}
