import { describe, expect, it } from 'vitest';
import { IaxLeg, NEWKEY1STR } from './leg.js';
import { CallState } from './call.js';
import {
  CONTROL_ANSWER,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_IAX,
  FRAME_TYPE_TEXT,
  IAX_ACCEPT,
  IAX_ACK,
  IAX_CALLTOKEN,
  IAX_NEW,
  decodeFullFrame,
  encodeFullFrame,
  isFullFrame,
} from './frames.js';
import {
  IE_TYPE_CALLTOKEN,
  decodeInformationElements,
  encodeInformationElements,
  findInformationElement,
} from './ies.js';

/** Wire two legs together so each one's outgoing frames arrive at the other. */
function pipe(a: IaxLeg, b: IaxLeg): void {
  a.on('send', (frame) => b.handle(frame));
  b.on('send', (frame) => a.handle(frame));
}

describe('IaxLeg', () => {
  it('brings up an outbound call against an auto-answering peer leg', () => {
    const caller = new IaxLeg({ localCall: 1, username: 'node1', calledNumber: '2000' });
    const answerer = new IaxLeg({ localCall: 2 });
    pipe(caller, answerer);

    let callerUp = false;
    let answererUp = false;
    caller.on('up', () => (callerUp = true));
    answerer.on('up', () => (answererUp = true));

    caller.start();

    expect(callerUp).toBe(true);
    expect(answererUp).toBe(true);
    expect(caller.callState).toBe(CallState.Up);
    expect(caller.remoteCall).toBe(2);
    expect(answerer.remoteCall).toBe(1);
  });

  it('carries voice, DTMF and text once up', () => {
    const caller = new IaxLeg({ localCall: 1 });
    const answerer = new IaxLeg({ localCall: 2 });
    pipe(caller, answerer);

    const audio: number[] = [];
    let dtmf = '';
    let text = '';
    answerer.on('audio', (payload) => audio.push(...payload));
    answerer.on('dtmf', (digit) => (dtmf = digit));
    answerer.on('text', (value) => (text = value));

    caller.start();
    caller.sendAudio(Uint8Array.from([1, 2, 3, 4]));
    caller.sendDtmf('7');
    caller.sendText('KX');

    expect(audio).toEqual([1, 2, 3, 4]);
    expect(dtmf).toBe('7');
    expect(text).toBe('KX');
  });

  it('completes the IAX2 call-token handshake before the call comes up', () => {
    const caller = new IaxLeg({ localCall: 1, username: '43980', calledNumber: '66005' });
    const token = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const sent: Buffer[] = [];
    caller.on('send', (frame) => sent.push(frame));

    let up = false;
    caller.on('up', () => (up = true));

    // A peer that requires a call token: NEW → CALLTOKEN; NEW+token → ACCEPT+ANSWER.
    const reply = (subclass: number, payload: Buffer, frameType = FRAME_TYPE_IAX) =>
      caller.handle(
        encodeFullFrame({
          sourceCall: subclass === IAX_CALLTOKEN ? 0 : 7,
          destCall: 1,
          retransmit: false,
          timestamp: 0,
          oseqno: 0,
          iseqno: 0,
          frameType,
          subclass,
          payload,
        }),
      );

    caller.start();

    // First NEW must advertise call-token support with an empty token IE.
    const firstNew = decodeFullFrame(sent[0]);
    expect(firstNew.subclass).toBe(IAX_NEW);
    const firstToken = findInformationElement(decodeInformationElements(firstNew.payload), IE_TYPE_CALLTOKEN);
    expect(Buffer.isBuffer(firstToken?.value) && firstToken.value.length).toBe(0);

    // Peer issues the token; the leg must resend NEW carrying it verbatim.
    sent.length = 0;
    reply(IAX_CALLTOKEN, encodeInformationElements([{ type: IE_TYPE_CALLTOKEN, value: token }]));

    const resent = sent.map((f) => decodeFullFrame(f)).find((f) => f.subclass === IAX_NEW);
    expect(resent).toBeDefined();
    const echoed = findInformationElement(decodeInformationElements(resent!.payload), IE_TYPE_CALLTOKEN);
    expect(Buffer.isBuffer(echoed?.value) && Buffer.from(echoed!.value as Buffer).equals(token)).toBe(true);

    // Peer accepts and answers → the call comes up.
    reply(IAX_ACCEPT, Buffer.alloc(0));
    reply(CONTROL_ANSWER, Buffer.alloc(0), FRAME_TYPE_CONTROL);
    expect(up).toBe(true);
    expect(caller.callState).toBe(CallState.Up);
    // Silence an unused-import lint edge if isFullFrame is otherwise untouched.
    expect(isFullFrame(sent[0] ?? Buffer.alloc(12))).toBe(true);
  });

  it('sends the app_rpt !NEWKEY1! handshake once when the call comes up', () => {
    const leg = new IaxLeg({ localCall: 1, calledNumber: '66005' });
    const sent: Buffer[] = [];
    leg.on('send', (frame) => sent.push(frame));
    leg.start();

    const peerFrame = (frameType: number, subclass: number, oseqno: number) =>
      encodeFullFrame({
        sourceCall: 9,
        destCall: 1,
        retransmit: false,
        timestamp: 100,
        oseqno,
        iseqno: 1,
        frameType,
        subclass,
        payload: Buffer.alloc(0),
      });

    leg.handle(peerFrame(FRAME_TYPE_IAX, IAX_ACCEPT, 0));
    leg.handle(peerFrame(FRAME_TYPE_CONTROL, CONTROL_ANSWER, 1));

    const texts = sent
      .map((f) => decodeFullFrame(f))
      .filter((f) => f.frameType === FRAME_TYPE_TEXT)
      .map((f) => f.payload.toString('utf8'));
    expect(texts).toEqual([NEWKEY1STR]);

    // A retransmitted ANSWER must not trigger a second handshake.
    leg.handle(peerFrame(FRAME_TYPE_CONTROL, CONTROL_ANSWER, 1));
    const textCount = sent
      .map((f) => decodeFullFrame(f))
      .filter((f) => f.frameType === FRAME_TYPE_TEXT).length;
    expect(textCount).toBe(1);
  });

  it('ACKs echo the timestamp of the frame they acknowledge (RFC 5456)', () => {
    const leg = new IaxLeg({ localCall: 1 });
    const sent: Buffer[] = [];
    leg.on('send', (frame) => sent.push(frame));
    leg.start();

    sent.length = 0;
    leg.handle(
      encodeFullFrame({
        sourceCall: 9,
        destCall: 1,
        retransmit: false,
        timestamp: 7777,
        oseqno: 0,
        iseqno: 1,
        frameType: FRAME_TYPE_TEXT,
        subclass: 0,
        payload: Buffer.from('hello'),
      }),
    );

    const ack = sent.map((f) => decodeFullFrame(f)).find((f) => f.subclass === IAX_ACK);
    expect(ack?.timestamp).toBe(7777);
  });

  it('does not advance iseqno on ACK frames (RFC 5456 non-sequence messages)', () => {
    const leg = new IaxLeg({ localCall: 1, calledNumber: '2000' });
    const sent: Buffer[] = [];
    leg.on('send', (frame) => sent.push(frame));
    leg.start();

    const peerFrame = (subclass: number, oseqno: number) =>
      encodeFullFrame({
        sourceCall: 9,
        destCall: 1,
        retransmit: false,
        timestamp: 0,
        oseqno,
        iseqno: 1,
        frameType: FRAME_TYPE_IAX,
        subclass,
        payload: Buffer.alloc(0),
      });

    // ACCEPT consumes sequence slot 0 → we now expect the peer's oseq 1.
    leg.handle(peerFrame(IAX_ACCEPT, 0));
    // An ACK carries the peer's CURRENT counter but does not consume a slot; it
    // must not inflate our iseqno (that would over-acknowledge and get our next
    // reliable frame discarded + VNAKed by Asterisk).
    leg.handle(peerFrame(IAX_ACK, 7));

    sent.length = 0;
    leg.sendDtmf('1'); // next spontaneous reliable frame we send
    const dtmf = decodeFullFrame(sent[0]);
    expect(dtmf.iseqno).toBe(1); // still 1 (from ACCEPT), not 8 (from the ACK)
  });

  it('emits hangup when torn down', () => {
    const caller = new IaxLeg({ localCall: 1 });
    const answerer = new IaxLeg({ localCall: 2 });
    pipe(caller, answerer);

    let answererHung = false;
    answerer.on('hangup', () => (answererHung = true));

    caller.start();
    caller.hangup();

    expect(answererHung).toBe(true);
  });
});
