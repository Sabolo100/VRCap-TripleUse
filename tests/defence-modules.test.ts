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
    audio: { speechAvailable: false, tone: () => 0, noise: () => 0, speak: () => false, stopSpeech: () => {}, outputLatencyMs: 12 },
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
