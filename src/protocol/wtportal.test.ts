import { describe, expect, it, vi } from 'vitest';
import { fetchWebTransceiverToken, parseWebTransceiverToken } from './wtportal.js';

const WT_HTML = [
  '<html>',
  '<applet id="WebTransceiver">',
  '<param name="user" value="allstar-public"/>',
  '<param name="callingName" value="7061ff6961f7"/>',
  '<param name="callSign" value="W9MDM"/>',
  '</applet>',
  '</html>',
].join('\n');

function response(body: string, init: { ok?: boolean; status?: number; setCookie?: string[] } = {}): Response {
  const headers = new Headers();
  const setCookie = init.setCookie ?? [];
  for (const cookie of setCookie) {
    headers.append('set-cookie', cookie);
  }
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers,
    text: async () => body,
  } as unknown as Response;
}

describe('parseWebTransceiverToken', () => {
  it('extracts the callingName token from the applet HTML', () => {
    expect(parseWebTransceiverToken(WT_HTML)).toBe('7061ff6961f7');
  });

  it('returns null when no token is present', () => {
    expect(parseWebTransceiverToken('<html>no token here</html>')).toBeNull();
  });
});

describe('fetchWebTransceiverToken', () => {
  it('logs in, carries the session cookie, and returns the token', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/login.php')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe('user=W9MDM&pass=pw%26stuff');
        return response('', { setCookie: ['PHPSESSID=abc123; path=/', 'other=1; path=/'] });
      }
      expect(url).toContain('/webtransceiver.php?node=66005');
      expect((init?.headers as Record<string, string>).Cookie).toBe('PHPSESSID=abc123; other=1');
      return response(WT_HTML);
    });

    const token = await fetchWebTransceiverToken('W9MDM', 'pw&stuff', '66005', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(token).toBe('7061ff6961f7');
  });

  it('fails clearly when login yields no session cookie', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => response(''));
    await expect(
      fetchWebTransceiverToken('W9MDM', 'bad', '66005', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/login failed/);
  });

  it('fails clearly when the page has no token', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/login.php')
        ? response('', { setCookie: ['PHPSESSID=abc; path=/'] })
        : response('<html>denied</html>'),
    );
    await expect(
      fetchWebTransceiverToken('W9MDM', 'pw', '66005', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/No web-transceiver token/);
  });
});
