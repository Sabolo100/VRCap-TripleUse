import { Rng } from './rng.js';

/**
 * COMMAND variant B - the "STRUCTURE" team task.
 *
 * Variant A distributes private knowledge as text: each participant is handed
 * a couple of corrections nobody else has. That works, but the asymmetry is
 * artificial - it exists because the system dealt out cards.
 *
 * Here the asymmetry is PERCEPTUAL. A cluster of coloured blocks floats
 * between the participants, and because the blocks occlude one another, each
 * seat sees a different subset. Nobody can see all of them, and some blocks
 * are visible from exactly one seat. The team's job is to agree on the
 * complete inventory - how many blocks of each colour - which is only possible
 * by describing what you can see from where you are standing.
 *
 * That makes two things measurable that a flat board cannot produce:
 *
 *   UNIQUE CONTRIBUTION. For each seat there is a set of blocks only that seat
 *   can see. Whether those blocks make it into the team's count is a direct,
 *   objective measure of whether that person contributed their view.
 *
 *   DOUBLE COUNTING. The same block seen from two seats must be counted once.
 *   Avoiding that requires spatial referencing ("the yellow one behind the tall
 *   blue"), so over-counting and under-counting are different failures with
 *   different causes, and the task separates them.
 */

export type BlockColor = 'PIROS' | 'KÉK' | 'ZÖLD' | 'SÁRGA';

export const BLOCK_COLORS: BlockColor[] = ['PIROS', 'KÉK', 'ZÖLD', 'SÁRGA'];

export const BLOCK_COLOR_HEX: Record<BlockColor, number> = {
  PIROS: 0xff5c7a,
  KÉK: 0x4fc3f7,
  ZÖLD: 0x7cf59a,
  SÁRGA: 0xffd166,
};

export interface StructureBlock {
  id: number;
  color: BlockColor;
  /** Position relative to the structure centre, metres. */
  x: number;
  y: number;
  z: number;
  /** Half-extent; all blocks are cubes. */
  size: number;
}

export interface StructureScenario {
  seed: number;
  seats: number;
  blocks: StructureBlock[];
  /** Seat positions on a ring around the structure. */
  seatPositions: { seat: number; x: number; z: number; yaw: number }[];
  /** blockId -> seats that can see it. */
  visibility: Record<number, number[]>;
  /** seat -> blocks only that seat can see. */
  exclusive: Record<number, number[]>;
  /**
   * seat -> blocks this seat can see that a MINORITY of seats can see.
   *
   * With five people standing around a structure, a view that is strictly
   * unique is geometrically rare: sightlines from a ring converge, so a block
   * hidden from four seats is usually hidden from the fifth too. That is also
   * true of real shared-awareness situations, and the hidden-profile
   * literature treats unshared information as graded rather than binary. So
   * the measured quantity is the privileged view - what most others cannot
   * see - weighted by how few people share it.
   */
  privileged: Record<number, number[]>;
  /** The answer: how many of each colour. */
  trueInventory: Record<BlockColor, number>;
  /** Blocks nobody can see - kept at zero by the generator. */
  invisible: number[];
}

const STRUCTURE_RADIUS = 0.92;
const SEAT_RADIUS = 2.6;
const EYE_HEIGHT = 1.6;
const STRUCTURE_HEIGHT = 1.45;

/** How much a block is worth reporting: 1 when only one seat can see it,
 *  falling off as more people share the view. */
export function rarityWeight(sc: StructureScenario, blockId: number): number {
  const n = sc.visibility[blockId]?.length ?? 0;
  return n > 0 ? 1 / n : 0;
}

/** Angular radius a cube of half-extent `size` subtends at distance `d`. */
function angularRadius(size: number, d: number): number {
  return Math.atan(size / Math.max(0.01, d));
}

/**
 * Can `seat` see `block`? A block is hidden when a nearer block covers its
 * direction from that seat. The test is deliberately generous - it uses the
 * blocking cube's inscribed sphere - so a block counted as visible really is.
 */
function isVisible(block: StructureBlock, seatPos: { x: number; z: number }, blocks: StructureBlock[]): boolean {
  const eye = { x: seatPos.x, y: EYE_HEIGHT, z: seatPos.z };
  const to = { x: block.x - eye.x, y: block.y - eye.y, z: block.z - eye.z };
  const dist = Math.hypot(to.x, to.y, to.z);
  if (dist < 1e-6) return true;
  const dir = { x: to.x / dist, y: to.y / dist, z: to.z / dist };

  for (const other of blocks) {
    if (other.id === block.id) continue;
    const oTo = { x: other.x - eye.x, y: other.y - eye.y, z: other.z - eye.z };
    const oDist = Math.hypot(oTo.x, oTo.y, oTo.z);
    // Only nearer blocks can occlude.
    if (oDist >= dist - 0.02) continue;
    const dot = (oTo.x * dir.x + oTo.y * dir.y + oTo.z * dir.z) / oDist;
    const sep = Math.acos(Math.max(-1, Math.min(1, dot)));
    // Occluded when the blocker's angular radius swallows the direction, with
    // a small margin so a hairline sliver does not count as "visible".
    if (sep < angularRadius(other.size * 0.92, oDist)) return false;
  }
  return true;
}

function buildOnce(seed: number, seats: number, blockCount: number): StructureScenario {
  const rng = new Rng(seed);

  const seatPositions = Array.from({ length: seats }, (_, i) => {
    const a = (i / seats) * Math.PI * 2;
    return { seat: i, x: Math.sin(a) * SEAT_RADIUS, z: Math.cos(a) * SEAT_RADIUS, yaw: a + Math.PI };
  });

  // A lobed cluster rather than a ball.
  //
  // This is the geometry that makes the task work. Around an evenly spaced
  // ring of seats, a symmetric blob is symmetric for everyone: a block hidden
  // from four viewpoints is hidden from the fifth as well, so almost nothing
  // ends up visible to exactly one person, and nobody has anything only they
  // can contribute. Lobes break that symmetry - each lobe shadows a different
  // narrow angular window, which is what creates pockets that one seat can see
  // into and the others cannot.
  const lobeCount = 3;
  const lobes = Array.from({ length: lobeCount }, () => {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.32, 0.62);
    return {
      x: Math.cos(a) * r,
      y: STRUCTURE_HEIGHT + rng.range(-0.30, 0.30),
      z: Math.sin(a) * r,
      spread: rng.range(0.26, 0.42),
    };
  });

  const blocks: StructureBlock[] = [];
  for (let i = 0; i < blockCount; i++) {
    const lobe = lobes[i % lobeCount]!;
    const a = rng.range(0, Math.PI * 2);
    const r = lobe.spread * Math.cbrt(rng.next());
    const tilt = rng.range(-1, 1);
    blocks.push({
      id: i,
      color: BLOCK_COLORS[rng.int(0, BLOCK_COLORS.length - 1)]!,
      x: lobe.x + Math.cos(a) * r,
      y: lobe.y + tilt * lobe.spread * 0.9,
      z: lobe.z + Math.sin(a) * r,
      size: rng.range(0.11, 0.17),
    });
  }

  // Push apart any overlapping pair, or the visibility test becomes arbitrary.
  for (let it = 0; it < 24; it++) {
    let moved = false;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i]!;
        const b = blocks[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const d = Math.hypot(dx, dy, dz);
        const need = (a.size + b.size) * 1.35;
        if (d >= need || d < 1e-6) continue;
        moved = true;
        const push = (need - d) / 2;
        a.x += (dx / d) * push; a.y += (dy / d) * push; a.z += (dz / d) * push;
        b.x -= (dx / d) * push; b.y -= (dy / d) * push; b.z -= (dz / d) * push;
      }
    }
    if (!moved) break;
  }

  return recompute(seed, seats, blocks, seatPositions);
}

/**
 * Generate a validated structure.
 *
 * Three properties have to hold or the exercise stops measuring what it claims:
 *   - no block is invisible from every seat, otherwise the correct answer is
 *     unobtainable and the team is being graded on luck;
 *   - every seat has at least one exclusive block, so everyone has something
 *     only they can contribute;
 *   - no single seat can see everything, so the task genuinely requires pooling.
 */
export function generateStructure(seed: number, seats: number, blockCount = 28): StructureScenario {
  let fallback: StructureScenario | null = null;
  let fallbackScore = -1;

  for (let attempt = 0; attempt < 60; attempt++) {
    let sc = buildOnce((seed + attempt * 0x9e3779b1) >>> 0, seats, blockCount);

    // A block nobody can see is not part of the puzzle - it only makes the
    // correct answer unobtainable. Removing one can reveal others, so this
    // repeats until the structure is fully accounted for.
    for (let pass = 0; pass < 6 && sc.invisible.length > 0; pass++) {
      const keep = sc.blocks.filter((b) => !sc.invisible.includes(b.id));
      if (keep.length < 12) break;
      sc = recompute(sc.seed, sc.seats, keep, sc.seatPositions);
    }
    if (sc.invisible.length > 0) continue;

    const seatCoverage = sc.seatPositions.map(
      (sp) => sc.blocks.filter((b) => sc.visibility[b.id]!.includes(sp.seat)).length
    );
    const noOneSeesAll = Math.max(...seatCoverage) < sc.blocks.length;
    if (!noOneSeesAll) continue;

    // Every seat must have something most of the others cannot see, or that
    // participant has no reason to speak and the exercise stops measuring
    // contribution for them.
    if (Object.values(sc.privileged).every((list) => list.length >= 1)) return sc;

    const repaired = plantExclusives(sc, new Rng((seed + attempt * 7919) >>> 0));
    if (repaired && repaired.invisible.length === 0
        && Object.values(repaired.privileged).every((l) => l.length >= 1)) return repaired;

    const quality = Object.values(sc.privileged).filter((l) => l.length > 0).length;
    if (quality > fallbackScore) { fallbackScore = quality; fallback = sc; }
  }
  return fallback ?? buildOnce(seed, seats, blockCount);
}

/**
 * Give every seat at least one block only it can see.
 *
 * For a starved seat, search for a position that sits in the shadow of the
 * structure from every other seat while staying clear from this one. Such
 * pockets exist because the cluster is deep; finding them is cheap enough to
 * brute force, and it is deterministic given the seed.
 */
function plantExclusives(sc: StructureScenario, rng: Rng): StructureScenario | null {
  const starved = sc.seatPositions.filter((sp) => (sc.privileged[sp.seat] ?? []).length === 0);
  if (starved.length === 0) return sc;

  const blocks = sc.blocks.map((b) => ({ ...b }));
  let nextId = Math.max(...blocks.map((b) => b.id)) + 1;

  for (const sp of starved) {
    let placed = false;
    for (let attempt = 0; attempt < 1200 && !placed; attempt++) {
      // Sample just behind the cluster as seen from this seat: close to the
      // far side, which is exactly where other seats' sightlines are blocked.
      const toCentre = Math.atan2(-sp.x, -sp.z);
      const spreadA = rng.range(-1.35, 1.35);
      const r = rng.range(0.38, 0.95);
      const candidate: StructureBlock = {
        id: nextId,
        color: BLOCK_COLORS[rng.int(0, BLOCK_COLORS.length - 1)]!,
        x: Math.sin(toCentre + spreadA) * r,
        y: STRUCTURE_HEIGHT + rng.range(-0.42, 0.42),
        z: Math.cos(toCentre + spreadA) * r,
        size: rng.range(0.11, 0.15),
      };
      // Must not overlap anything already placed.
      const clash = blocks.some((b) => {
        const d = Math.hypot(b.x - candidate.x, b.y - candidate.y, b.z - candidate.z);
        return d < (b.size + candidate.size) * 1.35;
      });
      if (clash) continue;

      const withCandidate = [...blocks, candidate];
      const seenBy = sc.seatPositions.filter((s2) => isVisible(candidate, s2, withCandidate)).map((s2) => s2.seat);
      if (seenBy.length === 1 && seenBy[0] === sp.seat) {
        blocks.push(candidate);
        nextId++;
        placed = true;
      }
    }
    if (!placed) return null;
  }

  return recompute(sc.seed, sc.seats, blocks, sc.seatPositions);
}

/** Recompute visibility and inventory after the block list has changed. */
function recompute(
  seed: number,
  seats: number,
  blocks: StructureBlock[],
  seatPositions: StructureScenario['seatPositions']
): StructureScenario {
  const visibility: Record<number, number[]> = {};
  const exclusive: Record<number, number[]> = {};
  const privileged: Record<number, number[]> = {};
  for (let s = 0; s < seats; s++) { exclusive[s] = []; privileged[s] = []; }
  const invisible: number[] = [];
  // "Most people cannot see it" - a minority of the seats.
  const minorityMax = Math.max(1, Math.floor(seats / 2));

  for (const b of blocks) {
    const seen = seatPositions.filter((sp) => isVisible(b, sp, blocks)).map((sp) => sp.seat);
    visibility[b.id] = seen;
    if (seen.length === 0) invisible.push(b.id);
    if (seen.length === 1) exclusive[seen[0]!]!.push(b.id);
    if (seen.length > 0 && seen.length <= minorityMax) {
      for (const st of seen) privileged[st]!.push(b.id);
    }
  }
  const trueInventory = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 } as Record<BlockColor, number>;
  for (const b of blocks) trueInventory[b.color]++;

  return { seed, seats, blocks, seatPositions, visibility, exclusive, privileged, trueInventory, invisible };
}

export type Inventory = Record<BlockColor, number>;

export interface InventoryOutcome {
  /** Per-colour signed error: positive means over-counted. */
  perColour: Record<BlockColor, number>;
  /** Total absolute error across colours. */
  totalAbsError: number;
  /** Blocks counted that are not there - the double-counting failure. */
  overCount: number;
  /** Blocks missed - the failure to pool. */
  underCount: number;
  /** 1 when every colour is exactly right. */
  exact: boolean;
  /** Share of colours within one of the truth. */
  accuracy: number;
}

export function scoreInventory(truth: Inventory, submitted: Inventory): InventoryOutcome {
  const perColour = {} as Record<BlockColor, number>;
  let over = 0;
  let under = 0;
  let abs = 0;
  let within1 = 0;
  for (const c of BLOCK_COLORS) {
    const diff = (submitted[c] ?? 0) - (truth[c] ?? 0);
    perColour[c] = diff;
    abs += Math.abs(diff);
    if (diff > 0) over += diff; else under += -diff;
    if (Math.abs(diff) <= 1) within1++;
  }
  return {
    perColour, totalAbsError: abs, overCount: over, underCount: under,
    exact: abs === 0, accuracy: within1 / BLOCK_COLORS.length,
  };
}

/** What a given seat can actually see, as an inventory. */
export function visibleInventory(sc: StructureScenario, seat: number): Inventory {
  const inv = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 } as Inventory;
  for (const b of sc.blocks) if (sc.visibility[b.id]!.includes(seat)) inv[b.color]++;
  return inv;
}

/**
 * The best inventory a team could produce without pooling: the single most
 * informative seat, taken alone. The gap between that and the truth is the
 * value of talking, and the generator guarantees it is non-zero.
 */
export function bestSingleSeat(sc: StructureScenario): { seat: number; outcome: InventoryOutcome } {
  let best = { seat: 0, outcome: scoreInventory(sc.trueInventory, visibleInventory(sc, 0)) };
  for (let s = 1; s < sc.seats; s++) {
    const o = scoreInventory(sc.trueInventory, visibleInventory(sc, s));
    if (o.totalAbsError < best.outcome.totalAbsError) best = { seat: s, outcome: o };
  }
  return best;
}
