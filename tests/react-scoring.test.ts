/**
 * REACT scoring. Feeds three synthetic participants - fast, average and
 * impaired - through the real finish() path and checks that the metrics and
 * the headline score order them the way they should be ordered.
 */
import { ReactModule } from '../packages/client/src/modules/react/ReactModule.js';
import type { ModuleContext } from '../packages/client/src/engine/task/Module.js';
import type { TrialRecord } from '@vrcap/shared';
import { Rng } from '@vrcap/shared';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};

function fakeCtx(): ModuleContext & { _metrics: Record<string, number>; _scores: Record<string, number> } {
  const metrics: Record<string, number> = {};
  const scores: Record<string, number> = {};
  const ctx = {
    platform: 'vr' as const,
    engine: { clock: { frameInterval: 11.1 }, device: { inputMode: 'controller' } },
    recorder: {
      trialNumber: 0,
      metric: (n: string, v: number) => { if (Number.isFinite(v)) metrics[n] = v; },
      score: (t: string, v: number) => { scores[t] = v; },
      trial: () => {},
      event: () => {},
    },
    rng: new Rng(1),
  } as unknown as ModuleContext;
  return Object.assign(ctx, { _metrics: metrics, _scores: scores });
}

interface Profile { name: string; simpleMean: number; simpleSd: number; lapseRate: number; choiceMean: number; choiceAcc: number; pointAcc: number; endpointErr: number; onTarget: number; asyncMs: number; }

function synth(p: Profile) {
  const rng = new Rng(42);
  const trials: TrialRecord[] = [];
  const gauss = (m: number, sd: number) => {
    const u = Math.max(1e-9, rng.next());
    const v = rng.next();
    return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const push = (block: string, rt: number | null, correct: boolean, outcome: TrialRecord['outcome'], response: Record<string, unknown> = {}, stimulus: Record<string, unknown> = {}) => {
    trials.push({
      trialNumber: trials.length + 1, block, stimulus, response: { ...response, rtMs: rt },
      correct, outcome, reactionTimeMs: rt, startedAt: 0, endedAt: rt ?? 0,
    });
  };

  for (let i = 0; i < 24; i++) {
    const lapse = rng.next() < p.lapseRate;
    const rt = Math.max(120, lapse ? gauss(p.simpleMean + 380, 120) : gauss(p.simpleMean, p.simpleSd));
    push('simple', rt, true, 'hit');
  }
  for (let i = 0; i < 28; i++) {
    const ok = rng.next() < p.choiceAcc;
    push('choice', Math.max(150, gauss(p.choiceMean, p.simpleSd * 1.3)), ok, ok ? 'hit' : 'false_alarm', { chosen: 'left' });
  }
  for (let i = 0; i < 20; i++) {
    const ok = rng.next() < p.pointAcc;
    const id = 2 + rng.next() * 3;
    push('point', Math.max(300, gauss(520 + id * 60, 90)), ok, ok ? 'hit' : 'false_alarm',
      { endpointErrorDeg: Math.abs(gauss(p.endpointErr, 0.6)), movementInitiationMs: gauss(230, 40), rayPathDeg: 40 + rng.next() * 25 },
      { amplitudeDeg: 30, widthDeg: 4.6, indexOfDifficulty: id });
  }
  for (let i = 0; i < 26; i++) {
    const ok = rng.next() < 0.94;
    const both = i % 5 === 0;
    push('twohand', Math.max(180, gauss(p.choiceMean, p.simpleSd)), ok, ok ? 'hit' : 'false_alarm',
      { chosen: both ? 'both' : i % 2 ? 'left' : 'right', ...(both ? { asynchronyMs: Math.abs(gauss(p.asyncMs, 25)) } : {}) });
  }
  return trials;
}

const profiles: Profile[] = [
  { name: 'gyors',   simpleMean: 265, simpleSd: 28,  lapseRate: 0.00, choiceMean: 360, choiceAcc: 0.98, pointAcc: 0.95, endpointErr: 0.9, onTarget: 0.88, asyncMs: 35 },
  { name: 'átlagos', simpleMean: 340, simpleSd: 55,  lapseRate: 0.06, choiceMean: 470, choiceAcc: 0.92, pointAcc: 0.85, endpointErr: 1.8, onTarget: 0.68, asyncMs: 90 },
  { name: 'lassú',   simpleMean: 470, simpleSd: 120, lapseRate: 0.25, choiceMean: 660, choiceAcc: 0.78, pointAcc: 0.62, endpointErr: 3.6, onTarget: 0.38, asyncMs: 210 },
];

console.log('REACT scoring');
const results: { name: string; ops: number; metrics: Record<string, number> }[] = [];

for (const p of profiles) {
  const mod = new ReactModule();
  const ctx = fakeCtx();
  // Inject synthetic data the way a real run would have accumulated it.
  (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
  (mod as unknown as { trials: TrialRecord[] }).trials = synth(p);
  (mod as unknown as { trackTrialStats: unknown[] }).trackTrialStats = [
    { rms: (1 - p.onTarget) * 9, onTarget: p.onTarget, lag: 120 + (1 - p.onTarget) * 260 },
    { rms: (1 - p.onTarget) * 10, onTarget: p.onTarget - 0.04, lag: 130 + (1 - p.onTarget) * 280 },
    { rms: (1 - p.onTarget) * 11, onTarget: p.onTarget - 0.08, lag: 140 + (1 - p.onTarget) * 300 },
  ];
  const res = mod.finish(ctx);
  results.push({ name: p.name, ops: res.opsScore, metrics: ctx._metrics });
  console.log(`  ${p.name.padEnd(8)} OPS=${String(res.opsScore).padStart(4)}  ` +
    `simpleRT=${Math.round(ctx._metrics.simple_rt_median!)}ms  ` +
    `lapses=${ctx._metrics.lapses}  choiceAcc=${(ctx._metrics.choice_accuracy! * 100).toFixed(0)}%  ` +
    `decisionCost=${Math.round(ctx._metrics.decision_cost!)}ms  onTarget=${(ctx._metrics.time_on_target! * 100).toFixed(0)}%`);
  check(`${p.name}: headline has 6 rows`, res.headline.length === 6, res.headline.length);
  check(`${p.name}: OPS in range`, res.opsScore >= 0 && res.opsScore <= 1000, res.opsScore);
  check(`${p.name}: every headline value is finite or an em dash`,
    res.headline.every((h) => h.value && !h.value.includes('NaN')), res.headline);
  check(`${p.name}: axis scores present`, !!res.axisScores && Object.keys(res.axisScores).length === 3);
}

check('fast scores above average', results[0]!.ops > results[1]!.ops, results.map(r => `${r.name}=${r.ops}`));
check('average scores above slow', results[1]!.ops > results[2]!.ops, results.map(r => `${r.name}=${r.ops}`));
check('fast and slow are well separated', results[0]!.ops - results[2]!.ops > 200, results[0]!.ops - results[2]!.ops);
check('decision cost is positive (choice slower than simple)',
  results.every((r) => r.metrics.decision_cost! > 0), results.map(r => r.metrics.decision_cost));
check('lapse count tracks the lapse rate',
  results[0]!.metrics.lapses! < results[2]!.metrics.lapses!, [results[0]!.metrics.lapses, results[2]!.metrics.lapses]);
check('fitts slope is positive (harder targets take longer)',
  results.every((r) => (r.metrics.fitts_slope ?? 0) > 0), results.map(r => r.metrics.fitts_slope));
check('speed-accuracy tradeoff metric is produced',
  results.every((r) => Number.isFinite(r.metrics.speed_accuracy_tradeoff!)));
check('all three produce >20 metrics',
  results.every((r) => Object.keys(r.metrics).length > 20), results.map(r => Object.keys(r.metrics).length));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
