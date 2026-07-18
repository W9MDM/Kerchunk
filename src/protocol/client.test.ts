import { createSocket } from 'node:dgram';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { IaxClient } from './client.js';
import { CallState } from './call.js';
import {
  CONTROL_ANSWER,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_IAX,
  IAX_ACCEPT,
  IAX_AUTHREP,
  IAX_AUTHREQ,
  IAX_NEW,
  IAX_REGACK,
  IAX_REGAUTH,
  IAX_REGREQ,
  decodeFullFrame,
  encodeFullFrame,
  isFullFrame,
} from './frames.js';
import {
  AUTH_METHOD_MD5,
  IE_TYPE_AUTHMETHODS,
  IE_TYPE_CHALLENGE,
  IE_TYPE_FORMAT,
  IE_TYPE_MD5_RESULT,
  decodeInformationElements,
  encodeInformationElements,
  findInformationElement,
} from './ies.js';
import { FORMAT_ULAW } from './client.js';

function waitForState(client: IaxClient, predicate: (value: string) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for state')), 1000);
    const handler = (value: string) => {
      if (predicate(value)) {
        clearTimeout(timer);
        client.off('state', handler);
        resolve();
      }
    };
    client.on('state', handler);
  });
}

function waitForRegistered(client: IaxClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for registration')), 1000);
    client.once('registered', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('IaxClient call control', () => {
  let clients: IaxClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    clients = [];
  });

  it('completes an auto-answered call and exchanges voice, text and DTMF', async () => {
    // Use throwaway ports, not the canonical 4569 — a running node/app holds that.
    const callee = new IaxClient({ port: 4575 });
    const caller = new IaxClient({ port: 4576 });
    clients = [callee, caller];

    const receivedAudio: number[] = [];
    let receivedText = '';
    let receivedDtmf = '';
    callee.on('audio', (event) => receivedAudio.push(...event.frame));
    callee.on('text', (text) => (receivedText = text));
    callee.on('dtmf', (digit) => (receivedDtmf = digit));

    const callerUp = waitForState(caller, (state) => state === 'up');
    const calleeUp = waitForState(callee, (state) => state === 'up');
    await caller.connect({ host: '127.0.0.1', port: 4575, username: 'node1' });
    await Promise.all([callerUp, calleeUp]);

    expect(caller.callState).toBe(CallState.Up);
    expect(callee.callState).toBe(CallState.Up);

    caller.sendAudio(Buffer.from([1, 2, 3, 4]));
    caller.sendText('KerchunkTest');
    caller.sendDtmf('5');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(receivedAudio).toEqual([1, 2, 3, 4]);
    expect(receivedText).toBe('KerchunkTest');
    expect(receivedDtmf).toBe('5');

    await caller.hangup();
    expect(caller.callState).toBe(CallState.Hangup);
  });

  it('answers a call-time MD5 auth challenge and reaches the up state', async () => {
    const secret = 'linkpass';
    const challenge = '827431';

    // Minimal secured node: NEW -> AUTHREQ(challenge); AUTHREP(md5) -> ACCEPT + ANSWER.
    const server = createSocket('udp4');
    let verifiedDigest = '';
    server.on('message', (data, rinfo) => {
      if (!isFullFrame(data)) {
        return;
      }
      const frame = decodeFullFrame(data);
      if (frame.frameType !== FRAME_TYPE_IAX) {
        return;
      }
      const reply = (frameType: number, subclass: number, payload: Buffer) =>
        server.send(
          encodeFullFrame({
            sourceCall: 200,
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

      if (frame.subclass === IAX_NEW) {
        reply(
          FRAME_TYPE_IAX,
          IAX_AUTHREQ,
          encodeInformationElements([
            { type: IE_TYPE_AUTHMETHODS, value: AUTH_METHOD_MD5 },
            { type: IE_TYPE_CHALLENGE, value: challenge },
          ]),
        );
      } else if (frame.subclass === IAX_AUTHREP) {
        const md5 = findInformationElement(decodeInformationElements(frame.payload), IE_TYPE_MD5_RESULT);
        verifiedDigest = typeof md5?.value === 'string' ? md5.value : '';
        reply(FRAME_TYPE_IAX, IAX_ACCEPT, encodeInformationElements([{ type: IE_TYPE_FORMAT, value: FORMAT_ULAW }]));
        reply(FRAME_TYPE_CONTROL, CONTROL_ANSWER, Buffer.alloc(0));
      }
    });
    await new Promise<void>((resolve) => server.bind(4573, resolve));

    const client = new IaxClient({ port: 4574 });
    clients = [client];

    const up = waitForState(client, (state) => state === 'up');
    await client.connect({ host: '127.0.0.1', port: 4573, username: 'kerchunk', secret });
    await up;

    expect(verifiedDigest).toBe(createHash('md5').update(challenge + secret).digest('hex'));

    await new Promise<void>((resolve) => server.close(resolve));
  });

  it('performs MD5 registration against a challenge/response registrar', async () => {
    const secret = 'sesame';
    const challenge = '349827';

    // Minimal IAX2 registrar: REGREQ -> REGAUTH(challenge); REGREQ+MD5 -> REGACK.
    const server = createSocket('udp4');
    let verifiedDigest = '';
    server.on('message', (data, rinfo) => {
      if (!isFullFrame(data)) {
        return;
      }
      const frame = decodeFullFrame(data);
      if (frame.frameType !== FRAME_TYPE_IAX || frame.subclass !== IAX_REGREQ) {
        return;
      }
      const ies = decodeInformationElements(frame.payload);
      const md5 = findInformationElement(ies, IE_TYPE_MD5_RESULT);
      const reply = (subclass: number, payload: Buffer) =>
        server.send(
          encodeFullFrame({
            sourceCall: 100,
            destCall: frame.sourceCall,
            retransmit: false,
            timestamp: 0,
            oseqno: 0,
            iseqno: 0,
            frameType: FRAME_TYPE_IAX,
            subclass,
            payload,
          }),
          rinfo.port,
          rinfo.address,
        );

      if (!md5) {
        reply(IAX_REGAUTH, encodeInformationElements([{ type: IE_TYPE_CHALLENGE, value: challenge }]));
      } else {
        verifiedDigest = typeof md5.value === 'string' ? md5.value : '';
        reply(IAX_REGACK, Buffer.alloc(0));
      }
    });
    await new Promise<void>((resolve) => server.bind(4571, resolve));

    const client = new IaxClient({ port: 4572 });
    clients = [client];

    const registered = waitForRegistered(client);
    await client.register({ host: '127.0.0.1', port: 4571, username: 'node1', secret });
    await registered;

    const expectedDigest = createHash('md5').update(challenge + secret).digest('hex');
    expect(verifiedDigest).toBe(expectedDigest);

    await new Promise<void>((resolve) => server.close(resolve));
  });
});
