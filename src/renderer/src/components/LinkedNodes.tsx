import { memo } from 'react';
import type { ProtocolConnectionInfo } from '../../../shared/ipc';
import { useCollapsed } from './CollapsibleSection';
import {
  FontAwesomeIcon,
  faLocationDot,
  faUser,
  faRotate,
  faLinkSlash,
  faSatelliteDish,
  faChevronDown,
  faChevronRight,
  faFloppyDisk,
  faCircleCheck,
} from '../icons';

export type SortMode = 'keyed' | 'number';

interface LinkedNodesProps {
  connections: ProtocolConnectionInfo[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  onUnlink: (label: string) => void;
  onUnlinkAll: () => void;
  onRefresh: () => void;
  onSave: (connection: ProtocolConnectionInfo) => void;
  savedNumbers: Set<string>;
}

/** Secondary line for a connection: description / frequency / host fallback. */
function connectionTitle(c: ProtocolConnectionInfo): string | undefined {
  const freq = c.frequency ? `${c.frequency}${c.tone ? ` / ${c.tone}` : ''}` : undefined;
  return c.description || freq || (c.host && !/^[0-9]+$/.test(c.label) ? `${c.host}:${c.port}` : undefined);
}

export const LinkedNodes = memo(function LinkedNodes({
  connections,
  sortMode,
  onSort,
  onUnlink,
  onUnlinkAll,
  onRefresh,
  onSave,
  savedNumbers,
}: LinkedNodesProps) {
  const [open, toggle] = useCollapsed('linked', true);

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
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <button onClick={toggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold">
          <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} className="w-3 shrink-0 text-muted-foreground" />
          <FontAwesomeIcon icon={faSatelliteDish} className="text-muted-foreground" />
          <span className="truncate">Linked Nodes</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {connections.length}
          </span>
          {/* Sorting only applies to the expanded list */}
          {open && (
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
          )}
        </div>
      </div>

      {/* Collapsed: compact read-only summary — node number on top, info under. */}
      {!open && connections.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {sorted.map((c) => {
            const meta = [c.callsign, c.location, connectionTitle(c)].filter(Boolean).join(' · ');
            return (
              <li key={c.localCall} className="flex items-baseline gap-2">
                {c.keyed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rx" title="keyed" />}
                <div className="min-w-0">
                  <span className="text-sm font-semibold tabular-nums">{c.label}</span>
                  {c.up === false && <span className="ml-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">calling…</span>}
                  {c.monitor && <span className="ml-2 text-[11px] text-muted-foreground">monitor</span>}
                  {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="mt-3">
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No direct links yet. Pick a node above and press Link.</p>
          ) : (
            <ul className="space-y-1.5">
              {sorted.map((c) => {
                const title = connectionTitle(c);
                const saved = savedNumbers.has(c.label);
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
                        {c.up === false && (
                          <span className="ml-2 animate-pulse rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">calling…</span>
                        )}
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
                    <div className="ml-3 flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => onSave(c)}
                        disabled={saved}
                        title={saved ? 'Already saved' : 'Save to my nodes'}
                        aria-label={saved ? 'Saved' : 'Save node'}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                          saved ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border hover:bg-accent'
                        }`}
                      >
                        <FontAwesomeIcon icon={saved ? faCircleCheck : faFloppyDisk} /> {saved ? 'Saved' : 'Save'}
                      </button>
                      <button
                        onClick={() => onUnlink(c.label)}
                        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:bg-destructive/10 hover:text-destructive"
                      >
                        <FontAwesomeIcon icon={faLinkSlash} /> Unlink
                      </button>
                    </div>
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
        </div>
      )}
    </section>
  );
});
