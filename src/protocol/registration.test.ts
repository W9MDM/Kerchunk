import { describe, expect, it, vi } from 'vitest';
import { registerNode } from './registration.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A typed fetch mock so `.mock.calls` captures (url, init). */
function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => jsonResponse(body, ok, status));
}

describe('registerNode', () => {
  it('POSTs the ASL3 registration payload and parses a success response', async () => {
    const fetchImpl = fakeFetch({
      ipaddr: '203.0.113.9',
      port: 4569,
      refresh: 120,
      data: 'node successfully registered',
    });

    const result = await registerNode('66005', 'hunter2', {
      advertisePort: 4569,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      success: true,
      ipaddr: '203.0.113.9',
      port: 4569,
      refresh: 120,
      message: 'node successfully registered',
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://register.allstarlink.org/');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({
      port: 4569,
      data: { nodes: { '66005': { node: '66005', passwd: 'hunter2', remote: 0 } } },
    });
  });

  it('omits the port field when no bindport is advertised', async () => {
    const fetchImpl = fakeFetch({ data: 'successfully registered', refresh: 60 });
    await registerNode('1234', 'pw', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toEqual({
      data: { nodes: { '1234': { node: '1234', passwd: 'pw', remote: 0 } } },
    });
  });

  it('reports failure when the response is not a success', async () => {
    const fetchImpl = fakeFetch({ data: 'authentication failed' });
    const result = await registerNode('1234', 'wrong', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.success).toBe(false);
    expect(result.refresh).toBe(60);
  });

  it('reports failure on a non-OK HTTP status', async () => {
    const fetchImpl = fakeFetch({}, false, 403);
    const result = await registerNode('1234', 'pw', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.success).toBe(false);
    expect(result.message).toBe('HTTP 403');
  });
});
