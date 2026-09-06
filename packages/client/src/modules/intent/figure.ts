import * as THREE from 'three';

/**
 * A PROCEDURAL POINT-LIGHT FIGURE.
 *
 * Thirteen spheres at the joints, nothing else: no body, no outline, no
 * shadow. That is Johansson's display, and it is chosen for what it takes
 * away - everything except the motion itself.
 *
 * The movement is parametric rather than recorded, and that is the whole
 * design. A deceptive trial differs from a genuine one in EXACTLY one sign:
 * the direction of the preparation. With motion capture the two conditions
 * would differ in a hundred small ways and we would not know which one the
 * participant read.
 */

export const JOINTS = [
  'head',
  'shoulderL', 'shoulderR',
  'elbowL', 'elbowR',
  'wristL', 'wristR',
  'hipL', 'hipR',
  'kneeL', 'kneeR',
  'ankleL', 'ankleR',
] as const;
export type JointName = (typeof JOINTS)[number];

/** Neutral stance for a 1.70 m figure, metres, origin at the feet. */
const BASE: Record<JointName, [number, number, number]> = {
  head: [0, 1.62, 0],
  shoulderL: [-0.19, 1.42, 0], shoulderR: [0.19, 1.42, 0],
  elbowL: [-0.24, 1.14, 0], elbowR: [0.24, 1.14, 0],
  wristL: [-0.26, 0.88, 0], wristR: [0.26, 0.88, 0],
  hipL: [-0.11, 0.94, 0], hipR: [0.11, 0.94, 0],
  kneeL: [-0.12, 0.52, 0], kneeR: [0.12, 0.52, 0],
  ankleL: [-0.11, 0.09, 0], ankleR: [0.11, 0.09, 0],
};

/** Phase boundaries as fractions of the movement. */
export const PREP_END = 0.45;
export const COMMIT_END = 0.75;

const A_LEAN = 0.075;
const A_WEIGHT = 0.045;
const A_ARM = 0.090;
const A_PELVIS = 0.090;
const A_STEP = 0.220;
const A_BODY = 0.350;
const DIP = 0.030;

/** Minimum-jerk shaped ramp: smooth in both position and velocity. */
function ramp(u: number): number {
  const s = Math.max(0, Math.min(1, u));
  return 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5;
}

export interface PoseParams {
  /** Fraction of the movement, 0..1. */
  t: number;
  /** Direction the preparation promises: -1 left, +1 right. */
  dirEarly: number;
  /** Direction the movement actually goes. */
  dirFinal: number;
  /** Height of the figure in metres. */
  height: number;
}

/**
 * Joint positions in the figure's own frame: +x right, +y up, +z towards the
 * viewer. The three phases are separate ramps, so the preparation can point
 * one way while the commitment goes the other and nothing else changes.
 */
export function pose(p: PoseParams): Record<JointName, THREE.Vector3> {
  const scale = p.height / 1.70;
  const s1 = ramp(p.t / PREP_END);
  const s2 = ramp((p.t - PREP_END) / (COMMIT_END - PREP_END));
  const s3 = ramp((p.t - COMMIT_END) / (1 - COMMIT_END));

  const lean = A_LEAN * s1 * p.dirEarly;
  const weight = A_WEIGHT * s1 * p.dirEarly;
  const arm = A_ARM * s1 * -p.dirEarly;
  const pelvis = A_PELVIS * s2 * p.dirFinal;
  const step = A_STEP * s2 * p.dirFinal;
  const body = A_BODY * s3 * p.dirFinal;
  const dip = -DIP * s1;

  const out = {} as Record<JointName, THREE.Vector3>;
  for (const j of JOINTS) {
    const [bx, by, bz] = BASE[j];
    let x = bx;
    let y = by;
    const z = bz;

    // Upper body carries the preparation: the lean is what an early
    // occlusion shows, and it is the only thing a feint inverts.
    if (j === 'head') x += lean;
    else if (j.startsWith('shoulder')) x += lean * 0.8;
    else if (j.startsWith('elbow')) x += lean * 0.7;
    else if (j.startsWith('wrist')) x += lean * 0.6 + arm;

    if (j.startsWith('hip')) { x += weight + pelvis; y += dip; }
    if (j.startsWith('knee')) { x += weight * 0.5 + pelvis * 0.6; y += dip * 0.8; }

    // The leading foot is the clearest commitment cue, and only the foot on
    // the side the figure is actually going steps out.
    if (j === 'ankleL' && p.dirFinal < 0) x += step;
    if (j === 'ankleR' && p.dirFinal > 0) x += step;
    if (j === 'kneeL' && p.dirFinal < 0) x += step * 0.5;
    if (j === 'kneeR' && p.dirFinal > 0) x += step * 0.5;

    x += body;
    out[j] = new THREE.Vector3(x * scale, y * scale, z * scale);
  }
  return out;
}

/**
 * The depth variant: instead of stepping sideways the figure steps towards
 * the viewer or away from them. Returned as a distance multiplier applied to
 * the whole figure - the module holds the figure's ANGULAR size constant
 * across it, so on a flat screen the two cases are literally identical
 * images, and only disparity and parallax can tell them apart.
 */
export function depthOffsetM(t: number, dirFinal: number, dirEarly: number, rangeM: number): number {
  const s1 = ramp(t / PREP_END);
  const s2 = ramp((t - PREP_END) / (COMMIT_END - PREP_END));
  const s3 = ramp((t - COMMIT_END) / (1 - COMMIT_END));
  // A small postural lean first, then the real move - the same three-phase
  // shape as the lateral movement, so the occlusion levels mean the same
  // thing in both blocks.
  return (0.12 * s1 * dirEarly + 0.30 * s2 * dirFinal + 0.58 * s3 * dirFinal) * rangeM;
}
