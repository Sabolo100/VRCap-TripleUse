import * as THREE from 'three';
import type { ModuleContext } from '../task/Module.js';

/**
 * KEEPING A PANEL WHERE THE PARTICIPANT CAN SEE IT.
 *
 * In a headset you look down and the control panel is there. On a laptop you
 * cannot look down at all - the camera never moves - so a panel outside the
 * frustum is not awkward, it is unreachable, and the module sits waiting for a
 * press on a button nobody can see. That is exactly what happened to SIGNAL's
 * "no target" control: -36 degrees is comfortable in VR and off the bottom of
 * a 65 degree viewport.
 *
 * These helpers take the placement a module WANTS and return the nearest one
 * that actually fits. In VR they pass the request through untouched, because
 * there the participant can turn their head and the tuned layout is correct.
 */

/**
 * Where the runner's HUD strip sits on a flat screen.
 *
 * It is the one panel that is always up during a block, carrying the block
 * line and the way out, so module panels have to stay above it. It lives here
 * rather than in the runner because both sides need it: the runner to place
 * the strip, and `fitAngles` to keep everything else clear of it.
 */
export const FLAT_HUD = { elDeg: -28, distanceM: 1.2, heightM: 0.14, tiltRad: -0.42 };

/** The top edge of that strip, in degrees. */
export function flatHudTopDeg(): number {
  const half = (Math.atan((FLAT_HUD.heightM * Math.cos(FLAT_HUD.tiltRad)) / 2 / FLAT_HUD.distanceM)
    * 180) / Math.PI;
  return FLAT_HUD.elDeg + half;
}

/** Usable half-angles of the view, in degrees. */
export interface ViewLimits {
  vDeg: number;
  hDeg: number;
}

/** The vertical FOV the engine uses per platform. Never assume more than this,
 *  even if the live camera happens to be wider at this moment. */
const DESIGN_FOV_DEG = { desktop: 65, mobile: 42, vr: 90 };
/** A headset's usable field, well inside the hardware's, since the
 *  participant can also turn their head. */
const VR_LIMITS: ViewLimits = { vDeg: 45, hDeg: 55 };

export function viewLimits(ctx: ModuleContext): ViewLimits {
  if (ctx.platform === 'vr') return VR_LIMITS;
  const cam = ctx.engine.camera as THREE.PerspectiveCamera;
  const design = DESIGN_FOV_DEG[ctx.platform] ?? 65;
  const fov = Math.min(Number.isFinite(cam?.fov) ? cam.fov : design, design);
  const v = fov / 2;
  // The aspect is whatever the window is right now; the bounds stop a freak
  // value (an unresized camera, a hidden tab) from promising room that is not
  // there or hiding room that is.
  const aspect = Math.max(0.8, Math.min(Number.isFinite(cam?.aspect) ? cam.aspect : 1.6, 2.4));
  const h = (Math.atan(Math.tan((v * Math.PI) / 180) * aspect) * 180) / Math.PI;
  return { vDeg: v, hDeg: h };
}

export interface FitRequest {
  /** Intended azimuth, degrees, 0 straight ahead and positive to the right. */
  azDeg?: number;
  /** Intended elevation, degrees, positive up. */
  elDeg: number;
  distanceM: number;
  widthM: number;
  heightM: number;
  /** Clearance kept between the panel edge and the edge of the view. */
  marginDeg?: number;
  /** How far the panel may be pushed back to make it fit. 1 = not at all. */
  maxDistanceFactor?: number;
  /**
   * Allow the panel to reach down into the runner's HUD strip. Only for panels
   * that are never on screen at the same time as it.
   */
  allowUnderHud?: boolean;
}

export interface Fitted {
  azDeg: number;
  elDeg: number;
  distanceM: number;
  /** True when the request had to be changed - useful for a log line. */
  adjusted: boolean;
}

/**
 * The nearest placement to the one requested that keeps the whole panel inside
 * the view.
 *
 * Two things can go wrong, and they need different answers. If the panel is
 * simply too far off axis, moving its centre is enough. If the panel is WIDER
 * than the room available, no centre works - so it is pushed further away
 * instead, which shrinks its angular size without changing the layout. Pushing
 * back is capped, so a panel that still does not fit shows up in the audit
 * rather than drifting off into the distance.
 */
export function fitAngles(ctx: ModuleContext, req: FitRequest): Fitted {
  const azDeg = req.azDeg ?? 0;
  if (ctx.platform === 'vr') {
    return { azDeg, elDeg: req.elDeg, distanceM: req.distanceM, adjusted: false };
  }
  const limits = viewLimits(ctx);
  const margin = req.marginDeg ?? 1.5;
  const availV = Math.max(2, limits.vDeg - margin);
  const availH = Math.max(2, limits.hDeg - margin);
  const maxFactor = req.maxDistanceFactor ?? 3;

  const halfAngle = (size: number, d: number) => (Math.atan(size / 2 / d) * 180) / Math.PI;

  let dist = req.distanceM;
  const limit = dist * maxFactor;
  // Grow the distance until the panel's own angular size fits, leaving at
  // least a degree of play for the centre.
  for (let i = 0; i < 24; i++) {
    const hh = halfAngle(req.heightM, dist);
    const hw = halfAngle(req.widthM, dist);
    if ((hh <= availV - 0.5 && hw <= availH - 0.5) || dist >= limit) break;
    dist = Math.min(limit, dist * 1.12);
  }

  const hh = halfAngle(req.heightM, dist);
  const hw = halfAngle(req.widthM, dist);
  const elRoom = Math.max(0, availV - hh);
  const azRoom = Math.max(0, availH - hw);
  // The HUD strip owns the bottom of a flat screen for the whole of a block.
  // Without this, a panel clamped to the very bottom lands on top of the block
  // line and the exit button - which is what happened to SIGNAL's control the
  // moment it was pulled back into view.
  const floor = req.allowUnderHud ? -elRoom : Math.max(-elRoom, flatHudTopDeg() + hh);
  const el = Math.max(floor, Math.min(elRoom, req.elDeg));
  const az = Math.max(-azRoom, Math.min(azRoom, azDeg));

  return {
    azDeg: az,
    elDeg: el,
    distanceM: dist,
    adjusted: Math.abs(el - req.elDeg) > 0.01 || Math.abs(az - azDeg) > 0.01
      || Math.abs(dist - req.distanceM) > 0.001,
  };
}

/**
 * Place a group at an azimuth and elevation around `eye`, facing back at it,
 * clamped so the whole panel stays in view on a flat screen.
 *
 * `yawRad` is the direction az = 0 points along; pass the participant's
 * captured facing, or leave it out for the world's -Z.
 */
export function placeInView(
  ctx: ModuleContext,
  group: THREE.Object3D,
  opts: FitRequest & { eye: THREE.Vector3; yawRad?: number }
): Fitted {
  const fit = fitAngles(ctx, opts);
  const yaw = (opts.yawRad ?? 0) + (fit.azDeg * Math.PI) / 180;
  const el = (fit.elDeg * Math.PI) / 180;
  const horiz = Math.cos(el) * fit.distanceM;
  group.position.set(
    opts.eye.x + Math.sin(yaw) * horiz,
    opts.eye.y + Math.sin(el) * fit.distanceM,
    opts.eye.z - Math.cos(yaw) * horiz
  );
  group.lookAt(opts.eye);
  return fit;
}

/** The live camera's position and horizontal facing - what a head-following
 *  panel is placed against. */
export function eyeFrame(ctx: ModuleContext): { eye: THREE.Vector3; yawRad: number } {
  const cam = ctx.engine.camera;
  const eye = new THREE.Vector3();
  const q = new THREE.Quaternion();
  cam.getWorldPosition(eye);
  cam.getWorldQuaternion(q);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return { eye, yawRad: Math.atan2(fwd.x, -fwd.z) };
}
