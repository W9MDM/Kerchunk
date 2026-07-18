/**
 * Look up AllStarLink node metadata (callsign, location, frequency, …) from the
 * public stats API: https://stats.allstarlink.org/api/stats/<node> (JSON).
 *
 * Response shape (relevant parts):
 *   { node: { callsign, node_frequency, node_tone, Status,
 *             server: { Location, Server_Name, SiteName } } }
 *
 * The API is rate-limited (~30 req/min per IP), so callers should cache results.
 */

export const DEFAULT_NODEINFO_URL = 'https://stats.allstarlink.org/api/stats';

export interface NodeInfo {
  node: string;
  callsign?: string;
  location?: string;
  description?: string;
  frequency?: string;
  tone?: string;
  status?: string;
}

export interface FetchNodeInfoOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** A node that some node is connected to, with any known metadata. */
export interface LinkedNode {
  node: string;
  callsign?: string;
  location?: string;
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Fetch metadata for a node number. Returns null on any error or empty result. */
export async function fetchNodeInfo(node: string, options: FetchNodeInfoOptions = {}): Promise<NodeInfo | null> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    return null;
  }
  const base = options.baseUrl ?? DEFAULT_NODEINFO_URL;
  try {
    const response = await doFetch(`${base}/${encodeURIComponent(node)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { node?: Record<string, unknown> };
    const n = data.node ?? {};
    const server = (n.server as Record<string, unknown> | undefined) ?? {};
    const info: NodeInfo = {
      node,
      callsign: clean(n.callsign),
      location: clean(server.Location),
      description: clean(server.Server_Name) ?? clean(server.SiteName),
      frequency: clean(n.node_frequency),
      tone: clean(n.node_tone),
      status: clean(n.Status),
    };
    if (!info.callsign && !info.location && !info.description && !info.frequency) {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

export interface NodeStats {
  /** The node's own last-reported keyed state (laggy — stats refresh ~30 s). */
  keyed: boolean;
  /** Nodes this node is currently connected to. */
  connections: LinkedNode[];
}

/** Fetch a node's connection list and last-reported keyed state from the stats API. */
export async function fetchNodeStats(node: string, options: FetchNodeInfoOptions = {}): Promise<NodeStats> {
  const empty: NodeStats = { keyed: false, connections: [] };
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    return empty;
  }
  const base = options.baseUrl ?? DEFAULT_NODEINFO_URL;
  try {
    const response = await doFetch(`${base}/${encodeURIComponent(node)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return empty;
    }
    const data = (await response.json()) as {
      stats?: { data?: { keyed?: unknown; links?: unknown[]; linkedNodes?: Array<Record<string, unknown>> } };
    };
    const dt = data.stats?.data ?? {};
    const keyed = Boolean(dt.keyed);
    const linked = Array.isArray(dt.linkedNodes) ? dt.linkedNodes : [];
    let connections: LinkedNode[];
    if (linked.length > 0) {
      connections = linked
        .map((entry) => ({
          node: entry?.name != null ? String(entry.name) : '',
          callsign: clean(entry?.callsign),
          location: clean((entry?.server as Record<string, unknown> | undefined)?.Location),
        }))
        .filter((l) => l.node !== '');
    } else {
      const links = Array.isArray(dt.links) ? dt.links : [];
      connections = links.map((n) => ({ node: String(n) })).filter((l) => l.node !== '');
    }
    return { keyed, connections };
  } catch {
    return empty;
  }
}

/** Fetch the list of nodes a given node is currently connected to. */
export async function fetchNodeConnections(
  node: string,
  options: FetchNodeInfoOptions = {},
): Promise<LinkedNode[]> {
  return (await fetchNodeStats(node, options)).connections;
}
