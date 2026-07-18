/**
 * AllStarLink node statistics reporting (the app_rpt `statpost` mechanism).
 *
 * A node periodically GETs stats.allstarlink.org/uhandler with its status so the
 * network stats site shows it as reporting. Two post types (from app_rpt.c):
 *
 *   status: ?node=N&time=T&seqno=S&nodes=<list>&apprptvers=x.y.z&apprptuptime=U
 *           &totalkerchunks=..&totalkeyups=..&totaltxtime=..&timeouts=..&totalexecdcommands=..
 *   keyed:  ?node=N&time=T&seqno=S&keyed=<0|1>&keytime=<sec>
 *
 * The `nodes` list is comma-separated, each entry a state char + node number:
 *   T = transceive, R = receive-only/monitor, L = local, C = connecting.
 *
 * Values are sent unencoded to match app_rpt's raw sprintf output.
 */

export const DEFAULT_STATPOST_URL = 'http://stats.allstarlink.org/uhandler';

export type LinkState = 'T' | 'R' | 'L' | 'C';

export interface StatusReport {
  node: string;
  seqno: number;
  timeSec: number;
  nodes: Array<{ state: LinkState; node: string }>;
  version: string;
  uptimeSec: number;
  totalKerchunks: number;
  totalKeyups: number;
  totalTxTimeSec: number;
  timeouts: number;
  totalExecdCommands: number;
}

export interface KeyedReport {
  node: string;
  seqno: number;
  timeSec: number;
  keyed: boolean;
  keyTimeSec: number;
}

export function buildStatusUrl(baseUrl: string, r: StatusReport): string {
  const nodes = r.nodes.map((n) => `${n.state}${n.node}`).join(',');
  return (
    `${baseUrl}?node=${r.node}&time=${r.timeSec}&seqno=${r.seqno}` +
    `&nodes=${nodes}` +
    `&apprptvers=${r.version}` +
    `&apprptuptime=${r.uptimeSec}` +
    `&totalkerchunks=${r.totalKerchunks}` +
    `&totalkeyups=${r.totalKeyups}` +
    `&totaltxtime=${r.totalTxTimeSec}` +
    `&timeouts=${r.timeouts}` +
    `&totalexecdcommands=${r.totalExecdCommands}`
  );
}

export function buildKeyedUrl(baseUrl: string, r: KeyedReport): string {
  return (
    `${baseUrl}?node=${r.node}&time=${r.timeSec}&seqno=${r.seqno}` +
    `&keyed=${r.keyed ? 1 : 0}&keytime=${r.keyTimeSec}`
  );
}

/** GET a statpost URL. Returns true on a 2xx response; never throws. */
export async function sendStatpost(url: string, fetchImpl?: typeof fetch): Promise<boolean> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    return false;
  }
  try {
    const response = await doFetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}
