import * as THREE from 'three';
import type { Rng } from '@vrcap/shared';

/**
 * PLACEMENT IN A VOLUME, not on a plane.
 *
 * The earlier `layout.ts` places stimuli on a single shell - one distance, one
 * arc in front of the participant. That is the right shape for a visual search
 * array, but it is still, geometrically, a curved 2D display. This module
 * places objects in an actual volume: all the way around the participant when
 * the task calls for it, at genuinely different distances, above and below eye
 * level.
 *
 * The distinction matters for measurement, not decoration:
 *
 *  - A full 360 degree surround makes head and body rotation the sampling
 *    behaviour. Scan coverage stops being a proxy and becomes the thing the
 *    participant actually has to do, and "did they ever look behind them" is a
 *    real, recordable variable.
 *  - Depth is a separate channel. With angular size held constant, distance is
 *    carried by binocular disparity and motion parallax alone - which exist in
 *    a headset and do not exist on a flat screen. Any metric derived from it is
 *    therefore VR-only, and is named so.
 *  - Objects that tumble present different faces over time, so a stimulus
 *    cannot be memorised as a static picture.
 */

export interface VolumeField {
  /** Half-extent of the horizontal span in degrees. Use 180 for a full surround. */
  azDeg: number;
  /** Elevation limits in degrees, relative to eye level. */
  elMinDeg: number;
  elMaxDeg: number;
  /** Distance range in metres. */
  rNear: number;
  rFar: number;
  /** Minimum angular separation between any two items, degrees. */
  minSepDeg: number;
  /** Eye height the volume is centred on. */
  height: number;
}

export interface VolumeSlot {
  azDeg: number;
  elDeg: number;
  /** Distance from the participant, metres. */
  radius: number;
  position: THREE.Vector3;
  /** Scale multiplier that holds angular size constant across the depth range. */
  depthScale: number;
}

export function volumePosition(azDeg: number, elDeg: number, radius: number, height: number): THREE.Vector3 {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el) * radius,
    height + Math.sin(el) * radius,
    -Math.cos(az) * Math.cos(el) * radius
  );
}

/** Great-circle separation between two directions, degrees. */
export function angularSep(a: { azDeg: number; elDeg: number }, b: { azDeg: number; elDeg: number }): number {
  const toRad = Math.PI / 180;
  const e1 = a.elDeg * toRad;
  const e2 = b.elDeg * toRad;
  const dAz = (a.azDeg - b.azDeg) * toRad;
  const c = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(dAz);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Wrap an angle into [-180, 180). */
export function wrapDeg(a: number): number {
  return ((a % 360) + 540) % 360 - 180;
}

/**
 * Place `count` items through the volume.
 *
 * Azimuths come from a stratified sample (one item per equal sector, jittered)
 * rather than an independent draw. Independent sampling routinely leaves a
 * 90 degree gap and a cluster somewhere else, and in a vigilance task that
 * means the participant's scanning strategy is being scored against a layout
 * accident rather than against the task.
 */
export function layoutVolume(count: number, f: VolumeField, rng: Rng): VolumeSlot[] {
  const fullCircle = f.azDeg >= 179.5;
  const span = fullCircle ? 360 : f.azDeg * 2;
  const sector = span / count;

  const slots: { azDeg: number; elDeg: number; radius: number }[] = [];
  for (let i = 0; i < count; i++) {
    const base = fullCircle ? -180 + (i + 0.5) * sector : -f.azDeg + (i + 0.5) * sector;
    slots.push({
      azDeg: base + rng.range(-0.32, 0.32) * sector,
      elDeg: rng.range(f.elMinDeg, f.elMaxDeg),
      // Sample distance in a way that fills the shell rather than piling up
      // near the inner radius.
      radius: Math.sqrt(rng.range(f.rNear * f.rNear, f.rFar * f.rFar)),
    });
  }

  relax(slots, f, fullCircle);

  return slots.map((s) => ({
    azDeg: wrapDeg(s.azDeg),
    elDeg: s.elDeg,
    radius: s.radius,
    position: volumePosition(s.azDeg, s.elDeg, s.radius, f.height),
    // Angular size is held constant so that distance carries only depth
    // information. Without this, "far" would simply mean "smaller", and the
    // depth manipulation would collapse into a size manipulation.
    depthScale: s.radius / f.rNear,
  }));
}

function relax(
  slots: { azDeg: number; elDeg: number; radius: number }[],
  f: VolumeField,
  fullCircle: boolean,
  iterations = 14
): void {
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]!;
        const b = slots[j]!;
        const sep = angularSep(a, b);
        if (sep >= f.minSepDeg) continue;
        moved = true;
        const dAz = wrapDeg(a.azDeg - b.azDeg);
        const dEl = a.elDeg - b.elDeg;
        const len = Math.hypot(dAz, dEl) || 0.001;
        const push = ((f.minSepDeg - sep) / 2) * 1.05;
        a.azDeg += (dAz / len) * push;
        a.elDeg += (dEl / len) * push;
        b.azDeg -= (dAz / len) * push;
        b.elDeg -= (dEl / len) * push;
      }
    }
    for (const s of slots) {
      s.elDeg = Math.max(f.elMinDeg, Math.min(f.elMaxDeg, s.elDeg));
      if (fullCircle) s.azDeg = wrapDeg(s.azDeg);
      else s.azDeg = Math.max(-f.azDeg, Math.min(f.azDeg, s.azDeg));
    }
    if (!moved) break;
  }
}

/**
 * Where an object sits relative to where the participant is looking.
 * `behind` is the measure a flat screen cannot produce: it is only meaningful
 * when the display surrounds the viewer.
 */
export function viewRelation(
  camera: THREE.Camera,
  worldPos: THREE.Vector3
): { eccentricityDeg: number; signedYawDeg: number; behind: boolean } {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  camera.getWorldPosition(p);
  camera.getWorldQuaternion(q);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const to = worldPos.clone().sub(p).normalize();
  const eccentricityDeg = THREE.MathUtils.radToDeg(fwd.angleTo(to));

  // Signed yaw: positive to the participant's right.
  const flatFwd = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
  const flatTo = new THREE.Vector3(to.x, 0, to.z).normalize();
  const cross = new THREE.Vector3().crossVectors(flatFwd, flatTo);
  const signedYawDeg = THREE.MathUtils.radToDeg(Math.atan2(cross.y, flatFwd.dot(flatTo)));

  return { eccentricityDeg, signedYawDeg, behind: eccentricityDeg > 100 };
}

/**
 * Continuous tumbling for a set of objects.
 *
 * A stimulus that never turns is, perceptually, a picture. Giving each object
 * its own slow rotation axis means the participant sees a solid body in space,
 * gets structure-from-motion for free, and cannot encode the display as a flat
 * pattern. Rates are kept low enough that the rotation never becomes the task.
 */
export class Tumbler {
  private items: { obj: THREE.Object3D; axis: THREE.Vector3; rate: number }[] = [];

  add(obj: THREE.Object3D, rng: Rng, minRate = 0.12, maxRate = 0.45): void {
    const axis = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    axis.normalize();
    this.items.push({ obj, axis, rate: rng.range(minRate, maxRate) });
  }

  update(dt: number): void {
    for (const it of this.items) it.obj.rotateOnAxis(it.axis, it.rate * dt);
  }

  clear(): void {
    this.items = [];
  }

  remove(obj: THREE.Object3D): void {
    this.items = this.items.filter((i) => i.obj !== obj);
  }
}

/** Volume presets scaled per platform. VR gets the full surround; a flat
 *  viewport cannot show one, so the span narrows and depth loses disparity. */
export function volumeFor(
  platform: 'vr' | 'desktop' | 'mobile',
  preset: {
    vr: Omit<VolumeField, 'height'>;
    desktop: Omit<VolumeField, 'height'>;
    mobile: Omit<VolumeField, 'height'>;
  },
  height = 1.6
): VolumeField {
  return { ...preset[platform], height };
}
