import { memo } from 'react';
import type { ProtocolConnectionInfo } from '../../../shared/ipc';
import { FontAwesomeIcon, faLocationDot, faUser, faRotate, faLinkSlash } from '../icons';

export type SortMode = 'keyed' | 'number';

interface LinkedNodesProps {
  connections: ProtocolConnectionInfo[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  onUnlink: (label: string) => void;
  onUnlinkAll: () => void;
  onRefresh: () => void;
}

export const LinkedNodes = memo(function LinkedNodes({
  connections,
  sortMode,
  onSort,
  onUnlink,
  onUnlinkAll,
  onRefresh,
}: LinkedNodesProps) {
  const sorted = [...connections].sort((a, b) => {
    if (sortMode === 'number') {
      const an = Number(a.label);
      const bn = Number(b.label);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return a.label.localeCompare(b.label);
    }
    if (Boolean(b.keyed) !== Boolean(a.keyed)) return Number(Boolean(b.keyed)) - Number(Boolean(a.keyed));
    return (b.lastKeyedAt ?? 0) - (a.lastKeyedAt ?? 0);
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Linked Nodes</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {connections.length}
          </span>
        </div>
        <div className="flex rounded-lg bg-muted p-0.5 text-xs">
          {([
            { v: 'keyed', l: 'Last Keyed' },
            { v: 'number', l: 'Number' },
          ] as const).map((s) => (
            <button
              key={s.v}
              onClick={() => onSort(s.v)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                sortMode === s.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.l}
            </button>
          ))}
        </div>
      </div>

      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No direct links yet. Pick a node above and press Link.</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((c) => {
            const freq = c.frequency ? `${c.frequency}${c.tone ? ` / ${c.tone}` : ''}` : undefined;
            const title =
              c.description || freq || (c.host && !/^[0-9]+$/.test(c.label) ? `${c.host}:${c.port}` : undefined);
            return (
              <li
                key={c.localCall}
                className="relative flex items-center justify-between rounded-xl border border-border bg-background px-4 py-2.5 pl-5"
              >
                {c.keyed && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-rx" />}
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    <span className="font-semibold tabular-nums">{c.label}</span>
                    {title ? <span className="text-muted-foreground"> {title}</span> : ''}
                    {c.monitor && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">monitor</span>
                    )}
                  </div>
                  {c.location && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FontAwesomeIcon icon={faLocationDot} />
                      <span className="truncate">{c.location}</span>
                    </div>
                  )}
                  {c.callsign && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FontAwesomeIcon icon={faUser} />
                      <span className="truncate">{c.callsign}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onUnlink(c.label)}
                  className="ml-3 flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:bg-destructive/10 hover:text-destructive"
                >
                  <FontAwesomeIcon icon={faLinkSlash} /> Unlink
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onUnlinkAll}
          disabled={connections.length === 0}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-40"
        >
          Unlink All
        </button>
        <button
          onClick={onRefresh}
          className="ml-auto rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
          title="Refresh network"
        >
          <FontAwesomeIcon icon={faRotate} /> Refresh
        </button>
      </div>
    </section>
  );
});
