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

  reset(): void {
    this.origin = performance.now();
    this.frameCount = 0;
  }

  beginFrame(t: number): void {
    const prev = this.frameTime;
    this.frameTime = t;
    this.frameDelta = Math.min(100, Math.max(0.5, t - prev));
    // Robust-ish running mean, ignoring hitches.
    if (this.frameDelta < 40) {
      this.frameInterval += (this.frameDelta - this.frameInterval) * 0.05;
    }
    this.frameCount++;
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
