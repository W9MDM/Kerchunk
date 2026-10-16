import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StatsGate,
  clearStatsCache,
  fetchNodeConnections,
  fetchNodeInfo,
  fetchNodeStats,
  isPublicNodeNumber,
  setDefaultStatsGate,
} from './nodeinfo.js';

beforeEach(() => {
  clearStatsCache();
  // No real pacing/back-off sleeps in unit tests.
  let now = 0;
  setDefaultStatsGate(
    new StatsGate(0, () => now, async (ms) => {
      now += ms;
    }),
  );
});

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
    const links = await fetchNodeConnections('12345', { fetchImpl: fetchImpl as unknown as typeof fetch });
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
      ok: false,
    });
  });
});

/** A Response with a status code and headers (rate-limit tests). */
function statusResponse(status: number, body: unknown = [], headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

/** A gate on a fake clock whose sleep() just advances time. */
function fakeGate(minIntervalMs = 2200) {
  let now = 0;
  const slept: number[] = [];
  const gate = new StatsGate(minIntervalMs, () => now, async (ms) => {
    slept.push(ms);
    now += ms;
  });
  return { gate, slept, total: () => slept.reduce((a, b) => a + b, 0) };
}

describe('isPublicNodeNumber', () => {
  it('accepts public node numbers only', () => {
    for (const n of ['2000', '44321', '651860', '999999']) expect(isPublicNodeNumber(n)).toBe(true);
    // private, EchoLink/phone (7-digit), web-client callsigns
    for (const n of ['1610', '1999', '3058210', 'KB9MQU', 'W9MDM', '']) expect(isPublicNodeNumber(n)).toBe(false);
  });
});

describe('StatsGate', () => {
  it('spaces requests apart instead of bursting', async () => {
    const { gate, total } = fakeGate(2200);
    for (let i = 0; i < 4; i += 1) expect(await gate.acquire()).toBe(true);
    expect(total()).toBe(3 * 2200);
  });

  it('lets queued high-priority lookups go before background polling', async () => {
    const { gate } = fakeGate(2200);
    await gate.acquire(); // the next slot is 2.2 s away
    const high = gate.acquire('high'); // now queued
    expect(await gate.acquire('low')).toBe(false);
    expect(await high).toBe(true);
    expect(await gate.acquire('low')).toBe(true); // nothing queued: waits its turn
  });

  it('pauses for Retry-After and after a back-off', async () => {
    const { gate, total } = fakeGate(0);
    gate.noteServer(null, 7);
    expect(await gate.acquire('low')).toBe(false);
    await gate.acquire();
    expect(total()).toBeGreaterThanOrEqual(7000);
    gate.backoff(30_000);
    await gate.acquire();
    expect(total()).toBeGreaterThanOrEqual(37_000);
  });
});

describe('fetchNodeStats rate limiting', () => {
  const STATS = { stats: { data: { keyed: false, linkedNodes: [{ name: 651861 }, { name: 'KB9MQU' }] } } };

  it('retries after a 429 instead of reporting no links', async () => {
    const { gate, slept } = fakeGate(0);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(429, [], { 'Retry-After': '3' }))
      .mockResolvedValueOnce(statusResponse(200, STATS));
    const stats = await fetchNodeStats('651860', { fetchImpl, gate });
    expect(stats.ok).toBe(true);
    expect(stats.connections.map((c) => c.node)).toEqual(['651861', 'KB9MQU']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3000);
  });

  it('flags a persistent failure as not ok (unknown, not empty)', async () => {
    const { gate } = fakeGate(0);
    const fetchImpl = vi.fn().mockResolvedValue(statusResponse(429, [], { 'Retry-After': '1' }));
    expect((await fetchNodeStats('626480', { fetchImpl, gate })).ok).toBe(false);
  });

  it('treats 404 (no stats for this node) as ok with no links', async () => {
    const { gate } = fakeGate(0);
    const fetchImpl = vi.fn().mockResolvedValue(statusResponse(404));
    expect(await fetchNodeStats('3058210', { fetchImpl, gate })).toEqual({ keyed: false, connections: [], ok: true });
  });

  it('caches responses so a refresh does not spend the budget again', async () => {
    const { gate } = fakeGate(0);
    const fetchImpl = vi.fn().mockResolvedValue(statusResponse(200, STATS));
    await fetchNodeStats('651860', { fetchImpl, gate });
    await fetchNodeInfo('651860', { fetchImpl, gate });
    await fetchNodeStats('651860', { fetchImpl, gate });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
