import { describe, expect, it, vi } from 'vitest';
import { buildKeyedUrl, buildStatusUrl, sendStatpost } from './stats.js';

describe('statpost URL builders', () => {
  it('builds a status URL matching app_rpt field order and node list format', () => {
    const url = buildStatusUrl('http://stats.allstarlink.org/uhandler', {
      node: '43980',
      seqno: 5,
      timeSec: 1700000000,
      nodes: [
        { state: 'T', node: '66005' },
        { state: 'C', node: '46655' },
      ],
      version: '0.2.0',
      uptimeSec: 120,
      totalKerchunks: 0,
      totalKeyups: 3,
      totalTxTimeSec: 42,
      timeouts: 0,
      totalExecdCommands: 0,
    });
    expect(url).toBe(
      'http://stats.allstarlink.org/uhandler?node=43980&time=1700000000&seqno=5' +
        '&nodes=T66005,C46655&apprptvers=0.2.0&apprptuptime=120' +
        '&totalkerchunks=0&totalkeyups=3&totaltxtime=42&timeouts=0&totalexecdcommands=0',
    );
  });

  it('builds an empty node list when nothing is connected', () => {
    const url = buildStatusUrl('http://x/uhandler', {
      node: '43980',
      seqno: 1,
      timeSec: 1,
      nodes: [],
      version: '0.2.0',
      uptimeSec: 1,
      totalKerchunks: 0,
      totalKeyups: 0,
      totalTxTimeSec: 0,
      timeouts: 0,
      totalExecdCommands: 0,
    });
    expect(url).toContain('&nodes=&apprptvers=');
  });

  it('builds a keyed URL', () => {
    expect(
      buildKeyedUrl('http://x/uhandler', { node: '43980', seqno: 2, timeSec: 10, keyed: true, keyTimeSec: 4 }),
    ).toBe('http://x/uhandler?node=43980&time=10&seqno=2&keyed=1&keytime=4');
  });

  it('sends via GET and reports success/failure without throwing', async () => {
    const ok = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true }) as Response);
    await expect(sendStatpost('http://x', ok as unknown as typeof fetch)).resolves.toBe(true);
    expect(ok.mock.calls[0][1]?.method).toBe('GET');

    const boom = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new Error('network');
    });
    await expect(sendStatpost('http://x', boom as unknown as typeof fetch)).resolves.toBe(false);
  });
});
