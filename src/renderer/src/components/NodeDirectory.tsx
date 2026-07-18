import { useEffect, useMemo, useState } from 'react';
import type { DirectoryNode, SavedNode } from '../../../shared/ipc';
import { FontAwesomeIcon, faMagnifyingGlass, faXmark, faThumbtack, faTowerBroadcast } from '../icons';

interface NodeDirectoryProps {
  open: boolean;
  onClose: () => void;
  onConnect: (node: string) => void;
  onSave: (node: SavedNode) => void;
  savedNumbers: Set<string>;
}

const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/30';

const MAX_RESULTS = 400;

export function NodeDirectory({ open, onClose, onConnect, onSave, savedNumbers }: NodeDirectoryProps) {
  const [all, setAll] = useState<DirectoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');

  useEffect(() => {
    if (!open || all.length > 0) return;
    setLoading(true);
    void window.electronAPI
      .getNodeDirectory()
      .then(setAll)
      .finally(() => setLoading(false));
  }, [open, all.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const countries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of all) counts.set(n.country, (counts.get(n.country) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => {
      if (a[0] === 'United States') return -1;
      if (b[0] === 'United States') return 1;
      return b[1] - a[1];
    });
  }, [all]);

  const states = useMemo(() => {
    if (country !== 'United States') return [];
    const counts = new Map<string, number>();
    for (const n of all) if (n.country === 'United States' && n.state) counts.set(n.state, (counts.get(n.state) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [all, country]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: DirectoryNode[] = [];
    for (const n of all) {
      if (country && n.country !== country) continue;
      if (state && n.state !== state) continue;
      if (q && !(n.node.includes(q) || n.callsign.toLowerCase().includes(q) || n.location.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))) continue;
      out.push(n);
      if (out.length >= MAX_RESULTS + 1) break;
    }
    return out;
  }, [all, country, state, query]);

  if (!open) return null;
  const capped = results.length > MAX_RESULTS;
  const shown = capped ? results.slice(0, MAX_RESULTS) : results;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-6 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FontAwesomeIcon icon={faTowerBroadcast} /> Node directory
            {all.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{all.length.toLocaleString()}</span>}
          </h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-8`} placeholder="Search node, callsign, or location" autoFocus />
          </div>
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setState('');
            }}
            className={inputClass}
          >
            <option value="">All countries</option>
            {countries.map(([c, n]) => (
              <option key={c} value={c}>
                {c} ({n})
              </option>
            ))}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)} className={inputClass} disabled={country !== 'United States'}>
            <option value="">{country === 'United States' ? 'All states' : '—'}</option>
            {states.map(([s, n]) => (
              <option key={s} value={s}>
                {s} ({n})
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading the AllStarLink directory…</p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No matching nodes.</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((n) => (
                <li key={n.node} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/50">
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      <span className="font-semibold tabular-nums">{n.node}</span>
                      {n.callsign ? <span className="text-muted-foreground"> · {n.callsign}</span> : ''}
                      {n.description ? <span className="text-muted-foreground"> · {n.description}</span> : ''}
                    </div>
                    {n.location && <div className="truncate text-xs text-muted-foreground">{n.location}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => onSave({ number: n.node, note: n.description || undefined, callsign: n.callsign || undefined, description: n.description || undefined, location: n.location || undefined })}
                      title={savedNumbers.has(n.node) ? 'Saved' : 'Save to my nodes'}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${savedNumbers.has(n.node) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
                    >
                      <FontAwesomeIcon icon={faThumbtack} />
                    </button>
                    <button
                      onClick={() => {
                        onConnect(n.node);
                        onClose();
                      }}
                      className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                    >
                      Link
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {capped && <p className="mt-2 text-xs text-muted-foreground">Showing first {MAX_RESULTS.toLocaleString()} — refine your search to narrow it down.</p>}
      </div>
    </div>
  );
}
