import { memo } from 'react';
import type { Topology, TopologyTreeNode } from '../../../shared/ipc';
import { FontAwesomeIcon, faRotate } from '../icons';

interface NetworkTreeProps {
  topology: Topology | null;
  onRefresh: () => void;
}

/** Count every distinct node reachable in the tree (excluding self). */
function countNodes(node: TopologyTreeNode, seen = new Set<string>()): number {
  for (const child of node.children) {
    if (!child.isSelf && !child.truncated) seen.add(child.node);
    countNodes(child, seen);
  }
  return seen.size;
}

const Branch = memo(function Branch({ node, depth }: { node: TopologyTreeNode; depth: number }) {
  const freq = node.frequency ? `${node.frequency}${node.tone ? ` / ${node.tone}` : ''}` : undefined;
  const detail = node.description || freq;
  const meta = [node.callsign, node.location].filter(Boolean).join(' · ');
  return (
    <div className={depth > 0 ? 'border-l border-border pl-4' : ''}>
      <div className="flex items-baseline gap-2 py-0.5">
        {node.keyed && !node.isSelf && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rx" title="keyed (~30s stats lag)" />}
        <span className={`text-sm tabular-nums ${node.isSelf ? 'font-semibold' : 'font-medium'}`}>{node.node}</span>
        {node.isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
        {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
        {node.truncated && <span className="text-xs text-muted-foreground" title="shown above">⟲</span>}
      </div>
      {meta && !node.isSelf && <div className="pb-0.5 pl-0 text-xs text-muted-foreground">{meta}</div>}
      {node.children.length > 0 && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <Branch key={`${child.node}-${depth}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});

export const NetworkTree = memo(function NetworkTree({ topology, onRefresh }: NetworkTreeProps) {
  if (!topology || topology.root.children.length === 0) return null;
  const total = countNodes(topology.root);
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Network</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {total}
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
        >
          <FontAwesomeIcon icon={faRotate} /> Refresh
        </button>
      </div>
      <div className="max-h-[28rem] overflow-y-auto pr-1">
        <Branch node={topology.root} depth={0} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Live map of the mesh you're linked into. 🟢 = recently keyed per AllStarLink stats (~30s lag). ⟲ = shown above.
      </p>
    </section>
  );
});
