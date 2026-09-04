import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, stdev, normaliseSoft, opsScore, clamp,
  fitLearningCurve, angleDiffDeg,
  type ModuleManifest, type TrialRecord,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import { BodyAnchor } from '../shared/anchor.js';

/**
 * MODULE 15 - ADAPT
 * Visuomotor rotation: how fast someone learns, not how good they are now.
 *
 * A hidden 30 degree rotation is inserted between the hand and the cursor that
 * represents it. The participant misses, corrects over the next few dozen
 * reaches, and the shape of that correction curve is the measurement. When the
 * rotation is removed they overshoot the other way - that aftereffect is the
 * part that was learned without knowing it.
 *
 * The paradigm is a flat one and stays valid flat, which is why this module
 * still runs on a desktop. Three dimensions add two things:
 *
 *   REAL REACHING     the movement is the arm's, not the wrist's, and the
 *                     error is read from the direction at 60% of the way out -
 *                     the plan, before online correction can rescue it.
 *
 *   ELEVATION PROBE   on a screen every target is in one plane, so nobody can
 *                     ask whether the learned correction transfers OUT of that
 *                     plane. Here the probe block puts targets 30 degrees above
 *                     and below the trained ring, with no feedback, and the
 *                     answer is `elevation_generalisation`.
 *
 * The rotation is never shown, never announced, and the controller model is
 * hidden throughout - if the participant can see their real hand the conflict
 * disappears and the module measures nothing.
 */

type Phase = 'baseline' | 'adaptation' | 'probe' | 'washout' | 'relearn';
type ProbeGroup = 'trained' | 'dir30' | 'dir90' | 'elev_up' | 'elev_down' | 'far';

const ROTATION_DEG = 30;
/** Chest-height start point, 0.25 m in front of the participant. */
const HOME_UP = -0.25;
const HOME_FORWARD = 0.25;
const REACH_RADIUS = 0.55;
const FAR_RADIUS = 0.75;
/** Direction is read here: far enough to be a real movement, early enough to
 *  be the plan rather than an online correction. */
const SAMPLE_FRACTION = 0.6;
const REACH_TIMEOUT_MS = 2500;

interface AdaptTrial {
  phase: Phase;
  trialInPhase: number;
  group: ProbeGroup | null;
  azDeg: number;
  elDeg: number;
  radiusM: number;
  rotationDeg: number;
  feedback: boolean;
  directionErrorDeg: number;
  endpointErrorDeg: number;
  movementTimeMs: number;
  reactionTimeMs: number;
  planeDeviationM: number;
  outcome: 'hit' | 'miss' | 'timeout' | 'invalid';
}

export class AdaptModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.ADAPT!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'baseline',
      title: 'ALAPVONAL',
      instruction:
        'Egy pontot fogsz látni a kezed helyén — A KEZEDET MAGÁT NEM LÁTOD. Vidd a pontot a célgömbhöz ' +
        'egy gyors, egyenes mozdulattal. Ne javítgasd útközben: célozz, és mozdulj.',
      controlHint: '',
      trials: 32,
      practiceTrials: 8,
    },
    {
      // Deliberately the same wording as the baseline. The rotation switches on
      // with this block and is never mentioned - being told would replace the
      // learning process with a strategy.
      id: 'adaptation',
      title: 'FOLYTASD',
      instruction: 'Folytasd ugyanígy. Ugyanaz a feladat.',
      controlHint: '',
      trials: 64,
      practiceTrials: 0,
    },
    {
      id: 'probe',
      title: 'PRÓBAPONTOK',
      instruction:
        'A következő néhány próbában nem fogod látni, hova ért a pont. Csak célozz úgy, ahogy eddig.',
      controlHint: '',
      trials: 18,
      practiceTrials: 0,
    },
    {
      id: 'washout',
      title: 'TOVÁBB',
      instruction: 'Folytasd ugyanígy.',
      controlHint: '',
      trials: 24,
      practiceTrials: 0,
    },
    {
      id: 'relearn',
      title: 'MÉG EGYSZER',
      instruction: 'Még egy sorozat. Ugyanaz a feladat.',
      controlHint: '',
      trials: 32,
      practiceTrials: 0,
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private root!: THREE.Group;
  private home!: THREE.Mesh;
  private target!: THREE.Mesh;
  private cursor!: THREE.Mesh;
  private radiusRing!: THREE.Mesh;
  private feedbackPanel!: Panel;

  private trials: AdaptTrial[] = [];
  private currentPhase: Phase = 'baseline';
  private rotationDeg = 0;
  private practice = false;
  private aborted = false;
  private hiddenControllers = false;
  private anchor!: BodyAnchor;
  /** Captured start point in world space. */
  private homePos = new THREE.Vector3();

  private live: {
    targetPos: THREE.Vector3;
    azDeg: number;
    elDeg: number;
    radius: number;
    onsetT: number;
    startedAt: number | null;
    sampled: boolean;
    directionErrorDeg: number;
    planeDeviations: number[];
    resolve: (r: { outcome: AdaptTrial['outcome']; endpointErrorDeg: number;
                   movementTimeMs: number; reactionTimeMs: number }) => void;
  } | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.anchor = new BodyAnchor(ctx);
    this.anchor.capture();
    this.anchor.offset(0, HOME_UP, HOME_FORWARD, this.homePos);
    this.ctx = ctx;
    this.root = ctx.root;
    const t = ctx.theme;
    ctx.recorder.setMotionHz(30);

    this.home = makePrimitive({ kind: 'sphere', color: t.textMuted, unlit: true, size: 0.04 });
    this.home.position.copy(this.homePos);
    this.target = makePrimitive({ kind: 'sphere', color: t.accent, unlit: true, size: 0.05 });
    this.target.visible = false;
    this.cursor = makePrimitive({ kind: 'sphere', color: t.accent2, unlit: true, size: 0.025 });
    this.radiusRing = makePrimitive({
      kind: 'torus', color: t.textMuted, unlit: true, size: REACH_RADIUS * 2, opacity: 0.18,
    });
    this.radiusRing.position.copy(this.homePos);
    this.radiusRing.rotation.x = Math.PI / 2;

    this.root.add(this.home, this.target, this.cursor, this.radiusRing);

    this.feedbackPanel = new Panel({
      width: 0.7, height: 0.14, pxPerMeter: 950, theme: t, frame: false, name: 'adapt-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.75, -0.9);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    // Without this the participant sees their real hand next to the rotated
    // cursor, there is no conflict, and the module measures nothing.
    this.hideControllers(true);

    for (const b of this.blocks) b.controlHint = this.controlHint();

    ctx.recorder.event('adapt_setup', {
      platform: ctx.platform, rotationDeg: ROTATION_DEG, targetRadiusM: REACH_RADIUS,
      directions: 8, farRadiusM: FAR_RADIUS, sampleFraction: SAMPLE_FRACTION,
      phasePlan: this.blocks.map((b) => ({ phase: b.id, trials: b.trials })),
    });
  }

  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'Nyúlj a célhoz — a kezed nem látod, csak a pontot';
      case 'desktop': return 'EGÉR: mozgatás · a kurzor nem ott lesz, ahol az egér';
      default: return 'HÚZD az ujjad a cél felé';
    }
  }

  private hideControllers(hide: boolean): void {
    this.hiddenControllers = hide;
    for (const p of this.ctx.engine.input.pointers) {
      if (p.object3D) p.object3D.visible = !hide;
    }
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    // The reaching frame is re-read per block; a participant who shifted
    // their feet must still find the start point in front of them.
    this.anchor.capture();
    this.anchor.offset(0, HOME_UP, HOME_FORWARD, this.homePos);
    this.home.position.copy(this.homePos);
    this.radiusRing.position.copy(this.homePos);
    const phase = block.id as Phase;
    this.currentPhase = phase;
    this.practice = practice;
    const count = practice ? block.practiceTrials : block.trials;
    if (count <= 0) return;

    const before = this.rotationDeg;
    // Baseline, probe-after-adaptation and washout differ only in whether the
    // rotation is on. Nothing announces the change.
    this.rotationDeg = (phase === 'adaptation' || phase === 'probe' || phase === 'relearn')
      ? ROTATION_DEG : 0;
    if (before !== this.rotationDeg && !practice) {
      ctx.recorder.event('rotation_change', {
        fromDeg: before, toDeg: this.rotationDeg, atTrial: this.trials.length,
      });
    }

    const feedback = phase !== 'probe';
    ctx.recorder.event('phase_start', {
      phase, rotationDeg: this.rotationDeg, feedback, trials: count,
    });

    const plan = phase === 'probe' ? this.probePlan() : this.reachPlan(count);

    for (let i = 0; i < plan.length && !this.aborted; i++) {
      ctx.recorder.trialNumber = this.trials.length + 1;
      const spec = plan[i]!;
      await this.runReach(phase, i, spec, feedback);
      if (this.aborted) return;
      await this.wait(ctx.rng.range(400, 700));
    }

    if (!practice) {
      const errs = this.trials.filter((t) => t.phase === phase).map((t) => t.directionErrorDeg);
      ctx.recorder.event('phase_summary', {
        phase, meanErrorDeg: errs.length ? +mean(errs).toFixed(2) : null, n: errs.length,
      });
    }
  }

  /** Eight trained directions in the horizontal ring, cycled then shuffled. */
  private reachPlan(count: number): { azDeg: number; elDeg: number; radius: number; group: ProbeGroup | null }[] {
    const out: { azDeg: number; elDeg: number; radius: number; group: ProbeGroup | null }[] = [];
    for (let i = 0; i < count; i++) {
      out.push({ azDeg: (i % 8) * 45 - 180 + 22.5, elDeg: 0, radius: REACH_RADIUS, group: null });
    }
    // Shuffle within groups of eight so every direction appears equally often
    // in every stretch of the phase - a run of one direction would let the
    // participant learn a single correction rather than a mapping.
    for (let s = 0; s + 8 <= out.length; s += 8) {
      const chunk = this.ctx.rng.shuffle(out.slice(s, s + 8));
      for (let k = 0; k < 8; k++) out[s + k] = chunk[k]!;
    }
    return out;
  }

  /** Six probe groups, three trials each, all without feedback. */
  private probePlan(): { azDeg: number; elDeg: number; radius: number; group: ProbeGroup }[] {
    const base = 22.5;
    const out: { azDeg: number; elDeg: number; radius: number; group: ProbeGroup }[] = [];
    const add = (group: ProbeGroup, azOff: number, elDeg: number, radius: number) => {
      for (let k = 0; k < 3; k++) {
        out.push({ azDeg: base + (k - 1) * 45 + azOff, elDeg, radius, group });
      }
    };
    add('trained', 0, 0, REACH_RADIUS);
    add('dir30', 30, 0, REACH_RADIUS);
    add('dir90', 90, 0, REACH_RADIUS);
    add('elev_up', 0, 30, REACH_RADIUS);
    add('elev_down', 0, -30, REACH_RADIUS);
    add('far', 0, 0, FAR_RADIUS);
    return this.ctx.rng.shuffle(out);
  }

  private async runReach(
    phase: Phase, index: number,
    spec: { azDeg: number; elDeg: number; radius: number; group: ProbeGroup | null },
    feedback: boolean
  ): Promise<void> {
    const ctx = this.ctx;
    await this.waitForHome();
    if (this.aborted) return;

    (this.home.material as THREE.MeshBasicMaterial).color.setHex(0x8fa6bf);
    await this.wait(350);
    if (this.aborted) return;

    const dir = new THREE.Vector3(
      Math.sin((spec.azDeg * Math.PI) / 180) * Math.cos((spec.elDeg * Math.PI) / 180),
      Math.sin((spec.elDeg * Math.PI) / 180),
      -Math.cos((spec.azDeg * Math.PI) / 180) * Math.cos((spec.elDeg * Math.PI) / 180)
    );
    const targetPos = this.homePos.clone().addScaledVector(dir, spec.radius);
    this.target.position.copy(targetPos);
    this.target.visible = true;

    const onsetT = ctx.engine.clock.frameTime;
    ctx.recorder.event('target_on', {
      phase, trialInPhase: index, azDeg: spec.azDeg, elDeg: spec.elDeg,
      radiusM: spec.radius, group: spec.group ?? undefined,
      rotationDeg: this.rotationDeg,
    }, onsetT);

    const res = await new Promise<{
      outcome: AdaptTrial['outcome']; endpointErrorDeg: number;
      movementTimeMs: number; reactionTimeMs: number;
    }>((resolve) => {
      this.live = {
        targetPos, azDeg: spec.azDeg, elDeg: spec.elDeg, radius: spec.radius,
        onsetT, startedAt: null, sampled: false, directionErrorDeg: NaN,
        planeDeviations: [], resolve,
      };
      setTimeout(() => {
        if (this.live) {
          const l = this.live;
          this.live = null;
          resolve({ outcome: 'timeout', endpointErrorDeg: NaN, movementTimeMs: NaN,
                    reactionTimeMs: l.startedAt === null ? NaN : l.startedAt - onsetT });
        }
      }, REACH_TIMEOUT_MS);
    });

    const dirErr = this.lastDirectionError;
    const planeDev = this.lastPlaneDeviation;

    this.target.visible = false;
    if (feedback) {
      // The cursor freezes where it landed - the only information the
      // participant gets about the rotation.
      await this.wait(400);
    } else {
      this.cursor.visible = false;
      await this.wait(250);
      this.cursor.visible = true;
    }

    const rec: AdaptTrial = {
      phase, trialInPhase: index, group: spec.group,
      azDeg: spec.azDeg, elDeg: spec.elDeg, radiusM: spec.radius,
      rotationDeg: this.rotationDeg, feedback,
      directionErrorDeg: dirErr, endpointErrorDeg: res.endpointErrorDeg,
      movementTimeMs: res.movementTimeMs, reactionTimeMs: res.reactionTimeMs,
      planeDeviationM: planeDev, outcome: res.outcome,
    };
    if (!this.practice) this.trials.push(rec);

    ctx.recorder.event('reach_end', {
      endpointErrorDeg: r2(res.endpointErrorDeg), movementTimeMs: r2(res.movementTimeMs),
      planeDeviationM: r2(planeDev, 4), feedbackShown: feedback, outcome: res.outcome,
    });

    if (!this.practice) {
      const trialRec: TrialRecord = {
        trialNumber: this.trials.length,
        block: phase,
        stimulus: {
          phase, trialInPhase: index, group: spec.group ?? undefined,
          azDeg: spec.azDeg, elDeg: spec.elDeg, radiusM: spec.radius,
          rotationDeg: this.rotationDeg, feedback, platform: ctx.platform,
        },
        response: {
          directionErrorDeg: r2(dirErr), endpointErrorDeg: r2(res.endpointErrorDeg),
          movementTimeMs: r2(res.movementTimeMs), reactionTimeMs: r2(res.reactionTimeMs),
          planeDeviationM: r2(planeDev, 4),
        },
        correct: res.outcome === 'hit',
        outcome: res.outcome,
        reactionTimeMs: Number.isFinite(res.reactionTimeMs) ? Math.round(res.reactionTimeMs) : null,
        startedAt: Math.round(onsetT),
        endedAt: Math.round(ctx.engine.clock.frameTime),
      };
      ctx.recorder.trial(trialRec);
    }

    if (this.practice) {
      this.showFeedback(Math.abs(dirErr) < 12 ? 'JÓ' : 'KICSIT MELLÉ', Math.abs(dirErr) < 12);
    }
  }

  private waitForHome(): Promise<void> {
    return new Promise((resolve) => {
      const step = () => {
        if (this.aborted) { resolve(); return; }
        const h = this.handPos();
        if (h && h.distanceTo(this.homePos) < 0.07) {
          (this.home.material as THREE.MeshBasicMaterial).color.setHex(0x8fa6bf);
          resolve();
          return;
        }
        setTimeout(step, 20);
      };
      step();
    });
  }

  /* ------------------------------------------------------------ update */

  private lastDirectionError = NaN;
  private lastPlaneDeviation = NaN;

  update(_dt: number, ctx: ModuleContext): void {
    const hand = this.handPos();
    if (!hand) return;

    // The cursor is the hand rotated about the vertical axis through home.
    // The participant sees only this; the hand itself is hidden.
    const rel = hand.clone().sub(this.homePos);
    if (this.rotationDeg !== 0) {
      rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), (this.rotationDeg * Math.PI) / 180);
    }
    const cursorPos = this.homePos.clone().add(rel);
    this.cursor.position.copy(cursorPos);

    const l = this.live;
    if (!l) return;

    const dist = rel.length();
    if (l.startedAt === null && dist > 0.05) {
      l.startedAt = ctx.engine.clock.frameTime;
      ctx.recorder.event('movement_start', {
        reactionTimeMs: +(l.startedAt - l.onsetT).toFixed(1),
      }, l.startedAt);
    }

    if (l.startedAt !== null) {
      // Distance from the straight home-to-target line: how far the reach
      // left the plane it was aimed in.
      const toTarget = l.targetPos.clone().sub(this.homePos);
      const proj = toTarget.clone().normalize().multiplyScalar(rel.dot(toTarget.clone().normalize()));
      l.planeDeviations.push(rel.clone().sub(proj).length());
    }

    // Read the movement direction once, at a fixed fraction of the way out.
    if (!l.sampled && dist >= l.radius * SAMPLE_FRACTION) {
      l.sampled = true;
      const targetAz = Math.atan2(l.targetPos.x - this.homePos.x, -(l.targetPos.z - this.homePos.z)) * 180 / Math.PI;
      const cursorAz = Math.atan2(cursorPos.x - this.homePos.x, -(cursorPos.z - this.homePos.z)) * 180 / Math.PI;
      l.directionErrorDeg = angleDiffDeg(cursorAz, targetAz);
      this.lastDirectionError = l.directionErrorDeg;
      ctx.recorder.event('direction_sample', {
        atFractionOfRadius: SAMPLE_FRACTION,
        directionErrorDeg: +l.directionErrorDeg.toFixed(2),
        tMs: +(ctx.engine.clock.frameTime - l.onsetT).toFixed(1),
      });
    }

    if (dist >= l.radius) {
      const targetAz = Math.atan2(l.targetPos.x - this.homePos.x, -(l.targetPos.z - this.homePos.z)) * 180 / Math.PI;
      const cursorAz = Math.atan2(cursorPos.x - this.homePos.x, -(cursorPos.z - this.homePos.z)) * 180 / Math.PI;
      const endErr = angleDiffDeg(cursorAz, targetAz);
      this.lastPlaneDeviation = l.planeDeviations.length ? mean(l.planeDeviations) : NaN;
      const mt = l.startedAt === null ? NaN : ctx.engine.clock.frameTime - l.startedAt;
      const rt = l.startedAt === null ? NaN : l.startedAt - l.onsetT;
      const resolve = l.resolve;
      this.live = null;
      resolve({
        outcome: Math.abs(endErr) < 12 ? 'hit' : 'miss',
        endpointErrorDeg: endErr, movementTimeMs: mt, reactionTimeMs: rt,
      });
    }
  }

  private handPos(): THREE.Vector3 | null {
    const p = this.ctx.engine.input.pointers.find((x) => x.active && (x.id === 'left' || x.id === 'right'))
      ?? this.ctx.engine.input.pointers.find((x) => x.active);
    return p?.object3D ? p.object3D.getWorldPosition(new THREE.Vector3()) : null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r0) => setTimeout(r0, ms));
  }

  private feedbackText = '';
  private feedbackOk = true;

  private showFeedback(text: string, ok: boolean): void {
    this.feedbackText = text;
    this.feedbackOk = ok;
    this.feedbackPanel.group.visible = true;
    this.feedbackPanel.invalidate();
    setTimeout(() => { this.feedbackPanel.group.visible = false; }, 500);
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.85), 14);
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2 + 10, {
      size: 26, color: this.feedbackOk ? t.ok : t.bad, align: 'center', weight: '600',
    });
  }

  /* ------------------------------------------------------------ finish */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';
    const of = (p: Phase) => this.trials.filter((t) => t.phase === p && Number.isFinite(t.directionErrorDeg));

    const baseline = of('baseline');
    const adaptation = of('adaptation');
    const washout = of('washout');
    const relearn = of('relearn');
    const probes = this.trials.filter((t) => t.phase === 'probe' && Number.isFinite(t.directionErrorDeg));

    const baselineBias = baseline.length ? mean(baseline.map((t) => t.directionErrorDeg)) : 0;
    const baselineSd = baseline.length > 2 ? stdev(baseline.map((t) => t.directionErrorDeg)) : NaN;
    // Every later error is expressed relative to the participant's own
    // baseline aim, so a person who naturally reaches a few degrees clockwise
    // is not scored as having failed to adapt.
    const corrected = (t: AdaptTrial) => t.directionErrorDeg - baselineBias;

    const adaptFit = fitLearningCurve(adaptation.map((t) => Math.abs(corrected(t))));
    const relearnFit = fitLearningCurve(relearn.map((t) => Math.abs(corrected(t))));

    // How many time constants the phase actually observed. The fit is
    // unbiased, but its run-to-run spread depends almost entirely on this
    // ratio: simulated over 200 runs at 64 trials, a tau of 8 comes back to
    // within +/-0.6 trials, a tau of 20 to +/-1.8, and a tau of 40 to +/-7.4.
    // Anyone slow enough to need this measurement most is the one whose
    // estimate is least trustworthy, so the ratio is reported and the result
    // screen says when the number is a lower bound rather than a value.
    const observedTaus = Number.isFinite(adaptFit.rateTrials) && adaptFit.rateTrials > 0
      ? adaptation.length / adaptFit.rateTrials : NaN;
    const rateReliable = Number.isFinite(observedTaus) && observedTaus >= 2.5;

    // Three separate things can go wrong with a learning curve, and each needs
    // its own check:
    //
    //   the error never fell        -> nothing was learned, there is no curve
    //   the curve fits badly        -> the shape is not exponential
    //   the window was too short    -> the shape is right, tau is not pinned
    //
    // r2 catches only the middle one. A flat series has no variance to explain
    // at all, and a curve observed over one and a half time constants fits
    // beautifully while its tau is worthless.
    const fittedDrop = Number.isFinite(adaptFit.start) && Number.isFinite(adaptFit.asymptote)
      ? adaptFit.start - adaptFit.asymptote : NaN;
    const learned = Number.isFinite(fittedDrop) && fittedDrop >= ROTATION_DEG * 0.15;
    const fitUsable = learned
      && Number.isFinite(adaptFit.rateTrials)
      && Number.isFinite(adaptFit.r2) && adaptFit.r2 >= 0.25;


    const earlyAdapt = adaptation.length >= 8
      ? Math.abs(mean(adaptation.slice(0, 4).map(corrected))) - Math.abs(mean(adaptation.slice(4, 8).map(corrected)))
      : NaN;

    // The aftereffect: with the rotation gone, the learned correction is still
    // applied, so the first reaches miss the other way.
    const aftereffect = washout.length >= 3
      ? Math.abs(mean(washout.slice(0, 3).map(corrected))) : NaN;

    const totalAdaptation = Number.isFinite(adaptFit.asymptote)
      ? ROTATION_DEG - adaptFit.asymptote : NaN;
    const implicitFraction = Number.isFinite(aftereffect) && Number.isFinite(totalAdaptation) && totalAdaptation > 1
      ? clamp(aftereffect / totalAdaptation, 0, 1.5) : NaN;

    const savings = Number.isFinite(adaptFit.rateTrials) && Number.isFinite(relearnFit.rateTrials)
      && adaptFit.rateTrials > 0
      ? clamp(1 - relearnFit.rateTrials / adaptFit.rateTrials, -1, 1) : NaN;

    /* --------------------------------------------- generalisation */

    const groupCorrection = (g: ProbeGroup) => {
      const rows = probes.filter((t) => t.group === g);
      // How far the aim was displaced against the rotation - the size of the
      // correction being carried at that probe location.
      return rows.length ? Math.abs(mean(rows.map(corrected))) : NaN;
    };
    const trainedCorr = groupCorrection('trained');
    const rel = (g: ProbeGroup) => {
      const c = groupCorrection(g);
      return Number.isFinite(c) && Number.isFinite(trainedCorr) && trainedCorr > 1 ? c / trainedCorr : NaN;
    };
    const dir30 = rel('dir30');
    const dir90 = rel('dir90');
    const elevUp = rel('elev_up');
    const elevDown = rel('elev_down');
    const elevGen = isVr
      ? mean([elevUp, elevDown].filter(Number.isFinite))
      : NaN;
    const farGen = isVr ? rel('far') : NaN;

    const planeDev = mean(this.trials.map((t) => t.planeDeviationM).filter(Number.isFinite));

    const M: [string, number, string, string?][] = [
      ['baseline_error_sd_deg', baselineSd, 'deg', 'baseline'],
      ['baseline_bias_deg', baselineBias, 'deg', 'baseline'],
      ['adaptation_rate_trials', adaptFit.rateTrials, 'trials', 'adaptation'],
      ['adaptation_fit_r2', adaptFit.r2, 'ratio', 'adaptation'],
      ['adaptation_observed_time_constants', observedTaus, 'ratio', 'adaptation'],
      ['adaptation_total_drop_deg', fittedDrop, 'deg', 'adaptation'],
      ['asymptotic_error_deg', adaptFit.asymptote, 'deg', 'adaptation'],
      ['early_adaptation_deg', earlyAdapt, 'deg', 'adaptation'],
      ['aftereffect_deg', aftereffect, 'deg', 'washout'],
      ['implicit_fraction', implicitFraction, 'ratio'],
      ['relearn_rate_trials', relearnFit.rateTrials, 'trials', 'relearn'],
      ['savings_index', savings, 'ratio'],
      ['direction_generalisation_30', dir30, 'ratio', 'probe'],
      ['direction_generalisation_90', dir90, 'ratio', 'probe'],
    ];
    if (isVr) {
      M.push(['elevation_generalisation', elevGen, 'ratio', 'probe']);
      M.push(['elevation_generalisation_up', elevUp, 'ratio', 'probe']);
      M.push(['elevation_generalisation_down', elevDown, 'ratio', 'probe']);
      M.push(['far_generalisation', farGen, 'ratio', 'probe']);
      M.push(['movement_plane_deviation', planeDev, 'm']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* -------------------------------------------------- scores */

    // A time constant fitted to a curve that never bent is a number without a
    // referent. Below this fit quality the rate is not scored at all.
    const rateScore = fitUsable ? normaliseSoft(adaptFit.rateTrials, 8, 40) : 0;
    const savingsScore = normaliseSoft(Number.isFinite(savings) ? savings : 0, 0.50, 0.0);
    const accuracyScore = normaliseSoft(Number.isFinite(adaptFit.asymptote) ? adaptFit.asymptote : 18, 3, 18);
    const implicitScore = normaliseSoft(Number.isFinite(implicitFraction) ? implicitFraction : 0.15, 0.65, 0.15);
    const genScore = normaliseSoft(Number.isFinite(elevGen) ? elevGen : 0.25, 0.85, 0.25);

    const components = isVr
      ? [
          { key: 'learning_rate', value: rateScore, weight: 0.30 },
          { key: 'savings', value: savingsScore, weight: 0.22 },
          { key: 'final_accuracy', value: accuracyScore, weight: 0.20 },
          { key: 'implicit_learning', value: implicitScore, weight: 0.16 },
          { key: 'spatial_generalisation', value: genScore, weight: 0.12 },
        ]
      : [
          { key: 'learning_rate', value: rateScore, weight: 0.34 },
          { key: 'savings', value: savingsScore, weight: 0.25 },
          { key: 'final_accuracy', value: accuracyScore, weight: 0.23 },
          { key: 'implicit_learning', value: implicitScore, weight: 0.18 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const deg = (v: number, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)}°` : '—');
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

    const headline: { label: string; value: string; hint?: string }[] = [];
    headline.push(!fitUsable
      ? { label: 'Tanulási ráta', value: 'nem értelmezhető',
          hint: 'a görbe nem illeszthető — valószínűleg nem adaptáltál' }
      : rateReliable
      ? { label: 'Tanulási ráta', value: `${Math.round(adaptFit.rateTrials)} próba`,
          hint: 'ennyi alatt tetted meg a javulás 63%-át' }
      : { label: 'Tanulási ráta', value: `≥ ${Math.round(adaptFit.rateTrials)} próba`,
          hint: 'lassan tanultál — a blokk véget ért, mielőtt a görbe beállt volna, ' +
                'ezért ez alsó becslés' });
    headline.push({ label: 'Végső pontosság', value: deg(adaptFit.asymptote), hint: 'ennyi hiba maradt' });
    headline.push({ label: 'Utóhatás', value: deg(aftereffect), hint: 'ennyi épült be tudattalanul' });
    headline.push({ label: 'Beépült arány', value: Number.isFinite(implicitFraction) ? `~${pct(implicitFraction)}` : '—',
                    hint: 'becsült implicit rész' });
    headline.push({ label: 'Újratanulás',
                    value: Number.isFinite(savings) ? `${savings >= 0 ? '+' : '−'}${Math.abs(Math.round(savings * 100))}%` : '—',
                    hint: 'ennyivel gyorsabb volt másodszorra' });
    headline.push(isVr
      ? { label: 'Térbeli átvitel', value: Number.isFinite(elevGen) ? elevGen.toFixed(2) : '—',
          hint: 'más magasságban ennyire működött' }
      : { label: 'Térbeli átvitel', value: 'headset kell', hint: 'az elevációs próbapontok kimaradtak' });

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        spatialWeightsApplied: isVr,
        rotationDeg: ROTATION_DEG,
        repeatWarning:
          'A savings definíció szerint azt jelenti, hogy a második kitettség gyorsabb. ' +
          'Ismételt felvételnél ez az érték nem hasonlítható az elsőhöz.',
        baseline: { biasDeg: r(baselineBias), sdDeg: r(baselineSd), n: baseline.length },
        adaptation: {
          tauTrials: r(adaptFit.rateTrials), r2: r(adaptFit.r2, 3),
          asymptoteDeg: r(adaptFit.asymptote), startDeg: r(adaptFit.start),
          earlyDeg: r(earlyAdapt), n: adaptation.length, fitUsable,
          observedTimeConstants: r(observedTaus, 2), rateReliable,
          totalDropDeg: r(fittedDrop), learned,
          rateNote: rateReliable ? null
            : 'the adaptation phase ended before the curve settled; tau is a lower bound',
        },
        washout: { aftereffectDeg: r(aftereffect), n: washout.length },
        relearn: { tauTrials: r(relearnFit.rateTrials), r2: r(relearnFit.r2, 3), n: relearn.length },
        savingsIndex: r(savings, 3),
        implicitFraction: r(implicitFraction, 3),
        implicitNote: 'aftereffect-based estimate, not an aiming report; biased upwards',
        generalisation: {
          dir30: r(dir30, 3), dir90: r(dir90, 3),
          elevationUp: isVr ? r(elevUp, 3) : null,
          elevationDown: isVr ? r(elevDown, 3) : null,
          elevation: isVr ? r(elevGen, 3) : null,
          far: isVr ? r(farGen, 3) : null,
        },
        movementPlaneDeviationM: isVr ? r(planeDev, 4) : null,
        totalTrials: this.trials.length,
      },
      axisScores: {
        motor: Math.round((rateScore + accuracyScore) / 2),
        memory: Math.round(savingsScore),
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.live?.resolve({ outcome: 'invalid', endpointErrorDeg: NaN, movementTimeMs: NaN, reactionTimeMs: NaN });
  }

  dispose(ctx: ModuleContext): void {
    this.hideControllers(false);
    ctx.panels.remove(this.feedbackPanel);
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
function r2(v: number, digits = 1): number | null { return r(v, digits); }
