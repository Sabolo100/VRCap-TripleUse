import * as THREE from 'three';

/**
 * AUDIO SYSTEM.
 *
 * Everything is synthesised at runtime: tones, beeps, noise bursts, alarms and
 * spatialised call signs. No audio files ship with the platform, which keeps it
 * asset-light and means an auditory stimulus is specified by numbers in the
 * module config rather than by a recording someone has to produce.
 *
 * Speech uses the Web Speech API when available (call signs in MULTI and
 * MEMORY); when it is not, the module falls back to its visual channel and the
 * run records that it did.
 */

export type ToneShape = OscillatorType;

export interface ToneSpec {
  freq: number;
  durationMs: number;
  shape?: ToneShape;
  gain?: number;
  /** Position for spatialised playback. Omit for head-locked stereo. */
  position?: THREE.Vector3;
  /** Linear frequency sweep target. */
  sweepTo?: number;
  attackMs?: number;
  releaseMs?: number;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private listener: AudioListener | null = null;
  private enabled = true;
  speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

  /** Must be called from a user gesture or the context stays suspended. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) { this.enabled = false; return; }
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.listener = this.ctx.listener;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Output latency in ms when the browser reports it - logged with each run. */
  get outputLatencyMs(): number | null {
    if (!this.ctx) return null;
    const l = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency;
    return typeof l === 'number' ? Math.round(l * 1000) : null;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Keep the audio listener on the camera so spatial cues follow the head. */
  syncListener(camera: THREE.Camera): void {
    const l = this.listener;
    if (!l || !this.ctx) return;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    camera.getWorldPosition(p);
    camera.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else {
      // Older Safari signature.
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /**
   * Play a tone. Returns the AudioContext time it was scheduled for, converted
   * to the performance.now() timebase, so auditory onsets are logged on the
   * same clock as visual ones.
   */
  tone(spec: ToneSpec): number {
    if (!this.enabled || !this.ctx || !this.master) return performance.now();
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = spec.durationMs / 1000;
    const attack = (spec.attackMs ?? 6) / 1000;
    const release = (spec.releaseMs ?? 40) / 1000;

    const osc = ctx.createOscillator();
    osc.type = spec.shape ?? 'sine';
    osc.frequency.setValueAtTime(spec.freq, now);
    if (spec.sweepTo) osc.frequency.linearRampToValueAtTime(spec.sweepTo, now + dur);

    const gain = ctx.createGain();
    const peak = spec.gain ?? 0.35;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.setValueAtTime(peak, now + Math.max(attack, dur - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + release);

    let tail: AudioNode = gain;
    if (spec.position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 30;
      panner.positionX?.setValueAtTime(spec.position.x, now);
      panner.positionY?.setValueAtTime(spec.position.y, now);
      panner.positionZ?.setValueAtTime(spec.position.z, now);
      gain.connect(panner);
      tail = panner;
    }
    osc.connect(gain);
    tail.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + release + 0.02);

    // AudioContext.currentTime and performance.now() share an origin offset we
    // can recover from getOutputTimestamp, when the browser provides it.
    return this.audioTimeToPerf(now);
  }

  /** Short filtered noise burst - used for error feedback and distractors. */
  noise(durationMs = 140, gain = 0.22, position?: THREE.Vector3): number {
    if (!this.enabled || !this.ctx || !this.master) return performance.now();
    const ctx = this.ctx;
    const frames = Math.ceil((durationMs / 1000) * ctx.sampleRate);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g);
    let tail: AudioNode = g;
    if (position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.positionX?.setValueAtTime(position.x, ctx.currentTime);
      panner.positionY?.setValueAtTime(position.y, ctx.currentTime);
      panner.positionZ?.setValueAtTime(position.z, ctx.currentTime);
      g.connect(panner);
      tail = panner;
    }
    tail.connect(this.master);
    src.start();
    return this.audioTimeToPerf(ctx.currentTime);
  }

  private audioTimeToPerf(audioTime: number): number {
    const ctx = this.ctx;
    if (!ctx) return performance.now();
    const ts = ctx.getOutputTimestamp?.();
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number') {
      return ts.performanceTime + (audioTime - ts.contextTime) * 1000;
    }
    return performance.now();
  }

  /* -------------------------------------------------------- shorthands */

  ok(): void { this.tone({ freq: 880, durationMs: 90, gain: 0.22, shape: 'sine' }); }
  error(): void { this.tone({ freq: 180, durationMs: 180, gain: 0.28, shape: 'square', sweepTo: 120 }); }
  click(): void { this.tone({ freq: 1400, durationMs: 28, gain: 0.15, shape: 'triangle' }); }
  warn(): void { this.tone({ freq: 620, durationMs: 240, gain: 0.26, shape: 'sawtooth', sweepTo: 520 }); }
  countdown(step: number): void {
    this.tone({ freq: step === 0 ? 1046 : 660, durationMs: step === 0 ? 220 : 110, gain: 0.24 });
  }

  /** Spoken instruction / call sign. Returns false when speech is unavailable. */
  speak(text: string, opts: { rate?: number; pitch?: number; lang?: string } = {}): boolean {
    if (!this.enabled || !this.speechAvailable) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate ?? 1.05;
      u.pitch = opts.pitch ?? 1;
      u.lang = opts.lang ?? 'hu-HU';
      speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  stopSpeech(): void {
    if (this.speechAvailable) speechSynthesis.cancel();
  }
}

export const audio = new AudioSystem();
