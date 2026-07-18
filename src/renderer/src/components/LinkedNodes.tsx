import { memo } from 'react';
import type { ProtocolConnectionInfo, Topology, TopologyTreeNode } from '../../../shared/ipc';

export type SortMode = 'keyed' | 'number';

interface LinkedNodesProps {
  connections: ProtocolConnectionInfo[];
  topology: Topology | null;
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  onUnlink: (label: string) => void;
  onUnlinkAll: () => void;
  onRefresh: () => void;
}

interface NetworkEntry {
  node: string;
  callsign?: string;
  location?: string;
  description?: string;
  frequency?: string;
  tone?: string;
  keyed: boolean;
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

/** Flatten a topology tree into network entries below the direct level, deduped. */
function flattenNetwork(topology: Topology | null, directLabels: Set<string>): NetworkEntry[] {
  if (!topology) return [];
  const seen = new Set<string>(directLabels);
  const out: NetworkEntry[] = [];
  const walk = (nodes: TopologyTreeNode[]) => {
    for (const n of nodes) {
      if (!n.isSelf && !seen.has(n.node)) {
        seen.add(n.node);
        out.push({
          node: n.node,
          callsign: n.callsign,
          location: n.location,
          description: n.description,
          frequency: n.frequency,
          tone: n.tone,
          keyed: Boolean(n.keyed),
        });
      }
      if (n.children.length) walk(n.children);
    }
  };
  // Skip the direct level (root.children); walk their descendants.
  for (const direct of topology.root.children) {
    if (direct.children.length) walk(direct.children);
  }
  return out;
}

function Row({
  number,
  title,
  location,
  operator,
  keyed,
  onUnlink,
}: {
  number: string;
  title?: string;
  location?: string;
  operator?: string;
  keyed: boolean;
  onUnlink?: () => void;
}) {
  return (
    <li className="relative flex items-center justify-between rounded-xl border border-border bg-background px-4 py-2.5 pl-5">
      {keyed && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-rx" />}
      <div className="min-w-0">
        <div className="truncate text-sm">
          <span className="font-semibold tabular-nums">{number}</span>
          {title ? <span className="text-muted-foreground"> {title}</span> : ''}
        </div>
        {location && (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PinIcon />
            <span className="truncate">{location}</span>
          </div>
        )}
        {operator && (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PersonIcon />
            <span className="truncate">{operator}</span>
          </div>
        )}
      </div>
      {onUnlink && (
        <button
          onClick={onUnlink}
          className="ml-3 shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:bg-destructive/10 hover:text-destructive"
        >
          Unlink
        </button>
      )}
    </li>
  );
}

export const LinkedNodes = memo(function LinkedNodes({
  connections,
  topology,
  sortMode,
  onSort,
  onUnlink,
  onUnlinkAll,
  onRefresh,
}: LinkedNodesProps) {
  const directLabels = new Set(connections.map((c) => c.label));
  const network = flattenNetwork(topology, directLabels);
  const total = connections.length + network.length;

  const byKeyedThenNumber = <T extends { keyed?: boolean; lastKeyedAt?: number; node?: string; label?: string }>(
    a: T,
    b: T,
  ) => {
    if (sortMode === 'number') {
      const an = Number(a.node ?? a.label);
      const bn = Number(b.node ?? b.label);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return String(a.node ?? a.label).localeCompare(String(b.node ?? b.label));
    }
    // keyed first, then most-recently keyed
    if (Boolean(b.keyed) !== Boolean(a.keyed)) return Number(Boolean(b.keyed)) - Number(Boolean(a.keyed));
    return (b.lastKeyedAt ?? 0) - (a.lastKeyedAt ?? 0);
  };

  const directSorted = [...connections].sort(byKeyedThenNumber);
  const networkSorted = [...network].sort(byKeyedThenNumber);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Linked Nodes</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {total}
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

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">No links yet. Pick a node below and press Link.</p>
      ) : (
        <div className="space-y-3">
          {directSorted.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Direct</div>
              <ul className="space-y-1.5">
                {directSorted.map((c) => {
                  const freq = c.frequency
                    ? `${c.frequency}${c.tone ? ` / ${c.tone}` : ''}`
                    : undefined;
                  const title = c.description || freq || (c.host && !/^[0-9]+$/.test(c.label) ? `${c.host}:${c.port}` : undefined);
                  const operator = [c.callsign, /* owner name not in API */].filter(Boolean).join(', ') || undefined;
                  return (
                    <Row
                      key={c.localCall}
                      number={c.label}
                      title={c.monitor ? `${title ? title + ' · ' : ''}monitor` : title}
                      location={c.location}
                      operator={operator}
                      keyed={Boolean(c.keyed)}
                      onUnlink={() => onUnlink(c.label)}
                    />
                  );
                })}
              </ul>
            </div>
          )}

          {networkSorted.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Network</div>
              <ul className="space-y-1.5">
                {networkSorted.map((n) => {
                  const freq = n.frequency ? `${n.frequency}${n.tone ? ` / ${n.tone}` : ''}` : undefined;
                  return (
                    <Row
                      key={n.node}
                      number={n.node}
                      title={n.description || freq}
                      location={n.location}
                      operator={n.callsign}
                      keyed={n.keyed}
                    />
                  );
                })}
              </ul>
            </div>
          )}
        </div>
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
          ↻ Refresh
        </button>
      </div>
    </section>
  );
});
