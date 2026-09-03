import * as THREE from 'three';
import type { Rng } from '@vrcap/shared';

/**
 * Placement of stimulus arrays on a spherical shell around the participant.
 *
 * Purely random placement is wrong for search tasks: it produces clumps and
 * empty bands, and search time then depends on how lucky the layout was rather
 * than on the participant. A jittered grid keeps the density even while still
 * looking irregular, and a short relaxation pass guarantees the minimum angular
 * separation that pointing and lateral masking both require.
 */

export interface ShellField {
  /** Half-extent of the horizontal span, degrees. */
  azDeg: number;
  /** Half-extent of the vertical span, degrees. */
  elDeg: number;
  /** Minimum angular separation between any two items, degrees. */
  minSepDeg: number;
  /** Shell radius in metres. */
  radius: number;
  /** Eye height the shell is centred on. */
  height: number;
}

export interface ShellSlot {
  azDeg: number;
  elDeg: number;
  position: THREE.Vector3;
}

/** Convert a spherical direction to a world position on the shell. */
export function shellPosition(azDeg: number, elDeg: number, f: ShellField): THREE.Vector3 {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el) * f.radius,
    f.height + Math.sin(el) * f.radius,
    -Math.cos(az) * Math.cos(el) * f.radius
  );
}

/**
 * Great-circle separation between two shell directions, degrees.
 * Small-angle approximations are wrong at the edges of a +/-55 degree field,
 * so this uses the real spherical law of cosines.
 */
export function angularSeparation(a: { azDeg: number; elDeg: number }, b: { azDeg: number; elDeg: number }): number {
  const toRad = Math.PI / 180;
  const el1 = a.elDeg * toRad;
  const el2 = b.elDeg * toRad;
  const dAz = (a.azDeg - b.azDeg) * toRad;
  const c = Math.sin(el1) * Math.sin(el2) + Math.cos(el1) * Math.cos(el2) * Math.cos(dAz);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/**
 * Lay out `count` items on a jittered grid across the field, then relax any
 * pair that still violates the minimum separation.
 */
export function layoutShell(count: number, f: ShellField, rng: Rng): ShellSlot[] {
  const spanAz = f.azDeg * 2;
  const spanEl = f.elDeg * 2;
  const aspect = spanAz / Math.max(1, spanEl);
  let cols = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
  let rows = Math.max(1, Math.ceil(count / cols));
  // Prefer a grid that is not absurdly elongated in either direction.
  while (cols * rows < count) cols++;

  const cellW = spanAz / cols;
  const cellH = spanEl / rows;

  // Jitter is chosen so that neighbouring cell centres cannot be pushed closer
  // than the required separation. If the field is too dense for the requested
  // count, jitter collapses to zero and the relaxation pass does the rest.
  const jitterAz = Math.max(0, Math.min(0.32, 0.5 * (1 - f.minSepDeg / Math.max(0.01, cellW))));
  const jitterEl = Math.max(0, Math.min(0.32, 0.5 * (1 - f.minSepDeg / Math.max(0.01, cellH))));

  const cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  const chosen = rng.shuffle(cells).slice(0, count);

  const slots = chosen.map(([c, r]) => ({
    azDeg: -f.azDeg + (c + 0.5) * cellW + rng.range(-jitterAz, jitterAz) * cellW,
    elDeg: -f.elDeg + (r + 0.5) * cellH + rng.range(-jitterEl, jitterEl) * cellH,
  }));

  relax(slots, f);

  return slots.map((s) => ({ ...s, position: shellPosition(s.azDeg, s.elDeg, f) }));
}

/** Push apart any pair closer than the minimum separation. */
function relax(slots: { azDeg: number; elDeg: number }[], f: ShellField, iterations = 16): void {
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]!;
        const b = slots[j]!;
        const sep = angularSeparation(a, b);
        if (sep >= f.minSepDeg) continue;
        moved = true;
        // Push along the az/el difference, scaled to close the deficit.
        const dAz = a.azDeg - b.azDeg;
        const dEl = a.elDeg - b.elDeg;
        const len = Math.hypot(dAz, dEl) || 0.001;
        const push = ((f.minSepDeg - sep) / 2) * 1.05;
        const ux = (dAz / len) * push;
        const uy = (dEl / len) * push;
        a.azDeg += ux; a.elDeg += uy;
        b.azDeg -= ux; b.elDeg -= uy;
      }
    }
    for (const s of slots) {
      s.azDeg = Math.max(-f.azDeg, Math.min(f.azDeg, s.azDeg));
      s.elDeg = Math.max(-f.elDeg, Math.min(f.elDeg, s.elDeg));
    }
    if (!moved) break;
  }
}

/** Field parameters scaled to the platform's actual viewport. */
export function fieldFor(
  platform: 'vr' | 'desktop' | 'mobile',
  preset: { vr: [number, number, number]; desktop: [number, number, number]; mobile: [number, number, number] },
  radius = 2.4,
  height = 1.6
): ShellField {
  const [azDeg, elDeg, minSepDeg] = preset[platform];
  return { azDeg, elDeg, minSepDeg, radius, height };
}
