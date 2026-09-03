/**
 * PSYCHOPHYSICAL AND BIOMECHANICAL ESTIMATORS.
 *
 * These are the load-bearing computations of FIELD, STEADY, RHYTHM and ADAPT:
 * an adaptive threshold, a postural sway ellipse, a tremor spectrum and a
 * learning-rate fit. They live in shared rather than in the modules because
 * every one of them can be checked against a synthetic signal with a known
 * answer, and a module that computes its own threshold inline cannot be.
 */

import { mean, clamp } from './scoring.js';

/* ===================================================== adaptive staircase */

export interface StaircaseOptions {
  /** Starting value of the varied parameter. */
  start: number;
  /** Correct answers needed before the task gets harder. 3 targets ~79%. */
  down: number;
  /** Multiplicative step while coarse, e.g. 0.75 shortens by a quarter. */
  coarseFactor: number;
  /** Step after `coarseAfter` reversals, closer to 1 for a finer estimate. */
  fineFactor: number;
  coarseAfter: number;
  min: number;
  max: number;
  /** true when a LOWER value is harder (duration); false when higher is harder (speed). */
  lowerIsHarder: boolean;
}

export interface Reversal {
  value: number;
  index: number;
  /** Trial number at which the reversal happened. */
  trial: number;
}

/**
 * Transformed up-down staircase. `down`-correct-in-a-row makes the task
 * harder, one error makes it easier, and the threshold is read from the
 * reversals rather than from the final value - a single lucky trial at the end
 * should not decide the estimate.
 */
export class Staircase {
  value: number;
  readonly reversals: Reversal[] = [];
  private streak = 0;
  private lastDirection: 'harder' | 'easier' | null = null;
  private trial = 0;

  constructor(private readonly o: StaircaseOptions) {
    this.value = o.start;
  }

  /** Feed one trial. Returns the value to use for the NEXT trial. */
  record(correct: boolean): number {
    this.trial++;
    let direction: 'harder' | 'easier' | null = null;

    if (correct) {
      this.streak++;
      if (this.streak >= this.o.down) {
        this.streak = 0;
        direction = 'harder';
      }
    } else {
      this.streak = 0;
      direction = 'easier';
    }

    if (direction) {
      if (this.lastDirection && direction !== this.lastDirection) {
        this.reversals.push({ value: this.value, index: this.reversals.length, trial: this.trial });
      }
      this.lastDirection = direction;
      const harder = direction === 'harder';
      const factor = this.reversals.length >= this.o.coarseAfter ? this.o.fineFactor : this.o.coarseFactor;
      // A factor below 1 always shrinks; whether shrinking is "harder" depends
      // on the parameter, so the direction is applied explicitly.
      const shrink = harder === this.o.lowerIsHarder;
      this.value = clamp(shrink ? this.value * factor : this.value / factor, this.o.min, this.o.max);
    }
    return this.value;
  }

  /** Geometric mean of the last `n` reversals. NaN with fewer than 2. */
  threshold(n = 8): number {
    if (this.reversals.length < 2) return NaN;
    const take = this.reversals.slice(-n).map((r) => r.value).filter((v) => v > 0);
    if (take.length < 2) return NaN;
    return Math.exp(mean(take.map(Math.log)));
  }
}

/**
 * The point where a falling accuracy curve crosses `level`, by linear
 * interpolation between the two bracketing samples.
 *
 * Used for the useful-field radius: the eccentricity at which peripheral
 * localisation drops to chance-corrected 50%. Returns the last x when the
 * curve never crosses, with `bounded: false` so the caller can report ">= x"
 * rather than a false precision.
 */
export function crossingPoint(
  points: { x: number; y: number }[],
  level: number
): { x: number; bounded: boolean } {
  const pts = [...points].filter((p) => Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  if (pts.length === 0) return { x: NaN, bounded: false };
  if (pts.length === 1) return { x: pts[0]!.x, bounded: false };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if ((a.y >= level && b.y < level) || (a.y <= level && b.y > level)) {
      const t = (level - a.y) / (b.y - a.y);
      return { x: a.x + t * (b.x - a.x), bounded: true };
    }
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  // Never crossed: report the end of the tested range it stayed on.
  return { x: last.y >= level ? last.x : first.x, bounded: false };
}

/* ======================================================== posturography */

export interface SwayResult {
  /** Total length of the horizontal centre-of-pressure path, millimetres. */
  pathLengthMm: number;
  /** Area of the 95% confidence ellipse, square millimetres. */
  area95Mm2: number;
  /** Standard deviation along each axis, millimetres. */
  sdMlMm: number;
  sdApMm: number;
  /** Mean speed of the path, mm/s. */
  meanVelocityMmS: number;
  samples: number;
}

/**
 * Standard posturography summary from a horizontal position trace.
 *
 * `ml` is medio-lateral (side to side), `ap` is antero-posterior (front to
 * back). Inputs are metres, outputs millimetres, because every published sway
 * norm is in millimetres.
 *
 * The 95% ellipse uses the principal axes of the covariance matrix scaled by
 * the F-distribution factor conventionally approximated as 5.991 (chi-square,
 * 2 df) - the same constant used by force-plate software, so the number is
 * comparable in magnitude to the posturography literature even though the
 * sensor is a headset rather than a plate.
 */
export function swayMetrics(ml: number[], ap: number[], durationS: number): SwayResult {
  const n = Math.min(ml.length, ap.length);
  const empty: SwayResult = {
    pathLengthMm: NaN, area95Mm2: NaN, sdMlMm: NaN, sdApMm: NaN,
    meanVelocityMmS: NaN, samples: n,
  };
  if (n < 8) return empty;

  const x = ml.slice(0, n).map((v) => v * 1000);
  const y = ap.slice(0, n).map((v) => v * 1000);
  const mx = mean(x);
  const my = mean(y);

  let path = 0;
  for (let i = 1; i < n; i++) path += Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);

  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
  }
  const d = n - 1;
  cxx /= d; cyy /= d; cxy /= d;

  // Eigenvalues of the 2x2 covariance matrix.
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = Math.max(0, tr / 2 - Math.sqrt(disc));

  return {
    pathLengthMm: path,
    area95Mm2: Math.PI * 5.991 * Math.sqrt(l1 * l2),
    sdMlMm: Math.sqrt(cxx),
    sdApMm: Math.sqrt(cyy),
    meanVelocityMmS: durationS > 0 ? path / durationS : NaN,
    samples: n,
  };
}

/**
 * Power of one frequency in a uniformly sampled signal (Goertzel).
 *
 * A full FFT would need power-of-two padding and a windowing decision; for
 * tremor we only need the power at a handful of candidate frequencies, and
 * Goertzel gives exactly that with no framework.
 */
export function goertzelPower(samples: number[], sampleHz: number, freqHz: number): number {
  const n = samples.length;
  if (n < 4 || sampleHz <= 0 || freqHz <= 0 || freqHz >= sampleHz / 2) return NaN;
  const k = (2 * Math.PI * freqHz) / sampleHz;
  const coeff = 2 * Math.cos(k);
  let s0 = 0, s1 = 0, s2 = 0;
  const m = mean(samples);
  for (let i = 0; i < n; i++) {
    s0 = samples[i]! - m + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / n;
}

/**
 * Amplitude of one frequency component, in the signal's own units.
 *
 * A power ratio between a driven frequency and its neighbours is unbounded -
 * a clean sinusoid divided by near-zero noise runs to thousands, which is
 * useless to display and unstable to score. The amplitude is bounded by
 * physics and can be read directly: "you swayed four millimetres at the
 * room's rhythm".
 */
export function goertzelAmplitude(samples: number[], sampleHz: number, freqHz: number): number {
  const p = goertzelPower(samples, sampleHz, freqHz);
  if (!Number.isFinite(p) || p < 0) return NaN;
  // power as normalised here is A^2 * n / 4 for a sinusoid of amplitude A.
  return 2 * Math.sqrt(p / samples.length);
}

/**
 * How much of the power in a set of frequencies sits at the first one.
 *
 * Bounded 0-1, which the raw ratio is not. Used as the evidence that a
 * response is specific to a driving frequency rather than a general increase
 * in movement.
 */
export function bandConcentration(
  samples: number[], sampleHz: number, targetHz: number, neighbourHz: number[]
): number {
  const at = goertzelPower(samples, sampleHz, targetHz);
  if (!Number.isFinite(at)) return NaN;
  const others = neighbourHz.map((f) => goertzelPower(samples, sampleHz, f)).filter(Number.isFinite);
  const total = at + others.reduce((a, b) => a + b, 0);
  return total > 0 ? clamp(at / total, 0, 1) : NaN;
}

/**
 * Dominant frequency of a signal within a band, scanned at `stepHz`.
 * Physiological hand tremor sits at 8-12 Hz and pathological rest tremor at
 * 4-6 Hz, so the band and the resolution both matter for the answer to mean
 * anything.
 */
export function dominantFrequency(
  samples: number[], sampleHz: number, loHz: number, hiHz: number, stepHz = 0.25
): { freqHz: number; power: number } {
  let best = { freqHz: NaN, power: -Infinity };
  const top = Math.min(hiHz, sampleHz / 2 - stepHz);
  for (let f = loHz; f <= top; f += stepHz) {
    const p = goertzelPower(samples, sampleHz, f);
    if (Number.isFinite(p) && p > best.power) best = { freqHz: f, power: p };
  }
  return best.power === -Infinity ? { freqHz: NaN, power: NaN } : best;
}

/* ==================================================== learning-rate fit */

export interface LearningFit {
  /** Trials to reach 63% of the total change - the exponential time constant. */
  rateTrials: number;
  /** Where the curve settles. */
  asymptote: number;
  /** Where it started. */
  start: number;
  /** Proportion of variance explained, 0-1. */
  r2: number;
}

/**
 * Fit `y = asymptote + (start - asymptote) * exp(-trial / tau)` by scanning
 * tau and solving the remaining two parameters in closed form.
 *
 * Scanning beats a gradient method here: tau is a single bounded parameter,
 * the error surface has one minimum over the plausible range, and a scan
 * cannot diverge on a participant who never adapted at all - it just returns
 * the largest tau with a poor r2, which is the honest answer.
 */
export function fitLearningCurve(values: number[], maxTau = 120): LearningFit {
  const ys = values.filter((v) => Number.isFinite(v));
  const bad: LearningFit = { rateTrials: NaN, asymptote: NaN, start: NaN, r2: NaN };
  if (ys.length < 8) return bad;

  const n = ys.length;
  const my = mean(ys);
  let ssTot = 0;
  for (const y of ys) ssTot += (y - my) * (y - my);
  // A flat series has no variance to explain, so "explained variance" is
  // undefined rather than perfect. Returning 1 here would tell a caller that a
  // participant who never changed was fitted beautifully.
  if (ssTot === 0) return { rateTrials: NaN, asymptote: my, start: my, r2: NaN };

  let best: LearningFit = bad;
  let bestSse = Infinity;

  for (let tau = 1; tau <= maxTau; tau += 0.5) {
    // With e = exp(-i/tau), y = a + b*e is linear in (a, b).
    let se = 0, see = 0, sy = 0, sey = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-i / tau);
      se += e; see += e * e; sy += ys[i]!; sey += e * ys[i]!;
    }
    const den = n * see - se * se;
    if (Math.abs(den) < 1e-12) continue;
    const b = (n * sey - se * sy) / den;
    const a = (sy - b * se) / n;

    let sse = 0;
    for (let i = 0; i < n; i++) {
      const pred = a + b * Math.exp(-i / tau);
      sse += (ys[i]! - pred) * (ys[i]! - pred);
    }
    if (sse < bestSse) {
      bestSse = sse;
      best = { rateTrials: tau, asymptote: a, start: a + b, r2: 1 - sse / ssTot };
    }
  }
  return best;
}

/* ========================================================= timing series */

export interface TappingResult {
  /** Mean signed asynchrony; negative means the tap led the beat. */
  meanAsyncMs: number;
  /** Standard deviation of the asynchronies - the precision measure. */
  sdAsyncMs: number;
  /** Slope of inter-response interval against beat number, ms per beat. */
  driftMsPerBeat: number;
  /** Standard deviation of the inter-response intervals. */
  sdIntervalMs: number;
  n: number;
}

/**
 * Summarise a tapping sequence.
 *
 * `asynchronies` are tap minus beat in ms (empty for a continuation phase,
 * where there is no beat to compare against); `intervals` are the inter-tap
 * intervals. Drift is the regression slope of interval on ordinal position,
 * which is what distinguishes a stable internal tempo from one that
 * accelerates once the metronome stops.
 */
export function tappingMetrics(asynchronies: number[], intervals: number[]): TappingResult {
  const a = asynchronies.filter(Number.isFinite);
  const iv = intervals.filter(Number.isFinite);
  const out: TappingResult = {
    meanAsyncMs: a.length ? mean(a) : NaN,
    sdAsyncMs: NaN, driftMsPerBeat: NaN, sdIntervalMs: NaN, n: iv.length,
  };
  if (a.length > 1) {
    const m = mean(a);
    out.sdAsyncMs = Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  }
  if (iv.length > 1) {
    const m = mean(iv);
    out.sdIntervalMs = Math.sqrt(iv.reduce((s, v) => s + (v - m) * (v - m), 0) / (iv.length - 1));
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < iv.length; i++) { sx += i; sy += iv[i]!; sxy += i * iv[i]!; sxx += i * i; }
    const den = iv.length * sxx - sx * sx;
    if (Math.abs(den) > 1e-12) out.driftMsPerBeat = (iv.length * sxy - sx * sy) / den;
  }
  return out;
}
