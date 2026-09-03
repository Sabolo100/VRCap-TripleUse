/**
 * Modules 12-15: FIELD, STEADY, RHYTHM, ADAPT.
 *
 * Each is checked the same way: feed the scoring pipeline a synthetic
 * participant whose true value is known, and require the module to recover it.
 * The spatial claims get their own assertions - a metric that is supposed to
 * be absent on a flat platform must actually be absent, not zero.
 */
import { Rng, MODULE_BY_CODE, supportsPlatform, isRunnableOn, isRunnable } from '@vrcap/shared';
import type { ModuleContext } from '../packages/client/src/engine/task/Module.js';
import { FieldModule } from '../packages/client/src/modules/field/FieldModule.js';
import { SteadyModule } from '../packages/client/src/modules/steady/SteadyModule.js';
import { RhythmModule } from '../packages/client/src/modules/rhythm/RhythmModule.js';
import { AdaptModule } from '../packages/client/src/modules/adapt/AdaptModule.js';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

interface FakeCtx extends ModuleContext {
  _metrics: Record<string, number>;
  _scores: Record<string, number>;
  _weights: { key: string; weight: number }[];
}

function fakeCtx(platform: 'vr' | 'desktop' | 'mobile' = 'vr', seed = 5): FakeCtx {
  const metrics: Record<string, number> = {};
  const scores: Record<string, number> = {};
  const ctx = {
    platform,
    engine: {
      clock: { frameInterval: 11.1, frameTime: 0 },
      camera: { getWorldQuaternion: () => ({}) },
      input: { on: () => () => {}, pose: () => ({ head: [], left: [], right: [] }) },
    },
    recorder: {
      trialNumber: 0,
      metric: (n: string, v: number) => { if (Number.isFinite(v)) metrics[n] = v; },
      score: (t: string, v: number) => { scores[t] = v; },
      trial: () => {}, event: () => {},
    },
    rng: new Rng(seed), scene: {}, panels: { remove: () => {} }, audio: { click: () => {} },
    theme: { accent: '#fff', accent2: '#0ff', ok: '#0f0', bad: '#f00', text: '#fff', textMuted: '#888' },
  } as unknown as ModuleContext;
  return Object.assign(ctx, { _metrics: metrics, _scores: scores, _weights: [] }) as FakeCtx;
}

/* ================================================================= FIELD */
console.log('\nFIELD  (hasznos látómező)');
{
  const ECCS = [10, 20, 35, 50];

  /**
   * Build a participant whose peripheral accuracy follows a known curve, so
   * the interpolated field radius has a right answer.
   */
  function build(opts: {
    platform?: 'vr' | 'desktop';
    accByEcc: Record<number, number>;
    depthNear: number; depthFar: number;
    fixationBreaks?: number;
    thresholdMs?: number; clutteredMs?: number;
    dvaDps?: number;
    centralAcc?: number;
    centralAccSingle?: number;
  }) {
    const platform = opts.platform ?? 'vr';
    const mod = new FieldModule();
    const ctx = fakeCtx(platform);
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;

    const trials: unknown[] = [];
    const push = (
      block: string, ecc: number, depth: number, periphOk: boolean, centralOk: boolean,
      brk = false, centralOnly = false
    ) => {
      trials.push({
        block, centralOnly, durationMs: 90, frames: 8, eccentricityDeg: ecc, directionIndex: 0, depthM: depth,
        centralShape: 'cube', centralAnswer: centralOk ? 'cube' : 'sphere', centralCorrect: centralOk,
        peripheralAnswer: centralOnly ? null : (periphOk ? 0 : 3),
        peripheralCorrect: centralOnly ? true : periphOk,
        errorDirections: periphOk ? 0 : 3,
        rtCentralMs: 500, rtPeripheralMs: 900, headMoveDeg: brk ? 12 : 1.5, fixationBreak: brk,
      });
    };

    // 24 trials per eccentricity gives an accuracy resolution of ~4 points,
    // fine enough that the interpolated crossing is not quantisation noise.
    const N = 24;
    const centralAcc = opts.centralAcc ?? 0.95;
    for (const ecc of ECCS) {
      const acc = opts.accByEcc[ecc] ?? 0.5;
      for (let i = 0; i < N; i++) {
        push('threshold', ecc, 1.6, i < Math.round(acc * N), i < Math.round(centralAcc * N));
      }
    }
    for (let i = 0; i < 16; i++) {
      const centralOk = i < Math.round(centralAcc * 16);
      push('depthfield', 20, 1.6, i < Math.round(opts.depthNear * 16), centralOk);
      push('depthfield', 20, 5.2, i < Math.round(opts.depthFar * 16), centralOk);
    }
    // Single-task catch trials: the dual-task baseline.
    const singleAcc = opts.centralAccSingle ?? 0.99;
    for (let i = 0; i < 24; i++) push('threshold', 10, 1.6, true, i < Math.round(singleAcc * 24), false, true);
    for (let i = 0; i < (opts.fixationBreaks ?? 0); i++) push('threshold', 50, 1.6, true, true, true);

    (mod as unknown as { trials: unknown[] }).trials = trials;
    (mod as unknown as { dvaTrials: unknown[] }).dvaTrials =
      Array.from({ length: 20 }, () => ({
        speedMps: 3, angularSpeedDegPerSec: opts.dvaDps ?? 30, gapDirection: 0, answer: 0,
        correct: true, distanceAtResponseM: 3,
      }));

    // Staircases are stubbed with a fixed threshold so the scoring pipeline is
    // tested independently of the adaptive procedure (which has its own test).
    const stub = (v: number) => ({ threshold: () => v, reversals: new Array(12).fill({ value: v }), value: v });
    (mod as unknown as { staircases: Map<string, unknown> }).staircases = new Map<string, unknown>([
      ['threshold', stub(opts.thresholdMs ?? 85)],
      ['cluttered', stub(opts.clutteredMs ?? 130)],
      ['dva', stub(3.2)],
    ]);

    const res = mod.finish(ctx);
    return { res, m: ctx._metrics, s: ctx._scores };
  }

  // A field that decays past 35 degrees: the 50% crossing sits between 35 and 50.
  const wide = build({
    accByEcc: { 10: 0.96, 20: 0.88, 35: 0.63, 50: 0.42 },
    depthNear: 0.88, depthFar: 0.75,
  });
  console.log(`  széles mező: sugár ${wide.m.field_radius_deg?.toFixed(1)}°, OPS ${wide.res.opsScore}`);
  check('interpolates a field radius between the tested eccentricities',
    near(wide.m.field_radius_deg!, 43.6, 2.0), wide.m.field_radius_deg);
  check('marks the radius as bounded when the curve actually crossed 50%',
    wide.m.field_radius_bounded === 1);

  // A narrow field: already below 50% at 35 degrees.
  const narrow = build({
    accByEcc: { 10: 0.92, 20: 0.71, 35: 0.42, 50: 0.21 },
    depthNear: 0.85, depthFar: 0.55,
  });
  console.log(`  szűk mező:   sugár ${narrow.m.field_radius_deg?.toFixed(1)}°, OPS ${narrow.res.opsScore}`);
  check('a narrower field yields a smaller radius',
    narrow.m.field_radius_deg! < wide.m.field_radius_deg!, [narrow.m.field_radius_deg, wide.m.field_radius_deg]);
  check('and a lower score', narrow.res.opsScore < wide.res.opsScore,
    { narrow: narrow.res.opsScore, wide: wide.res.opsScore });

  // Someone still above 50% at the outer edge: the radius must be reported as
  // a lower bound, not as a precise number the test never established.
  const unbounded = build({
    accByEcc: { 10: 0.97, 20: 0.95, 35: 0.9, 50: 0.83 },
    depthNear: 0.9, depthFar: 0.86,
  });
  check('an unexhausted field is flagged as a lower bound',
    unbounded.m.field_radius_bounded === 0 && unbounded.m.field_radius_deg === 50,
    [unbounded.m.field_radius_deg, unbounded.m.field_radius_bounded]);
  check('and the result screen says so',
    unbounded.res.headline[0]!.value.startsWith('≥'), unbounded.res.headline[0]);

  // The depth manipulation.
  const depthCost = build({
    accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.4 },
    depthNear: 0.94, depthFar: 0.62,
  });
  check('recovers the depth field cost', near(depthCost.m.depth_field_cost!, 0.3125, 0.05), depthCost.m.depth_field_cost);
  check('a depth-insensitive participant has a near-zero cost',
    Math.abs(build({ accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.4 }, depthNear: 0.875, depthFar: 0.875 })
      .m.depth_field_cost!) < 0.02);

  // The honesty rule.
  const flat = build({
    platform: 'desktop',
    accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.4 },
    depthNear: 0.9, depthFar: 0.6,
  });
  for (const name of ['field_radius_deg', 'depth_field_cost', 'outer_field_ratio', 'dva_threshold_dps', 'fixation_break_rate']) {
    check(`flat platform: ${name} is absent, not zero`, !(name in flat.m), flat.m[name]);
  }
  check('flat platform still reports the inner-field threshold', Number.isFinite(flat.m.ufov_threshold_ms!));
  check('flat platform scores use the rescaled weights',
    'clutter_resistance' in flat.s && !('field_size' in flat.s), Object.keys(flat.s));
  check('VR scores use the spatial weights',
    'field_size' in wide.s && 'depth_field' in wide.s && !('clutter_resistance' in wide.s), Object.keys(wide.s));
  check('the run records which weighting was applied',
    wide.res.summary.spatialWeightsApplied === true && flat.res.summary.spatialWeightsApplied === false);
  check('flat platform tells the participant what is missing',
    flat.res.headline.some((h) => h.value.includes('headset')), flat.res.headline.map((h) => h.value));

  // Fixation control: a glance is not a peripheral detection.
  const clean = build({ accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.40 }, depthNear: 0.9, depthFar: 0.8 });
  const glancer = build({
    accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.40 }, depthNear: 0.9, depthFar: 0.8,
    fixationBreaks: 60,
  });
  check('trials with a head turn do not inflate the outer accuracy',
    near(clean.m.peripheral_accuracy_50!, glancer.m.peripheral_accuracy_50!, 0.001),
    [clean.m.peripheral_accuracy_50, glancer.m.peripheral_accuracy_50]);
  check('but the head turns are still counted and reported',
    glancer.m.fixation_break_rate! > 0.25 && clean.m.fixation_break_rate === 0,
    [clean.m.fixation_break_rate, glancer.m.fixation_break_rate]);
  check('a frequent glancer is warned on the result screen',
    glancer.res.headline.some((h) => h.label === 'FIGYELEM'), glancer.res.headline.map((h) => h.label));
  const borderline = build({
    accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.40 }, depthNear: 0.9, depthFar: 0.8,
    fixationBreaks: 30,
  });
  check('an occasional glance does not trigger the warning',
    borderline.m.fixation_break_rate! < 0.25 && !borderline.res.headline.some((h) => h.label === 'FIGYELEM'),
    borderline.m.fixation_break_rate);

  // The dual-task cost needs the single-task baseline to exist at all.
  const noCost = build({
    accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.40 }, depthNear: 0.9, depthFar: 0.8,
    centralAcc: 0.96, centralAccSingle: 0.96,
  });
  const bigCost = build({
    accByEcc: { 10: 0.95, 20: 0.86, 35: 0.62, 50: 0.40 }, depthNear: 0.9, depthFar: 0.8,
    centralAcc: 0.70, centralAccSingle: 0.96,
  });
  check('central cost is the single-task minus dual-task accuracy',
    near(bigCost.m.central_cost!, 0.25, 0.03), bigCost.m.central_cost);
  check('someone who pays no dual-task cost scores near zero',
    Math.abs(noCost.m.central_cost!) < 0.03, noCost.m.central_cost);
  check('both accuracies are reported, not just the difference',
    Number.isFinite(bigCost.m.central_accuracy_single!) && Number.isFinite(bigCost.m.central_accuracy_dual!));
  check('a larger dual-task cost lowers the score', bigCost.res.opsScore < noCost.res.opsScore,
    { bigCost: bigCost.res.opsScore, noCost: noCost.res.opsScore });
  check('catch trials do not enter the peripheral accuracy',
    near(noCost.m.peripheral_accuracy_10!, 0.958, 0.01), noCost.m.peripheral_accuracy_10);

  check('distractor cost is the difference of the two thresholds',
    near(wide.m.distractor_cost!, 45, 0.01), wide.m.distractor_cost);
  check('no headline value is NaN', wide.res.headline.every((h) => !h.value.includes('NaN')));

  // Geometry: the two depths must subtend the same angle, or "far" would just
  // mean "smaller" and the depth block would measure size.
  const angular = (physicalSize: number, dist: number) => 2 * Math.atan(physicalSize / (2 * dist)) * 180 / Math.PI;
  const nearSize = 2 * 1.6 * Math.tan((3.6 * Math.PI) / 360);
  const farSize = nearSize * (5.2 / 1.6);
  check('the near and far targets subtend the same angle within 0.2°',
    Math.abs(angular(nearSize, 1.6) - angular(farSize, 5.2)) < 0.2,
    [angular(nearSize, 1.6), angular(farSize, 5.2)]);
}

/* ================================================================ STEADY */
console.log('\nSTEADY  (poszturális stabilitás)');
{
  const HZ = 90;

  /**
   * Build a synthetic standing trace. `swaySd` is the random sway amplitude in
   * metres; `driveAmp` is how strongly the participant follows the 0.20 Hz
   * moving room - the thing the block exists to detect.
   */
  function trace(block: string, condition: string, seconds: number, o: {
    swaySd: number; driveAmp?: number; tremorMm?: number; tremorHz?: number;
    driftMm?: number; footDownAtMs?: number | null; seed?: number;
  }) {
    const rng = new Rng(o.seed ?? 21);
    const g = () => {
      const u = Math.max(1e-9, rng.next());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
    };
    const samples: { t: number; x: number; y: number; z: number }[] = [];
    const n = Math.round(seconds * HZ);
    // Ring position used by the drift computation in the module.
    const ring = { x: 0.16, y: 1.42, z: -0.55 };
    for (let i = 0; i < n; i++) {
      const t = (i / HZ) * 1000;
      const tS = i / HZ;
      let x = g() * o.swaySd;
      let z = g() * o.swaySd;
      let y = 1.6;
      // The moving room drives antero-posterior sway only, between 15 and 35 s.
      if (o.driveAmp && tS >= 15 && tS < 35) {
        z += Math.sin(2 * Math.PI * 0.20 * (tS - 15)) * o.driveAmp;
      }
      if (block === 'hand') {
        const tr = (o.tremorMm ?? 0) / 1000;
        const f = o.tremorHz ?? 9;
        x = ring.x + Math.sin(2 * Math.PI * f * tS) * tr + g() * tr * 0.1;
        y = ring.y + Math.cos(2 * Math.PI * f * tS) * tr;
        z = ring.z + Math.sin(2 * Math.PI * f * tS + 1) * tr + ((o.driftMm ?? 0) / 1000) * (tS / seconds);
      }
      samples.push({ t, x, y, z });
    }
    return {
      block, condition, samples, durationS: seconds, discardedS: 3,
      footDownAtMs: o.footDownAtMs ?? null, aborted: false,
    };
  }

  function build(traces: unknown[]) {
    const mod = new SteadyModule();
    const ctx = fakeCtx('vr');
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { traces: unknown[] }).traces = traces;
    (mod as unknown as { handRing: unknown }).handRing = { position: { x: 0.16, y: 1.42, z: -0.55 } };
    (mod as unknown as { oneLegSkipped: boolean }).oneLegSkipped = false;
    const res = mod.finish(ctx);
    return { res, m: ctx._metrics, s: ctx._scores };
  }

  const steadyStance = () => trace('stance', 'both', 30, { swaySd: 0.004, seed: 1 });
  const steadyHands = () => [
    trace('hand', 'right', 30, { swaySd: 0, tremorMm: 0.5, tremorHz: 9, driftMm: 1, seed: 3 }),
    trace('hand', 'left', 30, { swaySd: 0, tremorMm: 0.6, tremorHz: 9, driftMm: 1, seed: 4 }),
  ];

  // A participant who does NOT follow the moving room: sway grows a little
  // (fatigue) but carries no power at the drive frequency.
  const independent = build([
    steadyStance(),
    trace('dark', 'both', 30, { swaySd: 0.006, seed: 2 }),
    trace('sway', 'both', 45, { swaySd: 0.005, driveAmp: 0, seed: 5 }),
    ...steadyHands(),
  ]);

  // A visually dependent participant: same overall sway, but locked to 0.20 Hz.
  const dependent = build([
    steadyStance(),
    trace('dark', 'both', 30, { swaySd: 0.006, seed: 2 }),
    trace('sway', 'both', 45, { swaySd: 0.005, driveAmp: 0.010, seed: 5 }),
    ...steadyHands(),
  ]);

  console.log(`  független:  ${independent.m.visual_reliance_mm?.toFixed(2)} mm @0,2 Hz (koncentráció ${independent.m.drive_frequency_concentration?.toFixed(2)}), OPS ${independent.res.opsScore}`);
  console.log(`  függő:      ${dependent.m.visual_reliance_mm?.toFixed(2)} mm @0,2 Hz (koncentráció ${dependent.m.drive_frequency_concentration?.toFixed(2)}), OPS ${dependent.res.opsScore}`);

  check('a participant who ignores the moving room sways little at its frequency',
    independent.m.visual_reliance_mm! < 3, independent.m.visual_reliance_mm);
  check('a participant who follows it sways close to the driven amplitude',
    near(dependent.m.visual_reliance_mm!, 10, 2.5), dependent.m.visual_reliance_mm);
  check('the reliance figure is readable, not an unbounded ratio',
    dependent.m.visual_reliance_mm! < 100, dependent.m.visual_reliance_mm);
  check('drive-frequency concentration separates following from moving more',
    dependent.m.drive_frequency_concentration! > independent.m.drive_frequency_concentration! + 0.2,
    [independent.m.drive_frequency_concentration, dependent.m.drive_frequency_concentration]);
  check('concentration stays inside 0-1',
    dependent.m.drive_frequency_concentration! <= 1 && independent.m.drive_frequency_concentration! >= 0);
  check('and therefore scores lower on visual independence',
    dependent.s.visual_independence! < independent.s.visual_independence!,
    [independent.s.visual_independence, dependent.s.visual_independence]);

  check('Romberg quotient is dark area over lit area',
    dependent.m.romberg_quotient! > 1.5 && dependent.m.romberg_quotient! < 3.5,
    dependent.m.romberg_quotient);
  check('a visually independent stance gives a Romberg near 1',
    (() => {
      const b = build([steadyStance(), trace('dark', 'both', 30, { swaySd: 0.004, seed: 9 }),
                       trace('sway', 'both', 45, { swaySd: 0.004, seed: 5 }), ...steadyHands()]);
      return Math.abs(b.m.romberg_quotient! - 1) < 0.45;
    })());

  check('tremor amplitude is recovered in millimetres',
    near(independent.m.tremor_rms_mm!, 0.45, 0.25), independent.m.tremor_rms_mm);
  check('tremor peak frequency is recovered',
    near(independent.m.tremor_peak_freq_hz!, 9, 0.5), independent.m.tremor_peak_freq_hz);
  const shaky = build([steadyStance(), trace('dark', 'both', 30, { swaySd: 0.006, seed: 2 }),
    trace('sway', 'both', 45, { swaySd: 0.005, seed: 5 }),
    trace('hand', 'right', 30, { swaySd: 0, tremorMm: 2.4, tremorHz: 6.5, seed: 3 }),
    trace('hand', 'left', 30, { swaySd: 0, tremorMm: 2.4, tremorHz: 6.5, seed: 4 })]);
  check('a shaky hand scores lower on steadiness',
    shaky.s.hand_steadiness! < independent.s.hand_steadiness!,
    [independent.s.hand_steadiness, shaky.s.hand_steadiness]);
  check('hand asymmetry is reported as the larger over the smaller',
    independent.m.hand_asymmetry! >= 1, independent.m.hand_asymmetry);

  // The optional block.
  const withLeg = build([
    steadyStance(), trace('dark', 'both', 30, { swaySd: 0.006, seed: 2 }),
    trace('sway', 'both', 45, { swaySd: 0.005, seed: 5 }),
    trace('oneleg', 'leftfoot', 20, { swaySd: 0.011, seed: 6 }),
    trace('oneleg', 'rightfoot', 20, { swaySd: 0.012, seed: 7 }),
    ...steadyHands(),
  ]);
  check('single-leg sway is larger than two-legged', withLeg.m.single_leg_area_ratio! > 2,
    withLeg.m.single_leg_area_ratio);
  check('skipping the optional block leaves the metric absent, not zero',
    !('single_leg_area_ratio' in independent.m));
  check('skipped: the remaining weights still sum to 1',
    !('single_leg_balance' in independent.s) && Object.keys(independent.s).length === 4,
    Object.keys(independent.s));
  check('included: five components', Object.keys(withLeg.s).length === 5, Object.keys(withLeg.s));
  check('the result screen says the block was skipped',
    independent.res.headline.some((h) => h.value === 'kihagyva'));
  check('and does not when it ran',
    !withLeg.res.headline.some((h) => h.value === 'kihagyva'));

  // Someone who put their foot down: only the standing portion counts.
  const early = build([
    steadyStance(), trace('dark', 'both', 30, { swaySd: 0.006, seed: 2 }),
    trace('sway', 'both', 45, { swaySd: 0.005, seed: 5 }),
    trace('oneleg', 'leftfoot', 20, { swaySd: 0.011, footDownAtMs: 8000, seed: 6 }),
    ...steadyHands(),
  ]);
  check('the trace is truncated at the moment the foot went down',
    early.res.summary.singleLeg !== null &&
    (early.res.summary as { singleLeg: { durationS: number } }).singleLeg.durationS === 8,
    early.res.summary.singleLeg);

  check('the result records that this is head tracking, not a force plate',
    String(independent.res.summary.instrument).includes('force-plate'));
  check('no headline value is NaN', independent.res.headline.every((h) => !h.value.includes('NaN')));
  check('sample rate is reported', near(independent.m.sample_rate_hz!, 90, 2), independent.m.sample_rate_hz);

  // Geometry: lattice grains must subtend the same angle at both extremes.
  const ang = (size: number, d: number) => 2 * Math.atan(size / (2 * d)) * 180 / Math.PI;
  check('lattice grains subtend the same angle at 2.5 m and 6.0 m',
    Math.abs(ang(0.05, 2.5) - ang(0.05 * (6.0 / 2.5), 6.0)) < 0.2,
    [ang(0.05, 2.5), ang(0.05 * (6.0 / 2.5), 6.0)]);
}

/* ================================================================ RHYTHM */
console.log('\nRHYTHM  (ritmusszinkronizáció)');
{
  /**
   * A synthetic tapper. `bias` is the mean asynchrony (negative = anticipates,
   * the normal finding); `jitter` is the sd, which is the precision measure.
   */
  function build(o: {
    platform?: 'vr' | 'desktop';
    bias?: number; jitter?: number;
    flashJitter?: number; movingJitter?: number;
    approachJitter?: number; peripheralJitter?: number;
    contSd?: number; contDrift?: number;
    polyAccuracy?: number;
    tempoLockAfter?: number;
    seed?: number;
  }) {
    const rng = new Rng(o.seed ?? 41);
    const g = () => {
      const u = Math.max(1e-9, rng.next());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
    };
    const beats: unknown[] = [];
    const taps: unknown[] = [];
    let idx = 0;
    let t = 10000;

    const bias = o.bias ?? -30;

    /**
     * Draw n values, then rescale them so the SAMPLE mean and sd are exactly
     * the requested ones. Without this the test is really testing the random
     * number generator: at 24 trials the sample sd of a 42 ms process carries
     * about 6 ms of its own noise, which is a third of the effect being
     * checked.
     */
    const exact = (n: number, meanMs: number, sdMs: number): number[] => {
      const raw = Array.from({ length: n }, () => g());
      const m0 = raw.reduce((a, b) => a + b, 0) / n;
      const centred = raw.map((v) => v - m0);
      const s0 = Math.sqrt(centred.reduce((a, b) => a + b * b, 0) / (n - 1));
      const k = s0 > 0 ? sdMs / s0 : 0;
      return centred.map((v) => meanMs + v * k);
    };

    const addBeats = (
      n: number, ioi: number, sourceKind: string, subBlock: string,
      jitter: number, paced = true, hand: 'left' | 'right' | 'any' = 'any', match = true
    ) => {
      const offsets = exact(n, bias, jitter);
      for (let i = 0; i < n; i++) {
        const time = t;
        const tapT = time + offsets[i]!;
        beats.push({
          index: idx++, time, ioiMs: ioi, paced, sourceKind, subBlock, hand,
          matchedTapT: match ? tapT : null,
        });
        if (match) taps.push({ t: tapT, hand, quantisationMs: 11.1, subBlock, beatIndex: idx - 1, asynchronyMs: tapT - time });
        t += ioi;
      }
    };

    // Paced tone at three tempi.
    for (const ioi of [400, 600, 800]) addBeats(24, ioi, 'tone', `tone${ioi}`, o.jitter ?? 25);

    // Continuation: unpaced beats whose taps drift at a known rate.
    let ct = t;
    let interval = 600;
    for (let i = 0; i < 24; i++) {
      const time = ct;
      beats.push({ index: idx++, time, ioiMs: 600, paced: false, sourceKind: 'tone',
                   subBlock: 'tone600', hand: 'any', matchedTapT: time });
      taps.push({ t: time, hand: 'any', quantisationMs: 11.1, subBlock: 'tone600', beatIndex: idx - 1, asynchronyMs: 0 });
      interval += o.contDrift ?? 0;
      ct += interval + g() * (o.contSd ?? 30);
    }
    t = ct + 2000;

    addBeats(40, 600, 'flash', 'flash', o.flashJitter ?? 42);
    addBeats(40, 600, 'moving', 'moving', o.movingJitter ?? 24);
    if ((o.platform ?? 'vr') === 'vr') {
      addBeats(32, 600, 'approach', 'approach', o.approachJitter ?? 34);
      addBeats(32, 600, 'peripheral', 'peripheral', o.peripheralJitter ?? 31);
    }

    // Tempo block: 20 beats at 600, then 450 - locking after N beats.
    const lockAfter = o.tempoLockAfter ?? 4;
    for (let i = 0; i < 20; i++) {
      beats.push({ index: idx++, time: t, ioiMs: 600, paced: true, sourceKind: 'tone',
                   subBlock: 'tempo', hand: 'any', matchedTapT: t + bias });
      t += 600;
    }
    for (let i = 0; i < 20; i++) {
      const locked = i >= lockAfter;
      beats.push({
        index: idx++, time: t, ioiMs: 450, paced: true, sourceKind: 'tone',
        subBlock: 'tempo', hand: 'any',
        matchedTapT: t + (locked ? 12 : 130),
      });
      t += 450;
    }

    // Polyrhythm: a proportion of beats land inside a quarter IOI.
    const acc = o.polyAccuracy ?? 0.7;
    for (let i = 0; i < 36; i++) {
      const hand: 'left' | 'right' = i % 2 === 0 ? 'left' : 'right';
      const ioi = hand === 'left' ? 900 : 600;
      const good = i < Math.round(acc * 36);
      beats.push({
        index: idx++, time: t, ioiMs: ioi, paced: true, sourceKind: 'poly',
        subBlock: 'poly_leftnear', hand,
        matchedTapT: t + (good ? 40 : ioi / 3),
      });
      t += 300;
    }

    const mod = new RhythmModule();
    const ctx = fakeCtx(o.platform ?? 'vr');
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { beats: unknown[] }).beats = beats;
    (mod as unknown as { taps: unknown[] }).taps = taps;
    (mod as unknown as { audioLatencies: number[] }).audioLatencies = [3.2, 3.5, 3.1];
    const res = mod.finish(ctx);
    return { res, m: ctx._metrics, s: ctx._scores };
  }

  const base = build({});
  console.log(`  alap: aszinkrónia ${base.m.async_mean_ms?.toFixed(1)} ± ${base.m.async_sd_ms?.toFixed(1)} ms, folytonossági nyereség ${base.m.visual_continuity_gain?.toFixed(1)} ms, OPS ${base.res.opsScore}`);

  check('recovers the mean asynchrony', near(base.m.async_mean_ms!, -30, 4), base.m.async_mean_ms);
  check('the mean asynchrony is negative, as the literature expects',
    base.m.async_mean_ms! < 0);
  check('recovers the asynchrony sd', near(base.m.async_sd_ms!, 25, 4), base.m.async_sd_ms);
  check('reports the sd per tempo',
    ['async_sd_400', 'async_sd_600', 'async_sd_800'].every((k) => Number.isFinite(base.m[k]!)));

  // The flagship spatial claim: a moving beat helps, a flash does not.
  check('recovers the visual continuity gain',
    near(base.m.visual_continuity_gain!, 18, 1), base.m.visual_continuity_gain);
  const noGain = build({ flashJitter: 26, movingJitter: 25 });
  check('someone who does not use the trajectory shows no gain',
    Math.abs(noGain.m.visual_continuity_gain!) < 2, noGain.m.visual_continuity_gain);
  check('and scores lower on continuity use',
    noGain.s.visual_continuity_use! < base.s.visual_continuity_use!,
    [base.s.visual_continuity_use, noGain.s.visual_continuity_use]);
  check('the result screen names the strategy',
    base.res.headline.some((h) => h.hint?.includes('pályát követed')),
    base.res.headline[4]?.hint);

  // Uncertainty must be visible, and an effect inside its own noise must be
  // labelled as such rather than presented as a finding.
  check('the continuity gain carries a standard error',
    Number.isFinite(base.m.visual_continuity_gain_se!) && base.m.visual_continuity_gain_se! > 0,
    base.m.visual_continuity_gain_se);
  check('the headline shows the estimate with its uncertainty',
    /± \d+ ms/.test(base.res.headline[4]!.value), base.res.headline[4]!.value);
  check('an effect smaller than its own error is flagged as uninterpretable',
    noGain.res.headline[4]!.hint?.includes('bizonytalanságon belül'), noGain.res.headline[4]?.hint);
  check('40 trials keep the flagship effect well above its noise',
    base.m.visual_continuity_gain! > 3 * base.m.visual_continuity_gain_se!,
    [base.m.visual_continuity_gain, base.m.visual_continuity_gain_se]);

  // The two VR-only costs.
  check('depth beat cost is recovered', near(base.m.depth_beat_cost!, 10, 1), base.m.depth_beat_cost);
  check('peripheral beat cost is recovered', near(base.m.peripheral_beat_cost!, 7, 1), base.m.peripheral_beat_cost);
  check('both spatial costs carry a standard error',
    Number.isFinite(base.m.depth_beat_cost_se!) && Number.isFinite(base.m.peripheral_beat_cost_se!));
  // A cost inside its own noise must not lower the score as if it were real.
  const noSpatialCost = build({ approachJitter: 24.5, peripheralJitter: 24.5, movingJitter: 24 });
  check('a cost within its own error does not enter the score as a real effect',
    noSpatialCost.s.spatial_beat_robustness! > base.s.spatial_beat_robustness!,
    [base.s.spatial_beat_robustness, noSpatialCost.s.spatial_beat_robustness]);

  // Internal clock and drift.
  const drifting = build({ contDrift: 4, contSd: 12 });
  check('recovers a continuation drift rate',
    near(drifting.m.continuation_drift_ms_per_beat!, 4, 1.2), drifting.m.continuation_drift_ms_per_beat);
  check('a steady tapper shows little drift',
    Math.abs(build({ contDrift: 0, contSd: 12 }).m.continuation_drift_ms_per_beat!) < 1.5);
  check('the drift direction is explained on the result screen',
    drifting.res.headline.some((h) => h.hint?.includes('lassulsz')),
    drifting.res.headline.map((h) => h.hint));
  check('continuation sd is reported separately from paced sd',
    Number.isFinite(drifting.m.continuation_sd_ms!) &&
    drifting.m.continuation_sd_ms !== drifting.m.async_sd_ms);

  // Tempo adaptation.
  const quick = build({ tempoLockAfter: 2 });
  const slow = build({ tempoLockAfter: 11 });
  check('a quick adapter locks on in fewer beats',
    quick.m.tempo_adaptation_beats! < slow.m.tempo_adaptation_beats!,
    [quick.m.tempo_adaptation_beats, slow.m.tempo_adaptation_beats]);
  check('and scores higher for it', quick.s.tempo_adaptation! > slow.s.tempo_adaptation!);

  // Polyrhythm.
  check('recovers polyrhythm accuracy', near(base.m.poly_accuracy!, 0.7, 0.04), base.m.poly_accuracy);
  check('a better polyrhythm scores higher',
    build({ polyAccuracy: 0.9 }).s.bimanual_polyrhythm! > build({ polyAccuracy: 0.45 }).s.bimanual_polyrhythm!);

  // The honesty rule.
  const flat = build({ platform: 'desktop' });
  for (const name of ['depth_beat_cost', 'peripheral_beat_cost', 'poly_depth_separation']) {
    check(`flat platform: ${name} is absent, not zero`, !(name in flat.m), flat.m[name]);
  }
  check('flat platform still measures the continuity gain, which the literature also does',
    Number.isFinite(flat.m.visual_continuity_gain!));
  check('flat platform drops the spatial score component',
    !('spatial_beat_robustness' in flat.s) && 'timing_precision' in flat.s, Object.keys(flat.s));
  check('the run records which weighting was applied',
    base.res.summary.spatialWeightsApplied === true && flat.res.summary.spatialWeightsApplied === false);

  // The device-resolution caveat this module cannot hide.
  check('response quantisation is recorded', near(base.m.response_quantisation_ms!, 11.1, 0.1));
  check('audio onset latency is recorded, so a systematic offset is visible',
    near(base.m.audio_onset_latency_ms!, 3.27, 0.3), base.m.audio_onset_latency_ms);
  check('no headline value is NaN', base.res.headline.every((h) => !h.value.includes('NaN')));

  // Geometry: the two polyrhythm orbits are separated by depth alone.
  const ang = (size: number, d: number) => 2 * Math.atan(size / (2 * d)) * 180 / Math.PI;
  check('the near and far polyrhythm balls subtend the same angle',
    Math.abs(ang(0.045, 0.9) - ang(0.09, 1.8)) < 0.2, [ang(0.045, 0.9), ang(0.09, 1.8)]);
}

/* ================================================================= ADAPT */
console.log('\nADAPT  (vizuomotoros adaptáció)');
{
  const ROT = 30;

  /**
   * A synthetic learner. `tau` is the true adaptation time constant, `residual`
   * the error it settles at, `aftereffectDeg` how much of the correction is
   * carried into washout, and `relearnTau` the second exposure.
   */
  function build(o: {
    platform?: 'vr' | 'desktop';
    tau?: number; residual?: number; relearnTau?: number;
    aftereffectDeg?: number; baselineBias?: number; noise?: number;
    elevGen?: number; dirGen30?: number; dirGen90?: number;
    neverAdapts?: boolean;
    seed?: number;
  }) {
    const rng = new Rng(o.seed ?? 77);
    const g = () => {
      const u = Math.max(1e-9, rng.next());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
    };
    const noise = o.noise ?? 0;
    const bias = o.baselineBias ?? 0;
    const trials: unknown[] = [];
    const push = (phase: string, i: number, errDeg: number, group: string | null = null,
                  elDeg = 0, radius = 0.55) => {
      trials.push({
        phase, trialInPhase: i, group, azDeg: 22.5, elDeg, radiusM: radius,
        rotationDeg: phase === 'baseline' || phase === 'washout' ? 0 : ROT,
        feedback: phase !== 'probe',
        directionErrorDeg: bias + errDeg + g() * noise,
        endpointErrorDeg: 2, movementTimeMs: 480, reactionTimeMs: 320,
        planeDeviationM: 0.02, outcome: 'hit',
      });
    };

    for (let i = 0; i < 32; i++) push('baseline', i, 0);

    const tau = o.tau ?? 14;
    const residual = o.residual ?? 5;
    for (let i = 0; i < 64; i++) {
      // Error decays from the full rotation towards the residual.
      const e = o.neverAdapts ? ROT : residual + (ROT - residual) * Math.exp(-i / tau);
      push('adaptation', i, e);
    }

    // Probe groups: the correction being carried, expressed as a displacement
    // against the rotation.
    const trainedCorr = ROT - residual;
    const probe = (group: string, factor: number, elDeg = 0, radius = 0.55) => {
      for (let k = 0; k < 3; k++) push('probe', k, -trainedCorr * factor, group, elDeg, radius);
    };
    probe('trained', 1.0);
    probe('dir30', o.dirGen30 ?? 0.8);
    probe('dir90', o.dirGen90 ?? 0.35);
    if ((o.platform ?? 'vr') === 'vr') {
      probe('elev_up', o.elevGen ?? 0.72, 30);
      probe('elev_down', o.elevGen ?? 0.72, -30);
      probe('far', 0.9, 0, 0.75);
    }

    const after = o.aftereffectDeg ?? 12;
    for (let i = 0; i < 24; i++) push('washout', i, -after * Math.exp(-i / 6));

    const rTau = o.relearnTau ?? 7;
    for (let i = 0; i < 32; i++) {
      push('relearn', i, residual + (ROT - residual) * Math.exp(-i / rTau));
    }

    const mod = new AdaptModule();
    const ctx = fakeCtx(o.platform ?? 'vr');
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { trials: unknown[] }).trials = trials;
    const res = mod.finish(ctx);
    return { res, m: ctx._metrics, s: ctx._scores };
  }

  const fast = build({ tau: 8, relearnTau: 4 });
  const slow = build({ tau: 30, relearnTau: 22 });
  console.log(`  gyors tanuló: tau ${fast.m.adaptation_rate_trials?.toFixed(1)} (r2 ${fast.m.adaptation_fit_r2?.toFixed(2)}), savings ${fast.m.savings_index?.toFixed(2)}, OPS ${fast.res.opsScore}`);
  console.log(`  lassú tanuló: tau ${slow.m.adaptation_rate_trials?.toFixed(1)} (r2 ${slow.m.adaptation_fit_r2?.toFixed(2)}), savings ${slow.m.savings_index?.toFixed(2)}, OPS ${slow.res.opsScore}`);

  check('recovers a fast time constant', near(fast.m.adaptation_rate_trials!, 8, 2.5), fast.m.adaptation_rate_trials);
  check('recovers a slow time constant', near(slow.m.adaptation_rate_trials!, 30, 4), slow.m.adaptation_rate_trials);

  // A tau the block was too short to observe must be labelled a lower bound.
  // r2 does not catch this - a barely-bent curve still fits well.
  check('a fast learner\'s rate is well identified',
    fast.m.adaptation_observed_time_constants! >= 2.5, fast.m.adaptation_observed_time_constants);
  check('a slow learner\'s rate is flagged as under-observed',
    slow.m.adaptation_observed_time_constants! < 2.5, slow.m.adaptation_observed_time_constants);
  check('and shown as a lower bound rather than a value',
    slow.res.headline[0]!.value.startsWith('≥') && !fast.res.headline[0]!.value.startsWith('≥'),
    [fast.res.headline[0]!.value, slow.res.headline[0]!.value]);
  check('the fit quality alone does not catch this - r2 is high for both',
    slow.m.adaptation_fit_r2! > 0.9 && fast.m.adaptation_fit_r2! > 0.9,
    [fast.m.adaptation_fit_r2, slow.m.adaptation_fit_r2]);
  check('the summary records why the slow rate is a bound',
    String((slow.res.summary as { adaptation: { rateNote: string } }).adaptation.rateNote).includes('lower bound'));
  check('the faster learner scores higher on learning rate',
    fast.s.learning_rate! > slow.s.learning_rate!, [fast.s.learning_rate, slow.s.learning_rate]);
  check('and higher overall', fast.res.opsScore > slow.res.opsScore,
    { fast: fast.res.opsScore, slow: slow.res.opsScore });
  check('recovers the asymptotic error', near(fast.m.asymptotic_error_deg!, 5, 2), fast.m.asymptotic_error_deg);
  check('the fit quality is reported', fast.m.adaptation_fit_r2! > 0.9, fast.m.adaptation_fit_r2);

  // Someone who never adapts must not receive a plausible-looking rate.
  const stuck = build({ neverAdapts: true, aftereffectDeg: 0.5 });
  const noisyStuck = build({ neverAdapts: true, aftereffectDeg: 0.5, noise: 2.5, seed: 91 });
  check('a non-learner produces no fitted drop',
    !(stuck.m.adaptation_total_drop_deg! >= 4.5), stuck.m.adaptation_total_drop_deg);
  check('a flat curve gives an undefined r2, not a perfect one',
    !Number.isFinite(stuck.m.adaptation_fit_r2!), stuck.m.adaptation_fit_r2);
  check('and scores zero on learning rate, not a number from an unfittable curve',
    stuck.s.learning_rate === 0, stuck.s.learning_rate);
  check('and the result screen says the curve is uninterpretable',
    stuck.res.headline[0]!.value === 'nem értelmezhető', stuck.res.headline[0]);
  check('a real learner does get a rate on the screen',
    fast.res.headline[0]!.value.includes('próba'), fast.res.headline[0]);
  check('a noisy non-learner is also caught, not given a bound',
    noisyStuck.res.headline[0]!.value === 'nem értelmezhető' && noisyStuck.s.learning_rate === 0,
    [noisyStuck.res.headline[0]!.value, noisyStuck.m.adaptation_fit_r2, noisyStuck.m.adaptation_total_drop_deg]);
  check('no headline ever shows NaN, even on a degenerate curve',
    stuck.res.headline.every((h) => !h.value.includes('NaN')) &&
    noisyStuck.res.headline.every((h) => !h.value.includes('NaN')),
    [stuck.res.headline[0]!.value, noisyStuck.res.headline[0]!.value]);

  // The aftereffect and the implicit estimate.
  check('recovers the aftereffect', near(fast.m.aftereffect_deg!, 11, 2.5), fast.m.aftereffect_deg);
  const mostlyImplicit = build({ aftereffectDeg: 20, residual: 5 });
  const mostlyExplicit = build({ aftereffectDeg: 4, residual: 5 });
  check('a larger aftereffect gives a larger implicit fraction',
    mostlyImplicit.m.implicit_fraction! > mostlyExplicit.m.implicit_fraction! + 0.3,
    [mostlyExplicit.m.implicit_fraction, mostlyImplicit.m.implicit_fraction]);
  check('the implicit estimate is labelled as an estimate, not a measurement',
    String(fast.res.summary.implicitNote).includes('estimate') &&
    fast.res.headline[3]!.value.startsWith('~'), fast.res.headline[3]);

  // Savings.
  check('savings is positive when relearning is faster',
    fast.m.savings_index! > 0.2, fast.m.savings_index);
  const noSavings = build({ tau: 12, relearnTau: 12 });
  check('and near zero when it is not', Math.abs(noSavings.m.savings_index!) < 0.25, noSavings.m.savings_index);
  check('the run carries the repeat-measurement warning savings makes necessary',
    String(fast.res.summary.repeatWarning).includes('nem hasonlítható'));

  // Baseline bias must be removed, or a naturally skewed aim reads as failure.
  const skewed = build({ tau: 8, relearnTau: 4, baselineBias: 7 });
  check('a participant with a natural aiming bias is not penalised for it',
    near(skewed.m.adaptation_rate_trials!, fast.m.adaptation_rate_trials!, 3),
    [fast.m.adaptation_rate_trials, skewed.m.adaptation_rate_trials]);
  check('and the bias itself is reported', near(skewed.m.baseline_bias_deg!, 7, 1), skewed.m.baseline_bias_deg);

  // Generalisation, including the VR-only elevation probe.
  check('direction generalisation falls off with angular distance',
    fast.m.direction_generalisation_30! > fast.m.direction_generalisation_90!,
    [fast.m.direction_generalisation_30, fast.m.direction_generalisation_90]);
  check('recovers the elevation generalisation ratio',
    near(fast.m.elevation_generalisation!, 0.72, 0.12), fast.m.elevation_generalisation);
  const planeBound = build({ elevGen: 0.2 });
  check('a plane-bound learner scores lower on spatial generalisation',
    planeBound.s.spatial_generalisation! < fast.s.spatial_generalisation!,
    [fast.s.spatial_generalisation, planeBound.s.spatial_generalisation]);

  // The honesty rule.
  const flat = build({ platform: 'desktop' });
  for (const name of ['elevation_generalisation', 'far_generalisation', 'movement_plane_deviation']) {
    check(`flat platform: ${name} is absent, not zero`, !(name in flat.m), flat.m[name]);
  }
  check('flat platform still measures the rate, savings and aftereffect',
    ['adaptation_rate_trials', 'savings_index', 'aftereffect_deg'].every((k) => Number.isFinite(flat.m[k]!)));
  check('flat platform drops the spatial component and keeps four',
    !('spatial_generalisation' in flat.s) && Object.keys(flat.s).length === 4, Object.keys(flat.s));
  check('the run records which weighting was applied',
    fast.res.summary.spatialWeightsApplied === true && flat.res.summary.spatialWeightsApplied === false);
  check('flat platform says what is missing',
    flat.res.headline.some((h) => h.value === 'headset kell'));
  check('no headline value is NaN', fast.res.headline.every((h) => !h.value.includes('NaN')));
}

/* ===================================================== platform gating */
console.log('\nPLATFORM GATING');
{
  // STEADY is the first VR-only module without variants. Before this the
  // supports check only ran on variants, so its card said "indítható" on a
  // laptop and starting it would have produced a run full of nulls.
  const steady = MODULE_BY_CODE.STEADY!;
  check('STEADY declares itself VR only', steady.supports.join(',') === 'vr', steady.supports);
  check('STEADY is implemented', isRunnable(steady));
  check('but not runnable on a flat platform',
    !isRunnableOn(steady, 'desktop') && !isRunnableOn(steady, 'mobile'));
  check('and runnable in VR', isRunnableOn(steady, 'vr'));

  for (const code of ['FIELD', 'RHYTHM', 'ADAPT']) {
    const m = MODULE_BY_CODE[code]!;
    check(`${code} runs on every platform, with the spatial metrics dropping out`,
      ['vr', 'desktop', 'mobile'].every((p) => supportsPlatform(m, p as 'vr')), m.supports);
  }
  check('an external module is never gated by supports',
    supportsPlatform(MODULE_BY_CODE.SPACE!, 'desktop'));
  check('a planned module is not runnable anywhere',
    !isRunnableOn(MODULE_BY_CODE.MULTI!, 'vr'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
