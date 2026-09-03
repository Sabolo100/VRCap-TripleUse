/**
 * Seeded PRNG. Every run stores its seed, so a stimulus sequence can be
 * replayed exactly - for debugging, for equivalent test forms, and so two
 * subjects can be given the identical sequence when that is wanted.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }

  /** mulberry32 - small, fast, good enough for stimulus scheduling. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  /** Exponential-ish inter-stimulus interval, clamped - the PVT standard shape. */
  isi(min: number, max: number): number {
    const u = this.next();
    const v = -Math.log(1 - u * 0.95) / 2.2;
    return min + Math.min(1, v) * (max - min);
  }
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
