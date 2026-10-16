/**
 * Look up AllStarLink node metadata (callsign, location, frequency, …) from the
 * public stats API: https://stats.allstarlink.org/api/stats/<node> (JSON).
 *
 * Response shape (relevant parts):
 *   { node: { callsign, node_frequency, node_tone, Status,
 *             server: { Location, Server_Name, SiteName } } }
 *
 * The API is rate-limited to 30 requests/min per IP (X-RateLimit-Limit), and
 * every request counts — including 404s for things that aren't public nodes.
 * Over the limit it answers 429 (or, if pushed, silently drops connections),
 * which used to read as "no links" and truncated the network map. So every
 * lookup goes through one shared {@link StatsGate} (paced under the limit,
 * backs off and retries on rate-limit / network signals) and a short cache.
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

/** `high` waits for a slot; `low` (background polling) gives up rather than
 * eat into the budget other lookups need. */
export type StatsPriority = 'high' | 'low';

export interface FetchNodeInfoOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Rate gate to use; defaults to the process-wide one. */
  gate?: StatsGate;
  priority?: StatsPriority;
}

/** A node that some node is connected to, with any known metadata. */
export interface LinkedNode {
  node: string;
  callsign?: string;
  location?: string;
}

/**
 * Public AllStarLink node numbers are 2000–999999. Below that are private
 * nodes, 7-digit numbers are EchoLink/phone/Web Transceiver links, and
 * callsigns are web clients — none have stats, so looking them up only burns
 * rate limit on a guaranteed 404.
 */
export function isPublicNodeNumber(node: string): boolean {
  if (!/^\d+$/.test(node)) return false;
  const n = Number(node);
  return n >= 2000 && n <= 999_999;
}

/**
 * Minimum spacing between requests. The API allows 30/min, but it enforces that
 * as a *rate* (nginx: bursts get 429s with no Retry-After, and hammering gets
 * new connections silently dropped for minutes). One request per ~2.2 s stays
 * under it without ever bursting.
 */
const MIN_INTERVAL_MS = 2_200;
/** Back-off after a header-less 429 or a timeout/network failure. */
const RATE_LIMITED_BACKOFF_MS = 60_000;
const NETWORK_BACKOFF_MS = 30_000;
/** Dropped connections hang ~21 s before failing; don't wait on them longer. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Paces every stats API request in the process: requests are spaced
 * {@link MIN_INTERVAL_MS} apart, and the whole gate pauses after a rate-limit
 * or network signal. High-priority callers (the network map, link info) queue;
 * low-priority ones (background keyed polling) give way to them.
 */
export class StatsGate {
  private nextAt = 0;
  private pausedUntil = 0;
  private highWaiting = 0;

  constructor(
    private readonly minIntervalMs = MIN_INTERVAL_MS,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Take the next request slot. Low priority returns false (instead of
   * waiting) while the gate is paused or a high-priority request is queued. */
  async acquire(priority: StatsPriority = 'high'): Promise<boolean> {
    if (priority === 'high') this.highWaiting += 1;
    try {
      for (;;) {
        const t = this.now();
        if (priority === 'low' && (this.highWaiting > 0 || t < this.pausedUntil)) return false;
        const at = Math.max(this.nextAt, this.pausedUntil);
        if (t >= at) {
          this.nextAt = t + this.minIntervalMs;
          return true;
        }
        await this.sleep(at - t);
      }
    } finally {
      if (priority === 'high') this.highWaiting -= 1;
    }
  }

  /** Pause all requests for at least `ms`. */
  backoff(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  /** Feed back the server's rate-limit headers, if it sent any. */
  noteServer(remaining: number | null, retryAfterSec: number | null): void {
    if (retryAfterSec != null && retryAfterSec > 0) this.backoff(retryAfterSec * 1000);
    else if (remaining === 0) this.backoff(RATE_LIMITED_BACKOFF_MS);
  }
}

let sharedGate = new StatsGate();

/** Test hook: replace the process-wide gate (e.g. with an instant one). */
export function setDefaultStatsGate(gate: StatsGate): void {
  sharedGate = gate;
}

type StatsResult = { status: 'ok'; data: Record<string, unknown> } | { status: 'notfound' } | { status: 'error' };

const OK_TTL_MS = 30_000; // the stats themselves refresh ~30 s
const NOTFOUND_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; result: StatsResult }>();

/** Test hook: forget cached responses. */
export function clearStatsCache(): void {
  cache.clear();
}

function headerNumber(response: Response, name: string): number | null {
  const raw = response.headers?.get?.(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** One rate-limited, cached GET of /api/stats/<node>. Never throws. */
async function getStats(node: string, options: FetchNodeInfoOptions): Promise<StatsResult> {
  const base = options.baseUrl ?? DEFAULT_NODEINFO_URL;
  const key = `${base}/${node}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.result.status === 'ok' ? OK_TTL_MS : NOTFOUND_TTL_MS)) {
    return hit.result;
  }
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) return { status: 'error' };
  const gate = options.gate ?? sharedGate;
  const priority = options.priority ?? 'high';

  // Rate-limit and network failures pause the shared gate, then retry — high
  // priority up to twice more; background (low) lookups just give up.
  const attempts = priority === 'high' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await gate.acquire(priority))) return { status: 'error' };
    try {
      const response = await doFetch(`${base}/${encodeURIComponent(node)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      gate.noteServer(headerNumber(response, 'x-ratelimit-remaining'), headerNumber(response, 'retry-after'));
      if (response.status === 429) {
        if (headerNumber(response, 'retry-after') == null) gate.backoff(RATE_LIMITED_BACKOFF_MS);
        continue;
      }
      if (response.status === 404) {
        const result: StatsResult = { status: 'notfound' };
        cache.set(key, { at: Date.now(), result });
        return result;
      }
      if (!response.ok) return { status: 'error' };
      const data = (await response.json()) as Record<string, unknown>;
      const result: StatsResult = { status: 'ok', data };
      cache.set(key, { at: Date.now(), result });
      return result;
    } catch {
      // Timeout / dropped connection — the server's sign we've been too busy.
      gate.backoff(NETWORK_BACKOFF_MS);
    }
  }
  return { status: 'error' };
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Fetch metadata for a node number. Returns null on any error or empty result. */
export async function fetchNodeInfo(node: string, options: FetchNodeInfoOptions = {}): Promise<NodeInfo | null> {
  const result = await getStats(node, options);
  if (result.status !== 'ok') {
    return null;
  }
  const n = (result.data.node as Record<string, unknown> | undefined) ?? {};
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
}

export interface NodeStats {
  /** The node's own last-reported keyed state (laggy — stats refresh ~30 s). */
  keyed: boolean;
  /** Nodes this node is currently connected to. */
  connections: LinkedNode[];
  /** False when the lookup failed (rate limit, network) — connections are then
   * unknown, not empty. A 404 (no stats for this node) counts as ok. */
  ok: boolean;
}

/** Fetch a node's connection list and last-reported keyed state from the stats API. */
export async function fetchNodeStats(node: string, options: FetchNodeInfoOptions = {}): Promise<NodeStats> {
  const result = await getStats(node, options);
  if (result.status !== 'ok') {
    return { keyed: false, connections: [], ok: result.status === 'notfound' };
  }
  const stats = result.data.stats as
    | { data?: { keyed?: unknown; links?: unknown[]; linkedNodes?: Array<Record<string, unknown>> } }
    | undefined;
  const dt = stats?.data ?? {};
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
  return { keyed, connections, ok: true };
}

/** Fetch the list of nodes a given node is currently connected to. */
export async function fetchNodeConnections(
  node: string,
  options: FetchNodeInfoOptions = {},
): Promise<LinkedNode[]> {
  return (await fetchNodeStats(node, options)).connections;
}
