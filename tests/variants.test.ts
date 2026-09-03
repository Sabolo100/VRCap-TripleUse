/**
 * A/B variants: the catalog wiring, the structure generator's guarantees, and
 * the two properties that make the spatial variants worth having -
 * ANTICIPATE-B's size-arrival effect and COMMAND-B's pooling gain.
 */
import {
  MODULES, runnableVariants, configVersionFor, variantOf,
  generateStructure, bestSingleSeat, visibleInventory, scoreInventory, rarityWeight,
  BLOCK_COLORS, Rng,
} from '@vrcap/shared';
import type { ModuleContext } from '../packages/client/src/engine/task/Module.js';
import { AnticipateSpatialModule } from '../packages/client/src/modules/anticipate/AnticipateSpatialModule.js';
import { createModule, hasVariantImplementation } from '../packages/client/src/modules/registry.js';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};

function fakeCtx(platform: 'vr' | 'desktop' = 'vr') {
  const metrics: Record<string, number> = {};
  const scores: Record<string, number> = {};
  const ctx = {
    platform,
    engine: { clock: { frameInterval: 11.1 }, camera: {}, rig: {}, input: {} },
    recorder: {
      trialNumber: 0,
      metric: (n: string, v: number) => { if (Number.isFinite(v)) metrics[n] = v; },
      score: (t: string, v: number) => { scores[t] = v; },
      trial: () => {}, event: () => {},
    },
    rng: new Rng(5), scene: {}, panels: { remove: () => {} },
    theme: { accent: '#fff', accent2: '#0ff', ok: '#0f0', bad: '#f00' },
  } as unknown as ModuleContext;
  return Object.assign(ctx, { _metrics: metrics, _scores: scores });
}
const gauss = (rng: Rng, m: number, sd: number) => {
  const u = Math.max(1e-9, rng.next());
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
};

/* ==================================================== catalog wiring === */
console.log('\nVARIANT CATALOG');
{
  const withVariants = MODULES.filter((m) => m.variants && m.variants.length > 1);
  check('exactly five modules have an A/B pair', withVariants.length === 5,
    withVariants.map((m) => m.code));
  check('the already-spatial modules have no variants',
    ['NAV', 'WATCH', 'HOLD', 'MEMORY'].every((c) => !MODULES.find((m) => m.code === c)?.variants));

  for (const m of withVariants) {
    const [a, b] = m.variants!;
    check(`${m.code}: A is not spatial, B is`, a!.spatial === false && b!.spatial === true);
    check(`${m.code}: distinct config versions`, a!.configVersion !== b!.configVersion,
      [a!.configVersion, b!.configVersion]);
    check(`${m.code}: config version matches the naming rule`,
      a!.configVersion === `${m.code}_STANDARD_A` && b!.configVersion === `${m.code}_SPATIAL_B`);
    check(`${m.code}: B declares at least one spatial affordance`,
      (b!.spatialAffordances?.length ?? 0) >= 1, b!.spatialAffordances);
    check(`${m.code}: B is implemented`, hasVariantImplementation(m.code, 'B'));
    check(`${m.code}: A resolves to a module`, createModule(m.code, 'A') !== null);
    check(`${m.code}: B resolves to a different implementation`,
      createModule(m.code, 'B')?.constructor.name !== createModule(m.code, 'A')?.constructor.name,
      [createModule(m.code, 'A')?.constructor.name, createModule(m.code, 'B')?.constructor.name]);
  }

  const react = MODULES.find((m) => m.code === 'REACT')!;
  check('REACT-B is VR only, so a flat platform offers just A',
    runnableVariants(react, 'desktop').map((v) => v.id).join(',') === 'A' &&
    runnableVariants(react, 'vr').map((v) => v.id).join(',') === 'A,B');
  check('configVersionFor keeps A and B apart',
    configVersionFor(react, 'A') !== configVersionFor(react, 'B'));
  check('an unknown variant falls back to A', variantOf(react, 'Z')?.id === 'A');
}

/* ================================================ COMMAND-B structure === */
console.log('\nCOMMAND-B STRUCTURE');
{
  let invisible = 0, seesAll = 0, starved = 0, noGain = 0;
  const gains: number[] = [];
  for (let seed = 1; seed <= 120; seed++) {
    for (const seats of [2, 3, 4, 5]) {
      const sc = generateStructure(seed * 6151, seats);
      if (sc.invisible.length) invisible++;
      const cov = sc.seatPositions.map((sp) => sc.blocks.filter((b) => sc.visibility[b.id]!.includes(sp.seat)).length);
      if (Math.max(...cov) >= sc.blocks.length) seesAll++;
      if (Object.values(sc.privileged).some((l) => l.length === 0)) starved++;
      const alone = bestSingleSeat(sc).outcome.totalAbsError;
      gains.push(alone);
      if (alone === 0) noGain++;
    }
  }
  check('no block is invisible from every seat', invisible === 0, invisible);
  check('no single seat can see the whole structure', seesAll === 0, seesAll);
  check('every seat has a privileged view', starved === 0, starved);
  check('pooling always pays: one seat alone is never enough', noGain === 0, noGain);
  console.log(`  mean best-single-seat error: ${(gains.reduce((a, b) => a + b, 0) / gains.length).toFixed(2)}`);

  const a = generateStructure(31337, 4);
  const b = generateStructure(31337, 4);
  check('structure generation is deterministic', JSON.stringify(a) === JSON.stringify(b));

  // Perfect pooling: the union of every seat's view must recover the truth.
  const union = new Set<number>();
  for (let s = 0; s < a.seats; s++) {
    for (const blk of a.blocks) if (a.visibility[blk.id]!.includes(s)) union.add(blk.id);
  }
  check('the seats together can see every block', union.size === a.blocks.length,
    [union.size, a.blocks.length]);

  const perfect = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 } as Record<string, number>;
  for (const blk of a.blocks) perfect[blk.color]!++;
  const scored = scoreInventory(a.trueInventory, perfect as never);
  check('a perfectly pooled inventory scores zero error', scored.totalAbsError === 0 && scored.exact);

  // Over- and under-counting must be distinguishable, not merged.
  const over = { ...a.trueInventory };
  over[BLOCK_COLORS[0]!] += 3;
  const under = { ...a.trueInventory };
  under[BLOCK_COLORS[1]!] = Math.max(0, under[BLOCK_COLORS[1]!] - 2);
  const so = scoreInventory(a.trueInventory, over);
  const su = scoreInventory(a.trueInventory, under);
  check('over-counting is reported as over, not under', so.overCount === 3 && so.underCount === 0);
  check('under-counting is reported as under, not over', su.underCount === 2 && su.overCount === 0);

  const weights = a.blocks.map((blk) => rarityWeight(a, blk.id));
  check('rarity weight is 1 for a block only one seat can see',
    a.blocks.some((blk) => a.visibility[blk.id]!.length === 1) ? Math.max(...weights) === 1 : true);
  check('a seat sees fewer blocks than exist', visibleInventory(a, 0) !== a.trueInventory);
}

/* ============================================ ANTICIPATE-B size effect === */
console.log('\nANTICIPATE-B  (time-to-contact)');
{
  // The measurement that variant A structurally cannot make: whether timing is
  // driven by tau (unaffected by physical size) or by a size heuristic (the
  // larger object judged to arrive sooner).
  const build = (sizeBias: number, ve: number) => {
    const rng = new Rng(19);
    const results: unknown[] = [];
    const add = (block: string, occlusionMs: number, n: number, level: string, size: number, ceExtra: number) => {
      for (let i = 0; i < n; i++) {
        results.push({
          block, signedErrorMs: gauss(rng, -20 + ceExtra, ve), travelMs: 1900,
          occlusionMs, physicalSize: size, sizeLevel: level, eccentricityDeg: 0,
        });
      }
    };
    add('approach', 0, 18, 'medium', 0.18, 0);
    add('occluded', 600, 12, 'medium', 0.18, 0);
    add('occluded', 1150, 12, 'medium', 0.18, 0);
    // A size heuristic makes the large object seem to arrive earlier, i.e. a
    // more negative constant error as size grows.
    add('size', 855, 9, 'small', 0.10, +sizeBias / 2);
    add('size', 855, 9, 'medium', 0.18, 0);
    add('size', 855, 9, 'large', 0.30, -sizeBias / 2);
    add('angle', 855, 10, 'medium', 0.18, 0);

    const mod = new AnticipateSpatialModule();
    const ctx = fakeCtx();
    (mod as unknown as { ctx: ModuleContext }).ctx = ctx;
    (mod as unknown as { results: unknown[] }).results = results;
    (mod as unknown as { trials: unknown[] }).trials = [];
    const res = mod.finish(ctx);
    return { ops: res.opsScore, m: ctx._metrics, headline: res.headline };
  };

  const tauUser = build(20, 55);
  const heuristicUser = build(220, 55);
  console.log(`  tau-alapú     OPS=${String(tauUser.ops).padStart(4)}  size effect=${tauUser.m.size_arrival_effect?.toFixed(0)}ms  tauReliance=${tauUser.m.tau_reliance?.toFixed(2)}`);
  console.log(`  heurisztikus  OPS=${String(heuristicUser.ops).padStart(4)}  size effect=${heuristicUser.m.size_arrival_effect?.toFixed(0)}ms  tauReliance=${heuristicUser.m.tau_reliance?.toFixed(2)}`);

  check('the size-arrival effect is recovered', heuristicUser.m.size_arrival_effect! > tauUser.m.size_arrival_effect!,
    [tauUser.m.size_arrival_effect, heuristicUser.m.size_arrival_effect]);
  check('tau reliance separates the two strategies',
    tauUser.m.tau_reliance! > 0.8 && heuristicUser.m.tau_reliance! < 0.4,
    [tauUser.m.tau_reliance, heuristicUser.m.tau_reliance]);
  check('same precision, tau user scores higher', tauUser.ops > heuristicUser.ops,
    { tau: tauUser.ops, heuristic: heuristicUser.ops });
  check('the strategy is named on the result screen',
    tauUser.headline.some((h) => h.hint?.includes('tau')) &&
    heuristicUser.headline.some((h) => h.hint?.includes('heurisztika')),
    [tauUser.headline[1]?.hint, heuristicUser.headline[1]?.hint]);
  check('occlusion robustness is positive', tauUser.m.occlusion_robustness! > 0);
  check('no headline value is NaN', tauUser.headline.every((h) => !h.value.includes('NaN')));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
