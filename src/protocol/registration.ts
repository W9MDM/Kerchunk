/**
 * ASL3 HTTP-based node registration.
 *
 * Registration publishes our node number → public IP into the AllStarLink
 * network database (and DNS). This is what lets other nodes accept our outbound
 * links: a called node validates that the calling node number resolves to the
 * source IP of the call. The registrar records the public IP it perceives our
 * POST arriving from, so this works even behind NAT.
 *
 * Wire protocol (from ASL3 res_rpt_http_registrations.c):
 *   POST https://register.allstarlink.org/
 *   Content-Type: application/json
 *   { "port": <iax bindport>,
 *     "data": { "nodes": { "<node>": { "node": "<node>", "passwd": "<pw>", "remote": 0 } } } }
 * Response JSON: { "ipaddr", "port", "refresh", "data" } where `data` contains
 * the string "successfully registered" on success. No challenge/nonce — the
 * password is sent in the body over HTTPS.
 */

export const DEFAULT_REGISTRAR_HOST = 'register.allstarlink.org';
const DEFAULT_REFRESH_SECONDS = 60;

export interface RegistrationResult {
  success: boolean;
  /** Public IP the registrar perceived for us. */
  ipaddr?: string;
  /** Port the registrar recorded. */
  port?: number;
  /** Seconds until the registration should be refreshed. */
  refresh: number;
  /** Raw status text from the response `data` field, for logging. */
  message?: string;
}

export interface RegisterNodeOptions {
  /** Registrar host; defaults to register.allstarlink.org. */
  host?: string;
  /** Our IAX bindport to advertise (omit to leave it out of the request). */
  advertisePort?: number;
  /** Injectable fetch for testing; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface RegistrarResponse {
  ipaddr?: string;
  port?: number;
  refresh?: number;
  data?: unknown;
}

/** Perform a single HTTP registration POST and parse the result. */
export async function registerNode(
  node: string,
  password: string,
  options: RegisterNodeOptions = {},
): Promise<RegistrationResult> {
  const host = options.host ?? DEFAULT_REGISTRAR_HOST;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    throw new Error('No fetch implementation is available for HTTP registration.');
  }

  const body: Record<string, unknown> = {
    data: { nodes: { [node]: { node, passwd: password, remote: 0 } } },
  };
  if (options.advertisePort) {
    body.port = options.advertisePort;
  }

  const response = await doFetch(`https://${host}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { success: false, refresh: DEFAULT_REFRESH_SECONDS, message: `HTTP ${response.status}` };
  }

  const json = (await response.json()) as RegistrarResponse;
  const message = typeof json.data === 'string' ? json.data : JSON.stringify(json.data ?? '');
  return {
    success: message.includes('successfully registered'),
    ipaddr: json.ipaddr,
    port: json.port,
    refresh: json.refresh && json.refresh > 0 ? json.refresh : DEFAULT_REFRESH_SECONDS,
    message,
  };
}
