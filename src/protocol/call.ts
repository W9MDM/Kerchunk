/**
 * Call-control state machine for a single IAX2 call leg.
 *
 * The machine is deliberately small and pure: it validates transitions but does
 * no I/O. The {@link IaxClient} drives it from received frames and consults it
 * before sending audio.
 */

export enum CallState {
  Idle = 'idle',
  /** Outbound NEW sent, awaiting ACCEPT. */
  Calling = 'calling',
  /** Inbound NEW received, awaiting local accept. */
  Ringing = 'ringing',
  /** ACCEPT exchanged, media may flow, awaiting ANSWER. */
  Accepted = 'accepted',
  /** ANSWER received/sent — call is fully up. */
  Up = 'up',
  Hangup = 'hangup',
  Rejected = 'rejected',
}

const TRANSITIONS: Record<CallState, CallState[]> = {
  [CallState.Idle]: [CallState.Calling, CallState.Ringing],
  [CallState.Calling]: [CallState.Accepted, CallState.Up, CallState.Rejected, CallState.Hangup],
  [CallState.Ringing]: [CallState.Accepted, CallState.Rejected, CallState.Hangup],
  [CallState.Accepted]: [CallState.Up, CallState.Hangup, CallState.Rejected],
  [CallState.Up]: [CallState.Hangup],
  [CallState.Hangup]: [],
  [CallState.Rejected]: [],
};

export class InvalidCallTransitionError extends Error {
  constructor(
    readonly from: CallState,
    readonly to: CallState,
  ) {
    super(`Invalid call state transition: ${from} -> ${to}`);
    this.name = 'InvalidCallTransitionError';
  }
}

export class CallSession {
  private state: CallState = CallState.Idle;

  get currentState(): CallState {
    return this.state;
  }

  /** Media is permitted once the far end has accepted the call. */
  get canSendAudio(): boolean {
    return this.state === CallState.Accepted || this.state === CallState.Up;
  }

  get isTerminated(): boolean {
    return this.state === CallState.Hangup || this.state === CallState.Rejected;
  }

  private transition(to: CallState): void {
    if (!TRANSITIONS[this.state].includes(to)) {
      throw new InvalidCallTransitionError(this.state, to);
    }
    this.state = to;
  }

  /** Local originates an outbound call (NEW sent). */
  dial(): void {
    this.transition(CallState.Calling);
  }

  /** An inbound NEW arrived. */
  incoming(): void {
    this.transition(CallState.Ringing);
  }

  accept(): void {
    this.transition(CallState.Accepted);
  }

  answer(): void {
    this.transition(CallState.Up);
  }

  reject(): void {
    this.transition(CallState.Rejected);
  }

  hangup(): void {
    this.transition(CallState.Hangup);
  }
}
