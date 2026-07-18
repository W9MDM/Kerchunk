import { describe, expect, it, vi } from 'vitest';
import { fetchNodeConnections, fetchNodeInfo, fetchNodeStats } from './nodeinfo.js';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

const SAMPLE = {
  node: {
    callsign: 'W9ML',
    node_frequency: '444.550',
    node_tone: '173.8',
    Status: 'Active',
    server: { Location: 'Hebron, IN', Server_Name: 'W9ML-Repeater', SiteName: 'W9ML' },
  },
};

describe('fetchNodeInfo', () => {
  it('parses callsign, location, description, frequency and tone', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE));
    const info = await fetchNodeInfo('66005', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(info).toEqual({
      node: '66005',
      callsign: 'W9ML',
      location: 'Hebron, IN',
      description: 'W9ML-Repeater',
      frequency: '444.550',
      tone: '173.8',
      status: 'Active',
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://stats.allstarlink.org/api/stats/66005');
  });

  it('returns null on a non-OK response', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}, false));
    expect(await fetchNodeInfo('1', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new Error('network');
    });
    expect(await fetchNodeInfo('1', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });

  it('returns null when the node has no useful metadata', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ node: {} }));
    expect(await fetchNodeInfo('1', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });
});

describe('fetchNodeConnections', () => {
  it('parses linkedNodes with and without metadata', async () => {
    const body = {
      stats: {
        data: {
          links: ['46655', '6453'],
          linkedNodes: [
            { name: 46655, callsign: 'N9IAA', server: { Location: 'Valparaiso, IN' } },
            { name: '6453' },
          ],
        },
      },
    };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body));
    const links = await fetchNodeConnections('43980', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(links).toEqual([
      { node: '46655', callsign: 'N9IAA', location: 'Valparaiso, IN' },
      { node: '6453', callsign: undefined, location: undefined },
    ]);
  });

  it('falls back to the links array when linkedNodes is absent', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ stats: { data: { links: ['100', '200'] } } }),
    );
    const links = await fetchNodeConnections('1', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(links.map((l) => l.node)).toEqual(['100', '200']);
  });

  it('returns [] on error', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new Error('network');
    });
    expect(await fetchNodeConnections('1', { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual([]);
  });
});

describe('fetchNodeStats', () => {
  it('returns keyed state alongside connections', async () => {
    const body = { stats: { data: { keyed: true, links: ['46655'], linkedNodes: [{ name: 46655 }] } } };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body));
    const stats = await fetchNodeStats('66005', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(stats.keyed).toBe(true);
    expect(stats.connections.map((l) => l.node)).toEqual(['46655']);
  });

  it('defaults to not-keyed with no connections on error', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new Error('network');
    });
    expect(await fetchNodeStats('1', { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({
      keyed: false,
      connections: [],
    });
  });
});
