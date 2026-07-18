import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IAX_PORT,
  isValidNodeNumber,
  resolveNode,
  type DnsResolver,
  type SrvRecord,
} from './resolver.js';

/** A configurable fake resolver: each method either returns data or throws ENOTFOUND. */
function fakeResolver(overrides: Partial<Record<keyof DnsResolver, unknown>>): DnsResolver {
  const notFound = () => Promise.reject(new Error('ENOTFOUND'));
  const wrap = <T>(value: unknown): (() => Promise<T>) =>
    value === undefined ? (notFound as () => Promise<T>) : () => Promise.resolve(value as T);
  return {
    resolveSrv: wrap<SrvRecord[]>(overrides.resolveSrv),
    resolve4: wrap<string[]>(overrides.resolve4),
    resolveTxt: wrap<string[][]>(overrides.resolveTxt),
  };
}

describe('node number validation', () => {
  it('accepts numeric node numbers up to seven digits', () => {
    expect(isValidNodeNumber('2000')).toBe(true);
    expect(isValidNodeNumber('50000')).toBe(true);
    expect(isValidNodeNumber(' 12345 ')).toBe(true);
  });

  it('rejects non-numeric or oversized node numbers', () => {
    expect(isValidNodeNumber('')).toBe(false);
    expect(isValidNodeNumber('12ab')).toBe(false);
    expect(isValidNodeNumber('12345678')).toBe(false);
    expect(isValidNodeNumber('1.2.3.4')).toBe(false);
  });
});

describe('resolveNode', () => {
  it('resolves via SRV port and A address', async () => {
    const resolver = fakeResolver({
      resolveSrv: [{ name: '50000.nodes.allstarlink.org', port: 4569, priority: 10, weight: 10 }],
      resolve4: ['162.248.93.134'],
    });
    await expect(resolveNode('50000', { resolver })).resolves.toEqual({
      node: '50000',
      host: '162.248.93.134',
      port: 4569,
    });
  });

  it('honors a non-standard IAX port from the SRV record', async () => {
    const resolver = fakeResolver({
      resolveSrv: [{ name: '2000.nodes.allstarlink.org', port: 4570, priority: 10, weight: 10 }],
      resolve4: ['10.0.0.5'],
    });
    const resolved = await resolveNode('2000', { resolver });
    expect(resolved.port).toBe(4570);
  });

  it('prefers the lowest-priority SRV record', async () => {
    const resolver = fakeResolver({
      resolveSrv: [
        { name: 'a.nodes.allstarlink.org', port: 5000, priority: 20, weight: 10 },
        { name: 'b.nodes.allstarlink.org', port: 4569, priority: 5, weight: 10 },
      ],
      resolve4: ['203.0.113.9'],
    });
    const resolved = await resolveNode('1234', { resolver });
    expect(resolved.port).toBe(4569);
  });

  it('falls back to the TXT record when SRV is absent', async () => {
    const resolver = fakeResolver({
      resolveTxt: [['NN=50000', 'IP=44.98.248.144', 'PT=4569']],
    });
    await expect(resolveNode('50000', { resolver })).resolves.toEqual({
      node: '50000',
      host: '44.98.248.144',
      port: 4569,
    });
  });

  it('falls back to a bare A record with the default port', async () => {
    const resolver = fakeResolver({
      resolve4: ['198.51.100.7'],
    });
    await expect(resolveNode('40000', { resolver })).resolves.toEqual({
      node: '40000',
      host: '198.51.100.7',
      port: DEFAULT_IAX_PORT,
    });
  });

  it('rejects an invalid node number without any DNS lookup', async () => {
    const resolver = fakeResolver({});
    await expect(resolveNode('not-a-node', { resolver })).rejects.toThrow(/valid AllStarLink node number/);
  });

  it('throws a helpful error when nothing resolves', async () => {
    const resolver = fakeResolver({});
    await expect(resolveNode('99999', { resolver })).rejects.toThrow(/Could not resolve AllStarLink node 99999/);
  });
});
