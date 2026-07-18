import { promises as dnsPromises } from 'node:dns';

/**
 * AllStarLink node-number resolution.
 *
 * In ASL3 a node number is resolved to an address purely through DNS against
 * `nodes.allstarlink.org`, which is kept in sync with the network registration
 * database. For node N:
 *
 *   SRV  `_iax._udp.N.nodes.allstarlink.org` -> IAX port (+ target name)
 *   A    `N.nodes.allstarlink.org`           -> node IP (or IAX proxy IP)
 *   TXT  `N.nodes.allstarlink.org`           -> "NN=N" "IP=..." "PT=4569"
 *
 * This module is pure Node (no Electron) so it is fully exercisable from Vitest
 * via an injectable {@link DnsResolver}.
 */

/** The DNS zone AllStarLink publishes active-node records under. */
export const NODE_DNS_DOMAIN = 'nodes.allstarlink.org';

/** Standard IAX2 UDP port; used when a record omits an explicit port. */
export const DEFAULT_IAX_PORT = 4569;

export interface ResolvedNode {
  /** The node number that was resolved. */
  node: string;
  /** IPv4 address of the node (or its IAX proxy). */
  host: string;
  /** IAX2 UDP port to send to. */
  port: number;
}

export interface SrvRecord {
  name: string;
  port: number;
  priority: number;
  weight: number;
}

/**
 * The subset of `node:dns` this resolver depends on. Injectable so tests can
 * supply deterministic answers instead of hitting the live network.
 */
export interface DnsResolver {
  resolveSrv(hostname: string): Promise<SrvRecord[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
}

const systemResolver: DnsResolver = {
  resolveSrv: (hostname) => dnsPromises.resolveSrv(hostname),
  resolve4: (hostname) => dnsPromises.resolve4(hostname),
  resolveTxt: (hostname) => dnsPromises.resolveTxt(hostname),
};

export interface ResolveNodeOptions {
  /** DNS implementation to use. Defaults to the system resolver. */
  resolver?: DnsResolver;
  /** Override the DNS zone (useful for a private directory in tests). */
  domain?: string;
}

/** AllStarLink node numbers are numeric, up to seven digits. */
export function isValidNodeNumber(node: string): boolean {
  return /^[0-9]{1,7}$/.test(node.trim());
}

/**
 * Resolve an AllStarLink node number to a concrete `{ host, port }`.
 *
 * Prefers the SRV+A pair (authoritative for the port), falls back to the TXT
 * record, then to a bare A lookup with the default IAX port. Throws a
 * human-readable error if the node cannot be resolved at all.
 */
export async function resolveNode(node: string, options: ResolveNodeOptions = {}): Promise<ResolvedNode> {
  const trimmed = node.trim();
  if (!isValidNodeNumber(trimmed)) {
    throw new Error(`"${node}" is not a valid AllStarLink node number.`);
  }

  const resolver = options.resolver ?? systemResolver;
  const domain = options.domain ?? NODE_DNS_DOMAIN;
  const baseName = `${trimmed}.${domain}`;

  // Preferred path: SRV gives the authoritative port and target; A gives the IP.
  try {
    const srv = pickSrv(await resolver.resolveSrv(`_iax._udp.${baseName}`));
    if (srv) {
      const target = srv.name && srv.name.length > 0 ? srv.name.replace(/\.$/, '') : baseName;
      const host = await firstA(resolver, target, baseName);
      if (host) {
        return { node: trimmed, host, port: srv.port || DEFAULT_IAX_PORT };
      }
    }
  } catch {
    // No SRV (or lookup failed) — fall through to TXT.
  }

  // Fallback: the TXT record carries IP= and PT=.
  try {
    const { ip, port } = parseTxt(await resolver.resolveTxt(baseName));
    if (ip) {
      return { node: trimmed, host: ip, port: port ?? DEFAULT_IAX_PORT };
    }
  } catch {
    // No TXT — fall through to a bare A lookup.
  }

  // Last resort: an A record with the default IAX port.
  try {
    const host = await firstA(resolver, baseName, baseName);
    if (host) {
      return { node: trimmed, host, port: DEFAULT_IAX_PORT };
    }
  } catch {
    // Nothing resolved.
  }

  throw new Error(`Could not resolve AllStarLink node ${trimmed}. It may be offline or unregistered.`);
}

/** Choose the SRV record with the lowest priority, breaking ties by weight. */
function pickSrv(records: SrvRecord[]): SrvRecord | undefined {
  if (!records || records.length === 0) {
    return undefined;
  }
  return [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
}

/** First A-record address for `hostname`, falling back to `fallbackName`. */
async function firstA(resolver: DnsResolver, hostname: string, fallbackName: string): Promise<string | undefined> {
  for (const name of hostname === fallbackName ? [hostname] : [hostname, fallbackName]) {
    try {
      const addresses = await resolver.resolve4(name);
      if (addresses && addresses.length > 0) {
        return addresses[0];
      }
    } catch {
      // Try the next candidate name.
    }
  }
  return undefined;
}

/** Extract IP= and PT= from a node's TXT record (chunks joined across strings). */
function parseTxt(records: string[][]): { ip?: string; port?: number } {
  const flat = records.flat().join(' ');
  const ip = /IP=([0-9.]+)/i.exec(flat)?.[1];
  const portRaw = /PT=([0-9]+)/i.exec(flat)?.[1];
  return { ip, port: portRaw ? Number(portRaw) : undefined };
}
