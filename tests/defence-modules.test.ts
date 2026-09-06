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
import { MultiModule } from '../packages/client/src/modules/multi/MultiModule.js';
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
