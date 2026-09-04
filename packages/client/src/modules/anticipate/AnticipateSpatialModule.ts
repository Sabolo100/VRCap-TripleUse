import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, stdev, slope, normaliseSoft, opsScore, clamp,
  type ModuleManifest, type TrialRecord, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { volumePosition, Tumbler } from '../shared/volume.js';

/**
 * MODULE 11 - ANTICIPATE, variant B
 * Time-to-contact: the object comes at you.
 *
 * Variant A is the Bassin timer layout - a ball running along a rail past a
 * marker. That apparatus is one-dimensional by construction, and putting it in
 * a headset changes nothing about what is measured.
 *
 * What a batter, a goalkeeper or a driver actually does is judge when
 * something will REACH them. The information for that is tau: the optical
 * expansion rate, the ratio of angular size to its rate of growth. Tau is
 * available only when the object approaches, and only when its angular size
 * genuinely grows - which is to say, only in depth.
 *
 * Block 3 is the reason this variant exists. Objects of three different
 * PHYSICAL sizes approach on schedules that arrive at the same instant. Anyone
 * using tau is unaffected by size. Anyone using a size-or-distance heuristic
 * judges the large one as arriving sooner - the size-arrival effect, a
 * well-documented signature that separates the two strategies. Variant A
 * cannot produce this measurement at all.
 */

type BlockId = 'approach' | 'occluded' | 'size' | 'angle';

interface SpecB {
  travelMs: number;
  occlusionFraction: number;
  /** Physical radius in metres - the size-arrival manipulation. */
  physicalSize: number;
  /** Direction the object comes from. */
  azDeg: number;
  elDeg: number;
  startRadius: number;
  sizeLevel: 'small' | 'medium' | 'large';
}

interface ResultB {
  block: BlockId;
  signedErrorMs: number;
  travelMs: number;
  occlusionMs: number;
  physicalSize: number;
  sizeLevel: SpecB['sizeLevel'];
  eccentricityDeg: number;
}

export class AnticipateSpatialModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.ANTICIPATE!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'approach',
      title: 'KÖZELEDÉS',
      instruction:
        'Egy gömb indul feléd a távolból, és pontosan akkor kell reagálnod, amikor elérné a fejedet. ' +
        'Nem oldalra mozog, hanem RÁD jön — a tágulásából tudod megítélni, mikor ér ide. ' +
        'Nem gyorsnak kell lenned, hanem pontosnak.',
      controlHint: '',
      trials: 18,
      practiceTrials: 5,
    },
    {
      id: 'occluded',
      title: 'TAKART KÖZELEDÉS',
      instruction:
        'Ugyanaz, de a gömb az út utolsó szakaszán eltűnik. Neked kell fejben továbbvinned, ' +
        'és akkor válaszolnod, amikor odaérne. Két különböző takarási hossz lesz.',
      controlHint: '',
      trials: 24,
      practiceTrials: 4,
    },
    {
      id: 'size',
      title: 'MÉRET',
      instruction:
        'Most különböző MÉRETŰ gömbök jönnek. A méret nem árulja el, mikor érkeznek — ' +
        'ugyanúgy kell időzítened mindegyiknél. Figyelj, nehogy a nagyobb korábbinak tűnjön.',
      controlHint: '',
      trials: 27,
      practiceTrials: 4,
    },
    {
      id: 'angle',
      title: 'IRÁNY',
      instruction:
        'Az utolsó blokk: a gömbök most különböző irányokból érkeznek, nem szemből. ' +
        'Néha oldalról vagy felülről. Ugyanaz a feladat: nyomd meg a ravaszt akkor, amikor elérné a fejedet.',
      controlHint: '',
      trials: 20,
      practiceTrials: 4,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private ball!: THREE.Mesh;
  private aimRing!: THREE.Mesh;
  private feedbackPanel!: Panel;
  private tumbler = new Tumbler();

  private currentBlock: BlockId = 'approach';
  private practice = false;
  private trials: TrialRecord[] = [];
  private results: ResultB[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;
  private feedbackText = '';
  private feedbackEarly = false;

  private live: {
    spec: SpecB;
    launchT: number;
    arrivalT: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    occludeAtMs: number;
    occluded: boolean;
    responded: boolean;
    resolve: (r: { signedErrorMs: number | null; outcome: 'ok' | 'early' | 'timeout' }) => void;
  } | null = null;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    this.ball = makePrimitive({ kind: 'sphere', color: ctx.theme.accent, unlit: true, size: 0.18 });
    this.ball.visible = false;
    this.root.add(this.ball);

    // A ring at the arrival plane, just in front of the face. It makes
    // "arrival" a place rather than an invisible instant, without giving away
    // the timing.
    this.aimRing = makePrimitive({
      kind: 'torus', color: ctx.theme.textMuted, unlit: true, opacity: 0.22, size: 0.9,
    });
    this.aimRing.position.set(0, 1.6, -0.55);
    this.root.add(this.aimRing);

    this.feedbackPanel = new Panel({
      width: 0.85, height: 0.2, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'anticipate-b-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.05, -1.6);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint();
    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
  }

  private controlHint(): string {
    const tail = ' Nem kell gyorsnak lenned — pontosnak kell lenned.';
    switch (this.ctx.platform) {
      case 'vr': return 'Húzd meg a ravaszt PONTOSAN akkor, amikor a gömb elérné a fejedet.' + tail;
      case 'mobile': return 'Koppints PONTOSAN akkor, amikor a gömb elérne.' + tail;
      default: return 'Kattints vagy nyomj SZÓKÖZT PONTOSAN akkor, amikor a gömb elérne.' + tail;
    }
  }

  /* -------------------------------------------------- trial generation */

  private angleRange(): { az: number; el: number } {
    // A flat viewport cannot show an object arriving from 60 degrees off axis,
    // so the spread narrows - but the approach itself, which is what this
    // variant is about, survives.
    switch (this.ctx.platform) {
      case 'vr': return { az: 55, el: 22 };
      case 'mobile': return { az: 16, el: 10 };
      default: return { az: 21, el: 12 };
    }
  }

  private buildSpecs(block: BlockId, count: number, rng: Rng): SpecB[] {
    const out: SpecB[] = [];
    const R = this.angleRange();
    const base = () => ({
      startRadius: rng.range(11, 16),
      azDeg: 0,
      elDeg: 0,
    });

    switch (block) {
      case 'approach':
        for (let i = 0; i < count; i++) {
          out.push({ ...base(), travelMs: rng.range(1500, 2300), occlusionFraction: 0, physicalSize: 0.18, sizeLevel: 'medium' });
        }
        return out;

      case 'occluded': {
        // Two occlusion depths, evenly split, so occlusion robustness has two
        // points plus the block-1 baseline to fit a slope through.
        const half = Math.floor(count / 2);
        for (let i = 0; i < count; i++) {
          out.push({
            ...base(), travelMs: rng.range(1500, 2300),
            occlusionFraction: i < half ? 0.35 : 0.62,
            physicalSize: 0.18, sizeLevel: 'medium',
          });
        }
        return rng.shuffle(out);
      }

      case 'size': {
        // The size-arrival manipulation. Physical radius varies by a factor of
        // 2.4 while the arrival schedule is identical, so any systematic
        // timing difference between sizes is a heuristic, not tau.
        const levels: [SpecB['sizeLevel'], number][] = [['small', 0.10], ['medium', 0.18], ['large', 0.30]];
        const per = Math.floor(count / 3);
        for (const [sizeLevel, physicalSize] of levels) {
          for (let i = 0; i < per; i++) {
            out.push({ ...base(), travelMs: 1900, occlusionFraction: 0.45, physicalSize, sizeLevel });
          }
        }
        while (out.length < count) {
          out.push({ ...base(), travelMs: 1900, occlusionFraction: 0.45, physicalSize: 0.18, sizeLevel: 'medium' });
        }
        return rng.shuffle(out);
      }

      case 'angle': {
        for (let i = 0; i < count; i++) {
          // Half head-on, half genuinely off-axis: the contrast is the cost of
          // judging an approach you are not looking straight down.
          const offAxis = i % 2 === 1;
          out.push({
            ...base(),
            azDeg: offAxis ? rng.range(-R.az, R.az) : rng.range(-6, 6),
            elDeg: offAxis ? rng.range(-R.el * 0.5, R.el) : rng.range(-4, 4),
            travelMs: rng.range(1500, 2300),
            occlusionFraction: 0.45,
            physicalSize: 0.18,
            sizeLevel: 'medium',
          });
        }
        return rng.shuffle(out);
      }
    }
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    const queue = this.buildSpecs(this.currentBlock, count, ctx.rng);
    let repeats = 0;
    for (let i = 0; i < queue.length && !this.aborted; i++) {
      ctx.recorder.trialNumber = i + 1;
      const r = await this.runTrial(queue[i]!);
      if (r.outcome === 'early' && repeats < 3) { repeats++; queue.push(queue[i]!); }
      await this.wait(600);
    }
    this.ball.visible = false;
    this.feedbackPanel.group.visible = false;
  }

  private runTrial(spec: SpecB): Promise<{ signedErrorMs: number | null; outcome: 'ok' | 'early' | 'timeout' }> {
    return new Promise((resolve) => { void this.launch(spec, resolve); });
  }

  private async launch(
    spec: SpecB,
    resolve: (r: { signedErrorMs: number | null; outcome: 'ok' | 'early' | 'timeout' }) => void
  ): Promise<void> {
    const ctx = this.ctx;
    this.ball.visible = false;
    this.feedbackPanel.group.visible = false;
    await this.wait(ctx.rng.range(900, 1700));
    if (this.aborted) { resolve({ signedErrorMs: null, outcome: 'timeout' }); return; }

    const from = volumePosition(spec.azDeg, spec.elDeg, spec.startRadius, 1.6);
    // Arrival is the ring plane just in front of the face, not the eye itself:
    // an object that reaches the eye has already passed the moment being judged.
    const dir = from.clone().sub(new THREE.Vector3(0, 1.6, 0)).normalize();
    const to = new THREE.Vector3(0, 1.6, 0).addScaledVector(dir, 0.55);

    this.ball.scale.setScalar(spec.physicalSize / 0.18);
    this.ball.position.copy(from);
    this.ball.visible = true;
    this.tumbler.clear();
    this.tumbler.add(this.ball, ctx.rng, 0.3, 0.8);

    const launchT = ctx.engine.clock.frameTime;
    const arrivalT = launchT + spec.travelMs;
    const occludeAtMs = spec.occlusionFraction > 0 ? spec.travelMs * (1 - spec.occlusionFraction) : Infinity;

    const live = {
      spec, launchT, arrivalT, from, to, occludeAtMs,
      occluded: false, responded: false,
      resolve: (r: { signedErrorMs: number | null; outcome: 'ok' | 'early' | 'timeout' }) => {
        this.live = null;
        this.ball.visible = false;
        this.tumbler.remove(this.ball);
        resolve(r);
      },
    };
    this.live = live;

    ctx.audio.tone({ freq: 900, durationMs: 40, gain: 0.16 });
    ctx.recorder.event('ball_launched', {
      travelMs: Math.round(spec.travelMs), startRadius: +spec.startRadius.toFixed(2),
      azDeg: +spec.azDeg.toFixed(1), elDeg: +spec.elDeg.toFixed(1),
      physicalSize: spec.physicalSize, sizeLevel: spec.sizeLevel,
      occlusionFraction: spec.occlusionFraction,
      quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
    }, launchT);

    setTimeout(() => {
      if (this.live !== live || live.responded) return;
      live.responded = true;
      ctx.recorder.event('timeout', { overshootMs: 1200 });
      this.commit(spec, null, 'timeout');
      live.resolve({ signedErrorMs: null, outcome: 'timeout' });
    }, spec.travelMs + 1300);
  }

  /* ---------------------------------------------------------- response */

  private onAction(e: ActionEvent): void {
    if (!e.down || e.action !== 'PRIMARY') return;
    const live = this.live;
    if (!live || live.responded) return;

    const elapsed = e.t - live.launchT;
    const fraction = clamp(elapsed / live.spec.travelMs, 0, 2);
    if (fraction < 0.25) {
      live.responded = true;
      this.ctx.recorder.event('early_reject', { fractionTravelled: +fraction.toFixed(3) });
      this.ctx.audio.error();
      if (this.practice) this.showFeedback('TÚL KORAI — várd meg a közeledést', true);
      this.commit(live.spec, null, 'invalid');
      live.resolve({ signedErrorMs: null, outcome: 'early' });
      return;
    }

    live.responded = true;
    const signed = e.t - live.arrivalT;
    this.ctx.engine.input.pulse(e.hand === 'none' ? 'both' : e.hand, 0.3, 24);
    this.ctx.recorder.event('timing_response', {
      signedErrorMs: +signed.toFixed(1), absErrorMs: +Math.abs(signed).toFixed(1),
      phase: elapsed < live.occludeAtMs ? 'before_occlusion' : e.t < live.arrivalT ? 'during_occlusion' : 'after_arrival',
      sizeLevel: live.spec.sizeLevel,
    }, e.t);

    if (this.practice) {
      const early = signed < 0;
      this.showFeedback(`${signed >= 0 ? '+' : '−'}${Math.abs(Math.round(signed))} ms · ${early ? 'KORÁN' : 'KÉSŐN'}`, early);
      this.ctx.audio.tone({ freq: early ? 1200 : 400, durationMs: 90, gain: 0.2 });
    }

    this.commit(live.spec, signed, Math.abs(signed) <= 100 ? 'hit' : 'miss');
    live.resolve({ signedErrorMs: signed, outcome: 'ok' });
  }

  private commit(spec: SpecB, signedErrorMs: number | null, outcome: TrialRecord['outcome']): void {
    const occlusionMs = spec.travelMs * spec.occlusionFraction;
    const ecc = Math.hypot(spec.azDeg, spec.elDeg);
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block: this.currentBlock,
      stimulus: {
        kind: 'anticipate_spatial', block: this.currentBlock,
        travelMs: Math.round(spec.travelMs), occlusionFraction: spec.occlusionFraction,
        occlusionMs: Math.round(occlusionMs), physicalSize: spec.physicalSize,
        sizeLevel: spec.sizeLevel, azDeg: +spec.azDeg.toFixed(1), elDeg: +spec.elDeg.toFixed(1),
        eccentricityDeg: +ecc.toFixed(1), startRadius: +spec.startRadius.toFixed(2),
        variant: 'B', platform: this.ctx.platform, practice: this.practice,
      },
      response: signedErrorMs === null ? null : {
        signedErrorMs: +signedErrorMs.toFixed(1), absErrorMs: +Math.abs(signedErrorMs).toFixed(1),
      },
      correct: signedErrorMs !== null && Math.abs(signedErrorMs) <= 100,
      outcome,
      reactionTimeMs: signedErrorMs === null ? null : +Math.abs(signedErrorMs).toFixed(1),
      startedAt: 0, endedAt: 0,
    };
    this.ctx.recorder.trial(rec);
    if (!this.practice) {
      this.trials.push(rec);
      if (signedErrorMs !== null) {
        this.results.push({
          block: this.currentBlock, signedErrorMs, travelMs: spec.travelMs,
          occlusionMs, physicalSize: spec.physicalSize, sizeLevel: spec.sizeLevel,
          eccentricityDeg: ecc,
        });
      }
    }
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.tumbler.update(dt);
    const live = this.live;
    if (!live || live.responded) return;
    const elapsed = ctx.engine.clock.frameTime - live.launchT;

    if (!live.occluded && elapsed >= live.occludeAtMs) {
      live.occluded = true;
      this.ball.visible = false;
      ctx.recorder.event('ball_occluded', {
        remainingMs: Math.round(live.arrivalT - ctx.engine.clock.frameTime),
      });
      return;
    }
    if (live.occluded) return;

    const t = clamp(elapsed / live.spec.travelMs, 0, 1);
    // Linear in distance, so the angular size grows the way a real approach
    // does - non-linearly, faster near the end. That growth curve IS the tau
    // signal, and flattening it would remove the thing being measured.
    this.ball.position.lerpVectors(live.from, live.to, t);
    this.ball.visible = true;
  }

  /* --------------------------------------------------------------- UI */

  private showFeedback(text: string, early: boolean): void {
    this.feedbackText = text;
    this.feedbackEarly = early;
    this.feedbackPanel.group.visible = true;
    this.feedbackPanel.invalidate();
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 14, withAlpha('#000000', 0.55));
    const bad = this.feedbackText.includes('KORAI');
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 34, color: bad ? t.bad : this.feedbackEarly ? t.accent2 : t.warn,
      align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const errs = this.results.map((r) => r.signedErrorMs);
    const byBlock = (b: BlockId) => this.results.filter((r) => r.block === b).map((r) => r.signedErrorMs);

    const CE = errs.length ? mean(errs) : NaN;
    const VE = errs.length > 1 ? stdev(errs) : NaN;
    const AE = errs.length ? mean(errs.map(Math.abs)) : NaN;

    const veOf = (b: BlockId) => { const e = byBlock(b); return e.length > 1 ? stdev(e) : NaN; };
    const ceOf = (b: BlockId) => { const e = byBlock(b); return e.length ? mean(e) : NaN; };

    /* --- occlusion robustness ---------------------------------------- */
    const occGroups = [
      { occ: 0, ve: veOf('approach') },
      ...[0.35, 0.62].map((f) => {
        const sub = this.results.filter((r) => r.block === 'occluded' && Math.abs(r.occlusionMs / r.travelMs - f) < 0.05);
        return { occ: mean(sub.map((r) => r.occlusionMs)), ve: sub.length > 1 ? stdev(sub.map((r) => r.signedErrorMs)) : NaN };
      }),
    ].filter((g) => Number.isFinite(g.occ) && Number.isFinite(g.ve));
    const occlusionRobustness = occGroups.length >= 2
      ? slope(occGroups.map((g) => g.occ), occGroups.map((g) => g.ve)) * 1000
      : NaN;

    /* --- the size-arrival effect -------------------------------------- */
    // The flagship measurement, and the one variant A structurally cannot make.
    // A tau-based observer times identically regardless of physical size; a
    // size-or-distance heuristic makes the large object seem to arrive sooner,
    // producing an increasingly early (negative) constant error with size.
    const ceAtSize = (level: SpecB['sizeLevel']) => {
      const e = this.results.filter((r) => r.block === 'size' && r.sizeLevel === level).map((r) => r.signedErrorMs);
      return e.length ? mean(e) : NaN;
    };
    const ceSmall = ceAtSize('small');
    const ceMedium = ceAtSize('medium');
    const ceLarge = ceAtSize('large');
    const sizeArrivalEffect = Number.isFinite(ceSmall) && Number.isFinite(ceLarge) ? ceSmall - ceLarge : NaN;
    const sizePoints = [
      { s: 0.10, ce: ceSmall }, { s: 0.18, ce: ceMedium }, { s: 0.30, ce: ceLarge },
    ].filter((p) => Number.isFinite(p.ce));
    const sizeSlope = sizePoints.length >= 2
      ? slope(sizePoints.map((p) => p.s), sizePoints.map((p) => p.ce))
      : NaN;
    // Tau reliance: 1 when size makes no difference, 0 when it dominates.
    const tauReliance = Number.isFinite(sizeArrivalEffect)
      ? clamp(1 - Math.abs(sizeArrivalEffect) / 250, 0, 1) : NaN;

    /* --- approach angle ------------------------------------------------ */
    const headOn = this.results.filter((r) => r.block === 'angle' && r.eccentricityDeg < 10);
    const offAxis = this.results.filter((r) => r.block === 'angle' && r.eccentricityDeg >= 10);
    const veHeadOn = headOn.length > 1 ? stdev(headOn.map((r) => r.signedErrorMs)) : NaN;
    const veOffAxis = offAxis.length > 1 ? stdev(offAxis.map((r) => r.signedErrorMs)) : NaN;
    const angleCost = Number.isFinite(veHeadOn) && Number.isFinite(veOffAxis) ? veOffAxis - veHeadOn : NaN;

    const invalid = this.trials.filter((t) => t.outcome === 'invalid').length;
    const timeouts = this.trials.filter((t) => t.outcome === 'timeout').length;
    const reactiveIndex = Number.isFinite(ceOf('approach')) ? clamp(ceOf('approach') / 250, 0, 1) : NaN;

    const M: [string, number, string, string?][] = [
      ['constant_error', CE, 'ms'],
      ['variable_error', VE, 'ms'],
      ['absolute_error', AE, 'ms'],
      ['timing_error_ms', AE, 'ms'],
      ['timing_variability', VE, 'ms'],
      ['ce_approach', ceOf('approach'), 'ms', 'approach'],
      ['ve_approach', veOf('approach'), 'ms', 'approach'],
      ['ve_occluded', veOf('occluded'), 'ms', 'occluded'],
      ['occlusion_robustness', occlusionRobustness, 'ms/1000ms'],
      ['ce_size_small', ceSmall, 'ms', 'size'],
      ['ce_size_medium', ceMedium, 'ms', 'size'],
      ['ce_size_large', ceLarge, 'ms', 'size'],
      ['size_arrival_effect', sizeArrivalEffect, 'ms'],
      ['size_arrival_slope', sizeSlope, 'ms/m'],
      ['tau_reliance', tauReliance, 'index'],
      ['ve_head_on', veHeadOn, 'ms', 'angle'],
      ['ve_off_axis', veOffAxis, 'ms', 'angle'],
      ['approach_angle_cost', angleCost, 'ms', 'angle'],
      ['early_response_rate', this.trials.length ? invalid / this.trials.length : NaN, 'ratio'],
      ['timeout_rate', this.trials.length ? timeouts / this.trials.length : NaN, 'ratio'],
      ['reactive_strategy_index', reactiveIndex, 'index'],
    ];
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* -------------------------------------------------------- scores */

    const precision = normaliseSoft(VE, 50, 210);
    const robustness = normaliseSoft(Number.isFinite(occlusionRobustness) ? occlusionRobustness : 95, 0, 95);
    const tau = Number.isFinite(tauReliance) ? tauReliance * 100 : 0;
    const accuracy = normaliseSoft(Math.abs(CE), 12, 160);
    const angleScore = normaliseSoft(Number.isFinite(angleCost) ? angleCost : 90, 0, 90);

    const ops = opsScore([
      { key: 'timing_precision', value: precision, weight: 0.32 },
      { key: 'tau_use', value: tau, weight: 0.24 },
      { key: 'occlusion_robustness_score', value: robustness, weight: 0.20 },
      { key: 'timing_accuracy', value: accuracy, weight: 0.12 },
      { key: 'approach_angle', value: angleScore, weight: 0.12 },
    ]);

    rec.score('timing_precision', precision, '1.0.0');
    rec.score('tau_use', tau, '1.0.0');
    rec.score('occlusion_robustness_score', robustness, '1.0.0');
    rec.score('timing_accuracy', accuracy, '1.0.0');
    rec.score('approach_angle', angleScore, '1.0.0');

    const ms = (v: number, signed = false) => {
      if (!Number.isFinite(v)) return '—';
      const r0 = Math.round(v);
      return signed ? `${r0 >= 0 ? '+' : '−'}${Math.abs(r0)} ms` : `${Math.abs(r0)} ms`;
    };

    const headline = [
      { label: 'Időzítési pontosság (VE)', value: ms(VE), hint: 'szórás — a fő mutató' },
      {
        label: 'Méret–érkezés hatás',
        value: ms(sizeArrivalEffect, true),
        hint: Number.isFinite(sizeArrivalEffect)
          ? (Math.abs(sizeArrivalEffect) < 60 ? 'tau-alapú becslés' : 'méret-heurisztika')
          : undefined,
      },
      { label: 'Takarás hatása', value: Number.isFinite(occlusionRobustness) ? `${Math.round(occlusionRobustness)} ms / s vak` : '—' },
      { label: 'Időzítési torzítás (CE)', value: ms(CE, true), hint: Number.isFinite(CE) ? (CE < 0 ? 'korán' : 'későn') : undefined },
      { label: 'Oldalirányú érkezés ára', value: ms(angleCost, true) },
      { label: 'Érvénytelen próba', value: `${invalid + timeouts} / ${this.trials.length}` },
    ];
    if (Number.isFinite(reactiveIndex) && reactiveIndex > 0.7) {
      headline[5] = { label: 'FIGYELEM', value: 'reagált, nem jelzett előre', hint: 'az eredmény óvatosan értelmezendő' };
    }

    return {
      opsScore: ops,
      headline,
      summary: {
        variant: 'B',
        overall: { constantErrorMs: r(CE), variableErrorMs: r(VE), absoluteErrorMs: r(AE), n: errs.length },
        approach: { ce: r(ceOf('approach')), ve: r(veOf('approach')) },
        occlusion: { ve: r(veOf('occluded')), robustness: r(occlusionRobustness, 2) },
        size: {
          small: r(ceSmall), medium: r(ceMedium), large: r(ceLarge),
          sizeArrivalEffectMs: r(sizeArrivalEffect), slopeMsPerM: r(sizeSlope, 1),
          tauReliance: r(tauReliance, 3),
          strategy: Number.isFinite(sizeArrivalEffect)
            ? (Math.abs(sizeArrivalEffect) < 60 ? 'tau' : 'size_heuristic') : null,
        },
        angle: { headOnVe: r(veHeadOn), offAxisVe: r(veOffAxis), costMs: r(angleCost) },
        validity: {
          earlyRate: r(this.trials.length ? invalid / this.trials.length : NaN, 3),
          reactiveStrategyIndex: r(reactiveIndex, 3),
          reactiveWarning: Number.isFinite(reactiveIndex) && reactiveIndex > 0.7,
        },
        platform: ctx.platform,
        trialsScored: this.trials.length,
      },
      axisScores: {
        timing: (precision + tau + robustness) / 3,
        reaction: accuracy,
        psychomotor: precision,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    const live = this.live;
    if (live && !live.responded) {
      live.responded = true;
      live.resolve({ signedErrorMs: null, outcome: 'timeout' });
    }
    this.live = null;
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.abort();
    this.tumbler.clear();
    ctx.panels.remove(this.feedbackPanel);
    this.feedbackPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
