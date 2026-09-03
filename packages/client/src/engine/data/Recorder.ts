import type { EventRecord, MetricRecord, MotionSample, ScoreRecord, TrialRecord } from '@vrcap/shared';
import type { Clock } from '../core/Clock.js';
import type { InputManager } from '../input/InputManager.js';

/**
 * EVENT-BASED LOGGING.
 *
 * The final score is the least interesting thing a run produces. What makes the
 * platform worth building is that every stimulus onset, every response, every
 * state transition and (optionally) the head and controller trajectory are kept,
 * so a metric nobody has thought of yet can still be computed from data
 * collected today.
 *
 * Motion logging is rate-limited per module: REACT wants 30 Hz because movement
 * initiation time is a real metric there, MEMORY wants 5 Hz because nothing in
 * it depends on where the hands are.
 */

export interface RecorderOptions {
  /** Samples per second for head/controller pose. 0 disables motion logging. */
  motionHz: number;
  /** Hard cap so a long WATCH run cannot grow without bound. */
  maxMotionSamples?: number;
  maxEvents?: number;
}

export class Recorder {
  private events: EventRecord[] = [];
  private motion: MotionSample[] = [];
  private trials: TrialRecord[] = [];
  private metrics: MetricRecord[] = [];
  private scores: ScoreRecord[] = [];

  private lastMotionAt = -Infinity;
  private motionIntervalMs: number;
  private opts: Required<RecorderOptions>;

  /** Current trial number, stamped onto events automatically. */
  trialNumber: number | null = null;

  constructor(private clock: Clock, private input: InputManager, opts: RecorderOptions) {
    this.opts = {
      motionHz: opts.motionHz,
      maxMotionSamples: opts.maxMotionSamples ?? 40000,
      maxEvents: opts.maxEvents ?? 20000,
    };
    this.motionIntervalMs = opts.motionHz > 0 ? 1000 / opts.motionHz : Infinity;
  }

  reset(): void {
    this.events = [];
    this.motion = [];
    this.trials = [];
    this.metrics = [];
    this.scores = [];
    this.trialNumber = null;
    this.lastMotionAt = -Infinity;
  }

  setMotionHz(hz: number): void {
    this.motionIntervalMs = hz > 0 ? 1000 / hz : Infinity;
  }

  /**
   * Log an event. `absoluteT` should be the performance.now() timestamp the
   * event really happened at (event.timeStamp for input, clock.frameTime for a
   * stimulus onset) - not the moment this function was called.
   */
  event(type: string, payload?: Record<string, unknown>, absoluteT?: number): void {
    if (this.events.length >= this.opts.maxEvents) return;
    this.events.push({
      t: round2(this.clock.runTime(absoluteT ?? performance.now())),
      trialNumber: this.trialNumber,
      type,
      ...(payload ? { payload } : {}),
    });
  }

  /** Called every frame; writes a pose sample when the interval has elapsed. */
  sampleMotion(): void {
    if (!Number.isFinite(this.motionIntervalMs)) return;
    if (this.motion.length >= this.opts.maxMotionSamples) return;
    const now = this.clock.frameTime;
    if (now - this.lastMotionAt < this.motionIntervalMs) return;
    this.lastMotionAt = now;
    const p = this.input.pose();
    this.motion.push({ t: round2(this.clock.frameRunTime()), head: p.head, left: p.left, right: p.right });
  }

  trial(rec: TrialRecord): void {
    this.trials.push(rec);
  }

  metric(name: string, value: number, unit = '', scope?: string): void {
    if (!Number.isFinite(value)) return;
    this.metrics.push({ name, value: round3(value), unit, ...(scope ? { scope } : {}) });
  }

  score(type: string, value: number, scoringVersion: string): void {
    this.scores.push({ type, value: round2(value), scoringVersion });
  }

  get data() {
    return {
      events: this.events,
      motion: this.motion,
      trials: this.trials,
      metrics: this.metrics,
      scores: this.scores,
    };
  }

  get counts() {
    return {
      events: this.events.length,
      motion: this.motion.length,
      trials: this.trials.length,
    };
  }

  /** Rough payload size, so the upload path can warn before it is a problem. */
  estimatedBytes(): number {
    return JSON.stringify(this.data).length;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
