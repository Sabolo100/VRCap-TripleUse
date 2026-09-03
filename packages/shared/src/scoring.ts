/**
 * Shared scoring primitives. Used on the client to render results immediately
 * and on the server to recompute / verify. Keeping them here means a score can
 * never mean two different things on the two sides of the wire.
 */

export const SCORING_VERSION = '1.0.0';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Robust variability: median absolute deviation scaled to sigma units. */
export function mad(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((q, r) => q - r);
  const idx = clamp((a.length - 1) * p, 0, a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo]!;
  return a[lo]! + (a[hi]! - a[lo]!) * (idx - lo);
}

/**
 * Map a raw value onto 0-100 where `good` scores 100 and `poor` scores 0.
 * Works in both directions (good may be lower than poor, e.g. reaction time).
 */
export function normalise(value: number, good: number, poor: number): number {
  if (!Number.isFinite(value)) return 0;
  const t = (value - poor) / (good - poor);
  return clamp(t * 100, 0, 100);
}

/**
 * Soft normalisation with a logistic shoulder - avoids everyone piling up at
 * 0 or 100 on the tails, which makes early demo data look broken.
 */
export function normaliseSoft(value: number, good: number, poor: number): number {
  if (!Number.isFinite(value)) return 0;
  const t = (value - poor) / (good - poor); // 0 at poor, 1 at good
  const z = (t - 0.5) * 5.5;
  return clamp(100 / (1 + Math.exp(-z)), 0, 100);
}

export interface OpsComponent {
  key: string;
  /** 0-100 */
  value: number;
  /** relative weight, does not need to sum to 1 */
  weight: number;
}

/**
 * The 0-1000 headline score. Its name is domain dependent
 * (OPS SCORE / READINESS SCORE / PERFORMANCE INDEX) but the maths is identical,
 * so runs stay comparable across domains for research purposes.
 */
export function opsScore(components: OpsComponent[]): number {
  const totalW = components.reduce((a, c) => a + c.weight, 0);
  if (totalW <= 0) return 0;
  const weighted = components.reduce((a, c) => a + clamp(c.value, 0, 100) * c.weight, 0) / totalW;
  return Math.round(clamp(weighted, 0, 100) * 10);
}

/** Linear regression slope of y over x - used for vigilance decrement, learning rate, drift. */
export function slope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    num += dx * (ys[i]! - my);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

/* ------------------------------------------------------------------ *
 * Signal detection theory
 * ------------------------------------------------------------------ */

/** Inverse standard normal CDF (Acklam's rational approximation, |err| < 1.15e-9). */
export function probit(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number;
  let r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export interface SdtResult {
  hitRate: number;
  faRate: number;
  /** Sensitivity: how far apart the signal and noise distributions are. */
  dPrime: number;
  /** Response bias. Positive = conservative (reluctant to say "yes"). */
  criterion: number;
  /** True when the log-linear correction had to move a rate off 0 or 1. */
  corrected: boolean;
}

/**
 * Signal detection theory summary.
 *
 * Hit and false-alarm rates of exactly 0 or 1 send the z-transform to infinity,
 * which is common with the trial counts a 9-minute assessment can afford. The
 * log-linear correction (add 0.5 to every cell, 1 to every total) is applied
 * unconditionally rather than only at the extremes: applying it selectively
 * biases the comparison between participants who hit the ceiling and those who
 * did not. Whether it changed anything is reported alongside.
 */
export function sdt(hits: number, misses: number, falseAlarms: number, correctRejections: number): SdtResult {
  const signal = hits + misses;
  const noise = falseAlarms + correctRejections;
  const rawHit = signal > 0 ? hits / signal : NaN;
  const rawFa = noise > 0 ? falseAlarms / noise : NaN;
  const hitRate = (hits + 0.5) / (signal + 1);
  const faRate = (falseAlarms + 0.5) / (noise + 1);
  const zh = probit(hitRate);
  const zf = probit(faRate);
  return {
    hitRate: Number.isFinite(rawHit) ? rawHit : hitRate,
    faRate: Number.isFinite(rawFa) ? rawFa : faRate,
    dPrime: zh - zf,
    criterion: -0.5 * (zh + zf),
    corrected: rawHit === 0 || rawHit === 1 || rawFa === 0 || rawFa === 1 || !Number.isFinite(rawHit) || !Number.isFinite(rawFa),
  };
}

/**
 * Pashler-Cowan capacity estimate for a change-detection or tracking task.
 * k = N * (hit rate - false alarm rate) / (1 - false alarm rate)
 *
 * Interpreted as "how many items the participant appears to have held", it is
 * only meaningful when the response set size N is fixed and known.
 */
export function capacityK(n: number, hitRate: number, faRate: number): number {
  if (faRate >= 1) return 0;
  return clamp((n * (hitRate - faRate)) / (1 - faRate), 0, n);
}

/** Shannon entropy of a distribution, normalised to 0..1 against log(bins). */
export function normalisedEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0 || counts.length < 2) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log(p);
  }
  return clamp(h / Math.log(counts.length), 0, 1);
}

/** Circular mean of angles in degrees, returned in [-180, 180). */
export function circularMeanDeg(anglesDeg: number[]): number {
  if (anglesDeg.length === 0) return NaN;
  let sx = 0;
  let sy = 0;
  for (const a of anglesDeg) {
    const r = (a * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const m = (Math.atan2(sy, sx) * 180) / Math.PI;
  return m >= 180 ? m - 360 : m;
}

/** Smallest signed difference between two headings, in [-180, 180). */
export function angleDiffDeg(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  if (d === 180) d = -180;
  return d;
}
