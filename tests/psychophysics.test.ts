/**
 * The estimators are checked against synthetic signals with known answers.
 * A threshold routine that cannot recover a threshold it was handed is worse
 * than no threshold at all, because the number still looks plausible.
 */
import {
  Staircase, crossingPoint, swayMetrics, goertzelPower, dominantFrequency,
  fitLearningCurve, tappingMetrics, goertzelAmplitude, bandConcentration, Rng,
} from '@vrcap/shared';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/* ================================================================ staircase */
console.log('\nSTAIRCASE');
{
  // A simulated observer whose psychometric function is known exactly.
  //
  // A 3-down-1-up rule converges on p = 0.5^(1/3) = 0.7937, NOT on the 50%
  // point, so the observer is parameterised by the duration at which it is
  // 79.37% correct - that is the quantity the staircase is estimating.
  // Chance is 12.5% because the peripheral response is an eight-alternative
  // choice.
  const TARGET_P = Math.pow(0.5, 1 / 3);
  const CHANCE = 0.125;
  const SLOPE = 0.30;                       // logistic slope on log duration
  const TRUE_MS = 80;                       // duration where p = TARGET_P
  const zAtTarget = Math.log(((TARGET_P - CHANCE) / (1 - CHANCE)) / (1 - (TARGET_P - CHANCE) / (1 - CHANCE)));
  const T50 = TRUE_MS * Math.exp(-SLOPE * zAtTarget);
  const makeObserver = (rng: Rng) => (ms: number) => {
    const z = (Math.log(ms) - Math.log(T50)) / SLOPE;
    const p = CHANCE + (1 - CHANCE) / (1 + Math.exp(-z));
    return rng.next() < p;
  };
  const newStaircase = () => new Staircase({
    start: 320, down: 3, coarseFactor: 0.75, fineFactor: 0.87, coarseAfter: 6,
    min: 11.1, max: 640, lowerIsHarder: true,
  });

  const sc = newStaircase();
  const obs = makeObserver(new Rng(7));
  for (let i = 0; i < 240; i++) sc.record(obs(sc.value));
  const est = sc.threshold(8);
  console.log(`  true ${TRUE_MS} ms (79%) -> estimate ${est.toFixed(1)} ms, ${sc.reversals.length} reversals`);
  check('recovers a known 79% threshold within 25%',
    est > TRUE_MS * 0.75 && est < TRUE_MS * 1.25, est);
  check('collects enough reversals', sc.reversals.length >= 10, sc.reversals.length);

  // The number that decides whether the module design works: can 48 trials -
  // what FIELD actually runs - estimate the threshold at all? Averaged over
  // 40 simulated participants, and the spread is what matters.
  const ests: number[] = [];
  let tooFewReversals = 0;
  for (let s = 0; s < 40; s++) {
    const st = newStaircase();
    const o = makeObserver(new Rng(1000 + s));
    for (let i = 0; i < 48; i++) st.record(o(st.value));
    if (st.reversals.length < 4) { tooFewReversals++; continue; }
    ests.push(st.threshold(8));
  }
  const m = ests.reduce((a, b) => a + b, 0) / ests.length;
  const sd = Math.sqrt(ests.reduce((a, b) => a + (b - m) * (b - m), 0) / (ests.length - 1));
  console.log(`  48 próbából: átlag ${m.toFixed(1)} ms, szórás ${sd.toFixed(1)} ms, ${ests.length}/40 használható`);
  check('48 trials are enough to estimate the threshold', m > TRUE_MS * 0.8 && m < TRUE_MS * 1.3, m);
  check('48 trials give a usable estimate for every simulated participant', tooFewReversals === 0, tooFewReversals);
  check('the between-participant spread is smaller than the effect it must detect', sd < TRUE_MS * 0.35, sd);

  // Direction: with lowerIsHarder the value must fall after three correct.
  const down = new Staircase({ start: 100, down: 3, coarseFactor: 0.5, fineFactor: 0.9,
    coarseAfter: 99, min: 1, max: 1000, lowerIsHarder: true });
  down.record(true); down.record(true); down.record(true);
  check('three correct shortens the duration', down.value === 50, down.value);
  down.record(false);
  check('one error lengthens it', down.value === 100, down.value);

  // The opposite polarity: speed, where higher is harder.
  const up = new Staircase({ start: 2, down: 3, coarseFactor: 0.5, fineFactor: 0.9,
    coarseAfter: 99, min: 0.1, max: 40, lowerIsHarder: false });
  up.record(true); up.record(true); up.record(true);
  check('three correct raises the speed', up.value === 4, up.value);
  up.record(false);
  check('one error lowers it', up.value === 2, up.value);

  const alwaysWrong = new Staircase({ start: 100, down: 3, coarseFactor: 0.5, fineFactor: 0.9,
    coarseAfter: 99, min: 20, max: 200, lowerIsHarder: true });
  for (let i = 0; i < 20; i++) alwaysWrong.record(false);
  check('a floundering observer is clamped, not run away', alwaysWrong.value === 200);
  check('and yields no threshold from one direction', !Number.isFinite(alwaysWrong.threshold()));
}

/* ============================================================== crossing */
console.log('\nCROSSING POINT (mezősugár)');
{
  const curve = [{ x: 10, y: 0.95 }, { x: 20, y: 0.86 }, { x: 35, y: 0.62 }, { x: 50, y: 0.38 }];
  const c = crossingPoint(curve, 0.5);
  check('interpolates between the bracketing eccentricities',
    c.bounded && near(c.x, 42.5, 1.0), c);
  const never = crossingPoint([{ x: 10, y: 0.9 }, { x: 50, y: 0.8 }], 0.5);
  check('reports unbounded when the curve never drops to the level',
    !never.bounded && never.x === 50, never);
  check('empty input is NaN, not zero', !Number.isFinite(crossingPoint([], 0.5).x));
}

/* ============================================================ posturography */
console.log('\nSWAY');
{
  // A known ellipse: sd 4 mm side to side, 8 mm front to back, uncorrelated.
  // The 95% ellipse area is pi * 5.991 * sqrt(l1*l2) = pi * 5.991 * 4 * 8.
  const rng = new Rng(11);
  const g = () => {
    const u = Math.max(1e-9, rng.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
  };
  const N = 4000;
  const ml: number[] = [], ap: number[] = [];
  for (let i = 0; i < N; i++) { ml.push(g() * 0.004); ap.push(g() * 0.008); }
  const s = swayMetrics(ml, ap, N / 60);
  const expected = Math.PI * 5.991 * 4 * 8;
  console.log(`  sd ${s.sdMlMm.toFixed(2)} / ${s.sdApMm.toFixed(2)} mm, area ${s.area95Mm2.toFixed(0)} mm2 (várt ~${expected.toFixed(0)})`);
  check('recovers the axis standard deviations', near(s.sdMlMm, 4, 0.4) && near(s.sdApMm, 8, 0.8), [s.sdMlMm, s.sdApMm]);
  check('recovers the 95% ellipse area within 12%', Math.abs(s.area95Mm2 - expected) / expected < 0.12, s.area95Mm2);
  check('a still head gives near-zero path', swayMetrics(new Array(200).fill(0), new Array(200).fill(0), 3).pathLengthMm === 0);
  check('too few samples give NaN, not a fake number', !Number.isFinite(swayMetrics([0, 1], [0, 1], 1).pathLengthMm));

  // Path length must scale with sampling of the same motion, so velocity is
  // the comparable figure - check it is reported.
  check('mean velocity is reported', Number.isFinite(s.meanVelocityMmS) && s.meanVelocityMmS > 0);
}

/* ================================================================= tremor */
console.log('\nTREMOR SPECTRUM');
{
  const HZ = 120;
  const N = 1200;
  for (const trueF of [4.5, 9.0]) {
    const sig: number[] = [];
    for (let i = 0; i < N; i++) sig.push(Math.sin((2 * Math.PI * trueF * i) / HZ) * 0.002);
    const d = dominantFrequency(sig, HZ, 2, 14, 0.25);
    check(`finds a ${trueF} Hz component`, near(d.freqHz, trueF, 0.3), d);
  }
  const mixed: number[] = [];
  for (let i = 0; i < N; i++) {
    mixed.push(Math.sin((2 * Math.PI * 9 * i) / HZ) * 0.003 + Math.sin((2 * Math.PI * 4 * i) / HZ) * 0.001);
  }
  check('picks the stronger of two components', near(dominantFrequency(mixed, HZ, 2, 14).freqHz, 9, 0.3));
  check('a constant signal has no power at any frequency',
    goertzelPower(new Array(200).fill(0.5), HZ, 9) < 1e-9);
  check('a frequency above Nyquist is rejected', !Number.isFinite(goertzelPower(new Array(200).fill(0), HZ, 90)));

  // Amplitude, in the signal's own units - the figure a result screen can show.
  for (const amp of [0.004, 0.012]) {
    const sig: number[] = [];
    for (let i = 0; i < 1800; i++) sig.push(Math.sin((2 * Math.PI * 0.2 * i) / HZ) * amp);
    const a = goertzelAmplitude(sig, HZ, 0.2);
    check(`recovers a ${(amp * 1000).toFixed(0)} mm amplitude within 5%`,
      Math.abs(a - amp) / amp < 0.05, [a, amp]);
  }
  // Concentration is bounded, which the raw power ratio is not.
  const driven: number[] = [];
  const undriven: number[] = [];
  const rng2 = new Rng(31);
  for (let i = 0; i < 1800; i++) {
    const n = (rng2.next() - 0.5) * 0.006;
    driven.push(Math.sin((2 * Math.PI * 0.2 * i) / HZ) * 0.01 + n);
    undriven.push(n);
  }
  const cd = bandConcentration(driven, HZ, 0.2, [0.10, 0.35]);
  const cu = bandConcentration(undriven, HZ, 0.2, [0.10, 0.35]);
  check('concentration is high when the signal is driven', cd > 0.85, cd);
  check('and near chance when it is not', cu < 0.75, cu);
  check('concentration stays inside 0-1 in both cases',
    cd >= 0 && cd <= 1 && cu >= 0 && cu <= 1, [cd, cu]);
}

/* ========================================================= learning curve */
console.log('\nLEARNING CURVE');
{
  const rng = new Rng(3);
  const noise = () => (rng.next() - 0.5) * 2;
  for (const trueTau of [8, 25]) {
    const ys: number[] = [];
    for (let i = 0; i < 80; i++) ys.push(4 + 26 * Math.exp(-i / trueTau) + noise());
    const f = fitLearningCurve(ys);
    console.log(`  tau ${trueTau} -> ${f.rateTrials.toFixed(1)} (asymptote ${f.asymptote.toFixed(1)}, r2 ${f.r2.toFixed(3)})`);
    check(`recovers tau=${trueTau} within 25%`, Math.abs(f.rateTrials - trueTau) / trueTau < 0.25, f.rateTrials);
    check(`recovers the asymptote for tau=${trueTau}`, near(f.asymptote, 4, 1.5), f.asymptote);
    check(`fit quality is high for tau=${trueTau}`, f.r2 > 0.9, f.r2);
  }
  // Someone who never adapts: the fit must not invent a learning rate with a
  // convincing r2.
  const flat: number[] = [];
  for (let i = 0; i < 80; i++) flat.push(28 + noise());
  const f = fitLearningCurve(flat);
  check('a non-learner gets a low r2', f.r2 < 0.25, f.r2);
  check('too few trials give NaN', !Number.isFinite(fitLearningCurve([1, 2, 3]).rateTrials));
}

/* ================================================================ tapping */
console.log('\nTAPPING');
{
  // Negative mean asynchrony is the classic finding: people anticipate.
  const async = [-31, -28, -35, -22, -30, -27, -33, -29];
  const iv = [600, 604, 598, 602, 601, 599, 603, 600];
  const t = tappingMetrics(async, iv);
  check('mean asynchrony is negative', t.meanAsyncMs < 0, t.meanAsyncMs);
  check('asynchrony sd is small for a steady tapper', t.sdAsyncMs < 6, t.sdAsyncMs);
  check('no drift when intervals are stable', Math.abs(t.driftMsPerBeat) < 0.6, t.driftMsPerBeat);

  // A tempo that accelerates: intervals shrink by 4 ms per beat.
  const drifting = Array.from({ length: 20 }, (_, i) => 600 - 4 * i);
  const d = tappingMetrics([], drifting);
  check('recovers a known drift rate', near(d.driftMsPerBeat, -4, 0.2), d.driftMsPerBeat);
  check('a continuation phase with no beat still gives interval stats',
    Number.isFinite(d.sdIntervalMs) && !Number.isFinite(d.meanAsyncMs));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
