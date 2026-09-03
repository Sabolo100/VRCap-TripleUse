import type { Clock } from '../core/Clock.js';

/**
 * STANDARD TRIAL STATE MACHINE.
 *
 *   PREPARE -> COUNTDOWN -> STIMULUS -> RESPONSE_WINDOW -> RESPONSE
 *           -> FEEDBACK (optional) -> INTER_TRIAL -> next
 *
 * Every module drives its trials through this, which is what makes timing
 * comparable across modules. The machine is advanced from the render loop, so a
 * phase boundary always lands on a frame - the same frame the participant could
 * first have seen the change.
 */

export type TrialPhase =
  | 'idle'
  | 'prepare'
  | 'countdown'
  | 'stimulus'
  | 'response_window'
  | 'response'
  | 'feedback'
  | 'inter_trial'
  | 'done';

export interface TrialHooks {
  /** Called once when a phase begins. `t` is the frame time of the transition. */
  onEnter?: (phase: TrialPhase, trial: number, t: number) => void;
  onExit?: (phase: TrialPhase, trial: number, t: number) => void;
  /** Called every frame while in a phase. */
  onUpdate?: (phase: TrialPhase, trial: number, elapsedMs: number, dt: number) => void;
  /** Return the duration in ms for a phase, or null for "wait for a signal". */
  duration: (phase: TrialPhase, trial: number) => number | null;
  /** Total number of trials. */
  trialCount: number;
  onTrialStart?: (trial: number, t: number) => void;
  onTrialEnd?: (trial: number, t: number) => void;
  onComplete?: (t: number) => void;
}

const SEQUENCE: TrialPhase[] = [
  'prepare',
  'countdown',
  'stimulus',
  'response_window',
  'response',
  'feedback',
  'inter_trial',
];

export class TrialMachine {
  phase: TrialPhase = 'idle';
  trial = 0;
  /** Frame time the current phase started at. */
  phaseStart = 0;
  private hooks: TrialHooks;
  private clock: Clock;
  private paused = false;
  private waiting = false;

  constructor(clock: Clock, hooks: TrialHooks) {
    this.clock = clock;
    this.hooks = hooks;
  }

  start(): void {
    this.trial = 0;
    this.phase = 'idle';
    this.enter('prepare');
    this.hooks.onTrialStart?.(this.trial, this.clock.frameTime);
  }

  get elapsed(): number {
    return this.clock.frameTime - this.phaseStart;
  }

  pause(): void { this.paused = true; }
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Do not credit paused time to the current phase.
    this.phaseStart = this.clock.frameTime;
  }

  /** Jump straight to a phase - used when a response arrives early. */
  goto(phase: TrialPhase): void {
    this.enter(phase);
  }

  /** Signal that an open-ended phase (duration === null) may end now. */
  release(): void {
    if (this.waiting) this.advance();
  }

  update(dt: number): void {
    if (this.paused || this.phase === 'idle' || this.phase === 'done') return;
    const elapsed = this.elapsed;
    this.hooks.onUpdate?.(this.phase, this.trial, elapsed, dt);
    const dur = this.hooks.duration(this.phase, this.trial);
    this.waiting = dur === null;
    if (dur !== null && elapsed >= dur) this.advance();
  }

  private advance(): void {
    const idx = SEQUENCE.indexOf(this.phase);
    if (idx < 0) return;
    if (idx === SEQUENCE.length - 1) {
      // End of trial.
      const t = this.clock.frameTime;
      this.exit(t);
      this.hooks.onTrialEnd?.(this.trial, t);
      this.trial++;
      if (this.trial >= this.hooks.trialCount) {
        this.phase = 'done';
        this.hooks.onComplete?.(t);
        return;
      }
      this.enter('prepare');
      this.hooks.onTrialStart?.(this.trial, t);
      return;
    }
    this.enter(SEQUENCE[idx + 1]!);
  }

  private enter(phase: TrialPhase): void {
    const t = this.clock.frameTime;
    if (this.phase !== 'idle') this.exit(t);
    this.phase = phase;
    this.phaseStart = t;
    this.waiting = false;
    this.hooks.onEnter?.(phase, this.trial, t);
  }

  private exit(t: number): void {
    this.hooks.onExit?.(this.phase, this.trial, t);
  }

  abort(): void {
    this.phase = 'done';
  }
}
