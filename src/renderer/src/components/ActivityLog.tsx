interface ActivityLogProps {
  entries: string[];
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 text-sm font-semibold text-foreground">Activity</div>
      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1 font-mono text-xs text-muted-foreground">
        {entries.length === 0 ? (
          <div>No activity yet.</div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={`${entry}-${index}`}
              className={`rounded-lg px-3 py-1.5 ${index === 0 ? 'bg-accent text-foreground' : 'bg-transparent'}`}
            >
              {entry}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
