import { Rng } from './rng.js';

/**
 * COMMAND (module 10) - the "GRID" team task.
 *
 * Abstract allocation problem on a small logistics graph. Every player sees the
 * same public board, but the board is partly WRONG, and each player privately
 * holds a couple of corrections that nobody else has. The optimal plan is only
 * reachable if the team pools its private facts - this is the classic hidden
 * profile paradigm, which is what makes information sharing directly measurable
 * in the outcome rather than only in the transcript.
 *
 * No military content is required: sites, units, tasks and resources are abstract.
 * The domain layer renames them (mission / delivery / relay leg).
 */

export type ResourceType = 'ALFA' | 'BRAVO' | 'CHARLIE';

export interface Site {
  id: string;          // S1..S6
  label: string;
  /** Table coordinates in metres, board is ~1.2 x 0.8 m. */
  x: number;
  z: number;
}

export interface Route {
  id: string;          // R1..
  a: string;           // site id
  b: string;           // site id
  /** Published travel cost. */
  cost: number;
}

export interface Unit {
  id: string;          // U1..U4
  label: string;
  siteId: string;
  /** Published resource type - may be wrong. */
  resource: ResourceType;
  /** Published capacity - may be wrong. */
  capacity: number;
}

export interface TaskTarget {
  id: string;          // T1..T4
  label: string;
  siteId: string;
  /** Published required resource - may be wrong. */
  requires: ResourceType;
  /** Published value - may be wrong. */
  value: number;
  /** Published demand (needs capacity >= demand) - may be wrong. */
  demand: number;
  /** Max travel cost that still counts as on time. */
  deadline: number;
}

/** A private correction held by exactly one player. */
export type FactKind =
  | 'route_closed'
  | 'route_cost'
  | 'site_hazard'
  | 'unit_resource'
  | 'unit_capacity'
  | 'task_value'
  | 'task_requires'
  | 'task_demand';

export interface Fact {
  id: string;
  kind: FactKind;
  /** Site / route / unit / task id the fact is about. */
  ref: string;
  /** Human readable statement (hu) shown on the private brief. */
  text: string;
  /** Machine readable correction applied when computing the true outcome. */
  patch: Record<string, number | string | boolean>;
  /** Seat that holds it. */
  seat: number;
}

export interface CommandScenario {
  seed: number;
  sites: Site[];
  routes: Route[];
  units: Unit[];
  tasks: TaskTarget[];
  /** Ground truth corrections. The server keeps these; clients only get their own. */
  facts: Fact[];
  /** Number of seats the scenario was generated for. */
  seats: number;
}

/** unitId -> taskId | null */
export type Assignment = Record<string, string | null>;

export interface PlanOutcome {
  /** Value actually achieved once every hidden correction is applied. */
  achievedValue: number;
  /** Best achievable value with full information. */
  optimalValue: number;
  /** achievedValue / optimalValue, 0..1 */
  optimality: number;
  /** Per unit explanation. */
  detail: {
    unitId: string;
    taskId: string | null;
    ok: boolean;
    reason: string;
    value: number;
    cost: number;
  }[];
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

const SITE_LABELS = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT'];
const RESOURCES: ResourceType[] = ['ALFA', 'BRAVO', 'CHARLIE'];

/** Single generation attempt. Callers use generateScenario, which validates. */
function generateRaw(seed: number, seats: number): CommandScenario {
  const rng = new Rng(seed);
  const nSites = 6;

  // Sites on a jittered ring so the graph is planar and readable from any seat.
  const sites: Site[] = [];
  for (let i = 0; i < nSites; i++) {
    const a = (i / nSites) * Math.PI * 2 + rng.range(-0.18, 0.18);
    const r = rng.range(0.30, 0.44);
    sites.push({
      id: `S${i + 1}`,
      label: SITE_LABELS[i]!,
      x: Math.cos(a) * r * 1.5,
      z: Math.sin(a) * r,
    });
  }

  // Ring routes guarantee connectivity, plus 2-3 chords for interesting choices.
  const routes: Route[] = [];
  let rid = 1;
  for (let i = 0; i < nSites; i++) {
    routes.push({
      id: `R${rid++}`,
      a: `S${i + 1}`,
      b: `S${((i + 1) % nSites) + 1}`,
      cost: rng.int(2, 5),
    });
  }
  const chordCount = 3;
  const usedChords = new Set<string>();
  for (let k = 0; k < chordCount; k++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const i = rng.int(0, nSites - 1);
      const j = (i + rng.int(2, nSites - 2)) % nSites;
      const key = [i, j].sort().join('-');
      if (i === j || usedChords.has(key)) continue;
      usedChords.add(key);
      routes.push({ id: `R${rid++}`, a: `S${i + 1}`, b: `S${j + 1}`, cost: rng.int(3, 7) });
      break;
    }
  }

  // Four units, spread over the board.
  const unitSites = rng.shuffle(sites.map((s) => s.id)).slice(0, 4);
  const units: Unit[] = unitSites.map((siteId, i) => ({
    id: `U${i + 1}`,
    label: `EGYSÉG ${i + 1}`,
    siteId,
    resource: rng.pick(RESOURCES),
    capacity: rng.int(2, 5),
  }));

  // Four tasks on the remaining / other sites.
  const taskSites = rng.shuffle(sites.map((s) => s.id)).slice(0, 4);
  const tasks: TaskTarget[] = taskSites.map((siteId, i) => ({
    id: `T${i + 1}`,
    label: `FELADAT ${i + 1}`,
    siteId,
    requires: rng.pick(RESOURCES),
    value: rng.int(2, 6) * 10,
    demand: rng.int(1, 4),
    deadline: rng.int(6, 12),
  }));

  // Make sure at least one clean solution exists before we start lying about it:
  // align unit 1 with task 1 and unit 2 with task 2.
  units[0]!.resource = tasks[0]!.requires;
  units[0]!.capacity = Math.max(units[0]!.capacity, tasks[0]!.demand);
  units[1]!.resource = tasks[1]!.requires;
  units[1]!.capacity = Math.max(units[1]!.capacity, tasks[1]!.demand);

  // ---- hidden facts -------------------------------------------------
  const facts: Fact[] = [];
  let fid = 1;
  const push = (seat: number, f: Omit<Fact, 'id' | 'seat'>) =>
    facts.push({ ...f, id: `F${fid++}`, seat });

  // A pool of candidate corrections; we deal them out round-robin to seats so
  // every player holds roughly the same amount of leverage.
  const candidates: Omit<Fact, 'id' | 'seat'>[] = [];

  // 1) a route is actually closed
  const closed = rng.pick(routes.slice(0, nSites));
  candidates.push({
    kind: 'route_closed',
    ref: closed.id,
    text: `A ${siteLabel(sites, closed.a)}-${siteLabel(sites, closed.b)} útvonal LEZÁRVA. A táblán még nyitottként szerepel.`,
    patch: { closed: true },
  });

  // 2) a route costs more than published
  const pricey = rng.pick(routes.filter((r) => r.id !== closed.id));
  const extra = rng.int(3, 6);
  candidates.push({
    kind: 'route_cost',
    ref: pricey.id,
    text: `A ${siteLabel(sites, pricey.a)}-${siteLabel(sites, pricey.b)} szakasz valós költsége ${pricey.cost + extra} (nem ${pricey.cost}).`,
    patch: { cost: pricey.cost + extra },
  });

  // 3) a unit carries a different resource
  const wrongUnit = rng.pick(units.slice(2));
  const realRes = rng.pick(RESOURCES.filter((r) => r !== wrongUnit.resource));
  candidates.push({
    kind: 'unit_resource',
    ref: wrongUnit.id,
    text: `${wrongUnit.label} valójában ${realRes} típusú készletet szállít, nem ${wrongUnit.resource}-t.`,
    patch: { resource: realRes },
  });

  // 4) a unit has less capacity
  const smallUnit = rng.pick(units);
  candidates.push({
    kind: 'unit_capacity',
    ref: smallUnit.id,
    text: `${smallUnit.label} kapacitása csak ${Math.max(1, smallUnit.capacity - 2)} (a tábla ${smallUnit.capacity}-t mutat).`,
    patch: { capacity: Math.max(1, smallUnit.capacity - 2) },
  });

  // 5) a task is worth much more than published
  const goldTask = rng.pick(tasks);
  candidates.push({
    kind: 'task_value',
    ref: goldTask.id,
    text: `${goldTask.label} valós értéke ${goldTask.value + 40} pont - a táblán alulértékelt.`,
    patch: { value: goldTask.value + 40 },
  });

  // 6) a task needs a different resource
  const wrongTask = rng.pick(tasks.filter((t) => t.id !== goldTask.id));
  const realReq = rng.pick(RESOURCES.filter((r) => r !== wrongTask.requires));
  candidates.push({
    kind: 'task_requires',
    ref: wrongTask.id,
    text: `${wrongTask.label} valójában ${realReq} készletet igényel, nem ${wrongTask.requires}-t.`,
    patch: { requires: realReq },
  });

  // 7) a site slows everything down
  const hazardSite = rng.pick(sites);
  candidates.push({
    kind: 'site_hazard',
    ref: hazardSite.id,
    text: `${hazardSite.label} körzetében akadály: minden áthaladás +3 költség.`,
    patch: { extraCost: 3 },
  });

  // 8) a task needs more than published
  const hungryTask = rng.pick(tasks);
  candidates.push({
    kind: 'task_demand',
    ref: hungryTask.id,
    text: `${hungryTask.label} tényleges igénye ${hungryTask.demand + 2} egység.`,
    patch: { demand: hungryTask.demand + 2 },
  });

  const dealt = rng.shuffle(candidates);
  // 2 facts per seat, capped by the pool.
  const perSeat = Math.min(2, Math.floor(dealt.length / Math.max(1, seats)));
  let idx = 0;
  for (let seat = 0; seat < seats; seat++) {
    for (let k = 0; k < perSeat && idx < dealt.length; k++) {
      push(seat, dealt[idx++]!);
    }
  }
  // Any leftovers go round-robin so no fact is wasted.
  let seat = 0;
  while (idx < dealt.length) {
    push(seat % seats, dealt[idx++]!);
    seat++;
  }

  return { seed, sites, routes, units, tasks, facts, seats };
}

function siteLabel(sites: Site[], id: string): string {
  return sites.find((s) => s.id === id)?.label ?? id;
}

/* ------------------------------------------------------------------ *
 * Truth resolution + scoring
 * ------------------------------------------------------------------ */

interface TrueWorld {
  routeCost: Map<string, number>;
  routeClosed: Set<string>;
  siteExtra: Map<string, number>;
  unitResource: Map<string, ResourceType>;
  unitCapacity: Map<string, number>;
  taskValue: Map<string, number>;
  taskRequires: Map<string, ResourceType>;
  taskDemand: Map<string, number>;
}

function buildTruth(sc: CommandScenario, facts: Fact[]): TrueWorld {
  const w: TrueWorld = {
    routeCost: new Map(sc.routes.map((r) => [r.id, r.cost])),
    routeClosed: new Set(),
    siteExtra: new Map(),
    unitResource: new Map(sc.units.map((u) => [u.id, u.resource])),
    unitCapacity: new Map(sc.units.map((u) => [u.id, u.capacity])),
    taskValue: new Map(sc.tasks.map((t) => [t.id, t.value])),
    taskRequires: new Map(sc.tasks.map((t) => [t.id, t.requires])),
    taskDemand: new Map(sc.tasks.map((t) => [t.id, t.demand])),
  };
  for (const f of facts) {
    switch (f.kind) {
      case 'route_closed': w.routeClosed.add(f.ref); break;
      case 'route_cost': w.routeCost.set(f.ref, Number(f.patch.cost)); break;
      case 'site_hazard': w.siteExtra.set(f.ref, Number(f.patch.extraCost)); break;
      case 'unit_resource': w.unitResource.set(f.ref, f.patch.resource as ResourceType); break;
      case 'unit_capacity': w.unitCapacity.set(f.ref, Number(f.patch.capacity)); break;
      case 'task_value': w.taskValue.set(f.ref, Number(f.patch.value)); break;
      case 'task_requires': w.taskRequires.set(f.ref, f.patch.requires as ResourceType); break;
      case 'task_demand': w.taskDemand.set(f.ref, Number(f.patch.demand)); break;
    }
  }
  return w;
}

/** Dijkstra over the true graph, including per-site hazard surcharges. */
function shortestCost(sc: CommandScenario, w: TrueWorld, from: string, to: string): number {
  const dist = new Map<string, number>(sc.sites.map((s) => [s.id, Infinity]));
  dist.set(from, w.siteExtra.get(from) ?? 0);
  const visited = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) { best = d; cur = id; }
    }
    if (cur === null) break;
    if (cur === to) return best;
    visited.add(cur);
    for (const r of sc.routes) {
      if (w.routeClosed.has(r.id)) continue;
      const other = r.a === cur ? r.b : r.b === cur ? r.a : null;
      if (!other || visited.has(other)) continue;
      const step = (w.routeCost.get(r.id) ?? r.cost) + (w.siteExtra.get(other) ?? 0);
      const nd = best + step;
      if (nd < (dist.get(other) ?? Infinity)) dist.set(other, nd);
    }
  }
  return Infinity;
}

/** Evaluate an assignment against the true world (all facts applied). */
export function evaluatePlan(
  sc: CommandScenario,
  assignment: Assignment,
  factsKnownToTruth: Fact[] = sc.facts
): Omit<PlanOutcome, 'optimalValue' | 'optimality'> {
  const w = buildTruth(sc, factsKnownToTruth);
  const detail: PlanOutcome['detail'] = [];
  const claimed = new Set<string>();
  let achieved = 0;

  for (const u of sc.units) {
    const taskId = assignment[u.id] ?? null;
    if (!taskId) {
      detail.push({ unitId: u.id, taskId: null, ok: false, reason: 'Nincs kiosztva', value: 0, cost: 0 });
      continue;
    }
    const t = sc.tasks.find((x) => x.id === taskId);
    if (!t) continue;
    if (claimed.has(taskId)) {
      detail.push({ unitId: u.id, taskId, ok: false, reason: 'A feladat már foglalt', value: 0, cost: 0 });
      continue;
    }
    const cost = shortestCost(sc, w, u.siteId, t.siteId);
    const res = w.unitResource.get(u.id)!;
    const req = w.taskRequires.get(t.id)!;
    const cap = w.unitCapacity.get(u.id)!;
    const dem = w.taskDemand.get(t.id)!;
    const val = w.taskValue.get(t.id)!;

    let reason = '';
    let ok = true;
    if (res !== req) { ok = false; reason = `Készlettípus nem egyezik (${res} ≠ ${req})`; }
    else if (cap < dem) { ok = false; reason = `Kapacitás kevés (${cap} < ${dem})`; }
    else if (!Number.isFinite(cost)) { ok = false; reason = 'Nincs járható útvonal'; }
    else if (cost > t.deadline) { ok = false; reason = `Késés (${cost} > ${t.deadline})`; }

    if (ok) { achieved += val; claimed.add(taskId); reason = 'Teljesítve'; }
    detail.push({ unitId: u.id, taskId, ok, reason, value: ok ? val : 0, cost: Number.isFinite(cost) ? cost : -1 });
  }
  return { achievedValue: achieved, detail };
}

/** Brute-force best plan with full information - the denominator of optimality. */
export function optimalPlan(sc: CommandScenario): { value: number; assignment: Assignment } {
  const units = sc.units.map((u) => u.id);
  const options: (string | null)[] = [null, ...sc.tasks.map((t) => t.id)];
  let bestValue = -1;
  let bestAssign: Assignment = {};

  const walk = (i: number, used: Set<string>, acc: Assignment) => {
    if (i === units.length) {
      const { achievedValue } = evaluatePlan(sc, acc);
      if (achievedValue > bestValue) { bestValue = achievedValue; bestAssign = { ...acc }; }
      return;
    }
    for (const opt of options) {
      if (opt && used.has(opt)) continue;
      acc[units[i]!] = opt;
      if (opt) used.add(opt);
      walk(i + 1, used, acc);
      if (opt) used.delete(opt);
    }
  };
  walk(0, new Set(), {});
  return { value: Math.max(0, bestValue), assignment: bestAssign };
}

export function scorePlan(sc: CommandScenario, assignment: Assignment): PlanOutcome {
  const { achievedValue, detail } = evaluatePlan(sc, assignment);
  const { value: optimalValue } = optimalPlan(sc);
  return {
    achievedValue,
    optimalValue,
    optimality: optimalValue > 0 ? achievedValue / optimalValue : 0,
    detail,
  };
}

/** What the board would look like to a player who only knows `facts`. */
export function publicScenario(sc: CommandScenario): Omit<CommandScenario, 'facts'> {
  const { facts: _facts, ...rest } = sc;
  return rest;
}


/* ------------------------------------------------------------------ *
 * Board-only baseline + validated generation
 * ------------------------------------------------------------------ */

/**
 * The best plan a team can build if nobody shares anything: optimise against
 * the published board (facts ignored), then live with the consequences in the
 * true world. This is the baseline the team has to beat, and the gap between
 * it and the true optimum is exactly the value of communication.
 */
export function boardOnlyPlan(sc: CommandScenario): { assignment: Assignment; achievedValue: number } {
  const naked: CommandScenario = { ...sc, facts: [] };
  const best = optimalPlan(naked);
  const { achievedValue } = evaluatePlan(sc, best.assignment);
  return { assignment: best.assignment, achievedValue };
}

/**
 * Deterministic, *validated* scenario for a given seat count.
 *
 * A generated board is only accepted when it is
 *   a) solvable to a decent value with full information, and
 *   b) genuinely penalised by not sharing - a team that plans off the printed
 *      board alone must lose a visible chunk of value.
 * Without (b) the exercise silently degrades into a solo puzzle and the
 * information-sharing metrics stop meaning anything.
 *
 * The same seed always yields the same accepted board, so a run can be
 * replayed and two teams can be given the identical problem.
 */
export function generateScenario(seed: number, seats: number): CommandScenario {
  const MIN_OPTIMAL = 90;
  const MAX_BOARD_ONLY_RATIO = 0.75;
  let fallback: CommandScenario | null = null;
  let fallbackScore = -1;

  for (let attempt = 0; attempt < 48; attempt++) {
    const sc = generateRaw((seed + attempt * 0x9e3779b1) >>> 0, seats);
    const opt = optimalPlan(sc).value;
    if (opt <= 0) continue;
    const board = boardOnlyPlan(sc).achievedValue;
    const ratio = board / opt;

    if (opt >= MIN_OPTIMAL && ratio <= MAX_BOARD_ONLY_RATIO) return sc;

    // Keep the most promising near-miss in case nothing fully qualifies.
    const quality = opt * (1 - Math.min(1, ratio));
    if (quality > fallbackScore) { fallbackScore = quality; fallback = sc; }
  }
  return fallback ?? generateRaw(seed, seats);
}

/** Diagnostics used by tests and the supervisor view. */
export function scenarioDifficulty(sc: CommandScenario): {
  optimal: number;
  boardOnly: number;
  informationGap: number;
} {
  const optimal = optimalPlan(sc).value;
  const boardOnly = boardOnlyPlan(sc).achievedValue;
  return { optimal, boardOnly, informationGap: optimal - boardOnly };
}
