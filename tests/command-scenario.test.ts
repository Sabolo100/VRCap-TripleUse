/**
 * COMMAND scenario generation and scoring.
 *
 * The property that matters is not "does it produce a board" but "is the board
 * worth talking about": every generated scenario must be solvable, and a team
 * that plans off the printed board alone must lose real value. If that gap
 * ever closes, the exercise silently stops measuring information sharing.
 */
import {
  generateScenario, optimalPlan, boardOnlyPlan, scorePlan, evaluatePlan, scenarioDifficulty,
} from '@vrcap/shared';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};

console.log('COMMAND scenario');

const ratios: number[] = [];
const optima: number[] = [];
let unsolvable = 0;
let factCounts: number[] = [];

for (let seed = 1; seed <= 120; seed++) {
  for (const seats of [2, 3, 4, 5]) {
    const sc = generateScenario(seed * 2654435761, seats);
    const d = scenarioDifficulty(sc);
    if (d.optimal <= 0) unsolvable++;
    optima.push(d.optimal);
    ratios.push(d.boardOnly / Math.max(1, d.optimal));
    factCounts.push(sc.facts.length);

    if (seed === 1 && seats === 4) {
      check('every seat holds at least one fact',
        [0, 1, 2, 3].every((s) => sc.facts.some((f) => f.seat === s)),
        sc.facts.map((f) => f.seat));
      check('units and tasks are generated', sc.units.length === 4 && sc.tasks.length === 4);
      check('graph is connected enough to plan', sc.routes.length >= 6, sc.routes.length);
    }
  }
}

check('no unsolvable scenario', unsolvable === 0, unsolvable);
check('board-only planning always loses value', Math.max(...ratios) <= 0.85, Math.max(...ratios).toFixed(3));
check('mean information gap is substantial', 1 - avg(ratios) > 0.4, (1 - avg(ratios)).toFixed(3));
check('scenarios have facts to share', Math.min(...factCounts) >= 4, Math.min(...factCounts));
console.log(`  mean optimal=${avg(optima).toFixed(1)}  mean board-only ratio=${avg(ratios).toFixed(3)}  worst=${Math.max(...ratios).toFixed(3)}`);

// Determinism: the same seed must reproduce the same board exactly, or a run
// cannot be replayed and two teams cannot be given the same problem.
{
  const a = generateScenario(123456, 4);
  const b = generateScenario(123456, 4);
  check('generation is deterministic', JSON.stringify(a) === JSON.stringify(b));
}

// Scoring behaviour.
{
  const sc = generateScenario(987654321, 4);
  const opt = optimalPlan(sc);
  const scored = scorePlan(sc, opt.assignment);
  check('optimal plan scores 100% optimality', Math.abs(scored.optimality - 1) < 1e-9, scored.optimality);
  check('optimal plan detail marks successes', scored.detail.some((d) => d.ok));

  const empty = scorePlan(sc, Object.fromEntries(sc.units.map((u) => [u.id, null])));
  check('empty plan scores zero', empty.achievedValue === 0, empty.achievedValue);
  check('empty plan optimality is zero', empty.optimality === 0, empty.optimality);

  // Two units on the same task: the second must be rejected, not double counted.
  const dup: Record<string, string | null> = {};
  const target = sc.tasks[0]!.id;
  sc.units.forEach((u, i) => { dup[u.id] = i < 2 ? target : null; });
  const dupScore = evaluatePlan(sc, dup);
  const claimed = dupScore.detail.filter((d) => d.ok).length;
  check('a task can only be claimed once', claimed <= 1, dupScore.detail);

  const board = boardOnlyPlan(sc);
  check('board-only plan is valid but weaker', board.achievedValue <= opt.value, [board.achievedValue, opt.value]);
}

function avg(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
