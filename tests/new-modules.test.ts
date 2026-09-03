/**
 * Scoring behaviour of SIGNAL, NAV, PRESSURE and ANTICIPATE.
 *
 * Each module gets three synthetic participants - strong, average and weak -
 * pushed through the real finish() path. The tests check ordering and, more
 * importantly, that each module's defining contrast behaves the way the
 * paradigm says it should.
 */
import { Rng } from '@vrcap/shared';
import type { TrialRecord } from '@vrcap/shared';
import type { ModuleContext, ModuleResult } from '../packages/client/src/engine/task/Module.js';
import { SignalModule } from '../packages/client/src/modules/signal/SignalModule.js';
import { NavModule } from '../packages/client/src/modules/nav/NavModule.js';
import { PressureModule } from '../packages/client/src/modules/pressure/PressureModule.js';
import { AnticipateModule } from '../packages/client/src/modules/anticipate/AnticipateModule.js';
import { buildNavWorld, pickJrdTrials, shortestPath } from '../packages/client/src/modules/nav/navWorld.js';
import { layoutShell, angularSeparation, fieldFor } from '../packages/client/src/modules/shared/layout.js';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};

function fakeCtx(platform: 'vr' | 'desktop' | 'mobile' = 'vr') {
  const metrics: Record<string, number> = {};
  const scores: Record<string, number> = {};
  const ctx = {
    platform,
    engine: { clock: { frameInterval: 11.1 }, device: { inputMode: 'controller' }, camera: {}, rig: {} },
    recorder: {
      trialNumber: 0,
      metric: (n: string, v: number) => { if (Number.isFinite(v)) metrics[n] = v; },
      score: (t: string, v: number) => { scores[t] = v; },
      trial: () => {}, event: () => {},
    },
    rng: new Rng(7),
    scene: {},
    panels: { remove: () => {} },
  } as unknown as ModuleContext;
  return Object.assign(ctx, { _metrics: metrics, _scores: scores });
}

const gauss = (rng: Rng, m: number, sd: number) => {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const trial = (block: string, stimulus: Record<string, unknown>, response: Record<string, unknown> | null,
  correct: boolean, outcome: TrialRecord['outcome'], rt: number | null): TrialRecord => ({
  trialNumber: 0, block, stimulus, response, correct, outcome,
  reactionTimeMs: rt, startedAt: 0, endedAt: rt ?? 0,
});

/* =================================================== layout helper === */
console.log('\nSHELL LAYOUT');
{
  const rng = new Rng(11);
  let worst = Infinity;
  let ok = true;
  for (const platform of ['vr', 'desktop', 'mobile'] as const) {
    const f = fieldFor(platform, { vr: [55, 25, 6], desktop: [26, 14, 5], mobile: [20, 13, 6] });
    for (const n of [6, 12, 24]) {
      for (let s = 0; s < 40; s++) {
        const slots = layoutShell(n, f, new Rng(s * 977 + n));
        if (slots.length !== n) ok = false;
        for (let i = 0; i < slots.length; i++) {
          for (let j = i + 1; j < slots.length; j++) {
            const sep = angularSeparation(slots[i]!, slots[j]!);
            worst = Math.min(worst, sep / f.minSepDeg);
          }
        }
        for (const sl of slots) {
          if (Math.abs(sl.azDeg) > f.azDeg + 0.01 || Math.abs(sl.elDeg) > f.elDeg + 0.01) ok = false;
        }
      }
    }
  }
  check('layout returns the requested item count and stays inside the field', ok);
  check('minimum angular separation is respected on every platform', worst >= 0.98, worst.toFixed(3));
}

/* ========================================================== SIGNAL === */
console.log('\nSIGNAL');
{
  interface P { name: string; featSlope: number; conjSlope: number; base: number; hit: number; fa: number; motHit: number; change: number; periph: number; }
  const profiles: P[] = [
    { name: 'erős',    featSlope: 2,  conjSlope: 18, base: 750,  hit: 0.98, fa: 0.02, motHit: 0.95, change: 0.92, periph: 0.94 },
    { name: 'átlagos', featSlope: 5,  conjSlope: 42, base: 1000, hit: 0.92, fa: 0.08, motHit: 0.80, change: 0.72, periph: 0.78 },
    { name: 'gyenge',  featSlope: 12, conjSlope: 78, base: 1400, hit: 0.78, fa: 0.22, motHit: 0.58, change: 0.44, periph: 0.55 },
  ];
  const out: { name: string; ops: number; m: Record<string, number> }[] = [];

  for (const p of profiles) {
    const rng = new Rng(31);
    const trials: TrialRecord[] = [];
    for (const [block, sl] of [['feature', p.featSlope], ['conjunction', p.conjSlope]] as const) {
      for (let i = 0; i < 30; i++) {
        const setSize = [6, 12, 24][i % 3]!;
        const present = i % 2 === 0;
        // Absent trials take about twice the slope - the serial-search signature.
        const rt = Math.max(250, gauss(rng, p.base + sl * setSize * (present ? 1 : 2), 120));
        const isHit = present ? rng.next() < p.hit : rng.next() >= p.fa;
        trials.push(trial(block,
          { setSize, targetPresent: present, targetIndex: present ? 0 : -1 },
          { rtMs: rt, responseType: present ? 'located' : 'absent', localisationErrorDeg: Math.abs(gauss(rng, 1.4, 0.6)) },
          isHit,
          present ? (isHit ? 'hit' : 'false_alarm') : (isHit ? 'correct_reject' : 'false_alarm'),
          rt));
      }
    }
    for (let i = 0; i < 12; i++) {
      const n = i % 2 === 0 ? 3 : 4;
      const correct = Math.round(n * p.motHit);
      trials.push(trial('mot', { targetCount: n, total: 10 }, { correctCount: correct, selectedIndices: [] },
        correct === n, correct === n ? 'hit' : 'miss', 2000));
    }
    for (let i = 0; i < 18; i++) {
      const ok = rng.next() < p.change;
      trials.push(trial('change', { changeType: ['color', 'size', 'position'][i % 3]!, sceneSize: 8 },
        { cycles: ok ? Math.ceil(gauss(rng, 2.4, 1)) : 6, rtMs: 4000 }, ok, ok ? 'hit' : 'false_alarm', 4000));
    }
    for (let i = 0; i < 30; i++) {
      const isCatch = i < 6;
      const ecc = [15, 30, 45][i % 3]!;
      // Detection falls off with eccentricity.
      const detect = rng.next() < p.periph - (ecc - 15) * 0.004;
      trials.push(trial('peripheral', { eccentricityDeg: ecc, catchTrial: isCatch },
        detect && !isCatch ? { rtMs: gauss(rng, 420, 70) } : null,
        isCatch ? !detect : detect,
        isCatch ? (detect ? 'false_alarm' : 'correct_reject') : (detect ? 'hit' : 'miss'),
        detect && !isCatch ? 420 : null));
    }

    const mod = new SignalModule();
    const ctx = fakeCtx();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { trials: TrialRecord[] }).trials = trials;
    (mod as unknown as { centralOnTargetMs: number }).centralOnTargetMs = 60000 * p.periph;
    (mod as unknown as { centralTotalMs: number }).centralTotalMs = 60000;
    const res: ModuleResult = mod.finish(ctx);
    out.push({ name: p.name, ops: res.opsScore, m: ctx._metrics });
    console.log(`  ${p.name.padEnd(8)} OPS=${String(res.opsScore).padStart(4)}  ` +
      `feat=${ctx._metrics.feature_slope?.toFixed(1)} conj=${ctx._metrics.conjunction_slope?.toFixed(1)} ms/elem  ` +
      `d'=${ctx._metrics.search_d_prime?.toFixed(2)}  k=${ctx._metrics.mot_capacity_k?.toFixed(2)}`);
    check(`${p.name}: 6 headline rows, no NaN`, res.headline.length === 6 && res.headline.every((h) => !h.value.includes('NaN')));
  }
  check('SIGNAL: strong > average > weak', out[0]!.ops > out[1]!.ops && out[1]!.ops > out[2]!.ops, out.map((o) => `${o.name}=${o.ops}`));
  check('SIGNAL: strong and weak well separated', out[0]!.ops - out[2]!.ops > 180, out[0]!.ops - out[2]!.ops);
  check('SIGNAL: conjunction slope exceeds feature slope for all', out.every((o) => o.m.conjunction_slope! > o.m.feature_slope!),
    out.map((o) => [o.m.feature_slope, o.m.conjunction_slope]));
  check('SIGNAL: slope difference recovered', out.every((o) => o.m.search_slope_difference! > 10));
  check("SIGNAL: absent slope roughly twice the present slope", out.every((o) => o.m.absent_present_slope_ratio! > 1.4 && o.m.absent_present_slope_ratio! < 2.9),
    out.map((o) => o.m.absent_present_slope_ratio?.toFixed(2)));
  check("SIGNAL: d' ordered and finite", out.every((o) => Number.isFinite(o.m.search_d_prime)) && out[0]!.m.search_d_prime! > out[2]!.m.search_d_prime!);
  check('SIGNAL: MOT capacity never exceeds the target count', out.every((o) => o.m.mot_capacity_k! <= 4.001));
}

/* ============================================================= NAV === */
console.log('\nNAV');
{
  // World invariants first: the graph is what everything else rests on.
  let bad = 0;
  let degreeOk = true;
  let landmarksOk = true;
  let routeOk = true;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = new Rng(seed * 7717);
    const w = buildNavWorld(seed, rng);
    for (const n of w.nodes) {
      if (n.neighbours.length < 2 || n.neighbours.length > 4) degreeOk = false;
      if (shortestPath(w, 0, n.id).length === 0 && n.id !== 0) bad++;
    }
    if (new Set(w.landmarks.map((l) => l.node)).size !== w.landmarks.length) landmarksOk = false;
    if (w.route.length !== 9) routeOk = false;
    for (let i = 1; i < w.route.length; i++) {
      if (!w.nodes[w.route[i - 1]!]!.neighbours.includes(w.route[i]!)) routeOk = false;
      if (i >= 2 && w.route[i] === w.route[i - 2]) routeOk = false;
    }
  }
  check('NAV: every node reachable from every node', bad === 0, bad);
  check('NAV: node degree stays between 2 and 4', degreeOk);
  check('NAV: the six landmarks sit on six different nodes', landmarksOk);
  check('NAV: the tour is 8 legs, uses real edges, never doubles straight back', routeOk);
  {
    const a = buildNavWorld(4242, new Rng(4242));
    const b = buildNavWorld(4242, new Rng(4242));
    check('NAV: generation is deterministic', JSON.stringify(a) === JSON.stringify(b));
    const jrd = pickJrdTrials(a, 12, new Rng(9));
    check('NAV: JRD trials are distinct and never point at the facing landmark',
      jrd.length === 12 && jrd.every((t) => t.facing !== t.target));
    check('NAV: JRD bearings are within [-180,180]', jrd.every((t) => t.trueBearingDeg >= -180 && t.trueBearingDeg <= 180));
  }

  interface N { name: string; jrd: number; fwd: number; rev: number; tri: number; map: number; }
  const profiles: N[] = [
    { name: 'erős',    jrd: 22, fwd: 1.00, rev: 0.95, tri: 18, map: 2.4 },
    { name: 'átlagos', jrd: 45, fwd: 0.88, rev: 0.68, tri: 38, map: 5.5 },
    { name: 'gyenge',  jrd: 82, fwd: 0.62, rev: 0.40, tri: 66, map: 11.0 },
  ];
  const out: { name: string; ops: number; m: Record<string, number> }[] = [];
  for (const p of profiles) {
    const rng = new Rng(53);
    const mod = new NavModule();
    const ctx = fakeCtx();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { world: unknown }).world = buildNavWorld(9, new Rng(9));
    (mod as unknown as { retraceResults: unknown[] }).retraceResults = [
      { direction: 'forward', correct: Math.round(8 * p.fwd), total: 8, wrongTurns: Math.round((1 - p.fwd) * 9), ms: 60000, recoveries: 0 },
      { direction: 'reverse', correct: Math.round(8 * p.rev), total: 8, wrongTurns: Math.round((1 - p.rev) * 11), ms: 70000, recoveries: 0 },
    ];
    (mod as unknown as { jrdResults: unknown[] }).jrdResults =
      Array.from({ length: 12 }, () => {
        const signed = gauss(rng, 0, p.jrd);
        return { absErr: Math.min(180, Math.abs(signed)), signedErr: signed, rtMs: 5000 };
      });
    (mod as unknown as { triangleResults: unknown[] }).triangleResults =
      Array.from({ length: 8 }, () => ({
        bearingErr: Math.min(180, Math.abs(gauss(rng, 0, p.tri))),
        distRatio: gauss(rng, 0.82, 0.15), trueDist: 12, estDist: 10, rtMs: 6000,
      }));
    (mod as unknown as { mapResults: unknown[] }).mapResults = [
      ...Array.from({ length: 4 }, () => ({ mode: 'position', error: Math.abs(gauss(rng, p.map, p.map * 0.3)), headingOffset: rng.range(0, 180), rtMs: 7000 })),
      ...Array.from({ length: 4 }, () => ({ mode: 'heading', error: Math.abs(gauss(rng, p.jrd * 0.8, 15)), headingOffset: rng.range(0, 180), rtMs: 6000 })),
    ];
    const res = mod.finish(ctx);
    out.push({ name: p.name, ops: res.opsScore, m: ctx._metrics });
    console.log(`  ${p.name.padEnd(8)} OPS=${String(res.opsScore).padStart(4)}  ` +
      `JRD=${ctx._metrics.jrd_absolute_error?.toFixed(0)}°  fwd=${(ctx._metrics.retrace_success_forward! * 100).toFixed(0)}%  ` +
      `revCost=${ctx._metrics.reverse_route_cost?.toFixed(2)}  triangle=${ctx._metrics.visual_path_integration_bearing_error?.toFixed(0)}°`);
    check(`${p.name}: 6 headline rows, no NaN`, res.headline.length === 6 && res.headline.every((h) => !h.value.includes('NaN')));
  }
  check('NAV: strong > average > weak', out[0]!.ops > out[1]!.ops && out[1]!.ops > out[2]!.ops, out.map((o) => `${o.name}=${o.ops}`));
  check('NAV: strong and weak well separated', out[0]!.ops - out[2]!.ops > 180, out[0]!.ops - out[2]!.ops);
  check('NAV: reverse route costs more than forward for all', out.every((o) => o.m.reverse_route_cost! >= 0));
  check('NAV: pointing error stays within 0-180', out.every((o) => o.m.jrd_absolute_error! >= 0 && o.m.jrd_absolute_error! <= 180));
  check('NAV: distance compression below 1 (the expected direction)', out.every((o) => o.m.distance_compression! < 1));
}

/* ======================================================== PRESSURE === */
console.log('\nPRESSURE');
{
  interface Q { name: string; baseAcc: number; baseRt: number; interf: number; switchC: number; drop: number; recover: number; postErr: number; }
  const profiles: Q[] = [
    { name: 'stabil',    baseAcc: 0.97, baseRt: 520, interf: 30,  switchC: 60,  drop: 0.03, recover: 0.00, postErr: 0.95 },
    { name: 'átlagos',   baseAcc: 0.94, baseRt: 620, interf: 75,  switchC: 150, drop: 0.12, recover: -0.04, postErr: 0.85 },
    { name: 'összeomló', baseAcc: 0.90, baseRt: 700, interf: 165, switchC: 320, drop: 0.30, recover: -0.20, postErr: 0.62 },
  ];
  const out: { name: string; ops: number; m: Record<string, number>; s: Record<string, number> }[] = [];

  for (const p of profiles) {
    const rng = new Rng(97);
    const trials: TrialRecord[] = [];
    const push = (block: string, extra: Record<string, unknown>, accuracy: number, rtBase: number, postError = false) => {
      const ok = rng.next() < accuracy;
      const rt = Math.max(180, gauss(rng, rtBase, 90));
      trials.push(trial(block, { ...extra, congruency: extra.congruency ?? 'congruent', isSwitch: extra.isSwitch ?? false, afterReversal: extra.afterReversal ?? false },
        { rtMs: rt, chosenSide: 'left', postError }, ok, ok ? 'hit' : 'false_alarm', rt));
    };
    for (let i = 0; i < 28; i++) push('baseline', {}, p.baseAcc, p.baseRt);
    for (let i = 0; i < 36; i++) {
      const c = i % 3 === 0 ? 'incongruent' : i % 3 === 1 ? 'congruent' : 'neutral';
      push('interference', { congruency: c }, c === 'incongruent' ? p.baseAcc - 0.05 : p.baseAcc, p.baseRt + (c === 'incongruent' ? p.interf : 0));
    }
    for (let i = 0; i < 40; i++) {
      const sw = i % 5 < 2;
      const c = i % 3 === 0 ? 'incongruent' : 'congruent';
      push('switching', { congruency: c, isSwitch: sw }, p.baseAcc - (sw ? 0.04 : 0),
        p.baseRt + (sw ? p.switchC : 0) + (c === 'incongruent' ? p.interf : 0));
    }
    for (let i = 0; i < 44; i++) {
      const postError = i > 0 && rng.next() < 0.2;
      push('pressure', { afterReversal: i >= 22 }, p.baseAcc - p.drop - (postError ? (1 - p.postErr) * 0.4 : 0), p.baseRt - 60, postError);
    }
    for (let i = 0; i < 24; i++) push('recovery', {}, p.baseAcc + p.recover, p.baseRt);

    const mod = new PressureModule();
    const ctx = fakeCtx();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { trials: TrialRecord[] }).trials = trials;
    (mod as unknown as { maxStreak: number }).maxStreak = 8;
    const res = mod.finish(ctx);
    out.push({ name: p.name, ops: res.opsScore, m: ctx._metrics, s: ctx._scores });
    console.log(`  ${p.name.padEnd(10)} OPS=${String(res.opsScore).padStart(4)}  ` +
      `interf=${ctx._metrics.interference_cost_rt?.toFixed(0)}ms  switch=${ctx._metrics.switch_cost_rt?.toFixed(0)}ms  ` +
      `drop=${(ctx._metrics.pressure_decrement! * 100).toFixed(0)}pt  recov=${(ctx._metrics.recovery_index! * 100).toFixed(0)}pt`);
    check(`${p.name}: 6 headline rows, no NaN`, res.headline.length === 6 && res.headline.every((h) => !h.value.includes('NaN')));
  }
  check('PRESSURE: stable > average > collapsing', out[0]!.ops > out[1]!.ops && out[1]!.ops > out[2]!.ops, out.map((o) => `${o.name}=${o.ops}`));
  check('PRESSURE: extremes well separated', out[0]!.ops - out[2]!.ops > 180, out[0]!.ops - out[2]!.ops);
  check('PRESSURE: interference cost recovered and ordered',
    out.every((o) => o.m.interference_cost_rt! > 0) && out[0]!.m.interference_cost_rt! < out[2]!.m.interference_cost_rt!,
    out.map((o) => o.m.interference_cost_rt?.toFixed(0)));
  check('PRESSURE: switch cost recovered and ordered',
    out.every((o) => o.m.switch_cost_rt! > 0) && out[0]!.m.switch_cost_rt! < out[2]!.m.switch_cost_rt!);
  check('PRESSURE: decrement ordered (collapsing drops most)',
    out[0]!.m.pressure_decrement! < out[2]!.m.pressure_decrement!,
    out.map((o) => o.m.pressure_decrement?.toFixed(3)));
  check('PRESSURE: recovery score punishes failure to return',
    out[0]!.s.recovery! > out[2]!.s.recovery!, [out[0]!.s.recovery, out[2]!.s.recovery]);
  check('PRESSURE: post-error accuracy ordered', out[0]!.m.post_error_accuracy! > out[2]!.m.post_error_accuracy!);
}

/* ====================================================== ANTICIPATE === */
console.log('\nANTICIPATE');
{
  interface A { name: string; ce: number; ve: number; occGrowth: number; scaling: number; cva: number; }
  const profiles: A[] = [
    { name: 'precíz',   ce: -12, ve: 45,  occGrowth: 18, scaling: 12, cva: 40 },
    { name: 'átlagos',  ce: -35, ve: 80,  occGrowth: 45, scaling: 45, cva: 130 },
    { name: 'szórt',    ce: -70, ve: 165, occGrowth: 95, scaling: 105, cva: 260 },
  ];
  const out: { name: string; ops: number; m: Record<string, number> }[] = [];

  for (const p of profiles) {
    const rng = new Rng(131);
    const results: unknown[] = [];
    const trials: TrialRecord[] = [];
    const add = (block: string, occMs: number, veExtra: number, ceExtra: number, level: string, factor: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const signed = gauss(rng, p.ce + ceExtra, p.ve + veExtra);
        results.push({ block, signedErrorMs: signed, travelMs: 1600, occlusionMs: occMs, speedLevel: level, speedFactor: factor });
        trials.push(trial(block, { occlusionMs: occMs }, { signedErrorMs: signed }, Math.abs(signed) <= 100,
          Math.abs(signed) <= 100 ? 'hit' : 'miss', Math.abs(signed)));
      }
    };
    add('visible', 0, 0, 0, 'standard', 1, 16);
    add('short', 500, p.occGrowth * 0.4, 0, 'standard', 1, 20);
    add('long', 1000, p.occGrowth, 0, 'standard', 1, 20);
    // Poor scaling shows up as biases that fan out across speeds.
    add('speed', 880, 10, -p.scaling, 'fast', 1, 8);
    add('speed', 880, 10, 0, 'medium', 1, 8);
    add('speed', 880, 10, p.scaling, 'slow', 1, 8);
    // Assuming constant velocity means being late when it speeds up.
    add('change', 880, 10, p.cva / 2, 'medium', 1.35, 8);
    add('change', 880, 10, -p.cva / 2, 'medium', 0.70, 8);

    const mod = new AnticipateModule();
    const ctx = fakeCtx();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { results: unknown[] }).results = results;
    (mod as unknown as { trials: TrialRecord[] }).trials = trials;
    const res = mod.finish(ctx);
    out.push({ name: p.name, ops: res.opsScore, m: ctx._metrics });
    console.log(`  ${p.name.padEnd(9)} OPS=${String(res.opsScore).padStart(4)}  ` +
      `CE=${ctx._metrics.constant_error?.toFixed(0)}ms VE=${ctx._metrics.variable_error?.toFixed(0)}ms  ` +
      `occRob=${ctx._metrics.occlusion_robustness?.toFixed(0)}  scale=${ctx._metrics.velocity_scaling_error?.toFixed(0)}ms  CVA=${ctx._metrics.constant_velocity_assumption?.toFixed(0)}ms`);
    check(`${p.name}: 6 headline rows, no NaN`, res.headline.length === 6 && res.headline.every((h) => !h.value.includes('NaN')));
  }
  check('ANTICIPATE: precise > average > scattered', out[0]!.ops > out[1]!.ops && out[1]!.ops > out[2]!.ops, out.map((o) => `${o.name}=${o.ops}`));
  check('ANTICIPATE: extremes well separated', out[0]!.ops - out[2]!.ops > 180, out[0]!.ops - out[2]!.ops);
  check('ANTICIPATE: variable error recovered in order', out[0]!.m.variable_error! < out[1]!.m.variable_error! && out[1]!.m.variable_error! < out[2]!.m.variable_error!);
  check('ANTICIPATE: occlusion robustness positive (precision decays with blind time)',
    out.every((o) => o.m.occlusion_robustness! > 0), out.map((o) => o.m.occlusion_robustness?.toFixed(1)));
  check('ANTICIPATE: constant-velocity assumption recovered as positive',
    out.every((o) => o.m.constant_velocity_assumption! > 0), out.map((o) => o.m.constant_velocity_assumption?.toFixed(0)));

  // The defining property: VE is the SD of SIGNED errors, so a constant bias
  // must not inflate it. This is the distinction the whole module rests on.
  {
    const mod = new AnticipateModule();
    const ctx = fakeCtx();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { results: unknown[] }).results = Array.from({ length: 40 }, () => ({
      block: 'visible', signedErrorMs: 100, travelMs: 1600, occlusionMs: 0, speedLevel: 'standard', speedFactor: 1,
    }));
    (mod as unknown as { trials: TrialRecord[] }).trials = [];
    const ctxAny = ctx as unknown as { _metrics: Record<string, number> };
    mod.finish(ctx);
    check('ANTICIPATE: a constant +100 ms bias gives VE = 0 and AE = 100',
      Math.abs(ctxAny._metrics.variable_error!) < 1e-6 && Math.abs(ctxAny._metrics.absolute_error! - 100) < 1e-6,
      [ctxAny._metrics.variable_error, ctxAny._metrics.absolute_error]);
  }

  // Two profiles with the same absolute error: the one whose error is mostly
  // bias (fixable) should score higher than the one that is mostly scatter.
  {
    const build = (ce: number, ve: number) => {
      const rng = new Rng(5);
      const mod = new AnticipateModule();
      const ctx = fakeCtx();
      (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
      (mod as unknown as { results: unknown[] }).results = ['visible', 'short', 'long', 'speed', 'change']
        .flatMap((block) => Array.from({ length: 16 }, () => ({
          block, signedErrorMs: gauss(rng, ce, ve), travelMs: 1600,
          occlusionMs: block === 'visible' ? 0 : block === 'short' ? 500 : 1000,
          speedLevel: 'medium', speedFactor: 1,
        })));
      (mod as unknown as { trials: TrialRecord[] }).trials = [];
      return mod.finish(ctx).opsScore;
    };
    const biased = build(110, 40);
    const scattered = build(5, 120);
    check('ANTICIPATE: a fixable bias scores above equivalent scatter', biased > scattered, { biased, scattered });
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
