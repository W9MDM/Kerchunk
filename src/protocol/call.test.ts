import { describe, expect, it } from 'vitest';
import { CallSession, CallState, InvalidCallTransitionError } from './call.js';

describe('CallSession state machine', () => {
  it('drives an outbound call from dial to up', () => {
    const session = new CallSession();
    expect(session.currentState).toBe(CallState.Idle);
    expect(session.canSendAudio).toBe(false);

    session.dial();
    expect(session.currentState).toBe(CallState.Calling);

    session.accept();
    expect(session.currentState).toBe(CallState.Accepted);
    expect(session.canSendAudio).toBe(true);

    session.answer();
    expect(session.currentState).toBe(CallState.Up);
    expect(session.canSendAudio).toBe(true);

    session.hangup();
    expect(session.currentState).toBe(CallState.Hangup);
    expect(session.isTerminated).toBe(true);
    expect(session.canSendAudio).toBe(false);
  });

  it('drives an inbound call from ringing to accepted', () => {
    const session = new CallSession();
    session.incoming();
    expect(session.currentState).toBe(CallState.Ringing);
    session.accept();
    expect(session.currentState).toBe(CallState.Accepted);
  });

  it('rejects impossible transitions', () => {
    const session = new CallSession();
    // Cannot answer a call that was never dialed.
    expect(() => session.answer()).toThrow(InvalidCallTransitionError);

    session.dial();
    session.hangup();
    // Cannot resurrect a terminated call.
    expect(() => session.accept()).toThrow(InvalidCallTransitionError);
  });
});
