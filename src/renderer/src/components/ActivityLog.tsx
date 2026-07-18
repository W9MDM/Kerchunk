interface ActivityLogProps {
  entries: string[];
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-semibold text-foreground">Activity</div>
      <div className="space-y-2 text-sm text-muted-foreground">
        {entries.length === 0 ? (
          <div>No activity yet.</div>
        ) : (
          entries.map((entry, index) => (
            <div key={`${entry}-${index}`} className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
              {entry}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
