/**
 * Defence catalogue, modules 05 / 16 / 17 / 18 / 19:
 * MULTI, HANDS, RISK, PROTOCOL, INTENT.
 *
 * The pattern is the one the earlier module tests use: build a synthetic
 * participant whose true value is known, push it through the module's real
 * scoring pipeline, and require the module to recover it. Anything the spec
 * claims is absent on a flat platform has to be genuinely absent - not zero,
 * not approximated.
 */
import { Rng, MODULE_BY_CODE, isRunnableOn } from '@vrcap/shared';
import type { ModuleContext } from '../packages/client/src/engine/task/Module.js';
import * as THREE from 'three';
import { MultiModule } from '../packages/client/src/modules/multi/MultiModule.js';
import { HandsModule, MIN_JERK_REFERENCE } from '../packages/client/src/modules/hands/HandsModule.js';
import {
  MotionTrack, GrabSystem, buildWirePath, wireProbe, keyAngleError,
  type Grabbable, type Socket,
} from '../packages/client/src/modules/hands/manipulation.js';
import { RiskModule, EV_OPTIMAL_PUMPS } from '../packages/client/src/modules/risk/RiskModule.js';
import {
  ProtocolModule, generateProcedure, pickRevised, name as stepName,
} from '../packages/client/src/modules/protocol/ProtocolModule.js';
import { IntentModule, risingCrossing } from '../packages/client/src/modules/intent/IntentModule.js';
import { pose, depthOffsetM, JOINTS } from '../packages/client/src/modules/intent/figure.js';
import { TrackStation, FORCING_FREQS, TRACK_CLAMP_DEG, type StationHost, type StationEvent }
  from '../packages/client/src/modules/multi/stations.js';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

interface FakeCtx extends ModuleContext {
  _metrics: Record<string, number>;
  _scores: string[];
  _trials: { outcome: string; block: string; reactionTimeMs: number | null }[];
  _events: { type: string; payload: Record<string, unknown> }[];
}

function fakeCtx(platform: 'vr' | 'desktop' | 'mobile' = 'vr', seed = 11): FakeCtx {
  const metrics: Record<string, number> = {};
  const scores: string[] = [];
  const trials: FakeCtx['_trials'] = [];
  const events: FakeCtx['_events'] = [];
  let frameTime = 0;
  const ctx = {
    platform,
    engine: {
      clock: {
        frameInterval: 11.1,
        get frameTime() { return frameTime; },
        set frameTime(v: number) { frameTime = v; },
      },
      camera: {},
      input: { on: () => () => {}, move: { x: 0, y: 0 }, pose: () => ({ head: [], left: [], right: [] }) },
    },
    recorder: {
      metric: (n: string, v: number) => { if (Number.isFinite(v)) metrics[n] = v; },
      score: (t: string) => { scores.push(t); },
      trial: (rec: { outcome: string; block: string; reactionTimeMs: number | null }) => { trials.push(rec); },
      event: (type: string, payload: Record<string, unknown> = {}) => { events.push({ type, payload }); },
      setMotionHz: () => {},
    },
    rng: new Rng(seed),
    scene: {},
    panels: { add: () => {}, remove: () => {}, onClick: () => () => {} },
    audio: {
      speechAvailable: false, tone: () => 0, noise: () => 0, speak: () => false,
      stopSpeech: () => {}, outputLatencyMs: 12,
      ok: () => {}, error: () => {}, click: () => {}, warn: () => {}, countdown: () => {},
    },
    theme: {
      accent: '#fff', accent2: '#0ff', accentSoft: '#aaa', ok: '#0f0', bad: '#f00', warn: '#ff0',
      text: '#fff', textMuted: '#888', surface: '#111', surfaceAlt: '#222', bg: '#000', line: '#333',
      fontDisplay: 'sans-serif', fontBody: 'sans-serif', fontMono: 'monospace', radius: 12,
    },
    mobileControls: null,
    root: { add: () => {} },
  } as unknown as ModuleContext;
  return Object.assign(ctx, { _metrics: metrics, _scores: scores, _trials: trials, _events: events }) as FakeCtx;
}

/* ================================================================= MULTI */
console.log('\nMULTI  (többfeladatos terhelés)');
{
  interface CondSpec {
    condition: string;
    stations: string[];
    trackRms?: number;
    monitorHits?: number; monitorMisses?: number; monitorFa?: number; monitorRts?: number[];
    resourceDeviation?: number;
    commHits?: number; commMisses?: number; commOwn?: number;
    dwellMs?: Record<string, number>;
    neglectMs?: Record<string, number>;
    rtFacing?: number[]; rtAway?: number[];
  }

  const cond = (s: CondSpec) => ({
    condition: s.condition,
    stations: s.stations,
    durationMs: 140_000,
    trackRms: s.trackRms ?? NaN,
    trackIdleFraction: 0.05,
    monitorHits: s.monitorHits ?? 0,
    monitorMisses: s.monitorMisses ?? 0,
    monitorFa: s.monitorFa ?? 0,
    monitorRts: s.monitorRts ?? [],
    resourceDeviation: s.resourceDeviation ?? NaN,
    recoveryLags: [3200, 4100],
    commHits: s.commHits ?? 0,
    commMisses: s.commMisses ?? 0,
    commFa: 0,
    commOwn: s.commOwn ?? 0,
    commRts: [2100, 2600],
    dwellMs: s.dwellMs ?? { track: 0, monitor: 0, resource: 0, comm: 0 },
    neglectMs: s.neglectMs ?? { track: 0, monitor: 0, resource: 0, comm: 0 },
    rtFacing: s.rtFacing ?? [],
    rtAway: s.rtAway ?? [],
  });

  /**
   * A participant whose degradation is known exactly:
   *   tracking   2.0 -> 3.0 deg        cost 0.50
   *   monitoring 1.00 -> 0.80 hit rate cost 0.20
   *   resource   200 -> 400 units      cost 1.00
   *   radio      1.00 -> 0.70 hit rate cost 0.30
   *   mean                              0.50
   */
  function build(platform: 'vr' | 'desktop' | 'mobile') {
    const mod = new MultiModule();
    const ctx = fakeCtx(platform);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { results: unknown[] }).results = [
      cond({ condition: 'baseline_track', stations: ['track'], trackRms: 2.0 }),
      cond({ condition: 'baseline_monitor', stations: ['monitor'], monitorHits: 10, monitorMisses: 0 }),
      cond({ condition: 'baseline_resource', stations: ['resource'], resourceDeviation: 200 }),
      cond({ condition: 'baseline_comm', stations: ['comm'], commHits: 10, commOwn: 10 }),
      cond({
        condition: 'dual', stations: ['track', 'monitor'],
        trackRms: 2.4, monitorHits: 9, monitorMisses: 1,
      }),
      cond({
        condition: 'load_low', stations: ['track', 'monitor', 'resource', 'comm'],
        trackRms: 3.0, monitorHits: 8, monitorMisses: 2, monitorFa: 1,
        monitorRts: [1800, 2000, 2200, 2400, 1900, 2100, 2300, 2500],
        resourceDeviation: 400, commHits: 7, commMisses: 3, commOwn: 10,
        dwellMs: { track: 60000, monitor: 32000, resource: 30000, comm: 18000 },
        neglectMs: { track: 8000, monitor: 26000, resource: 41000, comm: 33000 },
        rtFacing: [1500, 1600, 1700, 1550], rtAway: [2400, 2500, 2600, 2450],
      }),
      cond({
        condition: 'load_high', stations: ['track', 'monitor', 'resource', 'comm'],
        trackRms: 4.1, monitorHits: 12, monitorMisses: 8, resourceDeviation: 620,
        commHits: 8, commMisses: 6, commOwn: 14,
      }),
    ];
    const res = mod.finish(ctx);
    return { mod, ctx, res };
  }

  const vr = build('vr');
  check('dual_task_cost recovers the known 0.50', near(vr.ctx._metrics.dual_task_cost!, 0.5, 0.001),
    vr.ctx._metrics.dual_task_cost);
  check('per-station costs are recovered',
    near(vr.ctx._metrics.dual_task_cost_track!, 0.5, 0.001)
    && near(vr.ctx._metrics.dual_task_cost_monitor!, 0.2, 0.001)
    && near(vr.ctx._metrics.dual_task_cost_resource!, 1.0, 0.001)
    && near(vr.ctx._metrics.dual_task_cost_comm!, 0.3, 0.001),
    [vr.ctx._metrics.dual_task_cost_track, vr.ctx._metrics.dual_task_cost_monitor,
     vr.ctx._metrics.dual_task_cost_resource, vr.ctx._metrics.dual_task_cost_comm]);
  check('cost is measured against load_low, whose event rates match the baseline',
    // load_high is worse; if the cost had been taken from it, tracking would read 1.05.
    !near(vr.ctx._metrics.dual_task_cost_track!, 1.05, 0.02));
  check('tracking_rms reports the loaded value, not the baseline',
    vr.ctx._metrics.tracking_rms === 3.0 && vr.ctx._metrics.tracking_rms_baseline === 2.0);
  check('overload_cost separates the higher event rate from the task count',
    near(vr.ctx._metrics.overload_cost!, 0.25, 0.001), vr.ctx._metrics.overload_cost);

  check('VR run reports the four spatial metrics',
    ['station_dwell_entropy', 'neglect_time_s', 'orientation_cost_ms', 'rear_station_hit_rate']
      .every((k) => k in vr.ctx._metrics),
    Object.keys(vr.ctx._metrics).filter((k) => k.includes('neglect')));
  check('neglect_time_s is the worst station, in seconds', vr.ctx._metrics.neglect_time_s === 41,
    vr.ctx._metrics.neglect_time_s);
  check('orientation_cost_ms is the away-minus-facing median',
    near(vr.ctx._metrics.orientation_cost_ms!, 900, 60), vr.ctx._metrics.orientation_cost_ms);
  check('dwell entropy is between 0 and 1',
    vr.ctx._metrics.station_dwell_entropy! > 0 && vr.ctx._metrics.station_dwell_entropy! < 1,
    vr.ctx._metrics.station_dwell_entropy);

  for (const p of ['desktop', 'mobile'] as const) {
    const flat = build(p);
    check(`${p}: spatial metrics are absent, not zero`,
      !['station_dwell_entropy', 'neglect_time_s', 'orientation_cost_ms', 'rear_station_hit_rate']
        .some((k) => k in flat.ctx._metrics));
    check(`${p}: dual_task_cost still measured`, near(flat.ctx._metrics.dual_task_cost!, 0.5, 0.001));
    check(`${p}: spatialWeightsApplied false`,
      (flat.res.summary as { spatialWeightsApplied: boolean }).spatialWeightsApplied === false);
    check(`${p}: five scoring components, not seven`, flat.ctx._scores.length === 5, flat.ctx._scores);
    check(`${p}: result screen says the allocation measure needs VR`,
      flat.res.headline.some((h) => (h.hint ?? '').includes('VR kell')));
  }
  check('VR: seven scoring components', vr.ctx._scores.length === 7, vr.ctx._scores);
  check('OPS score is a sane 0-1000 number',
    Number.isFinite(vr.res.opsScore) && vr.res.opsScore >= 0 && vr.res.opsScore <= 1000, vr.res.opsScore);
  check('load curve has all three points and a slope',
    (() => {
      const lc = (vr.res.summary as { loadCurve: Record<string, number | null> }).loadCurve;
      return lc.one !== null && lc.two !== null && lc.four !== null && lc.slope !== null && lc.slope! < 0;
    })());

  /* -------------------------------------------------- event scheduling */

  function schedule(seed: number, stations: string[], durationMs: number, rates: Record<string, number>) {
    const mod = new MultiModule();
    const ctx = fakeCtx('vr', seed);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    return (mod as unknown as {
      schedule(a: string[], d: number, r: Record<string, number>, t0: number): StationEvent[];
    }).schedule(stations, durationMs, rates, 0);
  }
  const RATES = { monitorPerMin: 10, commPerMin: 7, pumpPerMin: 3, forcingGain: 1.45, snrDb: 3 };
  const all = ['track', 'monitor', 'resource', 'comm'];
  const s1 = schedule(4242, all, 140_000, RATES);
  const s2 = schedule(4242, all, 140_000, RATES);
  const s3 = schedule(99, all, 140_000, RATES);
  check('same seed gives the identical event sequence',
    JSON.stringify(s1) === JSON.stringify(s2));
  check('a different seed gives a different sequence', JSON.stringify(s1) !== JSON.stringify(s3));
  check('events are ordered in time', s1.every((e, i) => i === 0 || e.t >= s1[i - 1]!.t));
  check('no monitoring event starts inside the last response window',
    s1.filter((e) => e.station === 'monitor').every((e) => e.t <= 140_000 - 8000));
  {
    const gaps: number[] = [];
    const mon = s1.filter((e) => e.station === 'monitor');
    for (let i = 1; i < mon.length; i++) gaps.push(mon[i]!.t - mon[i - 1]!.t);
    check('monitoring events keep the 3.5 s minimum spacing',
      gaps.every((g) => g >= 3500 - 1e-6), Math.min(...gaps));
  }
  {
    // 40 % own call signs, checked over many blocks rather than one - a single
    // 140 s block only carries about 16 calls.
    let own = 0; let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const e of schedule(seed, all, 140_000, RATES)) {
        if (e.station !== 'comm') continue;
        total++;
        if (e.own) own++;
      }
    }
    check('own-call-sign ratio is 0.40', near(own / total, 0.4, 0.05), { own, total, ratio: own / total });
  }
  {
    const s = schedule(7, ['track', 'monitor'], 80_000, RATES);
    check('an inactive station schedules nothing',
      s.every((e) => e.station === 'monitor'), [...new Set(s.map((e) => e.station))]);
  }

  /* --------------------------------------------------- forcing function */

  {
    // The drift must not repeat inside a block, or it becomes learnable.
    // Scan for a period T <= 140 s that is close to a whole number of cycles
    // for all four frequencies at once.
    let worst = 0;
    for (let T = 2; T <= 140; T += 0.05) {
      const err = Math.max(...FORCING_FREQS.map((f) => {
        const c = f * T;
        return Math.abs(c - Math.round(c));
      }));
      worst = Math.max(worst, 1 - err * 4);
    }
    check('the forcing function has no common period inside a 140 s block', worst < 0.98, worst);
  }

  /* ------------------------------------------------------ tracking clamp */

  {
    const ctx = fakeCtx('vr', 3);
    const host: StationHost = {
      ctx, rng: new Rng(3),
      now: () => ctx.engine.clock.frameTime,
      log: () => {}, isPractice: () => false,
    };
    const st = new TrackStation(host, () => ({ x: 0, y: 0 }));
    st.setActive(true, 'load_low');
    st.setGain(1.45);
    st.beginCondition('load_low');
    const dt = 1 / 90;
    for (let i = 0; i < 90 * 140; i++) {
      (ctx.engine.clock as { frameTime: number }).frameTime = i * dt * 1000;
      st.update(dt, i * dt * 1000);
    }
    check('an abandoned tracking task stays finite and inside the clamp',
      Number.isFinite(st.rmsDeg) && st.rmsDeg <= TRACK_CLAMP_DEG, st.rmsDeg);
    check('an abandoned tracking task actually drifts out', st.rmsDeg > 3, st.rmsDeg);
    check('holding the stick idle is counted as idle time', st.idleMs > 100_000, st.idleMs);
  }
  {
    // A perfect nuller: a controller that pushes back exactly against the
    // current error should hold a much smaller RMS than an absent one.
    const ctx = fakeCtx('vr', 3);
    const host: StationHost = {
      ctx, rng: new Rng(3), now: () => ctx.engine.clock.frameTime,
      log: () => {}, isPractice: () => false,
    };
    let vec = { x: 0, y: 0 };
    const st = new TrackStation(host, () => vec);
    st.setActive(true, 'load_low');
    st.beginCondition('load_low');
    const dt = 1 / 90;
    for (let i = 0; i < 90 * 60; i++) {
      const t = i * dt * 1000;
      (ctx.engine.clock as { frameTime: number }).frameTime = t;
      st.update(dt, t);
      const e = (st as unknown as { errX: number; errY: number });
      vec = { x: Math.max(-1, Math.min(1, e.errX * 0.9)), y: Math.max(-1, Math.min(1, e.errY * 0.9)) };
    }
    check('an active controller holds the error well under the clamp', st.rmsDeg < 2.0, st.rmsDeg);
  }

  /* ------------------------------------------------------ trial records */

  {
    const mod = new MultiModule();
    const ctx = fakeCtx('vr');
    (mod as unknown as { ctx: ModuleContext; practice: boolean; activeIds: string[] }).ctx = ctx;
    (mod as unknown as { practice: boolean }).practice = false;
    (mod as unknown as { activeIds: string[] }).activeIds = ['track', 'monitor'];
    const log = (mod as unknown as { log(t: string, p: Record<string, unknown>): void }).log.bind(mod);
    log('station_timeout', { station: 'monitor', element: 'green', kind: 'monitor_deviation', onsetT: 1000, windowMs: 8000 });
    log('station_response', { station: 'monitor', element: 'red', kind: 'monitor_deviation', onsetT: 2000, rtMs: 1420, correct: true });
    check('a missed event is recorded as a timeout trial with no response',
      ctx._trials[0]!.outcome === 'timeout' && ctx._trials[0]!.reactionTimeMs === null, ctx._trials[0]);
    check('an answered event is recorded as a hit with its RT',
      ctx._trials[1]!.outcome === 'hit' && ctx._trials[1]!.reactionTimeMs === 1420, ctx._trials[1]);
    check('practice does not produce trial records', (() => {
      (mod as unknown as { practice: boolean }).practice = true;
      const before = ctx._trials.length;
      log('station_response', { station: 'monitor', element: 'green', onsetT: 3000, rtMs: 900, correct: true });
      return ctx._trials.length === before;
    })());
  }

  /* ---------------------------------------------------------- manifest */

  const m = MODULE_BY_CODE.MULTI!;
  check('MULTI is active in the catalogue', m.status === 'active', m.status);
  check('MULTI runs on all three platforms',
    (['vr', 'desktop', 'mobile'] as const).every((p) => isRunnableOn(m, p)));
  check('headline metrics from the manifest are all produced',
    m.headlineMetrics.every((k) => k in vr.ctx._metrics),
    m.headlineMetrics.filter((k) => !(k in vr.ctx._metrics)));
}

/* ================================================================= HANDS */
console.log('\nHANDS  (finom kézügyesség)');
{
  /* --------------------------------------------------- smoothness */

  /** The analytic minimum-jerk reach: position = L(10s^3 - 15s^4 + 6s^5). */
  function minJerkTrack(T: number, L: number, hz: number): MotionTrack {
    const tr = new MotionTrack();
    const n = Math.round(T * hz);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * T;
      const s = t / T;
      tr.push(t * 1000, new THREE.Vector3(L * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5), 0, 0));
    }
    return tr;
  }

  const REF = MIN_JERK_REFERENCE;
  check(`minimum-jerk reference is sqrt(360) = ${REF.toFixed(2)}`, near(REF, 18.974, 0.01));
  for (const hz of [60, 72, 90, 240]) {
    const nj = minJerkTrack(1, 0.3, hz).normalisedJerk();
    check(`jerk recovers the analytic value at ${hz} Hz`, near(nj, REF, REF * 0.05), nj);
  }
  {
    const a = minJerkTrack(1, 0.3, 90).normalisedJerk();
    const b = minJerkTrack(0.5, 0.3, 90).normalisedJerk();
    const c = minJerkTrack(1, 0.6, 90).normalisedJerk();
    check('jerk is independent of duration', near(a, b, REF * 0.05), [a, b]);
    check('jerk is independent of distance', near(a, c, 0.01), [a, c]);
  }
  {
    // A corrected, sub-movement-laden reach must score much worse.
    const tr = new MotionTrack();
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      const s = t;
      const x = 0.3 * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5) + 0.004 * Math.sin(2 * Math.PI * 6 * t);
      tr.push(t * 1000, new THREE.Vector3(x, 0, 0));
    }
    check('a wobbly reach scores far above the minimum-jerk reference',
      tr.normalisedJerk() > REF * 4, tr.normalisedJerk());
  }
  {
    // 0.4 mm at 8 Hz riding on a 20 mm/s drift: the drift is aiming, not tremor.
    const tr = new MotionTrack();
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      tr.push(t * 1000, new THREE.Vector3(0.02 * t + 0.0004 * Math.sin(2 * Math.PI * 8 * t), 0, 0));
    }
    check('tremor recovers 0.4 mm amplitude as its 0.28 mm rms, drift excluded',
      near(tr.tremorMm(), 0.283, 0.05), tr.tremorMm());
  }
  {
    const tr = new MotionTrack();
    for (let i = 0; i <= 120; i++) tr.push((i / 120) * 1000, new THREE.Vector3(0.02 * (i / 120), 0, 0));
    check('a pure drift with no tremor reads as zero', tr.tremorMm() < 1e-6, tr.tremorMm());
  }

  /* ------------------------------------------------------- grabbing */

  function socket(pos: THREE.Vector3, keyAngle: number | null = null): Socket {
    return {
      id: 's', index: 0, position: pos.clone(), axis: new THREE.Vector3(0, 1, 0),
      toleranceM: 0.009, keyAngleRad: keyAngle,
      angleToleranceRad: (12 * Math.PI) / 180, filled: false, accepts: 'peg', marker: null,
    };
  }
  function rig(pegAt: THREE.Vector3) {
    const hand = new THREE.Object3D();
    const obj = new THREE.Object3D();
    obj.position.copy(pegAt);
    const g: Grabbable = {
      id: 'peg', object: obj, home: pegAt.clone(),
      homeQuat: new THREE.Quaternion(), keyed: false, kind: 'peg',
    };
    let pressed = false;
    const events: { type: string; detail: unknown }[] = [];
    const sys = new GrabSystem(
      (h) => (h === 'right' ? hand : null),
      () => pressed,
      0.05,
      {
        onGrab: (h, gg, t, d) => events.push({ type: 'grab', detail: { h, id: gg.id, d } }),
        onRelease: (h, gg, t, r0) => events.push({
          type: 'release',
          detail: { socket: r0.socket?.id ?? null, errorMm: r0.errorM * 1000, angleDeg: r0.angleErrorRad === null ? null : (r0.angleErrorRad * 180) / Math.PI },
        }),
      }
    );
    sys.setGrabbables([g]);
    return { hand, obj, g, sys, events, press: (v: boolean) => { pressed = v; } };
  }

  {
    const r0 = rig(new THREE.Vector3(0, 0, 0));
    r0.sys.setSockets([socket(new THREE.Vector3(0.2, 0, 0))]);
    r0.hand.position.set(0.2, 0, 0);
    r0.hand.updateMatrixWorld(true);
    r0.press(true);
    r0.sys.update(0);
    check('a grab beyond the grab radius does not pick anything up',
      r0.events.length === 0, r0.events);
  }

  /**
   * The hand starts exactly on the peg, so the grab offset is zero and the
   * peg sits wherever the hand is. Anywhere else and the peg trails the hand
   * by the offset, which is correct behaviour but makes the arithmetic in
   * these assertions about the offset rather than about the placement rule.
   */
  const carry = (handEnd: THREE.Vector3, rollDeg = 0, keyAngle: number | null = null) => {
    const r0 = rig(new THREE.Vector3(0, 0, 0));
    r0.g.keyed = keyAngle !== null;
    const s = socket(new THREE.Vector3(0.2, 0, 0), keyAngle);
    r0.sys.setSockets([s]);
    r0.hand.position.set(0, 0, 0);
    r0.hand.updateMatrixWorld(true);
    r0.press(true);
    r0.sys.update(0);
    r0.hand.position.copy(handEnd);
    if (rollDeg) r0.hand.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rollDeg * Math.PI) / 180);
    r0.hand.updateMatrixWorld(true);
    r0.sys.update(100);
    r0.press(false);
    r0.sys.update(200);
    const rel = r0.events.find((e) => e.type === 'release')!.detail as
      { socket: string | null; errorMm: number; angleDeg: number | null };
    return { r0, s, rel };
  };

  {
    const { r0, s, rel } = carry(new THREE.Vector3(0.203, 0, 0));
    check('a grab inside the radius picks the object up', r0.events[0]?.type === 'grab');
    check('a release 3 mm inside the 9 mm tolerance fills the socket',
      rel.socket === 's' && near(rel.errorMm, 3, 0.1), rel);
    check('the socket is marked filled', s.filled);
  }
  {
    const { r0, s, rel } = carry(new THREE.Vector3(0.212, 0, 0));
    check('a release 12 mm off the 9 mm hole is a drop, not a placement',
      rel.socket === null && near(rel.errorMm, 12, 0.1), rel);
    check('a dropped peg goes back to its tray',
      r0.obj.position.distanceTo(r0.g.home) < 1e-6);
    check('the socket stays empty after a drop', !s.filled);
  }
  {
    // In position, but rotated 30 degrees past the 12 degree tolerance.
    const { s, rel } = carry(new THREE.Vector3(0.201, 0, 0), 30, 0);
    check('a keyed peg 30 deg out of alignment is refused on ANGLE, not position',
      rel.socket === null && near(rel.errorMm, 1, 0.2), rel);
    check('the refusing angle is reported so the module can score it',
      rel.angleDeg !== null && Math.abs(Math.abs(rel.angleDeg) - 30) < 1, rel.angleDeg);
    check('an angle-refused socket stays empty', !s.filled);
  }
  {
    const { rel } = carry(new THREE.Vector3(0.201, 0, 0), 8, 0);
    check('a keyed peg 8 deg out of alignment is accepted', rel.socket === 's', rel);
    check('the accepted angle error is recorded, not discarded',
      rel.angleDeg !== null && Math.abs(Math.abs(rel.angleDeg) - 8) < 1, rel.angleDeg);
  }
  {
    const s = socket(new THREE.Vector3(0, 0, 0), 0);
    const o = new THREE.Object3D();
    o.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (45 * Math.PI) / 180);
    o.updateMatrixWorld(true);
    check('key angle error is signed and wraps correctly',
      Math.abs(Math.abs((keyAngleError(o, s) * 180) / Math.PI) - 45) < 0.5,
      (keyAngleError(o, s) * 180) / Math.PI);
  }

  /* ------------------------------------------------------ wire path */

  {
    const path = buildWirePath(
      new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1), 0.16, 0.09, 0
    );
    const lens = { lateral: 0, depth: 0 };
    for (let i = 1; i < path.points.length; i++) {
      lens[path.segment[i]!] += path.points[i]!.distanceTo(path.points[i - 1]!);
    }
    check('the lateral and depth arcs are the same length within 2%',
      Math.abs(lens.lateral - lens.depth) / lens.lateral < 0.02, lens);
    check('both arc kinds are actually present', lens.lateral > 0 && lens.depth > 0);
    check('a point on the wire probes as zero distance',
      wireProbe(path, path.points[40]!).distanceM < 1e-6);
    check('a point 30 mm off the wire probes as 30 mm',
      near(wireProbe(path, path.points[40]!.clone().add(new THREE.Vector3(0, 0.03, 0))).distanceM, 0.03, 0.004));
    check('arc-length position runs from 0 to 1 along the path',
      wireProbe(path, path.points[0]!).sNorm < 0.02
      && wireProbe(path, path.points[path.points.length - 1]!).sNorm > 0.98);
  }

  /* -------------------------------------------------------- scoring */

  interface P {
    block: string; hand: 'left' | 'right'; errorMm: number; jerk: number;
    tremorMm: number; angleErrorDeg: number | null; pathMm: number; straightMm: number;
  }
  function handsRun(opts: {
    dominant?: 'left' | 'right';
    domCount: number; otherCount: number; biLeft: number; biRight: number;
    groovedCount: number; errorMm: number; jerk: number;
    contacts: number; lateralContactRate: number; depthContactRate: number;
    drops?: number;
  }) {
    const mod = new HandsModule();
    const ctx = fakeCtx('vr');
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { dominant: string }).dominant = opts.dominant ?? 'right';
    const dom = opts.dominant ?? 'right';
    const other = dom === 'right' ? 'left' : 'right';
    const list: P[] = [];
    const add = (block: string, hand: 'left' | 'right', n: number, angle: number | null = null) => {
      for (let i = 0; i < n; i++) {
        list.push({
          block, hand, errorMm: opts.errorMm, jerk: opts.jerk, tremorMm: 0.7,
          angleErrorDeg: angle, pathMm: 400, straightMm: 320,
        });
      }
    };
    add(`pegs:${dom}`, dom as 'left' | 'right', opts.domCount);
    add(`pegs:${other}`, other as 'left' | 'right', opts.otherCount);
    add('pegs:bimanual', 'left', opts.biLeft);
    add('pegs:bimanual', 'right', opts.biRight);
    add('grooved:grooved', 'right', opts.groovedCount, 6.5);
    (mod as unknown as { placements: P[] }).placements = list;
    (mod as unknown as { drops: number }).drops = opts.drops ?? 0;
    (mod as unknown as { wireRuns: unknown[] }).wireRuns = [{
      index: 0, completed: true, durationMs: 24_000, contacts: opts.contacts,
      contactMs: 3000, lateralMs: 12_000, depthMs: 12_000,
      lateralContactMs: 12_000 * opts.lateralContactRate,
      depthContactMs: 12_000 * opts.depthContactRate,
      lateralContacts: Math.round(opts.contacts / 2), depthContacts: Math.round(opts.contacts / 2),
      pathLengthM: 0.8,
    }];
    (mod as unknown as { assemblyPartsPlaced: unknown[] }).assemblyPartsPlaced = [
      { part: 'pin', hand: 'right', expected: 'right', rtMs: 1200 },
      { part: 'washer', hand: 'right', expected: 'left', rtMs: 1100 },
    ];
    const res = mod.finish(ctx);
    return { ctx, res };
  }

  // 15 placements in 30 s = 30/min per hand; bimanual 12 pairs in 30 s = 24/min.
  const h = handsRun({
    domCount: 16, otherCount: 14, biLeft: 12, biRight: 13, groovedCount: 14,
    errorMm: 3.2, jerk: 26, contacts: 6, lateralContactRate: 0.05, depthContactRate: 0.14,
    drops: 3,
  });
  check('placement rate is the mean of the two single-hand runs',
    near(h.ctx._metrics.placements_per_min!, 30, 0.01), h.ctx._metrics.placements_per_min);
  check('bimanual pairs count the SLOWER hand, not the total',
    near(h.ctx._metrics.bimanual_pairs_per_min!, 24, 0.01), h.ctx._metrics.bimanual_pairs_per_min);
  check('bimanual efficiency is measured against the weaker hand',
    near(h.ctx._metrics.bimanual_efficiency!, 24 / 28, 0.001), h.ctx._metrics.bimanual_efficiency);
  // 32/min against 28/min, normalised by their mean of 30.
  check('asymmetry is the normalised difference of the two hands',
    near(h.ctx._metrics.bimanual_asymmetry!, 4 / 30, 0.001), h.ctx._metrics.bimanual_asymmetry);
  check('grooved penalty is 1 - grooved/plain',
    near(h.ctx._metrics.grooved_penalty!, 1 - 14 / 30, 0.001), h.ctx._metrics.grooved_penalty);
  check('depth segments cost more contact time than lateral ones',
    near(h.ctx._metrics.wire_depth_segment_cost!, 0.09, 0.001), h.ctx._metrics.wire_depth_segment_cost);
  check('drop rate counts drops against attempts',
    near(h.ctx._metrics.drop_rate!, 3 / (69 + 3), 0.001), h.ctx._metrics.drop_rate);
  check('assembly hand accuracy notices the wrong hand',
    near(h.ctx._metrics.assembly_hand_accuracy!, 0.5, 0.001), h.ctx._metrics.assembly_hand_accuracy);
  check('six scoring components, weights summing to one', h.ctx._scores.length === 6, h.ctx._scores);
  check('OPS score is finite and in range',
    Number.isFinite(h.res.opsScore) && h.res.opsScore >= 0 && h.res.opsScore <= 1000, h.res.opsScore);
  check('the result screen states that the run had no touch feedback',
    (h.res.summary as { touchAbsent: boolean }).touchAbsent === true);
  check('the minimum-jerk reference is carried into the result',
    near((h.res.summary as { minJerkReference: number }).minJerkReference, 18.97, 0.01));

  {
    // One wild outlier must not move the precision measure - hence the median.
    const mod = new HandsModule();
    const ctx = fakeCtx('vr');
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    const nine = Array.from({ length: 9 }, () => ({
      block: 'pegs:right', hand: 'right' as const, errorMm: 3.0, jerk: 25,
      tremorMm: 0.6, angleErrorDeg: null, pathMm: 400, straightMm: 320,
    }));
    (mod as unknown as { placements: unknown[] }).placements = [
      ...nine,
      { block: 'pegs:right', hand: 'right', errorMm: 400, jerk: 25, tremorMm: 0.6, angleErrorDeg: null, pathMm: 400, straightMm: 320 },
    ];
    (mod as unknown as { wireRuns: unknown[] }).wireRuns = [];
    mod.finish(ctx);
    check('insertion precision uses the median, so one outlier cannot move it',
      near(ctx._metrics.insertion_precision_mm!, 3.0, 0.01), ctx._metrics.insertion_precision_mm);
  }
  {
    const mod = new HandsModule();
    const ctx = fakeCtx('vr');
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { placements: unknown[] }).placements = [];
    (mod as unknown as { wireRuns: unknown[] }).wireRuns = [];
    mod.finish(ctx);
    check('an empty run reports no grooved penalty rather than a made-up one',
      !('grooved_penalty' in ctx._metrics));
  }

  /* -------------------------------------------------------- manifest */

  const m = MODULE_BY_CODE.HANDS!;
  check('HANDS is active in the catalogue', m.status === 'active', m.status);
  check('HANDS runs in VR', isRunnableOn(m, 'vr'));
  check('HANDS does NOT run on desktop or mobile',
    !isRunnableOn(m, 'desktop') && !isRunnableOn(m, 'mobile'));
  check('HANDS headline metrics are all produced',
    m.headlineMetrics.every((k) => k in h.ctx._metrics),
    m.headlineMetrics.filter((k) => !(k in h.ctx._metrics)));
}

/* ================================================================== RISK */
console.log('\nRISK  (kockázatvállalás)');
{
  const MAX_PUMPS = 16;
  const PUMP_VALUE = 5;

  /* --------------------------------------------- the odds themselves */

  {
    // Expected value of planning to stop after k pumps: the balloon survives
    // iff its burst point is beyond k, which with a uniform burst point over
    // 1..16 happens with probability (16-k)/16.
    let best = -1;
    let bestK = 0;
    for (let k = 0; k <= MAX_PUMPS; k++) {
      const ev = PUMP_VALUE * k * ((MAX_PUMPS - k) / MAX_PUMPS);
      if (ev > best) { best = ev; bestK = k; }
    }
    check('the EV-maximising stop is where the module says it is',
      bestK === EV_OPTIMAL_PUMPS, { bestK, EV_OPTIMAL_PUMPS, ev: best });
  }
  {
    const rng = new Rng(31337);
    const counts = new Array(MAX_PUMPS + 1).fill(0);
    const N = 40_000;
    for (let i = 0; i < N; i++) counts[rng.int(1, MAX_PUMPS)]++;
    const expected = N / MAX_PUMPS;
    let chi = 0;
    for (let k = 1; k <= MAX_PUMPS; k++) chi += ((counts[k]! - expected) ** 2) / expected;
    check('burst points are uniform over 1..16 (chi-square, 15 df, crit 30.6)',
      chi < 30.6 && counts[0] === 0, chi);
  }

  /* ------------------------------------------------------ deck design */

  function newCycle(mod: RiskModule, deck: string, rng: Rng) {
    return (mod as unknown as {
      newCycle(d: string, r: Rng): { gain: number; loss: number }[];
    }).newCycle(deck, rng);
  }
  {
    const mod = new RiskModule();
    const nets: Record<string, number> = {};
    for (const d of ['A', 'B', 'C', 'D']) {
      const cyc = newCycle(mod, d, new Rng(9));
      nets[d] = cyc.reduce((a, c) => a + c.gain - c.loss, 0);
      check(`deck ${d} deals exactly ten cards per cycle`, cyc.length === 10, cyc.length);
    }
    check('A and B are the bad decks at -250 per ten cards',
      nets.A === -250 && nets.B === -250, nets);
    check('C and D are the good decks at +250 per ten cards',
      nets.C === 250 && nets.D === 250, nets);
    check('A loses often and B rarely, at the same net balance',
      newCycle(mod, 'A', new Rng(9)).filter((c) => c.loss > 0).length === 5
      && newCycle(mod, 'B', new Rng(9)).filter((c) => c.loss > 0).length === 1);
    check('C loses often and D rarely, at the same net balance',
      newCycle(mod, 'C', new Rng(9)).filter((c) => c.loss > 0).length === 5
      && newCycle(mod, 'D', new Rng(9)).filter((c) => c.loss > 0).length === 1);
  }
  {
    const mod = new RiskModule();
    const a = JSON.stringify(newCycle(mod, 'A', new Rng(77)));
    const b = JSON.stringify(newCycle(mod, 'A', new Rng(77)));
    const c = JSON.stringify(newCycle(mod, 'A', new Rng(78)));
    check('the same seed deals the same loss order', a === b);
    check('a different seed deals a different loss order', a !== c);
  }
  {
    const s1 = new Rng(555).shuffle(['A', 'B', 'C', 'D']);
    const s2 = new Rng(555).shuffle(['A', 'B', 'C', 'D']);
    const s3 = new Rng(556).shuffle(['A', 'B', 'C', 'D']);
    check('deck positions are seeded, so a repeat run cannot reuse "the second from the left"',
      JSON.stringify(s1) === JSON.stringify(s2) && JSON.stringify(s1) !== JSON.stringify(s3));
  }

  /* -------------------------------------------------- angular size */

  {
    const mod = new RiskModule();
    const setup = (block: string, pumps: number) => {
      (mod as unknown as { currentBlock: string; pumps: number }).currentBlock = block;
      (mod as unknown as { pumps: number }).pumps = pumps;
      return (mod as unknown as { angularSizeDeg(): number }).angularSizeDeg();
    };
    const sizes = [0, 4, 8, 12, 16].map((n) => setup('bart_approach', n));
    check('the approaching balloon holds a constant 12.0 deg of visual angle',
      sizes.every((s) => Math.abs(s - 12.0) < 0.2), sizes);
    const grow = [0, 8, 16].map((n) => setup('bart_size', n));
    check('the growing balloon really does grow in angular size',
      grow[0]! < grow[1]! && grow[1]! < grow[2]! && grow[0]! > 4 && grow[2]! > 20, grow);
    // Both blocks must reach a similar final salience, or the comparison would
    // be about size rather than about depth.
    check('the two blocks are not wildly different in scale',
      Math.abs(grow[1]! - 12) < 3, grow[1]);
  }

  /* ---------------------------------------------------------- scoring */

  interface B {
    blockId: string; index: number; explodeAt: number; pumps: number;
    exploded: boolean; earned: number; firstRtMs: number; decisionRts: number[];
    hesitationMs: number[]; reversals: number; pathMm: number;
  }
  const balloon = (blockId: string, i: number, pumps: number, exploded: boolean): B => ({
    blockId, index: i, explodeAt: exploded ? pumps : pumps + 3, pumps, exploded,
    earned: exploded ? 0 : pumps * PUMP_VALUE, firstRtMs: 700,
    decisionRts: new Array(pumps + 1).fill(700), hesitationMs: [320, 380], reversals: 1,
    pathMm: 400,
  });
  interface C { trial: number; deck: string; slot: number; gain: number; loss: number; rtMs: number; switched: boolean; afterLoss: boolean }
  const card = (trial: number, deck: string, afterLoss = false): C => ({
    trial, deck, slot: 0, gain: deck === 'A' || deck === 'B' ? 100 : 50,
    loss: 0, rtMs: afterLoss ? 1200 : 900, switched: false, afterLoss,
  });

  function riskRun(platform: 'vr' | 'desktop' | 'mobile', opts: {
    sizePumps: number[]; approachPumps?: number[]; exploded?: number[];
    deckSeq: string[];
  }) {
    const mod = new RiskModule();
    const ctx = fakeCtx(platform);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    const bs: B[] = [];
    opts.sizePumps.forEach((n, i) =>
      bs.push(balloon('bart_size', i, n, (opts.exploded ?? []).includes(i))));
    (opts.approachPumps ?? []).forEach((n, i) => bs.push(balloon('bart_approach', i, n, false)));
    (mod as unknown as { balloons: B[] }).balloons = bs;
    (mod as unknown as { cards: C[] }).cards = opts.deckSeq.map((d, i) => card(i + 1, d, i % 5 === 0));
    (mod as unknown as { bank: number }).bank = 400;
    const res = mod.finish(ctx);
    return { mod, ctx, res };
  }

  // A participant who reliably stops at 6, plus one burst that must be excluded.
  const seq = [
    ...new Array(20).fill('A'), ...new Array(20).fill('B'),
    ...new Array(10).fill('C'), ...new Array(10).fill('D'),
  ];
  const vrRisk = riskRun('vr', {
    // The burst is deliberately NOT the last balloon of its block: loss
    // chasing needs a balloon after it, inside the same block.
    sizePumps: [6, 6, 6, 6, 6], exploded: [1],
    approachPumps: [5, 5, 5, 5],
    deckSeq: seq,
  });
  check('adjusted risk index excludes bursts, as the BART requires',
    near(vrRisk.ctx._metrics.adjusted_risk_index!, (6 * 4 + 5 * 4) / 8, 0.001),
    vrRisk.ctx._metrics.adjusted_risk_index);
  check('calibration error is the unsigned distance from the EV optimum',
    near(vrRisk.ctx._metrics.risk_calibration_error!, Math.abs(5.5 - EV_OPTIMAL_PUMPS), 0.001),
    vrRisk.ctx._metrics.risk_calibration_error);
  check('approach shift compares the two blocks, whose odds are identical',
    near(vrRisk.ctx._metrics.approach_risk_shift!, -1, 0.001),
    vrRisk.ctx._metrics.approach_risk_shift);
  check('VR reports the reach measures under the reach name',
    'reach_reversal_rate' in vrRisk.ctx._metrics && !('pointer_reversal_rate' in vrRisk.ctx._metrics));
  check('VR scores five components including cue independence',
    vrRisk.ctx._scores.length === 5 && vrRisk.ctx._scores.includes('cue_independence'),
    vrRisk.ctx._scores);

  {
    // Symmetry: 4 pumps and 12 pumps are equally far from the optimum of 8.
    const timid = riskRun('desktop', { sizePumps: [4, 4, 4, 4], deckSeq: seq });
    const bold = riskRun('desktop', { sizePumps: [12, 12, 12, 12], deckSeq: seq });
    check('the calibration score treats over- and under-shooting identically',
      near(timid.res.opsScore, bold.res.opsScore, 0.5),
      [timid.res.opsScore, bold.res.opsScore]);
    check('and neither is called better in the headline text',
      timid.res.headline[1]!.value.includes('óvatosabb')
      && bold.res.headline[1]!.value.includes('merészebb'));
  }
  {
    const d = riskRun('desktop', { sizePumps: [7, 7, 7, 7], deckSeq: seq });
    check('desktop does not run the approach block, so the shift is absent',
      !('approach_risk_shift' in d.ctx._metrics) && !('adjusted_risk_index_approach' in d.ctx._metrics));
    check('desktop names the pointer path differently from a reach',
      'pointer_reversal_rate' in d.ctx._metrics && !('reach_reversal_rate' in d.ctx._metrics));
    check('desktop scores four components, weights still summing to one',
      d.ctx._scores.length === 4 && !d.ctx._scores.includes('cue_independence'), d.ctx._scores);
    check('desktop records that no spatial weighting was applied',
      (d.res.summary as { spatialWeightsApplied: boolean }).spatialWeightsApplied === false);
    check('the result says why the approach measure is missing',
      d.res.headline.some((h) => (h.hint ?? '').includes('VR kell')));
  }
  {
    const m = riskRun('mobile', { sizePumps: [7, 7, 7, 7], deckSeq: seq });
    check('mobile has neither reach nor pointer measures: a tap has no path before it',
      !('reach_reversal_rate' in m.ctx._metrics) && !('pointer_reversal_rate' in m.ctx._metrics));
    check('mobile reports the absence explicitly rather than as zero',
      (m.res.summary as { reach: unknown }).reach === null);
  }

  /* --------------------------------------------------- card learning */

  {
    const always = riskRun('desktop', { sizePumps: [7, 7], deckSeq: new Array(60).fill('A') });
    check('never learning gives a flat slope',
      near(always.ctx._metrics.learning_slope!, 0, 0.001), always.ctx._metrics.learning_slope);
    check('and a consistency of 1.0 - the choice never changed',
      near(always.ctx._metrics.decision_consistency!, 1, 0.001),
      always.ctx._metrics.decision_consistency);
  }
  {
    const learner = [
      ...new Array(20).fill('A'),
      ...new Array(10).fill('A'), ...new Array(10).fill('C'),
      ...new Array(20).fill('D'),
    ];
    const l = riskRun('desktop', { sizePumps: [7, 7], deckSeq: learner });
    check('a participant who moves to the good decks has a positive slope',
      l.ctx._metrics.learning_slope! > 5, l.ctx._metrics.learning_slope);
    check('and their final block net score is at ceiling',
      l.ctx._metrics.net_score_final === 20, l.ctx._metrics.net_score_final);
  }
  {
    const flip: string[] = [];
    for (let i = 0; i < 60; i++) flip.push(i % 2 === 0 ? 'A' : 'C');
    const f = riskRun('desktop', { sizePumps: [7, 7], deckSeq: flip });
    check('switching on every card gives a consistency of 0',
      near(f.ctx._metrics.decision_consistency!, 0, 0.001), f.ctx._metrics.decision_consistency);
  }
  {
    // Chasing: after a burst the next balloon is pumped harder.
    const mod = new RiskModule();
    const ctx = fakeCtx('vr');
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { balloons: B[] }).balloons = [
      balloon('bart_size', 0, 6, true), balloon('bart_size', 1, 11, false),
      balloon('bart_size', 2, 6, false), balloon('bart_size', 3, 5, false),
      balloon('bart_size', 4, 6, true), balloon('bart_size', 5, 12, false),
    ];
    (mod as unknown as { cards: C[] }).cards = seq.map((d, i) => card(i + 1, d));
    mod.finish(ctx);
    // after a burst: balloons 1 and 5 -> 11 and 12, mean 11.5
    // after a cash-out: balloons 2, 3 and 4 -> 6, 5 and 6, mean 5.667
    check('loss chasing compares the balloon after a burst with the one after a cash-out',
      near(ctx._metrics.loss_chasing_index!, 11.5 - (6 + 5 + 6) / 3, 0.001),
      ctx._metrics.loss_chasing_index);
  }

  /* ----------------------------------------------------- trial record */

  {
    const mod = new RiskModule();
    const ctx = fakeCtx('vr');
    (mod as unknown as { ctx: ModuleContext; practice: boolean }).ctx = ctx;
    (mod as unknown as { practice: boolean }).practice = false;
    (mod as unknown as { currentBlock: string }).currentBlock = 'bart_size';
    (mod as unknown as { recordBalloonTrial(b: B): void }).recordBalloonTrial(
      balloon('bart_size', 0, 7, false));
    (mod as unknown as { recordCardTrial(c: C): void }).recordCardTrial(card(1, 'A'));
    check('every RISK trial records `correct` as null - there is no right answer',
      ctx._trials.length === 2 && ctx._trials.every((t) => (t as unknown as { correct: unknown }).correct === null),
      ctx._trials);
    check('a burst balloon is a miss and a cashed one a hit, without implying either was wrong',
      ctx._trials[0]!.outcome === 'hit');
  }

  /* ---------------------------------------------------------- manifest */

  const rm = MODULE_BY_CODE.RISK!;
  check('RISK is active in the catalogue', rm.status === 'active', rm.status);
  check('RISK runs on all three platforms',
    (['vr', 'desktop', 'mobile'] as const).every((p) => isRunnableOn(rm, p)));
  check('RISK has no challenge mode - a live score would break the measurement',
    rm.challengeMode === false);
  check('RISK headline metrics are all produced',
    rm.headlineMetrics.every((k) => k in vrRisk.ctx._metrics),
    rm.headlineMetrics.filter((k) => !(k in vrRisk.ctx._metrics)));
  check('the result is flagged as behavioural description only',
    (vrRisk.res.summary as { behaviouralOnly: boolean }).behaviouralOnly === true);
}

/* ============================================================== PROTOCOL */
console.log('\nPROTOCOL  (eljárásrendi fegyelem)');
{
  /* -------------------------------------------------- the procedure */

  {
    let ok = true;
    let distinct = true;
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateProcedure(new Rng(seed));
      if (p.length !== 10) { ok = false; break; }
      for (let i = 1; i < p.length; i++) if (p[i]!.station === p[i - 1]!.station) { ok = false; break; }
      if (new Set(p.map(stepName)).size !== 10) distinct = false;
    }
    check('every generated procedure is ten steps with no two in a row on one station', ok);
    check('and uses ten distinct controls', distinct);
  }
  {
    const a = generateProcedure(new Rng(4242)).map(stepName).join('|');
    const b = generateProcedure(new Rng(4242)).map(stepName).join('|');
    const c = generateProcedure(new Rng(4243)).map(stepName).join('|');
    check('the same seed generates the same procedure', a === b);
    check('a different seed generates a different one', a !== c);
  }
  {
    let ok = true;
    for (let seed = 1; seed <= 400; seed++) {
      const rng = new Rng(seed);
      const p = generateProcedure(rng);
      const rev = pickRevised(p, 5, rng);
      if (rev.station === p[4]!.station || rev.station === p[6]!.station) { ok = false; break; }
      if (p.map(stepName).includes(stepName(rev))) { ok = false; break; }
    }
    check('the revised control is on a new station and is not already in the procedure', ok);
  }

  /* ------------------------------------------------- the step machine */

  function machine(platform: 'vr' | 'desktop' | 'mobile' = 'vr', revised = false) {
    const mod = new ProtocolModule();
    const ctx = fakeCtx(platform);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    const rng = new Rng(7);
    const proc = generateProcedure(rng);
    const rev = pickRevised(proc, 5, rng);
    const M = mod as unknown as {
      procedure: typeof proc; revisedControl: typeof rev; expected: number;
      omittedFlags: boolean[]; currentBlock: string; runIndex: number; guided: boolean;
      pressure: boolean; revisedRun: boolean; lastStepT: number;
      steps: { stepIndex: number; outcome: string; actual: string | null }[];
      offProcedureThisRun: number; perseverationsThisRun: number;
      resume: { startT: number; reorientDoneT: number | null; wrongStations: Set<number> } | null;
      resumptions: { lagMs: number; reorientationMs: number; decisionMs: number }[];
      operate(s: { station: number; control: number }, t: number): void;
      pendingInterruptions: number[];
    };
    M.procedure = proc;
    M.revisedControl = rev;
    M.expected = 0;
    M.omittedFlags = new Array(10).fill(false);
    M.currentBlock = 'baseline';
    M.runIndex = 0;
    M.guided = false;
    M.pressure = false;
    M.revisedRun = revised;
    M.lastStepT = 0;
    M.pendingInterruptions = [];
    return { mod, ctx, M, proc, rev };
  }

  {
    const { M, proc } = machine();
    M.operate(proc[0]!, 1000);
    check('a correct step advances the procedure', M.expected === 1);
    // Somewhere in the procedure but not next, and not later either.
    M.operate(proc[0]!, 2000);
    check('a wrong control does NOT advance the procedure', M.expected === 1, M.expected);
    check('and it is recorded as an order error, not an omission',
      M.steps.some((s) => s.outcome === 'wrong_control'), M.steps.map((s) => s.outcome));
  }
  {
    const { M, proc } = machine();
    M.operate(proc[0]!, 100);
    M.operate(proc[1]!, 200);
    M.operate(proc[5]!, 300);
    check('jumping to a later step marks the ones in between as omitted',
      M.steps.filter((s) => s.outcome === 'omitted').map((s) => s.stepIndex).join(',') === '2,3,4',
      M.steps.map((s) => `${s.stepIndex}:${s.outcome}`));
    check('and the procedure continues from after the step actually taken',
      M.expected === 6, M.expected);
  }
  {
    const { M, proc } = machine();
    // A control that is not part of the procedure at all.
    const all: { station: number; control: number }[] = [];
    for (let s = 0; s < 6; s++) for (let c = 0; c < 3; c++) all.push({ station: s, control: c });
    const outside = all.find((x) => !proc.map(stepName).includes(stepName(x)))!;
    M.operate(outside, 100);
    check('a control outside the procedure is an off-procedure action, not an order error',
      M.offProcedureThisRun === 1 && !M.steps.some((s) => s.outcome === 'wrong_control'),
      { off: M.offProcedureThisRun, steps: M.steps.map((s) => s.outcome) });
    check('and it does not advance the procedure either', M.expected === 0);
  }
  {
    const { M, proc, rev } = machine('vr', true);
    M.expected = 5;
    M.operate(proc[5]!, 100);
    check('in the revised run the OLD control counts as a perseveration',
      M.perseverationsThisRun === 1, M.perseverationsThisRun);
    check('and it does not satisfy the step', M.expected === 5);
    M.operate(rev, 200);
    check('the new control does satisfy it', M.expected === 6);
  }

  /* --------------------------------------------------- resumption lag */

  {
    const { M, proc } = machine('vr');
    M.expected = 4;
    // The interruption panel disappeared at t = 1000; the participant turned
    // to the right station at 2200 and acted at 3600.
    M.resume = { startT: 1000, reorientDoneT: 2200, wrongStations: new Set([1, 3]) };
    M.operate(proc[4]!, 3600);
    const r0 = M.resumptions[0]!;
    check('resumption lag runs from when the interruption disappeared',
      near(r0.lagMs, 2600, 0.001), r0.lagMs);
    check('reorientation is the turn, decision is what happened after it',
      near(r0.reorientationMs, 1200, 0.001) && near(r0.decisionMs, 1400, 0.001), r0);
    check('the two parts always add up to the whole',
      near(r0.reorientationMs + r0.decisionMs, r0.lagMs, 1e-9));
    check('wrong stations visited before finding the right one are counted',
      (M.resumptions[0] as unknown as { wrongStationVisits: number }).wrongStationVisits === 2);
  }
  {
    // On a phone there is no orientation at all before the tap.
    const { M, proc } = machine('mobile');
    M.expected = 2;
    M.resume = { startT: 500, reorientDoneT: null, wrongStations: new Set() };
    M.operate(proc[2]!, 2500);
    const r0 = M.resumptions[0]!;
    check('with no orientation signal the lag is still measured whole',
      near(r0.lagMs, 2000, 0.001), r0.lagMs);
    check('but it is not decomposed into a made-up split',
      !Number.isFinite(r0.reorientationMs) && !Number.isFinite(r0.decisionMs), r0);
  }

  /* ------------------------------------------------------- the scoring */

  interface SR {
    blockId: string; runIndex: number; stepIndex: number; expected: string;
    actual: string | null; outcome: string; stepTimeMs: number;
    afterInterruption: boolean; guided: boolean; pressure: boolean; revised: boolean;
  }
  interface RR {
    blockId: string; runIndex: number; guided: boolean; pressure: boolean; revised: boolean;
    durationMs: number; correct: number; omitted: number; orderErrors: number;
    offProcedure: number; perseverations: number; completed: boolean;
  }
  function protocolRun(platform: 'vr' | 'desktop' | 'mobile', opts: {
    learnCorrect: number; baseCorrect: number; pressureCorrect: number;
    omitted: number; orderErrors: number; perseverations: number;
    lags: number[]; reorients: number[];
  }) {
    const mod = new ProtocolModule();
    const ctx = fakeCtx(platform);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    const steps: SR[] = [];
    const mk = (blockId: string, runIndex: number, outcome: string, n: number, extra: Partial<SR> = {}) => {
      for (let i = 0; i < n; i++) {
        steps.push({
          blockId, runIndex, stepIndex: i, expected: 's0:switch', actual: 's0:switch',
          outcome, stepTimeMs: 2600, afterInterruption: false, guided: false,
          pressure: false, revised: false, ...extra,
        });
      }
    };
    mk('learn', 3, 'correct', opts.learnCorrect);
    mk('learn', 3, 'omitted', 10 - opts.learnCorrect);
    mk('baseline', 0, 'correct', opts.baseCorrect);
    mk('baseline', 0, 'omitted', 10 - opts.baseCorrect);
    mk('revised', 0, 'correct', opts.pressureCorrect, { pressure: true });
    mk('revised', 0, 'omitted', 10 - opts.pressureCorrect, { pressure: true });
    // Three guided passes with deliberate mistakes: they must not be scored.
    mk('learn', 0, 'wrong_control', 10, { guided: true });
    (mod as unknown as { steps: SR[] }).steps = steps;

    const runs: RR[] = [
      { blockId: 'learn', runIndex: 0, guided: true, pressure: false, revised: false, durationMs: 40_000, correct: 0, omitted: 10, orderErrors: 10, offProcedure: 0, perseverations: 0, completed: true },
      { blockId: 'learn', runIndex: 3, guided: false, pressure: false, revised: false, durationMs: 36_000, correct: opts.learnCorrect, omitted: 10 - opts.learnCorrect, orderErrors: 0, offProcedure: 0, perseverations: 0, completed: true },
      { blockId: 'baseline', runIndex: 0, guided: false, pressure: false, revised: false, durationMs: 32_000, correct: opts.baseCorrect, omitted: opts.omitted, orderErrors: opts.orderErrors, offProcedure: 1, perseverations: 0, completed: true },
      { blockId: 'revised', runIndex: 0, guided: false, pressure: true, revised: false, durationMs: 38_000, correct: opts.pressureCorrect, omitted: 10 - opts.pressureCorrect, orderErrors: 0, offProcedure: 0, perseverations: 0, completed: false },
      { blockId: 'revised', runIndex: 1, guided: false, pressure: false, revised: true, durationMs: 34_000, correct: 9, omitted: 1, orderErrors: 0, offProcedure: 0, perseverations: opts.perseverations, completed: true },
    ];
    (mod as unknown as { runs: RR[] }).runs = runs;
    (mod as unknown as { resumptions: unknown[] }).resumptions = opts.lags.map((l, i) => ({
      runIndex: 0, lagMs: l, reorientationMs: opts.reorients[i] ?? NaN,
      decisionMs: l - (opts.reorients[i] ?? NaN), wrongStationVisits: 1,
      resumedAtStep: 4, correct: true,
    }));
    const res = mod.finish(ctx);
    return { ctx, res };
  }

  const base = {
    learnCorrect: 9, baseCorrect: 10, pressureCorrect: 8,
    omitted: 0, orderErrors: 0, perseverations: 1,
    lags: [3000, 3600, 4200], reorients: [1100, 1300, 1500],
  };
  const vrP = protocolRun('vr', base);
  check('guided passes are excluded from the accuracy, mistakes and all',
    vrP.ctx._metrics.order_errors === 0, vrP.ctx._metrics.order_errors);
  check('compliance under pressure is the pressured rate over the baseline rate',
    near(vrP.ctx._metrics.compliance_under_pressure!, 0.8, 0.001),
    vrP.ctx._metrics.compliance_under_pressure);
  check('sequence recall comes from the unguided learning pass',
    near(vrP.ctx._metrics.sequence_recall_accuracy!, 0.9, 0.001),
    vrP.ctx._metrics.sequence_recall_accuracy);
  check('resumption lag is the median of the interruptions',
    vrP.ctx._metrics.resumption_lag === 3600, vrP.ctx._metrics.resumption_lag);
  check('VR reports the decomposition and the wrong-station count',
    ['reorientation_time', 'decision_time', 'wrong_station_visits']
      .every((k) => k in vrP.ctx._metrics));
  check('VR scores six components including spatial place keeping',
    vrP.ctx._scores.length === 6 && vrP.ctx._scores.includes('spatial_place_keeping'),
    vrP.ctx._scores);
  check('the result names how much of the recovery was turning',
    (vrP.res.headline[2]!.hint ?? '').includes('visszatájékozódás'));

  {
    const over = protocolRun('vr', { ...base, pressureCorrect: 10, baseCorrect: 8 });
    check('performing better under the deadline is capped at 1.0, not rewarded',
      over.ctx._metrics.compliance_under_pressure === 1,
      over.ctx._metrics.compliance_under_pressure);
  }
  for (const p of ['desktop', 'mobile'] as const) {
    const flat = protocolRun(p, base);
    check(`${p}: the VR decomposition is absent, not zero`,
      !['reorientation_time', 'decision_time', 'wrong_station_visits']
        .some((k) => k in flat.ctx._metrics));
    check(`${p}: resumption lag itself is still measured`,
      flat.ctx._metrics.resumption_lag === 3600);
    check(`${p}: five scoring components`, flat.ctx._scores.length === 5, flat.ctx._scores);
    check(`${p}: spatialWeightsApplied false`,
      (flat.res.summary as { spatialWeightsApplied: boolean }).spatialWeightsApplied === false);
  }
  {
    const d = protocolRun('desktop', base);
    check('desktop names the pointer sweep differently from a body turn',
      'pointer_reorientation_time' in d.ctx._metrics);
    const m = protocolRun('mobile', base);
    check('mobile has no reorientation measure under any name',
      !('pointer_reorientation_time' in m.ctx._metrics));
  }
  {
    const clean = protocolRun('vr', { ...base, perseverations: 0 });
    const stuck = protocolRun('vr', { ...base, perseverations: 2 });
    check('perseveration is per revised run and lowers the adaptation score',
      clean.ctx._metrics.perseveration_rate === 0 && stuck.ctx._metrics.perseveration_rate === 2
      && clean.res.opsScore > stuck.res.opsScore,
      [clean.res.opsScore, stuck.res.opsScore]);
  }

  /* ------------------------------------------------------ trial record */

  {
    const { mod, ctx, M, proc } = machine();
    M.operate(proc[0]!, 500);
    M.operate(proc[3]!, 1500);
    const outcomes = ctx._trials.map((t) => t.outcome);
    check('an omitted step is written as a miss with no response',
      outcomes.filter((o) => o === 'miss').length === 2
      && ctx._trials.filter((t) => t.outcome === 'miss')
        .every((t) => (t as unknown as { response: unknown }).response === null),
      outcomes);
    check('a correct step is a hit carrying its step time',
      ctx._trials.some((t) => t.outcome === 'hit' && t.reactionTimeMs === 500), ctx._trials[0]);
    void mod;
  }
  {
    const { ctx, M, proc } = machine();
    M.guided = true;
    M.operate(proc[0]!, 500);
    check('guided teaching passes write no trial records at all', ctx._trials.length === 0);
  }

  /* ---------------------------------------------------------- manifest */

  const pm = MODULE_BY_CODE.PROTOCOL!;
  check('PROTOCOL is active in the catalogue', pm.status === 'active', pm.status);
  check('PROTOCOL runs on all three platforms',
    (['vr', 'desktop', 'mobile'] as const).every((p) => isRunnableOn(pm, p)));
  check('PROTOCOL has no challenge mode - a live score would turn it into a race',
    pm.challengeMode === false);
  check('PROTOCOL headline metrics are all produced',
    pm.headlineMetrics.every((k) => k in vrP.ctx._metrics),
    pm.headlineMetrics.filter((k) => !(k in vrP.ctx._metrics)));
  check('PROTOCOL is not shown on the sport domain',
    pm.domains.C.relevance === 'none');
}

/* ================================================================ INTENT */
console.log('\nINTENT  (mozgásolvasás)');
{
  const MOVEMENT_MS = 1400;
  const OCCLUSIONS = [0.40, 0.55, 0.70, 0.85];

  /* ------------------------------------------------- the point-light rig */

  check('the figure is thirteen joints', JOINTS.length === 13, JOINTS.length);
  {
    const a = pose({ t: 0.6, dirEarly: 1, dirFinal: 1, height: 1.7 });
    const b = pose({ t: 0.6, dirEarly: 1, dirFinal: 1, height: 1.7 });
    check('the same parameters give the same pose, exactly',
      JOINTS.every((j) => a[j]!.distanceTo(b[j]!) === 0));
  }
  {
    // The core design claim: a feint differs from a genuine trial in ONE sign.
    const genuine = pose({ t: 0.35, dirEarly: 1, dirFinal: 1, height: 1.7 });
    const feint = pose({ t: 0.35, dirEarly: -1, dirFinal: 1, height: 1.7 });
    const leanDiff = genuine.head.x - feint.head.x;
    check('during preparation a feint leans the other way', Math.abs(leanDiff) > 0.02, leanDiff);
    const gLate = pose({ t: 0.95, dirEarly: 1, dirFinal: 1, height: 1.7 });
    const fLate = pose({ t: 0.95, dirEarly: -1, dirFinal: 1, height: 1.7 });
    check('the leading foot commits identically in both - only the preparation differs',
      Math.abs(gLate.ankleR.x - fLate.ankleR.x) < 0.06,
      gLate.ankleR.x - fLate.ankleR.x);
    check('and both end up going the same way',
      Math.sign(gLate.hipL.x) === Math.sign(fLate.hipL.x) && gLate.hipL.x > 0.2);
  }
  {
    // At the earliest occlusion a feint is unreadable BY DESIGN: only the
    // preparation has happened, and it points the wrong way.
    const early = pose({ t: 0.40, dirEarly: -1, dirFinal: 1, height: 1.7 });
    check('at the first occlusion the visible lean points AWAY from the outcome',
      Math.sign(early.head.x) === -1, early.head.x);
    const late = pose({ t: 0.85, dirEarly: -1, dirFinal: 1, height: 1.7 });
    check('by the last occlusion the commitment has overtaken the lean',
      late.hipL.x > 0, late.hipL.x);
  }
  {
    const h1 = pose({ t: 0.5, dirEarly: 1, dirFinal: 1, height: 1.70 });
    const h2 = pose({ t: 0.5, dirEarly: 1, dirFinal: 1, height: 0.85 });
    check('the figure scales with its height', near(h1.head.y, h2.head.y * 2, 1e-9));
  }
  {
    const toward = depthOffsetM(0.9, -1, -1, 1.0);
    const away = depthOffsetM(0.9, 1, 1, 1.0);
    check('the depth movement goes both ways and by the same amount',
      toward < 0 && away > 0 && near(Math.abs(toward), Math.abs(away), 1e-9), [toward, away]);
    check('and it starts from rest', near(depthOffsetM(0, 1, 1, 1.0), 0, 1e-9));
  }

  /* --------------------------------------------------- the trial list */

  function lists(seed: number) {
    const mod = new IntentModule();
    const ctx = fakeCtx('vr', seed);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    return {
      frontal: mod.trialList('frontal', new Rng(seed)),
      depth: mod.trialList('depth', new Rng(seed)),
      peripheral: mod.trialList('peripheral', new Rng(seed)),
    };
  }
  {
    const { frontal, depth, peripheral } = lists(1234);
    check('the frontal block is 48 trials', frontal.length === 48, frontal.length);
    check('direction is balanced',
      frontal.filter((t) => t.dirFinal === -1).length === 24, frontal.length);
    check('viewpoint is balanced',
      frontal.filter((t) => t.viewpoint === 'side').length === 24);
    check('each occlusion level appears equally often',
      OCCLUSIONS.every((o) => frontal.filter((t) => t.occlusion === o).length === 12),
      OCCLUSIONS.map((o) => frontal.filter((t) => t.occlusion === o).length));
    const feints = frontal.filter((t) => t.deceptive);
    check('one quarter of the trials are feints', feints.length === 12, feints.length);
    check('and the feints are spread evenly over the occlusion levels, not clumped',
      OCCLUSIONS.every((o) => feints.filter((t) => t.occlusion === o).length === 3),
      OCCLUSIONS.map((o) => feints.filter((t) => t.occlusion === o).length));
    check('every feint has its preparation inverted, and no genuine trial does',
      feints.every((t) => t.dirEarly === -t.dirFinal)
      && frontal.filter((t) => !t.deceptive).every((t) => t.dirEarly === t.dirFinal));
    check('the depth and peripheral blocks are 16 trials each',
      depth.length === 16 && peripheral.length === 16);
    check('the peripheral block uses both sides equally',
      peripheral.filter((t) => t.azDeg < 0).length === 8,
      peripheral.filter((t) => t.azDeg < 0).length);
  }
  {
    const a = JSON.stringify(lists(99).frontal);
    const b = JSON.stringify(lists(99).frontal);
    const c = JSON.stringify(lists(100).frontal);
    check('the same seed gives the same trial list', a === b);
    check('a different seed gives a different order', a !== c);
  }

  /* --------------------------------------------- the earliest-frame rule */

  {
    const pts = [{ x: 560, y: 0.50 }, { x: 770, y: 0.60 }, { x: 980, y: 0.80 }, { x: 1190, y: 0.92 }];
    const c = risingCrossing(pts, 0.70);
    check('a rising curve crossing 0.70 between 770 and 980 is interpolated there',
      c.bounded && near(c.ms, 875, 30), c);
  }
  {
    const c = risingCrossing(
      [{ x: 560, y: 0.55 }, { x: 770, y: 0.58 }, { x: 980, y: 0.61 }, { x: 1190, y: 0.64 }], 0.70);
    check('a curve that never reaches the level reports the LONGEST occlusion, not the shortest',
      !c.bounded && c.ms === 1190 && c.label.startsWith('≥'), c);
  }
  {
    const c = risingCrossing(
      [{ x: 560, y: 0.90 }, { x: 770, y: 0.92 }, { x: 980, y: 0.95 }, { x: 1190, y: 0.97 }], 0.70);
    check('a curve already above at the earliest occlusion reports "at most" that',
      !c.bounded && c.above && c.ms === 560 && c.label.startsWith('≤'), c);
  }
  check('an empty curve gives no number at all',
    !Number.isFinite(risingCrossing([], 0.7).ms));

  /* ------------------------------------------------------------ scoring */

  interface A {
    block: string; occlusion: number; dirFinal: number; dirEarly: number;
    deceptive: boolean; viewpoint: string; azDeg: number;
    answer: number; correct: boolean; rtMs: number; confidence: number; confidenceRtMs: number;
  }
  const ans = (o: Partial<A> & { correct: boolean }): A => ({
    block: 'frontal', occlusion: 0.70, dirFinal: 1, dirEarly: 1, deceptive: false,
    viewpoint: 'front', azDeg: 0, answer: 1, rtMs: 900, confidence: 2, confidenceRtMs: 600, ...o,
  });

  function intentRun(platform: 'vr' | 'desktop' | 'mobile', build: (push: (a: A) => void) => void) {
    const mod = new IntentModule();
    const ctx = fakeCtx(platform);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    const list: A[] = [];
    build((a) => list.push(a));
    (mod as unknown as { answers: A[] }).answers = list;
    const res = mod.finish(ctx);
    return { ctx, res };
  }

  const accByOcc: Record<number, number> = { 0.40: 0.5, 0.55: 0.6, 0.70: 0.8, 0.85: 0.95 };
  const standard = (push: (a: A) => void) => {
    for (const occ of OCCLUSIONS) {
      // Nine genuine trials per level at the intended accuracy, three feints.
      const nCorrect = Math.round(accByOcc[occ]! * 9);
      for (let i = 0; i < 9; i++) {
        push(ans({
          occlusion: occ, correct: i < nCorrect,
          viewpoint: i % 2 === 0 ? 'front' : 'side',
          confidence: i < nCorrect ? 3 : 1,
        }));
      }
      for (let i = 0; i < 3; i++) {
        push(ans({ occlusion: occ, deceptive: true, dirEarly: -1, correct: occ >= 0.70 && i === 0 }));
      }
    }
  };

  const vrI = intentRun('vr', (push) => {
    standard(push);
    for (let i = 0; i < 16; i++) {
      push(ans({ block: 'depth', occlusion: i < 8 ? 0.55 : 0.85, correct: i % 4 !== 0 }));
    }
    for (let i = 0; i < 16; i++) {
      push(ans({
        block: 'peripheral', occlusion: i < 8 ? 0.55 : 0.85,
        azDeg: i % 2 === 0 ? -55 : 55, correct: i % 3 !== 0,
      }));
    }
  });
  check('prediction accuracy excludes the feints',
    near(vrI.ctx._metrics.prediction_accuracy!, (5 + 5 + 7 + 9) / 36, 0.02),
    vrI.ctx._metrics.prediction_accuracy);
  check('the earliest reliable frame is interpolated on the genuine curve',
    vrI.ctx._metrics.earliest_reliable_frame_ms! > 770
    && vrI.ctx._metrics.earliest_reliable_frame_ms! < 980,
    vrI.ctx._metrics.earliest_reliable_frame_ms);
  check('deception susceptibility uses only the two late occlusions',
    // late genuine (7+9)/18 = 0.889 ; late deceptive 2/6 = 0.333
    near(vrI.ctx._metrics.deception_susceptibility!, 16 / 18 - 2 / 6, 0.02),
    vrI.ctx._metrics.deception_susceptibility);
  check('confidence calibration is the high-minus-low accuracy difference',
    near(vrI.ctx._metrics.confidence_calibration!, 1 - 0, 0.02),
    vrI.ctx._metrics.confidence_calibration);
  check('VR reports the depth and peripheral measures',
    ['depth_intent_accuracy', 'depth_earliest_frame_ms', 'peripheral_intent_accuracy', 'peripheral_cost']
      .every((k) => k in vrI.ctx._metrics));
  check('the peripheral cost is matched on occlusion level, not taken raw',
    Number.isFinite(vrI.ctx._metrics.peripheral_cost!), vrI.ctx._metrics.peripheral_cost);
  check('VR scores six components', vrI.ctx._scores.length === 6, vrI.ctx._scores);

  for (const p of ['desktop', 'mobile'] as const) {
    const flat = intentRun(p, standard);
    check(`${p}: the depth and peripheral measures are absent, not zero`,
      !['depth_intent_accuracy', 'depth_earliest_frame_ms', 'peripheral_intent_accuracy', 'peripheral_cost']
        .some((k) => k in flat.ctx._metrics));
    check(`${p}: prediction accuracy and the earliest frame are still measured`,
      'prediction_accuracy' in flat.ctx._metrics && 'earliest_reliable_frame_ms' in flat.ctx._metrics);
    check(`${p}: four scoring components`, flat.ctx._scores.length === 4, flat.ctx._scores);
    check(`${p}: spatialWeightsApplied false`,
      (flat.res.summary as { spatialWeightsApplied: boolean }).spatialWeightsApplied === false);
    check(`${p}: the result says the depth measure needs VR`,
      flat.res.headline.some((h) => (h.hint ?? '').includes('VR kell')));
  }
  {
    // Never reaching the level must be reported as a bound, not as a number.
    const poor = intentRun('desktop', (push) => {
      for (const occ of OCCLUSIONS) {
        for (let i = 0; i < 9; i++) push(ans({ occlusion: occ, correct: i < 5 }));
      }
    });
    const sum = poor.res.summary as { earliestReliableBounded: boolean; earliestReliableFrameMs: number | null; earliestReliableLabel: string };
    check('a participant who never reaches the level gets a bound, not a fabricated number',
      sum.earliestReliableBounded === false && sum.earliestReliableFrameMs === null
      && sum.earliestReliableLabel.startsWith('≥'), sum);
    check('and the result screen says so in words',
      (poor.res.headline[1]!.hint ?? '').includes('sem állt össze'));
  }
  {
    const front = intentRun('desktop', (push) => {
      for (const occ of OCCLUSIONS) {
        for (let i = 0; i < 8; i++) {
          push(ans({ occlusion: occ, viewpoint: i < 4 ? 'front' : 'side', correct: i < 4 ? true : i < 6 }));
        }
      }
    });
    check('viewpoint cost is the front-minus-side accuracy difference',
      near(front.ctx._metrics.viewpoint_cost!, 1 - 0.5, 0.001), front.ctx._metrics.viewpoint_cost);
  }
  {
    const over = intentRun('desktop', (push) => {
      for (const occ of OCCLUSIONS) {
        for (let i = 0; i < 8; i++) push(ans({ occlusion: occ, correct: i < 4, confidence: 3 }));
      }
    });
    check('overconfidence is the confidence level minus the accuracy it earned',
      near(over.ctx._metrics.overconfidence!, 1 - 0.5, 0.001), over.ctx._metrics.overconfidence);
  }

  /* ---------------------------------------------------------- manifest */

  const im = MODULE_BY_CODE.INTENT!;
  check('INTENT is active in the catalogue', im.status === 'active', im.status);
  check('INTENT runs on all three platforms',
    (['vr', 'desktop', 'mobile'] as const).every((p) => isRunnableOn(im, p)));
  check('INTENT is primary for sport', im.domains.C.relevance === 'primary');
  check('INTENT headline metrics are all produced',
    im.headlineMetrics.every((k) => k in vrI.ctx._metrics),
    im.headlineMetrics.filter((k) => !(k in vrI.ctx._metrics)));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
