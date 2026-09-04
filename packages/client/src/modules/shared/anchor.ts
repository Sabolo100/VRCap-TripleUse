import * as THREE from 'three';
import type { ModuleContext } from '../../engine/task/Module.js';

/**
 * BODY ANCHOR — where the participant actually is.
 *
 * Modules that put things within arm's reach were placing them around the
 * world origin at a hardcoded eye height. That is only correct for someone
 * standing exactly on the origin who happens to be 1.6 m tall. Anyone standing
 * half a metre to the side gets the target beside them instead of in front,
 * and a tall participant gets it at chest height - occasionally inside their
 * own body.
 *
 * This captures the participant's position, eye height and facing once, and
 * every peripersonal placement is expressed relative to that. It is captured
 * rather than tracked live: a target that follows the head cannot be reached,
 * because it retreats as you lean towards it.
 */
export class BodyAnchor {
  /** Head position at capture. */
  readonly origin = new THREE.Vector3(0, 1.6, 0);
  /** Facing at capture, radians, 0 = down -Z. */
  yaw = 0;
  private captured = false;

  constructor(private ctx: ModuleContext) {}

  get eyeHeight(): number {
    return this.origin.y;
  }

  /** Re-read the participant's pose. Call at calibration and at block start. */
  capture(): void {
    const cam = this.ctx.engine.camera;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    cam.getWorldPosition(p);
    cam.getWorldQuaternion(q);
    // A headset that has not started tracking reports the origin at zero
    // height; keeping the default is better than anchoring to the floor.
    if (p.y > 0.8) {
      this.origin.copy(p);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      this.yaw = Math.atan2(fwd.x, -fwd.z);
      this.captured = true;
    }
  }

  ensure(): void {
    if (!this.captured) this.capture();
  }

  /**
   * A point at `radius` metres from the anchor, `azDeg` to the right of the
   * captured facing and `elDeg` above it.
   */
  place(azDeg: number, elDeg: number, radius: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.ensure();
    const az = this.yaw + (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    const horiz = Math.cos(el) * radius;
    return target.set(
      this.origin.x + Math.sin(az) * horiz,
      this.origin.y + Math.sin(el) * radius,
      this.origin.z - Math.cos(az) * horiz
    );
  }

  /** Offset in the anchor's own frame: +x right, +y up, +z forward. */
  offset(right: number, up: number, forward: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.ensure();
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return target.set(
      this.origin.x + right * c + forward * s,
      this.origin.y + up,
      this.origin.z + right * s - forward * c
    );
  }
}
