import * as THREE from 'three';

/**
 * VISUAL SIGNAL SYSTEM.
 *
 * Every stimulus change a module can make - flash, pulse, blink, colour change,
 * scale change, fade, disappearance - goes through here, for one reason: the
 * system reports back the frame time at which the change was actually applied,
 * and that timestamp is what stimulus onset means. A module that sets
 * `material.color` directly has no idea when the participant saw it.
 */

type Easing = (t: number) => number;

export const Ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outBack: (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};

interface Tween {
  obj: THREE.Object3D;
  startMs: number;
  durMs: number;
  ease: Easing;
  apply: (o: THREE.Object3D, k: number) => void;
  onDone?: () => void;
  loop?: boolean;
  id: number;
}

export type StimulusMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

export function materialOf(o: THREE.Object3D): StimulusMaterial | null {
  const m = (o as THREE.Mesh).material;
  if (!m) return null;
  return (Array.isArray(m) ? m[0] : m) as StimulusMaterial;
}

export class SignalSystem {
  private tweens: Tween[] = [];
  private nextId = 1;
  /** Frame time of the most recent applied change, for onset stamping. */
  lastAppliedAt = 0;

  update(nowMs: number): void {
    this.lastAppliedAt = nowMs;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]!;
      const raw = (nowMs - tw.startMs) / tw.durMs;
      const t = tw.loop ? raw % 1 : Math.min(1, Math.max(0, raw));
      tw.apply(tw.obj, tw.ease(t));
      if (!tw.loop && raw >= 1) {
        this.tweens.splice(i, 1);
        tw.onDone?.();
      }
    }
  }

  private push(tw: Omit<Tween, 'id'>): number {
    const id = this.nextId++;
    this.tweens.push({ ...tw, id });
    return id;
  }

  cancel(id: number): void {
    const i = this.tweens.findIndex((t) => t.id === id);
    if (i >= 0) this.tweens.splice(i, 1);
  }

  cancelFor(obj: THREE.Object3D): void {
    this.tweens = this.tweens.filter((t) => t.obj !== obj);
  }

  clear(): void {
    this.tweens.length = 0;
  }

  /* ------------------------------------------------------------ signals */

  /** Instant colour change. Returns the frame time it was applied at. */
  setColor(obj: THREE.Object3D, color: THREE.ColorRepresentation, nowMs: number): number {
    const m = materialOf(obj);
    if (m) {
      m.color.set(color);
      if ('emissive' in m) (m as THREE.MeshStandardMaterial).emissive.set(color);
    }
    return nowMs;
  }

  /** One-shot brightness spike that decays - the canonical "target appears". */
  flash(obj: THREE.Object3D, nowMs: number, durMs = 220, peak = 2.6): number {
    const m = materialOf(obj);
    if (!m || !('emissiveIntensity' in m)) return nowMs;
    const std = m as THREE.MeshStandardMaterial;
    const base = std.emissiveIntensity;
    this.push({
      obj, startMs: nowMs, durMs, ease: Ease.outQuad,
      apply: (_o, k) => { std.emissiveIntensity = peak + (base - peak) * k; },
      onDone: () => { std.emissiveIntensity = base; },
    });
    return nowMs;
  }

  /** Continuous sinusoidal pulse - the WATCH baseline state. */
  pulse(obj: THREE.Object3D, nowMs: number, periodMs = 1000, min = 0.25, max = 1.0): number {
    const m = materialOf(obj);
    if (!m) return nowMs;
    return this.push({
      obj, startMs: nowMs, durMs: periodMs, ease: Ease.linear, loop: true,
      apply: (_o, k) => {
        const v = min + (max - min) * (0.5 - 0.5 * Math.cos(k * Math.PI * 2));
        if ('emissiveIntensity' in m) (m as THREE.MeshStandardMaterial).emissiveIntensity = v * 1.6;
        m.opacity = Math.min(1, 0.35 + v * 0.65);
        m.transparent = true;
      },
    });
  }

  fadeTo(obj: THREE.Object3D, nowMs: number, opacity: number, durMs = 250, onDone?: () => void): number {
    const m = materialOf(obj);
    if (!m) return nowMs;
    m.transparent = true;
    const from = m.opacity;
    return this.push({
      obj, startMs: nowMs, durMs, ease: Ease.outQuad,
      apply: () => {}, onDone,
    }) && this.push({
      obj, startMs: nowMs, durMs, ease: Ease.outQuad,
      apply: (_o, k) => { m.opacity = from + (opacity - from) * k; },
      onDone,
    });
  }

  scaleTo(obj: THREE.Object3D, nowMs: number, to: number, durMs = 220, ease: Easing = Ease.outBack, onDone?: () => void): number {
    const from = obj.scale.x;
    return this.push({
      obj, startMs: nowMs, durMs, ease,
      apply: (o, k) => o.scale.setScalar(from + (to - from) * k),
      onDone,
    });
  }

  /** Pop-in used whenever a stimulus first becomes visible. */
  appear(obj: THREE.Object3D, nowMs: number, targetScale = 1, durMs = 160): number {
    obj.visible = true;
    obj.scale.setScalar(targetScale * 0.01);
    return this.scaleTo(obj, nowMs, targetScale, durMs, Ease.outBack);
  }

  disappear(obj: THREE.Object3D, nowMs: number, durMs = 140, onDone?: () => void): number {
    return this.scaleTo(obj, nowMs, 0.001, durMs, Ease.inQuad, () => {
      obj.visible = false;
      onDone?.();
    });
  }

  /** N discrete blinks; used for rare-event signalling. */
  blink(obj: THREE.Object3D, nowMs: number, count = 2, onMs = 90, offMs = 90): number {
    const total = count * (onMs + offMs);
    return this.push({
      obj, startMs: nowMs, durMs: total, ease: Ease.linear,
      apply: (o, k) => {
        const phase = (k * total) % (onMs + offMs);
        o.visible = phase < onMs;
      },
      onDone: () => { obj.visible = true; },
    });
  }
}
