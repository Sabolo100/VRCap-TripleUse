import * as THREE from 'three';

/**
 * MOTION SYSTEM.
 *
 * Standard, parameterised movements shared by every module: linear, circular,
 * orbit, waypoint, oscillation, approach/retreat and bounded random walk. The
 * tracking blocks in REACT and the moving targets in SIGNAL and ANTICIPATE use
 * the same code path, so "target speed" means the same thing everywhere.
 */

export type MotionKind =
  | 'linear'
  | 'circular'
  | 'orbit'
  | 'waypoint'
  | 'oscillate'
  | 'lissajous'
  | 'approach'
  | 'randomwalk';

export interface MotionSpec {
  kind: MotionKind;
  /** metres / second, or radians / second for circular and orbit. */
  speed: number;
  direction?: THREE.Vector3;
  centre?: THREE.Vector3;
  radius?: number;
  /** Lissajous frequency ratio and phase - produces a smooth but hard to
   *  predict path, which is what a pursuit-tracking task needs. */
  freq?: [number, number];
  phase?: number;
  amplitude?: THREE.Vector3;
  waypoints?: THREE.Vector3[];
  /** Random walk: how sharply direction may change per second. */
  jitter?: number;
  /** Bounding sphere radius around `centre` for random walk. */
  bounds?: number;
  loop?: boolean;
  onArrive?: () => void;
}

interface Mover {
  obj: THREE.Object3D;
  spec: MotionSpec;
  t: number;
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  wpIndex: number;
  done: boolean;
}

export class MotionSystem {
  private movers = new Map<THREE.Object3D, Mover>();

  attach(obj: THREE.Object3D, spec: MotionSpec): void {
    this.movers.set(obj, {
      obj,
      spec,
      t: 0,
      origin: obj.position.clone(),
      velocity: (spec.direction?.clone() ?? new THREE.Vector3(1, 0, 0)).normalize().multiplyScalar(spec.speed),
      wpIndex: 0,
      done: false,
    });
  }

  detach(obj: THREE.Object3D): void {
    this.movers.delete(obj);
  }

  clear(): void {
    this.movers.clear();
  }

  /** Instantaneous velocity, useful for lead/lag analysis in tracking tasks. */
  velocityOf(obj: THREE.Object3D): THREE.Vector3 | null {
    return this.movers.get(obj)?.velocity.clone() ?? null;
  }

  update(dt: number): void {
    for (const m of this.movers.values()) {
      if (m.done) continue;
      m.t += dt;
      const s = m.spec;
      const p = m.obj.position;
      const before = p.clone();

      switch (s.kind) {
        case 'linear':
          p.addScaledVector(m.velocity, dt);
          break;

        case 'circular': {
          const c = s.centre ?? m.origin;
          const r = s.radius ?? 1;
          const a = m.t * s.speed + (s.phase ?? 0);
          p.set(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
          break;
        }

        case 'orbit': {
          const c = s.centre ?? m.origin;
          const r = s.radius ?? 1;
          const a = m.t * s.speed + (s.phase ?? 0);
          const tilt = Math.sin(m.t * s.speed * 0.37) * 0.35;
          p.set(c.x + Math.cos(a) * r, c.y + Math.sin(tilt) * r * 0.4, c.z + Math.sin(a) * r);
          break;
        }

        case 'lissajous': {
          const c = s.centre ?? m.origin;
          const amp = s.amplitude ?? new THREE.Vector3(1, 0.5, 0.4);
          const [fx, fy] = s.freq ?? [1, 1.37];
          const a = m.t * s.speed;
          p.set(
            c.x + Math.sin(a * fx + (s.phase ?? 0)) * amp.x,
            c.y + Math.sin(a * fy) * amp.y,
            c.z + Math.sin(a * (fx * 0.61) + 1.1) * amp.z
          );
          break;
        }

        case 'oscillate': {
          const c = s.centre ?? m.origin;
          const amp = s.amplitude ?? new THREE.Vector3(1, 0, 0);
          const a = Math.sin(m.t * s.speed + (s.phase ?? 0));
          p.copy(c).addScaledVector(amp, a);
          break;
        }

        case 'approach': {
          const target = s.centre ?? new THREE.Vector3(0, 1.6, 0);
          const dir = target.clone().sub(p);
          const dist = dir.length();
          if (dist < 0.05) {
            m.done = true;
            s.onArrive?.();
            break;
          }
          p.addScaledVector(dir.normalize(), Math.min(dist, s.speed * dt));
          break;
        }

        case 'waypoint': {
          const wps = s.waypoints ?? [];
          if (wps.length === 0) { m.done = true; break; }
          const target = wps[m.wpIndex % wps.length]!;
          const dir = target.clone().sub(p);
          const dist = dir.length();
          if (dist < 0.08) {
            m.wpIndex++;
            if (!s.loop && m.wpIndex >= wps.length) { m.done = true; s.onArrive?.(); break; }
          } else {
            p.addScaledVector(dir.normalize(), Math.min(dist, s.speed * dt));
          }
          break;
        }

        case 'randomwalk': {
          const jitter = s.jitter ?? 1.2;
          m.velocity.x += (Math.random() - 0.5) * jitter * dt;
          m.velocity.y += (Math.random() - 0.5) * jitter * dt * 0.4;
          m.velocity.z += (Math.random() - 0.5) * jitter * dt;
          m.velocity.clampLength(0, s.speed);
          p.addScaledVector(m.velocity, dt);
          const c = s.centre ?? m.origin;
          const bound = s.bounds ?? 3;
          const off = p.clone().sub(c);
          if (off.length() > bound) {
            off.setLength(bound);
            p.copy(c).add(off);
            m.velocity.reflect(off.clone().normalize()).multiplyScalar(0.85);
          }
          break;
        }
      }

      if (dt > 0) m.velocity.copy(p.clone().sub(before).divideScalar(dt));
    }
  }
}
