import * as THREE from 'three';

/**
 * GRASPING AND MOVEMENT ANALYSIS.
 *
 * Two things HANDS needs that no other module has needed: picking objects up
 * in the peripersonal space, and describing the quality of the movement that
 * carried them - not just whether it arrived.
 *
 * Both are kept away from the module itself so that a later hand-tracking
 * mode (pinch instead of trigger, wrist pose instead of grip space) changes
 * one file rather than four blocks.
 */

/* ------------------------------------------------------- motion analysis */

/**
 * Dimensionless normalised jerk.
 *
 * The standard smoothness measure: because it is normalised by duration and
 * distance, a slow 40 cm reach and a quick 12 cm one are directly comparable,
 * which raw jerk is not.
 *
 *     NJ = sqrt( 0.5 * integral(|d3x/dt3|^2) dt * T^5 / L^2 )
 *
 * An analytic minimum-jerk trajectory gives exactly sqrt(360) = 18.97
 * regardless of how far or how fast it went; that number is the reference
 * point the anchors are set around, not zero.
 */
export class MotionTrack {
  private t: number[] = [];
  private p: THREE.Vector3[] = [];

  push(tMs: number, pos: THREE.Vector3): void {
    // Duplicate timestamps make the finite differences explode.
    const last = this.t[this.t.length - 1];
    if (last !== undefined && tMs - last < 1e-3) return;
    this.t.push(tMs);
    this.p.push(pos.clone());
  }

  get samples(): number { return this.p.length; }

  clear(): void { this.t = []; this.p = []; }

  pathLengthMm(): number {
    let l = 0;
    for (let i = 1; i < this.p.length; i++) l += this.p[i]!.distanceTo(this.p[i - 1]!);
    return l * 1000;
  }

  straightLineMm(): number {
    if (this.p.length < 2) return 0;
    return this.p[0]!.distanceTo(this.p[this.p.length - 1]!) * 1000;
  }

  durationS(): number {
    if (this.t.length < 2) return 0;
    return (this.t[this.t.length - 1]! - this.t[0]!) / 1000;
  }

  normalisedJerk(): number {
    const n = this.p.length;
    if (n < 8) return NaN;
    const T = this.durationS();
    const L = this.pathLengthMm() / 1000;
    if (T <= 0 || L <= 1e-4) return NaN;

    // A uniform step from the actual span. Frame times are near-uniform, and
    // using the mean rather than each interval keeps the stencils below
    // second-order accurate instead of first.
    const h = T / (n - 1);
    const h3 = h * h * h;
    const jerk: THREE.Vector3[] = new Array(n);
    const P = this.p;
    const v = (i: number) => P[Math.max(0, Math.min(n - 1, i))]!;

    for (let i = 0; i < n; i++) {
      const j = new THREE.Vector3();
      if (i >= 2 && i <= n - 3) {
        // Central, second-order: (-f[-2] + 2f[-1] - 2f[+1] + f[+2]) / 2h^3
        j.copy(v(i - 2)).multiplyScalar(-1)
          .addScaledVector(v(i - 1), 2)
          .addScaledVector(v(i + 1), -2)
          .addScaledVector(v(i + 2), 1)
          .divideScalar(2 * h3);
      } else if (i < 2) {
        // Forward one-sided, so the endpoints are kept. A minimum-jerk reach
        // carries its LARGEST jerk at the two endpoints; dropping them - which
        // a central-difference-only scheme has to - biased the measure low,
        // and by an amount that depended on the frame rate.
        j.copy(v(i)).multiplyScalar(-1)
          .addScaledVector(v(i + 1), 3)
          .addScaledVector(v(i + 2), -3)
          .addScaledVector(v(i + 3), 1)
          .divideScalar(h3);
      } else {
        j.copy(v(i))
          .addScaledVector(v(i - 1), -3)
          .addScaledVector(v(i - 2), 3)
          .addScaledVector(v(i - 3), -1)
          .divideScalar(h3);
      }
      jerk[i] = j;
    }

    // Trapezoid over the whole span, endpoints included.
    let integral = 0;
    for (let i = 0; i < n; i++) {
      integral += jerk[i]!.lengthSq() * (i === 0 || i === n - 1 ? h / 2 : h);
    }
    return Math.sqrt((0.5 * integral * Math.pow(T, 5)) / (L * L));
  }

  /**
   * Tremor: the RMS of the position after a 250 ms moving average is removed.
   *
   * Subtracting the local mean leaves only what oscillates faster than about
   * 4 Hz, which is where physiological tremor lives; slow drift towards the
   * hole is aiming, not tremor, and must not be counted as it.
   */
  tremorMm(): number {
    const n = this.p.length;
    if (n < 8) return NaN;
    // A window of a fixed SAMPLE COUNT, not a fixed duration. A time window
    // can end up with one more sample on one side than the other, and then a
    // steady drift no longer cancels - it leaks into the residual and is
    // counted as tremor it is not.
    const dt = (this.t[n - 1]! - this.t[0]!) / (n - 1);
    const half = Math.max(2, Math.round(125 / Math.max(1e-3, dt)));
    if (n < half * 2 + 3) return NaN;
    let sum = 0;
    let count = 0;
    const avg = new THREE.Vector3();
    for (let i = half; i < n - half; i++) {
      avg.set(0, 0, 0);
      for (let j = i - half; j <= i + half; j++) avg.add(this.p[j]!);
      avg.divideScalar(half * 2 + 1);
      sum += this.p[i]!.distanceToSquared(avg);
      count++;
    }
    return count ? Math.sqrt(sum / count) * 1000 : NaN;
  }
}

/* -------------------------------------------------------------- grabbing */

export interface Grabbable {
  id: string;
  object: THREE.Object3D;
  home: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  /** Objects with a key ridge must also be rotated to match the socket. */
  keyed: boolean;
  kind: string;
}

export interface Socket {
  id: string;
  index: number;
  position: THREE.Vector3;
  /** Insertion axis, pointing out of the board. */
  axis: THREE.Vector3;
  toleranceM: number;
  /** Null when orientation does not matter. */
  keyAngleRad: number | null;
  angleToleranceRad: number;
  filled: boolean;
  accepts: string;
  marker: THREE.Object3D | null;
}

export interface GrabEvents {
  onGrab(hand: 'left' | 'right', g: Grabbable, t: number, distanceM: number): void;
  onRelease(
    hand: 'left' | 'right',
    g: Grabbable,
    t: number,
    result: { socket: Socket | null; errorM: number; angleErrorRad: number | null }
  ): void;
}

interface Held {
  g: Grabbable;
  offset: THREE.Vector3;
  quatOffset: THREE.Quaternion;
  grabbedAt: number;
  startPos: THREE.Vector3;
}

export class GrabSystem {
  private grabbables: Grabbable[] = [];
  private sockets: Socket[] = [];
  private held = new Map<'left' | 'right', Held>();
  private wasPressed = new Map<'left' | 'right', boolean>();
  private enabledHands: ('left' | 'right')[] = ['left', 'right'];

  constructor(
    private hand: (h: 'left' | 'right') => THREE.Object3D | null,
    private pressed: (h: 'left' | 'right') => boolean,
    private grabRadiusM: number,
    private events: GrabEvents
  ) {}

  setGrabbables(list: Grabbable[]): void { this.grabbables = list; }
  setSockets(list: Socket[]): void { this.sockets = list; }
  setHands(hands: ('left' | 'right')[]): void { this.enabledHands = hands; }

  heldBy(h: 'left' | 'right'): Grabbable | null { return this.held.get(h)?.g ?? null; }
  heldSince(h: 'left' | 'right'): number | null { return this.held.get(h)?.grabbedAt ?? null; }
  startPos(h: 'left' | 'right'): THREE.Vector3 | null { return this.held.get(h)?.startPos ?? null; }

  handPosition(h: 'left' | 'right', target = new THREE.Vector3()): THREE.Vector3 | null {
    const o = this.hand(h);
    if (!o) return null;
    return o.getWorldPosition(target);
  }

  update(t: number): void {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (const h of ['left', 'right'] as const) {
      const enabled = this.enabledHands.includes(h);
      const obj = this.hand(h);
      const down = enabled && !!obj && this.pressed(h);
      const was = this.wasPressed.get(h) ?? false;
      this.wasPressed.set(h, down);
      if (!obj) { if (this.held.has(h)) this.forceRelease(h, t); continue; }
      obj.getWorldPosition(pos);
      obj.getWorldQuaternion(quat);

      // The held object is moved to THIS frame's hand pose before the press
      // edge is handled, and its world matrix forced up to date. Otherwise a
      // release reads the object where it was one frame ago, and the insertion
      // error - measured in millimetres against a 9 mm hole - carries a whole
      // frame of hand movement as if it were aiming error.
      const held = this.held.get(h);
      if (held) this.follow(held, pos, quat);

      if (down && !was && !this.held.has(h)) {
        this.tryGrab(h, pos, quat, t);
        const justGrabbed = this.held.get(h);
        if (justGrabbed) this.follow(justGrabbed, pos, quat);
      } else if (!down && was && this.held.has(h)) {
        this.release(h, t);
      }
    }
  }

  private follow(held: Held, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    held.g.object.position.copy(pos).add(held.offset.clone().applyQuaternion(quat));
    held.g.object.quaternion.copy(quat).multiply(held.quatOffset);
    held.g.object.updateMatrixWorld(true);
  }

  private tryGrab(h: 'left' | 'right', pos: THREE.Vector3, quat: THREE.Quaternion, t: number): void {
    let best: Grabbable | null = null;
    let bestD = this.grabRadiusM;
    const p = new THREE.Vector3();
    for (const g of this.grabbables) {
      if (!g.object.visible) continue;
      if ([...this.held.values()].some((x) => x.g === g)) continue;
      const d = g.object.getWorldPosition(p).distanceTo(pos);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) return;
    // The object keeps its offset from the hand rather than snapping into it:
    // snapping would teleport the peg and destroy the transport trajectory
    // that the smoothness measure is computed from.
    const inv = quat.clone().invert();
    this.held.set(h, {
      g: best,
      offset: best.object.position.clone().sub(pos).applyQuaternion(inv),
      quatOffset: inv.clone().multiply(best.object.quaternion),
      grabbedAt: t,
      startPos: pos.clone(),
    });
    this.events.onGrab(h, best, t, bestD);
  }

  private release(h: 'left' | 'right', t: number): void {
    const held = this.held.get(h);
    if (!held) return;
    this.held.delete(h);
    const g = held.g;
    const p = g.object.getWorldPosition(new THREE.Vector3());

    let bestSocket: Socket | null = null;
    let bestRadial = Infinity;
    let bestAngle: number | null = null;
    for (const s of this.sockets) {
      if (s.filled || s.accepts !== g.kind) continue;
      const rel = p.clone().sub(s.position);
      const along = rel.dot(s.axis);
      // 30 mm of slack along the insertion axis: the peg does not have to be
      // flush, only over the hole and pointing into it.
      if (Math.abs(along) > 0.03) continue;
      const radial = rel.clone().addScaledVector(s.axis, -along).length();
      if (radial > s.toleranceM || radial >= bestRadial) continue;
      let angleErr: number | null = null;
      if (s.keyAngleRad !== null) {
        angleErr = keyAngleError(g.object, s);
        if (Math.abs(angleErr) > s.angleToleranceRad) {
          // Close enough in position but wrong rotation: this is a real miss,
          // and the module must see the angle that caused it.
          bestAngle = angleErr;
          continue;
        }
      }
      bestSocket = s;
      bestRadial = radial;
      bestAngle = angleErr;
    }

    if (bestSocket) {
      bestSocket.filled = true;
      g.object.position.copy(bestSocket.position);
      g.object.quaternion.copy(socketQuat(bestSocket, g));
      this.events.onRelease(h, g, t, {
        socket: bestSocket, errorM: bestRadial, angleErrorRad: bestAngle,
      });
    } else {
      const nearest = this.nearestSocketDistance(p, g.kind);
      g.object.position.copy(g.home);
      g.object.quaternion.copy(g.homeQuat);
      this.events.onRelease(h, g, t, { socket: null, errorM: nearest, angleErrorRad: bestAngle });
    }
  }

  private forceRelease(h: 'left' | 'right', t: number): void {
    const held = this.held.get(h);
    if (!held) return;
    this.held.delete(h);
    held.g.object.position.copy(held.g.home);
    held.g.object.quaternion.copy(held.g.homeQuat);
    this.events.onRelease(h, held.g, t, { socket: null, errorM: Infinity, angleErrorRad: null });
  }

  private nearestSocketDistance(p: THREE.Vector3, kind: string): number {
    let d = Infinity;
    for (const s of this.sockets) {
      if (s.filled || s.accepts !== kind) continue;
      d = Math.min(d, p.distanceTo(s.position));
    }
    return d;
  }

  /** Drop everything - used on abort and between blocks. */
  releaseAll(): void {
    for (const h of ['left', 'right'] as const) {
      const held = this.held.get(h);
      if (!held) continue;
      this.held.delete(h);
      held.g.object.position.copy(held.g.home);
      held.g.object.quaternion.copy(held.g.homeQuat);
    }
    this.wasPressed.clear();
  }
}

/** Signed roll of the object's key ridge about the socket axis, radians. */
export function keyAngleError(object: THREE.Object3D, s: Socket): number {
  const key = new THREE.Vector3(1, 0, 0).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
  const { u, v } = socketBasis(s);
  const x = key.dot(u);
  const y = key.dot(v);
  const angle = Math.atan2(y, x);
  let d = angle - (s.keyAngleRad ?? 0);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * An in-plane basis for the socket, built so that an object with an identity
 * orientation reads as zero key angle. Any consistent basis would work for
 * accept/reject, but the angle is also REPORTED - a basis with an arbitrary
 * 90 degree offset would make every logged orientation error wrong by 90.
 */
export function socketBasis(s: Socket): { u: THREE.Vector3; v: THREE.Vector3 } {
  const ref = Math.abs(s.axis.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const u = ref.clone().addScaledVector(s.axis, -ref.dot(s.axis)).normalize();
  const v = new THREE.Vector3().crossVectors(s.axis, u).normalize();
  return { u, v };
}

function socketQuat(s: Socket, g: Grabbable): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.axis);
  if (s.keyAngleRad === null || !g.keyed) return q;
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.keyAngleRad));
}

/* ----------------------------------------------------------- wire path */

export interface WirePath {
  points: THREE.Vector3[];
  /** Which kind of arc each point belongs to. */
  segment: ('lateral' | 'depth')[];
  totalLengthM: number;
}

/**
 * Four arcs of equal length and equal curvature: lateral, depth, lateral,
 * depth. Matching them is the whole point - `wire_depth_segment_cost` is then
 * a difference between two segments that differ only in direction, not in
 * how hard they are to draw.
 */
export function buildWirePath(
  origin: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  forward: THREE.Vector3,
  arcLengthM: number,
  amplitudeM: number,
  variant: number
): WirePath {
  const points: THREE.Vector3[] = [];
  const segment: ('lateral' | 'depth')[] = [];
  const per = 26;
  const sign = variant % 2 === 0 ? 1 : -1;
  // Each arc advances the same distance along the "rail" direction and bulges
  // by the same amplitude; only the bulge axis changes.
  const order: ('lateral' | 'depth')[] = ['lateral', 'depth', 'lateral', 'depth'];
  let cursor = origin.clone().addScaledVector(right, -arcLengthM * 2);
  for (let a = 0; a < order.length; a++) {
    const kind = order[a]!;
    const bulge = kind === 'lateral' ? up : forward;
    const dir = a % 2 === 0 ? sign : -sign;
    for (let i = 0; i < per; i++) {
      const s = i / (per - 1);
      const p = cursor.clone()
        .addScaledVector(right, s * arcLengthM)
        .addScaledVector(bulge, Math.sin(s * Math.PI) * amplitudeM * dir);
      if (a > 0 && i === 0) continue;
      points.push(p);
      segment.push(kind);
    }
    cursor = cursor.clone().addScaledVector(right, arcLengthM);
  }
  let total = 0;
  for (let i = 1; i < points.length; i++) total += points[i]!.distanceTo(points[i - 1]!);
  return { points, segment, totalLengthM: total };
}

/** Nearest point on the polyline: axial distance, arc-length position, segment kind. */
export function wireProbe(path: WirePath, p: THREE.Vector3): {
  distanceM: number; sNorm: number; segment: 'lateral' | 'depth';
} {
  let best = Infinity;
  let bestIdx = 0;
  let bestT = 0;
  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]!;
    const b = path.points[i]!;
    ab.copy(b).sub(a);
    ap.copy(p).sub(a);
    const len2 = ab.lengthSq();
    const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ap.dot(ab) / len2)) : 0;
    const d = ap.sub(ab.multiplyScalar(t)).length();
    if (d < best) { best = d; bestIdx = i; bestT = t; }
  }
  let s = 0;
  for (let i = 1; i < bestIdx; i++) s += path.points[i]!.distanceTo(path.points[i - 1]!);
  s += path.points[bestIdx]!.distanceTo(path.points[bestIdx - 1]!) * bestT;
  return {
    distanceM: best,
    sNorm: path.totalLengthM > 0 ? s / path.totalLengthM : 0,
    segment: path.segment[bestIdx]!,
  };
}
