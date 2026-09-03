import type { Rng } from '@vrcap/shared';

/**
 * Procedural navigation world.
 *
 * A node graph rather than open terrain, for two reasons. First, comfort:
 * free continuous steering is the main cause of VR sickness, and a participant
 * who feels ill also performs worse - which would be recorded as poor spatial
 * ability. Second, measurement: with discrete decision points, "wrong turn"
 * is an unambiguous event rather than a judgement about a wandering path.
 *
 * Everything here is seeded, so a run can be replayed exactly, and a retest
 * can be given a genuinely different world.
 */

export interface NavNode {
  id: number;
  x: number;
  z: number;
  neighbours: number[];
}

export interface NavLandmark {
  id: number;
  name: string;
  /** Node it stands beside. */
  node: number;
  x: number;
  z: number;
  kind: 'pillar' | 'gate' | 'cone' | 'tower' | 'ring' | 'slab';
  color: number;
}

export interface NavWorld {
  seed: number;
  nodes: NavNode[];
  edges: [number, number][];
  landmarks: NavLandmark[];
  /** The tour route: a sequence of node ids, length routeLength + 1. */
  route: number[];
  extent: { x: number; z: number };
}

const LANDMARK_DEFS: { name: string; kind: NavLandmark['kind']; color: number }[] = [
  { name: 'FEHÉR OSZLOP', kind: 'pillar', color: 0xe8eef5 },
  { name: 'KÉK KAPU', kind: 'gate', color: 0x4fc3f7 },
  { name: 'ZÖLD KÚP', kind: 'cone', color: 0x7cf59a },
  { name: 'PIROS TORONY', kind: 'tower', color: 0xff5c7a },
  { name: 'SÁRGA GYŰRŰ', kind: 'ring', color: 0xffd166 },
  { name: 'LILA HASÁB', kind: 'slab', color: 0xc6a0ff },
];

export interface NavWorldOptions {
  cols?: number;
  rows?: number;
  spacingX?: number;
  spacingZ?: number;
  jitter?: number;
  routeLength?: number;
  landmarkCount?: number;
}

export function buildNavWorld(seed: number, rng: Rng, opts: NavWorldOptions = {}): NavWorld {
  const cols = opts.cols ?? 4;
  const rows = opts.rows ?? 3;
  const spacingX = opts.spacingX ?? 19;
  const spacingZ = opts.spacingZ ?? 16;
  const jitter = opts.jitter ?? 4;
  const routeLength = opts.routeLength ?? 8;
  const landmarkCount = opts.landmarkCount ?? 6;

  /* ---- nodes on a jittered grid ---------------------------------- */
  const nodes: NavNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        id: nodes.length,
        x: (c - (cols - 1) / 2) * spacingX + rng.range(-jitter, jitter),
        z: (r - (rows - 1) / 2) * spacingZ + rng.range(-jitter, jitter),
        neighbours: [],
      });
    }
  }
  const idx = (c: number, r: number) => r * cols + c;

  /* ---- candidate edges from grid adjacency ----------------------- */
  const candidates: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) candidates.push([idx(c, r), idx(c + 1, r)]);
      if (r + 1 < rows) candidates.push([idx(c, r), idx(c, r + 1)]);
    }
  }

  // Start fully connected on the grid, then prune. Pruning (rather than
  // growing) makes it easy to keep the two invariants that matter: the graph
  // stays connected, and no node drops below two exits - a dead end would turn
  // a wrong turn into a forced backtrack and pollute the route metrics.
  let edges = [...candidates];
  const degree = () => {
    const d = new Array(nodes.length).fill(0);
    for (const [a, b] of edges) { d[a]++; d[b]++; }
    return d;
  };
  const connected = (test: [number, number][]) => {
    const adj = new Map<number, number[]>();
    for (const [a, b] of test) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    return seen.size === nodes.length;
  };

  const targetEdges = Math.max(nodes.length, Math.round(nodes.length * 1.35));
  for (const e of rng.shuffle([...edges])) {
    if (edges.length <= targetEdges) break;
    const d = degree();
    if (d[e[0]]! <= 2 || d[e[1]]! <= 2) continue;
    const without = edges.filter((x) => !(x[0] === e[0] && x[1] === e[1]));
    if (!connected(without)) continue;
    edges = without;
  }

  for (const [a, b] of edges) {
    nodes[a]!.neighbours.push(b);
    nodes[b]!.neighbours.push(a);
  }

  /* ---- landmarks, spread as far apart as possible ---------------- */
  // Greedy farthest-point selection: clustered landmarks would make several
  // judgement-of-relative-direction trials nearly identical.
  const chosen: number[] = [rng.int(0, nodes.length - 1)];
  while (chosen.length < landmarkCount) {
    let best = -1;
    let bestDist = -1;
    for (const n of nodes) {
      if (chosen.includes(n.id)) continue;
      const d = Math.min(...chosen.map((c) => dist(nodes[c]!, n)));
      if (d > bestDist) { bestDist = d; best = n.id; }
    }
    chosen.push(best);
  }

  const landmarks: NavLandmark[] = chosen.map((nodeId, i) => {
    const n = nodes[nodeId]!;
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(5, 8);
    const def = LANDMARK_DEFS[i % LANDMARK_DEFS.length]!;
    return {
      id: i,
      name: def.name,
      kind: def.kind,
      color: def.color,
      node: nodeId,
      x: n.x + Math.cos(a) * r,
      z: n.z + Math.sin(a) * r,
    };
  });

  /* ---- tour route ------------------------------------------------ */
  // A walk that never immediately doubles back, and prefers nodes it has not
  // visited, so the tour covers the graph rather than oscillating.
  const route: number[] = [chosen[0]!];
  const visited = new Set<number>(route);
  let previous = -1;
  for (let i = 0; i < routeLength; i++) {
    const current = route[route.length - 1]!;
    const options = nodes[current]!.neighbours.filter((n) => n !== previous);
    const pool = options.length ? options : nodes[current]!.neighbours;
    const fresh = pool.filter((n) => !visited.has(n));
    const next = fresh.length ? rng.pick(fresh) : rng.pick(pool);
    previous = current;
    route.push(next);
    visited.add(next);
  }

  return {
    seed,
    nodes,
    edges,
    landmarks,
    route,
    extent: { x: ((cols - 1) / 2) * spacingX + jitter, z: ((rows - 1) / 2) * spacingZ + jitter },
  };
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** World-space bearing from one point to another, degrees, 0 = -Z, clockwise. */
export function bearingDeg(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
}

export function distanceBetween(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return dist(a, b);
}

/** Shortest path in edge count, used for the optimal-route ratio. */
export function shortestPath(world: NavWorld, from: number, to: number): number[] {
  const prev = new Map<number, number>();
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === to) break;
    for (const m of world.nodes[n]!.neighbours) {
      if (seen.has(m)) continue;
      seen.add(m);
      prev.set(m, n);
      queue.push(m);
    }
  }
  if (!seen.has(to)) return [];
  const path = [to];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (p === undefined) return [];
    path.unshift(p);
    cur = p;
  }
  return path;
}

/**
 * Pick judgement-of-relative-direction triples.
 * The target must be far enough away that it could never simply be seen, and
 * the three landmarks must be distinct, or the trial answers itself.
 */
export function pickJrdTrials(
  world: NavWorld,
  count: number,
  rng: Rng,
  minTargetDistance = 26
): { standNode: number; facing: number; target: number; trueBearingDeg: number }[] {
  const out: { standNode: number; facing: number; target: number; trueBearingDeg: number }[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < count * 80) {
    const standNode = rng.int(0, world.nodes.length - 1);
    const node = world.nodes[standNode]!;
    const facing = rng.pick(world.landmarks);
    const target = rng.pick(world.landmarks.filter((l) => l.id !== facing.id));
    if (!target) continue;
    if (distanceBetween(node, target) < minTargetDistance) continue;
    if (distanceBetween(node, facing) < 8) continue;
    const key = `${standNode}:${facing.id}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ standNode, facing: facing.id, target: target.id, trueBearingDeg: bearingDeg(node, target) });
  }
  // If the graph is too small to satisfy the distance rule, relax it rather
  // than returning fewer trials than the block promised.
  while (out.length < count) {
    const standNode = rng.int(0, world.nodes.length - 1);
    const facing = rng.pick(world.landmarks);
    const target = rng.pick(world.landmarks.filter((l) => l.id !== facing.id));
    if (!target) break;
    out.push({
      standNode, facing: facing.id, target: target.id,
      trueBearingDeg: bearingDeg(world.nodes[standNode]!, target),
    });
  }
  return out;
}
