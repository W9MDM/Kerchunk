interface StatusBadgeProps {
  label: string;
  tone: 'connected' | 'disconnected' | 'warning';
}

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const toneClasses = {
    connected: 'bg-connected/10 text-connected border-connected/30',
    disconnected: 'bg-disconnected/10 text-disconnected border-disconnected/30',
    warning: 'bg-warning/10 text-warning border-warning/30',
  } as const;

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}
