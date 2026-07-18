/**
 * AllStarLink portal Web Transceiver token acquisition.
 *
 * Guests (operators without a node number) authenticate to a node with the
 * well-known allstar-public/allstar user plus a per-session token that the
 * AllStarLink portal issues; the far node validates the token against the
 * portal. The flow (mirroring DroidStar's obtain_asl_wt_creds):
 *
 *   1. POST https://www.allstarlink.org/portal/login.php
 *      body: user=<callsign>&pass=<portal password>   (session cookie returned)
 *   2. GET  https://www.allstarlink.org/portal/webtransceiver.php?node=<node>
 *      → HTML containing a `callingName "<token>"` line; the quoted value is
 *        the session token, carried in the IAX CALLING NAME IE.
 */

export const PORTAL_BASE = 'https://www.allstarlink.org/portal';

export interface FetchTokenOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Collect Set-Cookie headers into a single Cookie header value. */
function cookiesFrom(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const raw = getSetCookie ? getSetCookie.call(response.headers) : [];
  const single = response.headers.get('set-cookie');
  const all = raw.length > 0 ? raw : single ? [single] : [];
  return all.map((cookie) => cookie.split(';')[0]).join('; ');
}

/** Extract the token from the webtransceiver.php HTML (the callingName param). */
export function parseWebTransceiverToken(html: string): string | null {
  for (const line of html.split('\n')) {
    if (line.includes('callingName')) {
      const parts = line.split('"');
      if (parts.length >= 4 && parts[3].trim() !== '') {
        return parts[3];
      }
    }
  }
  return null;
}

/**
 * Log into the AllStarLink portal and fetch a Web Transceiver token for the
 * given node. Throws with a readable message on failure.
 */
export async function fetchWebTransceiverToken(
  callsign: string,
  password: string,
  node: string,
  options: FetchTokenOptions = {},
): Promise<string> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    throw new Error('No fetch implementation available for the portal login.');
  }
  const base = options.baseUrl ?? PORTAL_BASE;

  const login = await doFetch(`${base}/login.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `user=${encodeURIComponent(callsign)}&pass=${encodeURIComponent(password)}`,
    redirect: 'manual',
  });
  // A 200 or a redirect are both fine — what matters is the session cookie.
  const cookie = cookiesFrom(login);
  if (!cookie) {
    throw new Error('AllStarLink portal login failed (no session). Check callsign/password.');
  }

  const page = await doFetch(`${base}/webtransceiver.php?node=${encodeURIComponent(node)}`, {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  if (!page.ok) {
    throw new Error(`Portal web-transceiver page failed (HTTP ${page.status}).`);
  }
  const token = parseWebTransceiverToken(await page.text());
  if (!token) {
    throw new Error(
      'No web-transceiver token found — check your portal login, and that this node allows Web Transceiver access.',
    );
  }
  return token;
}
