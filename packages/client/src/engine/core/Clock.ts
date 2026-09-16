/**
 * Timing.
 *
 * Reaction-time work lives or dies on being honest about *which* clock a
 * number came from, so this class keeps three separate notions of "now":
 *
 *  - `now()`         performance.now(), the highest resolution clock we have.
 *                    Used for input events, which arrive with their own
 *                    event.timeStamp on the same time origin.
 *  - `frameTime`     the timestamp handed to the animation loop. Inside an XR
 *                    session this is the *predicted display time* of the frame,
 *                    i.e. roughly when photons reach the eye. Stimulus onsets
 *                    are stamped with this, never with performance.now().
 *  - `runTime()`     milliseconds since the run started, what gets logged.
 *
 * The residual end-to-end latency (compositor, panel, controller polling) is
 * NOT removed. It is a constant per hardware class, which is why every run
 * records its device profile and why the leaderboard refuses to mix classes.
 */
export class Clock {
  /** performance.now() at run start. */
  private origin = performance.now();
  /** Loop timestamp of the frame currently being built. */
  frameTime = performance.now();
  /** Milliseconds between the last two frames. */
  frameDelta = 16.7;
  /** Rolling estimate of the presentation interval - the quantisation floor
   *  on any polled (rather than event-driven) response. */
  frameInterval = 16.7;
  private frameCount = 0;

  /* Frame-time samples since the last `takeFrameStats()`. A ring of raw
   * deltas rather than a running mean: a headset that renders 90 fps with a
   * hitch every second reads as smooth on average and is nauseating in
   * practice, and only the distribution shows that. */
  private samples = new Float32Array(4096);
  private sampleCount = 0;
  private sampleTotal = 0;

  reset(): void {
    this.origin = performance.now();
    this.frameCount = 0;
    this.sampleCount = 0;
    this.sampleTotal = 0;
  }

  beginFrame(t: number): void {
    const prev = this.frameTime;
    this.frameTime = t;
    const raw = t - prev;
    this.frameDelta = Math.min(100, Math.max(0.5, raw));
    // Robust-ish running mean, ignoring hitches.
    if (this.frameDelta < 40) {
      this.frameInterval += (this.frameDelta - this.frameInterval) * 0.05;
    }
    this.frameCount++;
    if (raw > 0 && raw < 1000) {
      this.samples[this.sampleTotal % this.samples.length] = raw;
      this.sampleTotal++;
      this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length);
    }
  }

  /**
   * Distribution of the frame intervals collected since the previous call:
   * median and 95th percentile in ms, the estimated fps, and how many frames
   * overran 1.5x the presentation interval (what the participant feels as a
   * stutter). Resets the window. Null when nothing was collected.
   */
  takeFrameStats(): { frames: number; medianMs: number; p95Ms: number; maxMs: number; fps: number; longFrames: number } | null {
    const n = this.sampleCount;
    if (n < 8) { this.sampleCount = 0; this.sampleTotal = 0; return null; }
    const arr = Array.from(this.samples.subarray(0, n)).sort((a, b) => a - b);
    const q = (f: number) => arr[Math.min(n - 1, Math.floor(f * n))]!;
    const median = q(0.5);
    const long = arr.filter((d) => d > this.frameInterval * 1.5).length;
    this.sampleCount = 0;
    this.sampleTotal = 0;
    return {
      frames: n,
      medianMs: +median.toFixed(2),
      p95Ms: +q(0.95).toFixed(2),
      maxMs: +arr[n - 1]!.toFixed(1),
      fps: +(1000 / median).toFixed(1),
      longFrames: long,
    };
  }

  now(): number {
    return performance.now();
  }

  /** ms since run start, from an absolute performance.now()-based timestamp. */
  runTime(absolute = performance.now()): number {
    return absolute - this.origin;
  }

  /** ms since run start for the frame being built. */
  frameRunTime(): number {
    return this.frameTime - this.origin;
  }

  get frames(): number {
    return this.frameCount;
  }

  /** Estimated refresh rate, Hz. */
  get refreshRate(): number {
    return Math.round(1000 / this.frameInterval);
  }
}
