/**
 * WATCH, HOLD and MEMORY - the three modules built around the fact that the
 * display is a volume rather than a surface.
 *
 * Besides the usual ordering checks, these tests verify the properties that
 * only exist because the task is spatial: that the emitter lattice really
 * surrounds the participant, that scan shrinkage is penalised independently of
 * detection rate, that the stop-signal staircase yields an interpretable SSRT,
 * and that spatial updating cost is separable from raw span.
 */
import { Rng } from '@vrcap/shared';
import type { TrialRecord } from '@vrcap/shared';
import type { ModuleContext } from '../packages/client/src/engine/task/Module.js';
import { WatchModule } from '../packages/client/src/modules/watch/WatchModule.js';
import { HoldModule } from '../packages/client/src/modules/hold/HoldModule.js';
import { MemoryModule } from '../packages/client/src/modules/memory/MemoryModule.js';
import { layoutVolume, angularSep, viewRelation, volumePosition, wrapDeg, volumeFor } from '../packages/client/src/modules/shared/volume.js';
import * as THREE from 'three';

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
    rng: new Rng(3),
    scene: {},
    panels: { remove: () => {} },
    theme: { accent: '#ff9e1b', accent2: '#4fc3f7', ok: '#4ade80' },
  } as unknown as ModuleContext;
  return Object.assign(ctx, { _metrics: metrics, _scores: scores });
}

const gauss = (rng: Rng, m: number, sd: number) => {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ================================================== volume layer === */
console.log('\nVOLUME LAYER');
{
  const f = volumeFor('vr', {
    vr: { azDeg: 180, elMinDeg: -16, elMaxDeg: 26, rNear: 3.2, rFar: 8.5, minSepDeg: 9 },
    desktop: { azDeg: 26, elMinDeg: -11, elMaxDeg: 13, rNear: 4, rFar: 5.2, minSepDeg: 7 },
    mobile: { azDeg: 20, elMinDeg: -10, elMaxDeg: 12, rNear: 4, rFar: 5, minSepDeg: 7 },
  });
  let worstSep = Infinity;
  let sectorsOk = true;
  let depthSpread = 0;
  for (let seed = 0; seed < 60; seed++) {
    const slots = layoutVolume(32, f, new Rng(seed * 8191 + 1));
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        worstSep = Math.min(worstSep, angularSep(slots[i]!, slots[j]!) / f.minSepDeg);
      }
    }
    // Every 45 degree sector must contain at least two emitters, or "behind
    // you" is not reliably populated and rear detection is untestable.
    const sectors = new Array(8).fill(0);
    for (const s of slots) sectors[Math.floor(((wrapDeg(s.azDeg) + 180) / 360) * 8) % 8]++;
    if (sectors.some((c) => c < 2)) sectorsOk = false;
    depthSpread += Math.max(...slots.map((s) => s.radius)) - Math.min(...slots.map((s) => s.radius));
  }
  check('surround: minimum angular separation holds', worstSep >= 0.98, worstSep.toFixed(3));
  check('surround: every 45 degree sector has at least two emitters', sectorsOk);
  check('surround: emitters genuinely spread in depth', depthSpread / 60 > 3.5, (depthSpread / 60).toFixed(2));

  // Angular size compensation: a far emitter must not simply be smaller.
  const slots = layoutVolume(12, f, new Rng(5));
  const angSizes = slots.map((s) => 2 * Math.atan((0.17 * s.depthScale) / (2 * s.radius)) * 180 / Math.PI);
  const spread = Math.max(...angSizes) - Math.min(...angSizes);
  check('surround: angular size is constant across depth', spread < 0.2, spread.toFixed(4));

  // viewRelation: something directly behind must register as behind.
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 1.6, 0);
  cam.updateMatrixWorld(true);
  const behind = viewRelation(cam, volumePosition(175, 0, 5, 1.6));
  const ahead = viewRelation(cam, volumePosition(3, 0, 5, 1.6));
  check('viewRelation: an object at 175 degrees reads as behind', behind.behind && !ahead.behind,
    [behind.eccentricityDeg.toFixed(1), ahead.eccentricityDeg.toFixed(1)]);
}

/* ========================================================= WATCH === */
console.log('\nWATCH');
{
  interface W { name: string; hit0: number; decay: number; fa: number; cov0: number; shrink: number; rearPenalty: number; }
  const profiles: W[] = [
    { name: 'éber',    hit0: 0.94, decay: 0.02, fa: 1,  cov0: 20, shrink: 0.95, rearPenalty: 0.05 },
    { name: 'átlagos', hit0: 0.86, decay: 0.09, fa: 4,  cov0: 16, shrink: 0.72, rearPenalty: 0.18 },
    { name: 'lejtő',   hit0: 0.74, decay: 0.20, fa: 11, cov0: 12, shrink: 0.42, rearPenalty: 0.34 },
  ];
  const out: { name: string; ops: number; m: Record<string, number>; s: Record<string, number> }[] = [];

  // Deterministic cells rather than sampling. A four-minute watch block yields
  // only ~17 scored events, so a random fixture cannot resolve effects of 0.05
  // and would test the sampler rather than the aggregation. Here each cell gets
  // an exact hit count, so the recovered metrics are checkable by hand.
  const buildWatch = (p: W, ctx: ReturnType<typeof fakeCtx>) => {
    const events: unknown[] = [];
    const cell = (block: string, third: number, behind: boolean, far: boolean, n: number) => {
      let rate = block === 'calibration' ? p.hit0 + 0.03 : p.hit0 - p.decay * third;
      if (behind) rate -= p.rearPenalty;
      if (far) rate -= 0.06;
      rate = Math.max(0.02, Math.min(1, rate));
      for (let i = 0; i < n; i++) {
        events.push({
          type: ['skip', 'double', 'hue', 'drift', 'audio'][i % 5],
          emitterIndex: i, onsetT: events.length * 12000,
          eccentricityDeg: behind ? 140 : 40, behind, third,
          detected: (i + 0.5) / n < rate,
          rtMs: 900 + third * 60, block, radius: far ? 7.2 : 4.1,
        });
      }
    };
    for (const block of ['calibration', 'watchA', 'watchB']) {
      for (const third of [0, 1, 2]) {
        cell(block, third, false, false, 8);
        cell(block, third, false, true, 8);
        cell(block, third, true, false, 4);
        cell(block, third, true, true, 4);
      }
    }
    const bins = [0, 1, 2].map((third) => {
      const visited = Math.round(p.cov0 * (third === 0 ? 1 : third === 1 ? (1 + p.shrink) / 2 : p.shrink));
      const b = new Array(24).fill(0);
      for (let i = 0; i < Math.min(24, visited); i++) b[i] = 40;
      return b;
    });
    const mod = new WatchModule();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { events: unknown[] }).events = events;
    (mod as unknown as { falseAlarms: unknown[] }).falseAlarms =
      Array.from({ length: p.fa }, (_, i) => ({ t: i * 1000, sinceLastEventMs: 6000 }));
    (mod as unknown as { yawBins: number[][] }).yawBins = bins;
    (mod as unknown as { yawSamples: number[][] }).yawSamples =
      bins.map((b) => b.flatMap((c, i) => Array.from({ length: Math.round(c / 4) }, () => -180 + i * 15)));
    (mod as unknown as { yawTravelDeg: number }).yawTravelDeg = p.cov0 * 400;
    (mod as unknown as { field: unknown }).field = { rNear: 3.2, rFar: 8.5 };
    return mod;
  };

  for (const p of profiles) {
    const ctx = fakeCtx('vr');
    const res = buildWatch(p, ctx).finish(ctx);
    out.push({ name: p.name, ops: res.opsScore, m: ctx._metrics, s: ctx._scores });
    console.log(`  ${p.name.padEnd(8)} OPS=${String(res.opsScore).padStart(4)}  ` +
      `d'=${ctx._metrics.d_prime?.toFixed(2)}  lejtés=${ctx._metrics.vigilance_decrement_hitrate?.toFixed(3)}  ` +
      `lefedettség=${ctx._metrics.head_scan_range?.toFixed(0)}°  shrink=${ctx._metrics.scan_shrinkage?.toFixed(2)}  ` +
      `hátsó=${(ctx._metrics.rear_hit_rate! * 100).toFixed(0)}%`);
    check(`${p.name}: headline rows present, no NaN`, res.headline.length === 6 && res.headline.every((h) => !h.value.includes('NaN')));
  }
  check('WATCH: alert > average > declining', out[0]!.ops > out[1]!.ops && out[1]!.ops > out[2]!.ops, out.map((o) => `${o.name}=${o.ops}`));
  check('WATCH: extremes well separated', out[0]!.ops - out[2]!.ops > 180, out[0]!.ops - out[2]!.ops);
  check('WATCH: decrement is negative and ordered',
    out.every((o) => o.m.vigilance_decrement_hitrate! <= 0) && out[0]!.m.vigilance_decrement_hitrate! > out[2]!.m.vigilance_decrement_hitrate!);
  check('WATCH: rear detection is worse than front for all',
    out.every((o) => o.m.rear_hit_rate! < o.m.front_hit_rate!), out.map((o) => [o.m.rear_hit_rate, o.m.front_hit_rate]));
  check('WATCH: depth cost recovered (near easier than far)',
    out.every((o) => o.m.depth_cost! > 0), out.map((o) => o.m.depth_cost?.toFixed(3)));
  check('WATCH: scan shrinkage ordered', out[0]!.m.scan_shrinkage! > out[2]!.m.scan_shrinkage!);

  // The point of the spatial measure: two participants with the SAME overall
  // hit rate should be separated by whether their supervised sector held up.
  {
    const wide: W = { name: 'stabil', hit0: 0.86, decay: 0.09, fa: 4, cov0: 18, shrink: 0.95, rearPenalty: 0.18 };
    const narrow: W = { ...wide, name: 'szűkülő', shrink: 0.40 };
    const a = fakeCtx('vr'); const ra = buildWatch(wide, a).finish(a);
    const b = fakeCtx('vr'); const rb = buildWatch(narrow, b).finish(b);
    check('WATCH: identical detection, shrinking coverage scores lower',
      ra.opsScore > rb.opsScore && Math.abs(a._metrics.hit_rate! - b._metrics.hit_rate!) < 1e-9,
      { stabil: ra.opsScore, szukulo: rb.opsScore, hitA: a._metrics.hit_rate, hitB: b._metrics.hit_rate });
  }

  // On a flat screen the spatial components must be dropped, not faked.
  {
    const ctx = fakeCtx('desktop');
    const res = buildWatch(profiles[1]!, ctx).finish(ctx);
    check('WATCH: flat platform omits spatial metrics',
      ctx._metrics.scan_shrinkage === undefined && ctx._metrics.rear_hit_rate === undefined,
      Object.keys(ctx._metrics).filter((k) => k.includes('scan') || k.includes('rear')));
    check('WATCH: flat platform result says spatial metrics need VR',
      res.headline.some((h) => h.value.includes('VR')));
    check('WATCH: flat platform still scores the temporal measures',
      Number.isFinite(ctx._metrics.d_prime!) && Number.isFinite(ctx._metrics.vigilance_decrement_hitrate!));
  }
}

/* ========================================================== HOLD === */
console.log('\nHOLD');
{
  interface H { name: string; goRt: number; commission: number; ssrt: number; traj: number; ruleCost: number; commit: number; }
  const profiles: H[] = [
    { name: 'fegyelmezett', goRt: 480, commission: 0.05, ssrt: 195, traj: 0.90, ruleCost: 0.08, commit: 0.72 },
    { name: 'átlagos',      goRt: 570, commission: 0.16, ssrt: 265, traj: 0.76, ruleCost: 0.20, commit: 0.55 },
    { name: 'impulzív',     goRt: 640, commission: 0.38, ssrt: 380, traj: 0.60, ruleCost: 0.40, commit: 0.34 },
  ];
  const out: { name: string; ops: number; m: Record<string, number> }[] = [];

  const buildHold = (p: H, ctx: ReturnType<typeof fakeCtx>) => {
    const rng = new Rng(29);
    const records: unknown[] = [];
    // go / no-go
    for (let i = 0; i < 60; i++) {
      const isGo = i < 43;
      const type = isGo ? 'go' : (i % 2 === 0 ? 'nogo_red' : 'nogo_blue');
      const responded = isGo ? rng.next() > 0.02 : rng.next() < p.commission * (type === 'nogo_red' ? 1.3 : 0.7);
      const rt = responded ? Math.max(180, gauss(rng, p.goRt, 90)) : null;
      records.push({
        block: 'gonogo', type, responded, rtMs: rt, fraction: clampf(gauss(rng, p.commit, 0.12)),
        ssdMs: null, stopFired: false, correct: responded === isGo, afterReversal: false, travelMs: 2400,
      });
    }
    // stop-signal: simulate the staircase converging near 0.5
    let ssd = 250;
    for (let i = 0; i < 56; i++) {
      const isStop = i % 4 === 0;
      // Race model: a response escapes if the go process finishes before ssd + ssrt.
      const goRt = Math.max(180, gauss(rng, p.goRt, 90));
      if (isStop) {
        const responded = goRt < ssd + p.ssrt;
        records.push({
          block: 'stop', type: 'stop', responded, rtMs: responded ? goRt : null,
          fraction: clampf(goRt / 2400), ssdMs: ssd, stopFired: true,
          correct: !responded, afterReversal: false, travelMs: 2400,
        });
        ssd = Math.max(50, Math.min(1200, ssd + (responded ? -50 : 50)));
      } else {
        records.push({
          block: 'stop', type: 'go', responded: true, rtMs: goRt,
          fraction: clampf(goRt / 2400), ssdMs: null, stopFired: false,
          correct: true, afterReversal: false, travelMs: 2400,
        });
      }
    }
    // trajectory
    for (let i = 0; i < 36; i++) {
      const collision = i < 18;
      const responded = collision ? rng.next() < p.traj : rng.next() > p.traj;
      records.push({
        block: 'trajectory', type: collision ? 'hit_path' : 'miss_path', responded,
        rtMs: responded ? gauss(rng, p.goRt + 120, 100) : null, fraction: clampf(gauss(rng, p.commit, 0.12)),
        ssdMs: null, stopFired: false, correct: responded === collision, afterReversal: false, travelMs: 2400,
      });
    }
    // reversal
    for (let i = 0; i < 40; i++) {
      const after = i >= 20;
      const accuracy = after && i < 25 ? 1 - p.ruleCost - 0.1 : 0.92;
      const correct = rng.next() < accuracy;
      records.push({
        block: 'reversal', type: i % 4 === 0 ? 'nogo_red' : 'go', responded: correct ? i % 4 !== 0 : i % 4 === 0,
        rtMs: gauss(rng, p.goRt, 90), fraction: clampf(gauss(rng, p.commit, 0.12)),
        ssdMs: null, stopFired: false, correct, afterReversal: after, travelMs: 2400,
      });
    }
    const mod = new HoldModule();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { records: unknown[] }).records = records;
    (mod as unknown as { trials: TrialRecord[] }).trials = [];
    (mod as unknown as { ssdHistory: number[] }).ssdHistory =
      (records as { stopFired: boolean; ssdMs: number | null }[])
        .filter((x) => x.stopFired && x.ssdMs !== null).map((x) => x.ssdMs!);
    (mod as unknown as { headTrackSamples: number[] }).headTrackSamples = [12, 15, 11, 9];
    return mod;
  };

  for (const p of profiles) {
    const ctx = fakeCtx('vr');
    const res = buildHold(p, ctx).finish(ctx);
    out.push({ name: p.name, ops: res.opsScore, m: ctx._metrics });
    console.log(`  ${p.name.padEnd(13)} OPS=${String(res.opsScore).padStart(4)}  ` +
      `commission=${(ctx._metrics.commission_error_rate! * 100).toFixed(0)}%  SSRT=${ctx._metrics.ssrt?.toFixed(0)}ms  ` +
      `p(resp|sig)=${ctx._metrics.p_respond_signal?.toFixed(2)}  traj d'=${ctx._metrics.trajectory_d_prime?.toFixed(2)}`);
    check(`${p.name}: 6 headline rows, no NaN`, res.headline.length === 6 && res.headline.every((h) => !h.value.includes('NaN')));
    check(`${p.name}: staircase converged near 0.5`,
      Math.abs(ctx._metrics.p_respond_signal! - 0.5) < 0.22, ctx._metrics.p_respond_signal?.toFixed(3));
    check(`${p.name}: race model holds (failed stops faster than go median)`,
      ctx._metrics.race_model_ok === 1, [ctx._metrics.stop_failure_rt, ctx._metrics.stop_go_rt_median]);
  }
  check('HOLD: disciplined > average > impulsive', out[0]!.ops > out[1]!.ops && out[1]!.ops > out[2]!.ops, out.map((o) => `${o.name}=${o.ops}`));
  check('HOLD: extremes well separated', out[0]!.ops - out[2]!.ops > 180, out[0]!.ops - out[2]!.ops);
  check('HOLD: SSRT recovered close to the simulated value',
    profiles.every((p, i) => Math.abs(out[i]!.m.ssrt! - p.ssrt) < 90),
    profiles.map((p, i) => [p.ssrt, Math.round(out[i]!.m.ssrt!)]));
  check('HOLD: the harder no-go (red) draws more commissions than blue',
    out.every((o) => o.m.commission_rate_red! >= o.m.commission_rate_blue!),
    out.map((o) => [o.m.commission_rate_red, o.m.commission_rate_blue]));
  check('HOLD: commitment fraction ordered (impulsive commits earliest)',
    out[0]!.m.commitment_fraction! > out[2]!.m.commitment_fraction!);

  // Two people with identical commission rates should still be separated by
  // how fast their inhibition actually is.
  {
    const slow: H = { name: 'lassú gátlás', goRt: 550, commission: 0.16, ssrt: 380, traj: 0.78, ruleCost: 0.2, commit: 0.55 };
    const fast: H = { ...slow, name: 'gyors gátlás', ssrt: 190 };
    const a = fakeCtx('vr'); const ra = buildHold(fast, a).finish(a);
    const b = fakeCtx('vr'); const rb = buildHold(slow, b).finish(b);
    check('HOLD: same commission rate, faster SSRT scores higher',
      ra.opsScore > rb.opsScore, { fast: ra.opsScore, slow: rb.opsScore, ssrtFast: a._metrics.ssrt, ssrtSlow: b._metrics.ssrt });
  }
}

/* ======================================================== MEMORY === */
console.log('\nMEMORY');
{
  interface M { name: string; span: number; updCost: number; bind: number; swap: number; nbackD: number; interf: number; }
  const profiles: M[] = [
    { name: 'erős',    span: 7, updCost: 0.08, bind: 0.90, swap: 0.06, nbackD: 3.1, interf: 0.08 },
    { name: 'átlagos', span: 5, updCost: 0.24, bind: 0.72, swap: 0.16, nbackD: 2.0, interf: 0.22 },
    { name: 'gyenge',  span: 3, updCost: 0.48, bind: 0.44, swap: 0.32, nbackD: 0.9, interf: 0.42 },
  ];
  const out: { name: string; ops: number; m: Record<string, number> }[] = [];

  const buildMem = (p: M, ctx: ReturnType<typeof fakeCtx>) => {
    const rng = new Rng(41);
    const spanResults: unknown[] = [];
    for (let len = 3; len <= Math.min(9, p.span + 1); len++) {
      for (let k = 0; k < 2; k++) {
        const correct = len <= p.span;
        spanResults.push({
          length: len, correct, firstError: correct ? null : rng.int(0, len - 1),
          depthConfusion: !correct && rng.next() < 0.25, rtMs: 4000,
        });
      }
    }
    // Exact counts per rotation angle: with the module's real ten trials the
    // accuracy resolution is 0.33, which cannot show a 0.08 cost difference.
    // The fixture uses more trials and realises the intended accuracy exactly.
    const rotateResults: unknown[] = [];
    const addRot = (deg: number, n: number, acc: number) => {
      const nCorrect = Math.round(clampf01(acc) * n);
      for (let i = 0; i < n; i++) {
        rotateResults.push({
          rotationDeg: deg, correct: i < nCorrect, rtMs: 5000,
          firstPickMs: 1800 + p.updCost * 3000,
        });
      }
    };
    addRot(0, 12, 0.92);
    addRot(90, 12, 0.92 - p.updCost);
    addRot(180, 12, 0.92 - p.updCost * 1.3);
    const bindResults = Array.from({ length: 12 }, () => {
      const swap = rng.next() < p.swap;
      return { angErr: Math.abs(gauss(rng, swap ? 22 : 6, 4)), depthErr: Math.abs(gauss(rng, 0.5, 0.3)), swap, nearestCorrect: rng.next() < p.bind };
    });
    // n-back stream with the module's real structure (12 targets, 5+5 lures,
    // 18 fillers) and exact response counts per cell.
    const nbackResult: unknown[] = [];
    const hit = Math.min(0.98, 0.5 + p.nbackD * 0.15);
    const fa = Math.max(0.02, 0.5 - p.nbackD * 0.14);
    const addNb = (type: string, isTarget: boolean, n: number, rate: number) => {
      const nResp = Math.round(clampf01(rate) * n);
      for (let i = 0; i < n; i++) {
        nbackResult.push({ type, isTarget, responded: i < nResp, rtMs: i < nResp ? 900 : null });
      }
    };
    addNb('target', true, 12, hit);
    addNb('lure1', false, 5, fa * 2.1);
    addNb('lure3', false, 5, fa * 2.1);
    addNb('filler', false, 18, fa);
    const nPlain = Math.round(clampf01(0.88) * 8);
    const nInterf = Math.round(clampf01(0.88 - p.interf) * 8);
    const interfereResults = [
      ...Array.from({ length: 8 }, (_, i) => ({ withInterference: false, correct: i < nPlain, timeOnTarget: NaN })),
      ...Array.from({ length: 8 }, (_, i) => ({ withInterference: true, correct: i < nInterf, timeOnTarget: 0.7 })),
    ];
    const mod = new MemoryModule();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { spanResults: unknown[] }).spanResults = spanResults;
    (mod as unknown as { rotateResults: unknown[] }).rotateResults = rotateResults;
    (mod as unknown as { bindResults: unknown[] }).bindResults = bindResults;
    (mod as unknown as { nbackResult: unknown[] }).nbackResult = nbackResult;
    (mod as unknown as { interfereResults: unknown[] }).interfereResults = interfereResults;
    (mod as unknown as { trials: TrialRecord[] }).trials = [];
    return mod;
  };

  for (const p of profiles) {
    const ctx = fakeCtx('vr');
    const res = buildMem(p, ctx).finish(ctx);
    out.push({ name: p.name, ops: res.opsScore, m: ctx._metrics });
    console.log(`  ${p.name.padEnd(8)} OPS=${String(res.opsScore).padStart(4)}  ` +
      `span=${ctx._metrics.corsi_span}  updCost=${ctx._metrics.updating_cost?.toFixed(2)}  ` +
      `bind=${(ctx._metrics.binding_accuracy! * 100).toFixed(0)}%  nback d'=${ctx._metrics.nback_d_prime?.toFixed(2)}  ` +
      `interf=${ctx._metrics.interference_cost?.toFixed(2)}`);
    check(`${p.name}: 6 headline rows, no NaN`, res.headline.length === 6 && res.headline.every((h) => !h.value.includes('NaN')));
  }
  check('MEMORY: strong > average > weak', out[0]!.ops > out[1]!.ops && out[1]!.ops > out[2]!.ops, out.map((o) => `${o.name}=${o.ops}`));
  check('MEMORY: extremes well separated', out[0]!.ops - out[2]!.ops > 180, out[0]!.ops - out[2]!.ops);
  check('MEMORY: span recovered exactly', profiles.every((p, i) => out[i]!.m.corsi_span === p.span),
    profiles.map((p, i) => [p.span, out[i]!.m.corsi_span]));
  check('MEMORY: 180 degree rotation costs more than 90',
    out.every((o) => o.m.updating_cost_180! >= o.m.updating_cost!),
    out.map((o) => [o.m.updating_cost?.toFixed(3), o.m.updating_cost_180?.toFixed(3)]));
  check('MEMORY: lures draw more false alarms than plain fillers',
    out.every((o) => o.m.nback_lure_cost! > 0), out.map((o) => o.m.nback_lure_cost?.toFixed(3)));
  check('MEMORY: interference cost positive and ordered',
    out[0]!.m.interference_cost! < out[2]!.m.interference_cost!);

  // Span and updating must be separable: same capacity, different cost of
  // applying a transformation to it.
  {
    const cheap: M = { name: 'olcsó frissítés', span: 5, updCost: 0.05, bind: 0.72, swap: 0.16, nbackD: 2.0, interf: 0.22 };
    const dear: M = { ...cheap, name: 'drága frissítés', updCost: 0.50 };
    const a = fakeCtx('vr'); const ra = buildMem(cheap, a).finish(a);
    const b = fakeCtx('vr'); const rb = buildMem(dear, b).finish(b);
    check('MEMORY: same span, cheaper spatial updating scores higher',
      ra.opsScore > rb.opsScore && a._metrics.corsi_span === b._metrics.corsi_span,
      { cheap: ra.opsScore, dear: rb.opsScore, span: a._metrics.corsi_span });
  }

  // Flat platforms must not report depth measures at all.
  {
    const ctx = fakeCtx('desktop');
    const res = buildMem(profiles[1]!, ctx).finish(ctx);
    check('MEMORY: flat platform omits depth metrics',
      ctx._metrics.depth_confusion_rate === undefined && ctx._metrics.binding_depth_error === undefined);
    check('MEMORY: flat platform result says depth needs VR', res.headline.some((h) => h.value.includes('VR')));
  }
}

function clampf(v: number): number { return Math.max(0.05, Math.min(0.98, v)); }
function clampf01(v: number): number { return Math.max(0, Math.min(1, v)); }

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
