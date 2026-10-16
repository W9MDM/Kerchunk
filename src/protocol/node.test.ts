import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KerchunkNode, type AudioCodec, type TopologyTreeNode } from './node.js';
import { StatsGate, clearStatsCache } from './nodeinfo.js';
import {
  CONTROL_ANSWER,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_IAX,
  FRAME_TYPE_VOICE,
  IAX_ACCEPT,
  IAX_INVAL,
  IAX_NEW,
  IAX_PING,
  IAX_PONG,
  decodeFullFrame,
  decodeMiniFrame,
  encodeFullFrame,
  encodeMiniFrame,
  isFullFrame,
} from './frames.js';

/** Identity codec: one wire byte == one PCM sample. Keeps mixing arithmetic obvious. */
const identityCodec: AudioCodec = {
  decode: (payload) => Int16Array.from(payload),
  encode: (samples) => Uint8Array.from(samples, (s) => s & 0xff),
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('KerchunkNode', () => {
  let node: KerchunkNode | null = null;
  let peer: Socket | null = null;

  afterEach(async () => {
    await node?.close();
    node = null;
    await new Promise<void>((resolve) => (peer ? peer.close(() => resolve()) : resolve()));
    peer = null;
  });

  it('links to a resolved node and conference-mixes audio both ways', async () => {
    const peerCall = 500;
    let peerRxAudio: number[] = [];

    // Minimal peer node: answers NEW, then behaves as one conference participant.
    peer = createSocket('udp4');
    peer.on('message', (data, rinfo) => {
      if (!isFullFrame(data)) {
        peerRxAudio = [...decodeMiniFrame(data).payload];
        return;
      }
      const frame = decodeFullFrame(data);
      // The first voice frame of a stream arrives as a full VOICE frame.
      if (frame.frameType === FRAME_TYPE_VOICE) {
        peerRxAudio = [...frame.payload];
        return;
      }
      if (frame.frameType !== FRAME_TYPE_IAX || frame.subclass !== IAX_NEW) {
        return;
      }
      const reply = (frameType: number, subclass: number, payload: Buffer) =>
        peer!.send(
          encodeFullFrame({
            sourceCall: peerCall,
            destCall: frame.sourceCall,
            retransmit: false,
            timestamp: 0,
            oseqno: 0,
            iseqno: 0,
            frameType,
            subclass,
            payload,
          }),
          rinfo.port,
          rinfo.address,
        );
      reply(FRAME_TYPE_IAX, IAX_ACCEPT, Buffer.alloc(0));
      reply(FRAME_TYPE_CONTROL, CONTROL_ANSWER, Buffer.alloc(0));
    });
    await new Promise<void>((resolve) => peer!.bind(4589, resolve));

    node = new KerchunkNode({
      port: 4590,
      codec: identityCodec,
      frameSize: 3,
      nodeNumber: '1000',
      resolve: async (nodeNumber) => ({ node: nodeNumber, host: '127.0.0.1', port: 4589 }),
    });

    const linked = new Promise<void>((resolve) => {
      node!.on('state', (line) => line.startsWith('linked to') && resolve());
    });
    // Drive mixTick() manually below rather than starting the 20 ms interval, so
    // the conference tick is deterministic and doesn't consume frames early.
    await node.connectToNode('4571');
    await linked;

    expect(node.getConnections()).toHaveLength(1);
    expect(node.getConnections()[0].state).toBe('up');

    // The peer sends a voice frame into the conference.
    const nodeLegRemote = peerCall;
    peer.send(
      encodeMiniFrame({ sourceCall: nodeLegRemote, timestamp: 20, payload: Buffer.from([9, 9, 9]) }),
      4590,
      '127.0.0.1',
    );
    await wait(30);

    // Local operator speaks; run one conference tick.
    const localAudio = new Promise<number[]>((resolve) => {
      node!.on('localAudio', (payload) => resolve([...payload]));
    });
    node.pushLocalAudio(Uint8Array.from([5, 6, 7]));
    node.mixTick();

    // Local hears the peer (everyone but local); the peer hears local (N-1 mixing).
    expect(await localAudio).toEqual([9, 9, 9]);
    await wait(20);
    expect(peerRxAudio).toEqual([5, 6, 7]);
  });

  it('does not stream audio back at a peer that is the only one talking', async () => {
    const peerCall = 600;
    let peerRxCount = 0;

    peer = createSocket('udp4');
    peer.on('message', (data, rinfo) => {
      if (!isFullFrame(data)) {
        peerRxCount += 1; // a mini voice frame from the node
        return;
      }
      const frame = decodeFullFrame(data);
      if (frame.frameType === FRAME_TYPE_VOICE) {
        peerRxCount += 1;
        return;
      }
      if (frame.frameType !== FRAME_TYPE_IAX || frame.subclass !== IAX_NEW) return;
      const reply = (frameType: number, subclass: number) =>
        peer!.send(
          encodeFullFrame({
            sourceCall: peerCall,
            destCall: frame.sourceCall,
            retransmit: false,
            timestamp: 0,
            oseqno: 0,
            iseqno: 0,
            frameType,
            subclass,
            payload: Buffer.alloc(0),
          }),
          rinfo.port,
          rinfo.address,
        );
      reply(FRAME_TYPE_IAX, IAX_ACCEPT);
      reply(FRAME_TYPE_CONTROL, CONTROL_ANSWER);
    });
    await new Promise<void>((resolve) => peer!.bind(4594, resolve));

    node = new KerchunkNode({
      port: 4595,
      codec: identityCodec,
      frameSize: 3,
      nodeNumber: '1000',
      reportStats: false,
      resolve: async (n) => ({ node: n, host: '127.0.0.1', port: 4594 }),
    });
    const linked = new Promise<void>((resolve) => {
      node!.on('state', (line) => line.startsWith('linked to') && resolve());
    });
    await node.connectToNode('4571');
    await linked;

    // Peer talks; we are NOT keyed. We should hear it but NOT transmit back.
    peer.send(encodeMiniFrame({ sourceCall: peerCall, timestamp: 20, payload: Buffer.from([9, 9, 9]) }), 4595, '127.0.0.1');
    await wait(30);
    const heard = new Promise<number[]>((resolve) => node!.on('localAudio', (p) => resolve([...p])));
    node.mixTick();

    expect(await heard).toEqual([9, 9, 9]); // we hear the peer
    await wait(20);
    expect(peerRxCount).toBe(0); // but we sent it nothing
  });

  it('reports and tears down connections', async () => {
    node = new KerchunkNode({
      port: 4591,
      codec: identityCodec,
      resolve: async (nodeNumber) => ({ node: nodeNumber, host: '127.0.0.1', port: 4599 }),
    });
    await node.connectToNode('2000');
    expect(node.getConnections()).toHaveLength(1);

    node.disconnectNode('2000');
    expect(node.getConnections()).toHaveLength(0);
  });

  it('replies INVAL to a stale/unknown call so the peer tears it down', async () => {
    node = new KerchunkNode({
      port: 4592,
      codec: identityCodec,
      resolve: async (nodeNumber) => ({ node: nodeNumber, host: '127.0.0.1', port: 4593 }),
    });

    peer = createSocket('udp4');
    const inval = new Promise<{ sourceCall: number; destCall: number }>((resolve) => {
      peer!.on('message', (data) => {
        if (!isFullFrame(data)) return;
        const frame = decodeFullFrame(data);
        if (frame.frameType === FRAME_TYPE_IAX && frame.subclass === IAX_INVAL) {
          resolve({ sourceCall: frame.sourceCall, destCall: frame.destCall });
        }
      });
    });
    await new Promise<void>((resolve) => peer!.bind(4593, resolve));

    // A peer keeps pinging a call the node doesn't have (a zombie after teardown).
    peer.send(
      encodeFullFrame({
        sourceCall: 999,
        destCall: 1,
        retransmit: false,
        timestamp: 0,
        oseqno: 0,
        iseqno: 0,
        frameType: FRAME_TYPE_IAX,
        subclass: IAX_PING,
        payload: Buffer.alloc(0),
      }),
      4592,
      '127.0.0.1',
    );

    const reply = await inval;
    expect(reply.destCall).toBe(999);
  });

  /** A peer that answers NEW, then answers PINGs only while `alive()` is true. */
  async function keepalivePeer(peerPort: number, alive: () => boolean): Promise<Socket> {
    const sock = createSocket('udp4');
    sock.on('message', (data, rinfo) => {
      if (!isFullFrame(data)) return;
      const frame = decodeFullFrame(data);
      if (frame.frameType !== FRAME_TYPE_IAX) return;
      const reply = (frameType: number, subclass: number) =>
        sock.send(
          encodeFullFrame({
            sourceCall: 700,
            destCall: frame.sourceCall,
            retransmit: false,
            timestamp: 0,
            oseqno: 0,
            iseqno: 0,
            frameType,
            subclass,
            payload: Buffer.alloc(0),
          }),
          rinfo.port,
          rinfo.address,
        );
      if (frame.subclass === IAX_NEW) {
        reply(FRAME_TYPE_IAX, IAX_ACCEPT);
        reply(FRAME_TYPE_CONTROL, CONTROL_ANSWER);
      } else if (frame.subclass === IAX_PING && alive()) {
        reply(FRAME_TYPE_IAX, IAX_PONG);
      }
    });
    await new Promise<void>((resolve) => sock.bind(peerPort, resolve));
    return sock;
  }

  it('drops an up link whose peer goes silent, and keeps one that answers PINGs', async () => {
    let alive = true;
    peer = await keepalivePeer(4595, () => alive);
    node = new KerchunkNode({
      port: 4594,
      codec: identityCodec,
      reportStats: false,
      linkPingIntervalMs: 40,
      linkTimeoutMs: 200,
      resolve: async (nodeNumber) => ({ node: nodeNumber, host: '127.0.0.1', port: 4595 }),
    });
    const linked = new Promise<void>((resolve) => {
      node!.on('state', (line) => line.startsWith('linked to') && resolve());
    });
    await node.connectToNode('2000');
    await linked;

    // Answering PINGs keeps the link up well past the timeout.
    await wait(500);
    expect(node.getConnections()).toHaveLength(1);

    // The peer vanishes (no HANGUP) — the link is detected as lost.
    const lost = new Promise<string>((resolve) => {
      node!.on('state', (line) => line.includes('lost') && resolve(line));
    });
    alive = false;
    expect(await lost).toContain('link to 2000 lost');
    expect(node.getConnections()).toHaveLength(0);
  });

  it('maps the mesh without looking up non-public entries, flagging failed lookups', async () => {
    clearStatsCache();
    peer = await keepalivePeer(4597, () => true);
    const mesh: Record<string, string[]> = {
      '2000': ['651860', '1610', 'KB9MQU', '3058210'],
      '651860': ['2000', '626480'],
    };
    const fetchImpl = vi.fn(async (url: string) => {
      const n = decodeURIComponent(url.split('/').pop()!);
      if (n === '626480') {
        return { ok: false, status: 500, headers: new Headers(), json: async () => ({}) } as unknown as Response;
      }
      const links = mesh[n] ?? [];
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ stats: { data: { keyed: false, linkedNodes: links.map((name) => ({ name })) } } }),
      } as unknown as Response;
    });
    node = new KerchunkNode({
      port: 4596,
      codec: identityCodec,
      reportStats: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      statsGate: new StatsGate(0),
      resolve: async (nodeNumber) => ({ node: nodeNumber, host: '127.0.0.1', port: 4597 }),
    });
    const linked = new Promise<void>((resolve) => {
      node!.on('state', (line) => line.startsWith('linked to') && resolve());
    });
    await node.connectToNode('2000');
    await linked;

    const snapshots: boolean[] = [];
    const topo = await node.getTopology((s) => snapshots.push(s.complete));

    const looked = fetchImpl.mock.calls.map(([url]) => decodeURIComponent(String(url).split('/').pop()!));
    expect(looked.sort()).toEqual(['2000', '626480', '651860']);
    expect(topo.complete).toBe(true);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every((c) => c === false)).toBe(true);

    const find = (t: TopologyTreeNode, n: string): TopologyTreeNode | undefined =>
      t.node === n && !t.truncated ? t : t.children.map((c) => find(c, n)).find(Boolean);
    const hub = find(topo.root, '2000')!;
    expect(hub.children.map((c) => c.node)).toEqual(['651860', '1610', 'KB9MQU', '3058210']);
    expect(find(topo.root, '626480')!.unavailable).toBe(true);
    expect(find(topo.root, '651860')!.unavailable).toBe(false);
  });
});
