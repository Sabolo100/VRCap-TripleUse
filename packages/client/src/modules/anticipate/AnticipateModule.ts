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

/**
 * MODULE 11 - ANTICIPATE
 * Coincidence timing and temporal anticipation.
 *
 * This is NOT a reaction-time task, and that distinction is the whole module.
 * In a reaction task the stimulus appears and you respond afterwards; the floor
 * is your own neural delay. Here the motion is visible in advance, so the
 * response can be timed to coincide with arrival - and the error can be
 * NEGATIVE. In sport that matters: at 130 km/h a tennis serve arrives in about
 * 500 ms, so waiting until you have seen it is already too late. Elite
 * performance comes from prediction, not from faster reacting.
 *
 * Three error measures are reported separately because they mean different
 * things:
 *
 *   CONSTANT ERROR (CE)  mean signed error - systematic bias, early or late.
 *                        Easy to coach away with feedback.
 *   VARIABLE ERROR (VE)  SD of signed error - precision. Hard to change, and
 *                        the single best indicator for selection.
 *   ABSOLUTE ERROR (AE)  mean |error| - a mixture of the two.
 *
 * Two athletes with the same AE can be completely different: one is always
 * 80 ms early (fixable in a week), the other averages zero but is all over the
 * place (much harder). The scoring weights VE accordingly.
 */

type BlockId = 'visible' | 'short' | 'long' | 'speed' | 'change';

interface TrialSpec {
  travelMs: number;
  occlusionFraction: number;
  direction: 'left_to_right' | 'right_to_left';
  speedLevel: 'fast' | 'medium' | 'slow' | 'standard';
  /** Multiplier applied to the remaining speed at the moment of occlusion. */
  speedFactor: number;
}

interface Result {
  block: BlockId;
  signedErrorMs: number;
  travelMs: number;
  occlusionMs: number;
  speedLevel: TrialSpec['speedLevel'];
  speedFactor: number;
}

export class AnticipateModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.ANTICIPATE!;

  readonly blocks: BlockDescriptor[] = [

    {
      id: 'visible',
      title: 'LÁTHATÓ PÁLYA',
      instruction: {
        vr:
          'Egy gömb indul el egy sínen, egy fehér cél felé. Húzd meg a ravaszt PONTOSAN abban a pillanatban, ' +
          'amikor a gömb elérné a célt. Ez nem gyorsasági feladat: nem gyorsnak kell lenned, hanem pontosnak, ' +
          'ezért nyugodtan indulhat előbb a mozdulatod.',
        desktop:
          'Egy gömb indul el egy sínen, egy fehér cél felé. Nyomd meg a SZÓKÖZT (vagy kattints) PONTOSAN ' +
          'abban a pillanatban, amikor a gömb elérné a célt. Ez nem gyorsasági feladat: nem gyorsnak kell ' +
          'lenned, hanem pontosnak, ezért nyugodtan indulhat előbb a mozdulatod.',
        mobile:
          'Egy gömb indul el egy sínen, egy fehér cél felé. Nyomd meg a képernyő alján a MOST gombot PONTOSAN ' +
          'abban a pillanatban, amikor a gömb elérné a célt. Ez nem gyorsasági feladat: nem gyorsnak kell ' +
          'lenned, hanem pontosnak.',
      },
      controlHint: '',
      trials: 16,
      practiceTrials: 5,
    },
    {
      id: 'short',
      title: 'RÖVID TAKARÁS',
      instruction:
        'Ugyanaz a feladat, de a gömb az út utolsó harmadában ELTŰNIK. Neked kell fejben továbbvinned, ' +
        'és ugyanúgy jelezned, amikor odaérne a célhoz.',
      controlHint: '',
      trials: 20,
      practiceTrials: 3,
    },
    {
      id: 'long',
      title: 'HOSSZÚ TAKARÁS',
      instruction:
        'Most a gömb már az út közepe előtt eltűnik: az út utolsó 60%-át vakon kell megbecsülnöd. ' +
        'Ez nehéz — az ingadozás természetes.',
      controlHint: '',
      trials: 20,
      practiceTrials: 3,
    },
    {
      id: 'speed',
      title: 'SEBESSÉG',
      instruction:
        'A gömb hol gyorsan, hol lassan indul. Figyeld meg a sebességét, mielőtt eltűnik, és ehhez igazítsd ' +
        'a becslést — ugyanaz az időzítés nem lesz jó minden sebességnél.',
      controlHint: '',
      trials: 24,
      practiceTrials: 3,
    },
    {
      id: 'change',
      title: 'VÁLTOZÓ SEBESSÉG',
      instruction:
        'Az utolsó rész. Itt a gömb a takarás alatt meg is változtathatja a sebességét — gyorsulhat vagy ' +
        'lassulhat, és ezt nem látod. Időzíts úgy, ahogy a legjobbnak érzed.',
      controlHint: '',
      trials: 16,
      practiceTrials: 3,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private ball!: THREE.Mesh;
  private rail!: THREE.Mesh;
  private targetPlane!: THREE.Mesh;
  private targetRing!: THREE.Mesh;
  private feedbackPanel!: Panel;

  private trackHalf = 2.2;
  private trackY = 1.6;
  private trackZ = -3.0;

  private currentBlock: BlockId = 'visible';
  private practice = false;
  private trials: TrialRecord[] = [];
  private results: Result[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;
  private feedbackText = '';
  private feedbackEarly = false;

  /** Live trial state, read by the frame loop and the input handler. */
  private live: {
    spec: TrialSpec;
    launchT: number;
    arrivalT: number;
    startX: number;
    endX: number;
    occludeAtMs: number;
    occluded: boolean;
    responded: boolean;
    resolve: (r: { signedErrorMs: number | null; outcome: 'ok' | 'early' | 'timeout'; fraction: number }) => void;
  } | null = null;

  private headLeadSamples: number[] = [];
  private sampleTimer = 0;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    // Angular extent has to fit the viewport, but the travel TIMES stay the
    // same on every platform - the error is measured in milliseconds, so the
    // physical track length does not enter the score.
    const extentDeg = ctx.platform === 'vr' ? 40 : ctx.platform === 'desktop' ? 23 : 18;
    this.trackHalf = Math.tan((extentDeg * Math.PI) / 180) * Math.abs(this.trackZ);

    this.rail = makePrimitive({
      kind: 'box', color: 0x2b3646, unlit: true, size: [this.trackHalf * 2, 0.012, 0.03],
    });
    this.rail.position.set(0, this.trackY - 0.13, this.trackZ);
    this.root.add(this.rail);

    this.targetPlane = makePrimitive({
      kind: 'plane', color: 0xe8eef5, unlit: true, opacity: 0.85, doubleSided: true, size: [0.10, 0.55, 1],
    });
    this.targetPlane.position.set(0, this.trackY, this.trackZ);
    this.root.add(this.targetPlane);

    this.targetRing = makePrimitive({
      kind: 'ring', color: ctx.theme.accent, unlit: true, doubleSided: true, size: 0.44, opacity: 0.7,
    });
    this.targetRing.position.set(0, this.trackY, this.trackZ + 0.01);
    this.root.add(this.targetRing);

    const ballScale = ctx.platform === 'mobile' ? 0.21 : 0.16;
    this.ball = makePrimitive({ kind: 'sphere', color: ctx.theme.accent, unlit: true, size: ballScale });
    this.ball.position.set(-this.trackHalf, this.trackY, this.trackZ);
    this.ball.visible = false;
    this.root.add(this.ball);

    const flat = ctx.platform !== 'vr';
    this.feedbackPanel = new Panel({
      width: 0.85, height: 0.2, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'anticipate-feedback',
    });
    this.feedbackPanel.group.position.set(0, this.trackY - 0.55, flat ? -2.0 : -2.6);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint();

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
  }

  /**
   * Touch controls.
   *
   * A timing task wants the response target in the same place every trial: an
   * unconstrained tap adds the time spent choosing where to put the finger to
   * every measurement, and that variance lands directly in the variable error
   * this module reports.
   */
  private setupTouchControls(): void {
    this.ctx.mobileControls?.set({
      hint: 'MOST — pontosan akkor, amikor a gömb elérné a fehér célt.',
      buttons: [{
        id: 'now', label: 'MOST', variant: 'primary', wide: true, action: 'PRIMARY',
      }],
    });
  }


  private controlHint(): string {
    const base = ' Nem gyorsnak kell lenned — pontosnak.';
    switch (this.ctx.platform) {
      case 'vr': return 'RAVASZ pontosan akkor, amikor a gömb elérné a fehér célt.' + base;
      case 'mobile': return 'MOST gomb pontosan akkor, amikor a gömb elérné a fehér célt.' + base;
      default: return 'SZÓKÖZ vagy kattintás pontosan akkor, amikor a gömb elérné a fehér célt.' + base;
    }
  }

  /* -------------------------------------------------- trial generation */

  private buildSpecs(block: BlockId, count: number, rng: Rng): TrialSpec[] {
    const dir = (): TrialSpec['direction'] => (rng.bool() ? 'left_to_right' : 'right_to_left');
    const specs: TrialSpec[] = [];

    switch (block) {
      case 'visible':
        for (let i = 0; i < count; i++) {
          specs.push({ travelMs: rng.range(1400, 2000), occlusionFraction: 0, direction: dir(), speedLevel: 'standard', speedFactor: 1 });
        }
        return specs;

      case 'short':
      case 'long': {
        const occ = block === 'short' ? 0.30 : 0.60;
        for (let i = 0; i < count; i++) {
          specs.push({ travelMs: rng.range(1400, 2000), occlusionFraction: occ, direction: dir(), speedLevel: 'standard', speedFactor: 1 });
        }
        return specs;
      }

      case 'speed': {
        // Exactly equal numbers at each speed, so the per-level constant error
        // is estimated from the same amount of data at each level.
        const levels: [TrialSpec['speedLevel'], number][] = [['fast', 1100], ['medium', 1600], ['slow', 2200]];
        const per = Math.floor(count / 3);
        for (const [level, travel] of levels) {
          for (let i = 0; i < per; i++) {
            specs.push({ travelMs: travel, occlusionFraction: 0.55, direction: dir(), speedLevel: level, speedFactor: 1 });
          }
        }
        while (specs.length < count) {
          specs.push({ travelMs: 1600, occlusionFraction: 0.55, direction: dir(), speedLevel: 'medium', speedFactor: 1 });
        }
        return rng.shuffle(specs);
      }

      case 'change': {
        // The visible portion is identical for both factors, so nothing before
        // the occlusion can give the change away.
        const per = Math.floor(count / 2);
        for (let i = 0; i < per; i++) {
          specs.push({ travelMs: 1600, occlusionFraction: 0.55, direction: dir(), speedLevel: 'medium', speedFactor: 1.35 });
        }
        for (let i = 0; i < count - per; i++) {
          specs.push({ travelMs: 1600, occlusionFraction: 0.55, direction: dir(), speedLevel: 'medium', speedFactor: 0.70 });
        }
        return rng.shuffle(specs);
      }
    }
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.setupTouchControls();
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    const queue = this.buildSpecs(this.currentBlock, count, ctx.rng);
    let index = 0;
    let repeats = 0;

    while (index < queue.length && !this.aborted) {
      const spec = queue[index]!;
      ctx.recorder.trialNumber = index + 1;
      const outcome = await this.runTrial(spec, index);

      // A response before a quarter of the travel is not a timing judgement,
      // it is a discharge. Re-queue it rather than letting it pollute the
      // error distribution - but cap the repeats so a participant who keeps
      // firing early cannot extend the block indefinitely.
      if (outcome.outcome === 'early' && repeats < 3) {
        repeats++;
        queue.push(spec);
      }
      index++;
      await this.wait(500);
    }
    this.ball.visible = false;
    this.feedbackPanel.group.visible = false;
  }

  private runTrial(spec: TrialSpec, index: number): Promise<{ signedErrorMs: number | null; outcome: 'ok' | 'early' | 'timeout'; fraction: number }> {
    const ctx = this.ctx;
    const sign = spec.direction === 'left_to_right' ? 1 : -1;
    const startX = -this.trackHalf * sign;
    const endX = 0;

    ctx.recorder.event('trial_setup', {
      travelMs: Math.round(spec.travelMs), occlusionFraction: spec.occlusionFraction,
      direction: spec.direction, speedLevel: spec.speedLevel, speedFactor: spec.speedFactor,
    });

    return new Promise((resolve) => {
      void this.launch(spec, startX, endX, index, resolve);
    });
  }

  private async launch(
    spec: TrialSpec,
    startX: number,
    endX: number,
    index: number,
    resolve: (r: { signedErrorMs: number | null; outcome: 'ok' | 'early' | 'timeout'; fraction: number }) => void
  ): Promise<void> {
    const ctx = this.ctx;
    this.ball.position.set(startX, this.trackY, this.trackZ);
    this.ball.visible = false;
    this.feedbackPanel.group.visible = false;
    this.headLeadSamples = [];

    await this.wait(ctx.rng.range(900, 1600));
    if (this.aborted) { resolve({ signedErrorMs: null, outcome: 'timeout', fraction: 0 }); return; }

    const launchT = ctx.engine.clock.frameTime;
    const occludeAtMs = spec.occlusionFraction > 0 ? spec.travelMs * (1 - spec.occlusionFraction) : Infinity;

    // Arrival time is computed from the launch timestamp and the travel time,
    // never read back from the rendered position. The rendered ball is a
    // depiction of the schedule; the schedule is the measurement.
    let arrivalT = launchT + spec.travelMs;
    if (spec.speedFactor !== 1 && Number.isFinite(occludeAtMs)) {
      const remaining = spec.travelMs - occludeAtMs;
      arrivalT = launchT + occludeAtMs + remaining / spec.speedFactor;
    }

    this.ball.visible = true;
    this.live = {
      spec, launchT, arrivalT, startX, endX, occludeAtMs,
      occluded: false, responded: false, resolve,
    };

    ctx.audio.tone({ freq: 900, durationMs: 40, gain: 0.16 });
    ctx.recorder.event('ball_launched', {
      travelMs: Math.round(spec.travelMs), startX: +startX.toFixed(2), targetX: endX,
      occlusionFraction: spec.occlusionFraction,
      quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
    }, launchT);

    // Watchdog: close the trial 1200 ms after the theoretical arrival.
    const timeoutMs = (arrivalT - launchT) + 1200;
    setTimeout(() => {
      const live = this.live;
      if (!live || live.responded) return;
      live.responded = true;
      this.ball.visible = false;
      this.live = null;
      ctx.recorder.event('timeout', { overshootMs: 1200 });
      this.commit(spec, null, 'timeout', 1, index);
      resolve({ signedErrorMs: null, outcome: 'timeout', fraction: 1 });
    }, timeoutMs + 60);
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
      this.ball.visible = false;
      this.live = null;
      this.ctx.recorder.event('early_reject', { fractionTravelled: +fraction.toFixed(3) });
      this.ctx.audio.error();
      if (this.practice) {
        this.feedbackText = 'TÚL KORAI — várd meg a mozgást';
        this.feedbackEarly = true;
        this.feedbackPanel.group.visible = true;
        this.feedbackPanel.invalidate();
      }
      this.commit(live.spec, null, 'invalid', fraction, 0);
      live.resolve({ signedErrorMs: null, outcome: 'early', fraction });
      return;
    }

    live.responded = true;
    const signedError = e.t - live.arrivalT;
    this.ball.visible = false;
    const phase = elapsed < live.occludeAtMs ? 'before_occlusion'
      : e.t < live.arrivalT ? 'during_occlusion' : 'after_arrival';

    this.ctx.recorder.event('timing_response', {
      responseT: +e.t.toFixed(1), arrivalT: +live.arrivalT.toFixed(1),
      signedErrorMs: +signedError.toFixed(1), absErrorMs: +Math.abs(signedError).toFixed(1),
      phase, fractionAtResponse: +fraction.toFixed(3),
    }, e.t);

    this.ctx.engine.input.pulse(e.hand === 'none' ? 'both' : e.hand, 0.3, 24);

    if (this.practice) {
      const early = signedError < 0;
      this.feedbackText = `${signedError >= 0 ? '+' : '−'}${Math.abs(Math.round(signedError))} ms · ${early ? 'KORÁN' : 'KÉSŐN'}`;
      this.feedbackEarly = early;
      this.feedbackPanel.group.visible = true;
      this.feedbackPanel.invalidate();
      // Signed feedback in practice only: without knowing the direction of the
      // error the participant cannot calibrate, and half the first measured
      // block would be spent tuning in.
      this.ctx.audio.tone({ freq: early ? 1200 : 400, durationMs: 90, gain: 0.2 });
    }

    this.commit(live.spec, signedError, Math.abs(signedError) <= 100 ? 'hit' : 'miss', fraction, 0, phase);
    const resolve = live.resolve;
    this.live = null;
    resolve({ signedErrorMs: signedError, outcome: 'ok', fraction });
  }

  private commit(
    spec: TrialSpec,
    signedErrorMs: number | null,
    outcome: TrialRecord['outcome'],
    fraction: number,
    _index: number,
    phase = 'none'
  ): void {
    const occlusionMs = spec.occlusionFraction > 0 ? spec.travelMs * spec.occlusionFraction : 0;
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block: this.currentBlock,
      stimulus: {
        kind: 'anticipate',
        block: this.currentBlock,
        travelMs: Math.round(spec.travelMs),
        occlusionFraction: spec.occlusionFraction,
        occlusionMs: Math.round(occlusionMs),
        direction: spec.direction,
        speedLevel: spec.speedLevel,
        speedFactor: spec.speedFactor,
        trackExtentDeg: +((Math.atan(this.trackHalf / Math.abs(this.trackZ)) * 180) / Math.PI).toFixed(1),
        platform: this.ctx.platform,
        practice: this.practice,
      },
      response: signedErrorMs === null ? null : {
        signedErrorMs: +signedErrorMs.toFixed(1),
        absErrorMs: +Math.abs(signedErrorMs).toFixed(1),
        responsePhase: phase,
        fractionAtResponse: +fraction.toFixed(3),
      },
      correct: signedErrorMs === null ? false : Math.abs(signedErrorMs) <= 100,
      outcome,
      reactionTimeMs: signedErrorMs === null ? null : +Math.abs(signedErrorMs).toFixed(1),
      startedAt: 0,
      endedAt: 0,
    };
    this.ctx.recorder.trial(rec);
    if (!this.practice) {
      this.trials.push(rec);
      if (signedErrorMs !== null) {
        this.results.push({
          block: this.currentBlock,
          signedErrorMs,
          travelMs: spec.travelMs,
          occlusionMs,
          speedLevel: spec.speedLevel,
          speedFactor: spec.speedFactor,
        });
      }
    }
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    const live = this.live;
    if (live && !live.responded) {
      const elapsed = ctx.engine.clock.frameTime - live.launchT;

      if (!live.occluded && elapsed >= live.occludeAtMs) {
        live.occluded = true;
        this.ball.visible = false;
        ctx.recorder.event('ball_occluded', {
          fractionTravelled: +(live.occludeAtMs / live.spec.travelMs).toFixed(3),
          remainingMs: Math.round(live.arrivalT - ctx.engine.clock.frameTime),
        });
        if (live.spec.speedFactor !== 1) {
          ctx.recorder.event('speed_changed', {
            factor: live.spec.speedFactor,
            newTravelRemainMs: Math.round(live.arrivalT - ctx.engine.clock.frameTime),
          });
        }
      }

      if (!live.occluded) {
        const t = clamp(elapsed / live.spec.travelMs, 0, 1);
        this.ball.position.x = live.startX + (live.endX - live.startX) * t;
        this.ball.visible = true;

        // Head lead: is the participant tracking the ball, or already looking
        // at the target? This is a coarse proxy from head direction, not gaze -
        // the headset has no eye tracking, and the metric name says so.
        this.sampleTimer += dt;
        if (this.sampleTimer >= 0.05) {
          this.sampleTimer = 0;
          const q = new THREE.Quaternion();
          ctx.engine.camera.getWorldQuaternion(q);
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
          const headX = (fwd.x / Math.max(0.05, -fwd.z)) * Math.abs(this.trackZ);
          const ballX = this.ball.position.x;
          const span = Math.abs(live.startX - live.endX) || 1;
          this.headLeadSamples.push(clamp((ballX - headX) * Math.sign(live.endX - live.startX) / span, -1, 1));
        }
      }
    }

    // The target ring breathes gently so the arrival point stays salient
    // without flashing at the moment of arrival, which would be a cue.
    const pulse = 0.55 + Math.sin(ctx.engine.clock.frameTime / 620) * 0.15;
    (this.targetRing.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  /* --------------------------------------------------------------- UI */

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 14, withAlpha('#000000', 0.55));
    const bad = this.feedbackText.includes('KORAI');
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 38,
      color: bad ? t.bad : this.feedbackEarly ? t.accent2 : t.warn,
      align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const errs = this.results.map((r) => r.signedErrorMs);
    const byBlock = (b: BlockId) => this.results.filter((r) => r.block === b).map((r) => r.signedErrorMs);

    // The three classical measures. VE is the SD of the SIGNED errors, not of
    // the absolute ones: a participant who is consistently 100 ms late has a
    // large AE but near-zero VE, and those are different people.
    const CE = errs.length ? mean(errs) : NaN;
    const VE = errs.length > 1 ? stdev(errs) : NaN;
    const AE = errs.length ? mean(errs.map(Math.abs)) : NaN;

    const ceOf = (b: BlockId) => { const e = byBlock(b); return e.length ? mean(e) : NaN; };
    const veOf = (b: BlockId) => { const e = byBlock(b); return e.length > 1 ? stdev(e) : NaN; };

    const ceVisible = ceOf('visible');
    const ceShort = ceOf('short');
    const ceLong = ceOf('long');
    const veVisible = veOf('visible');
    const veShort = veOf('short');
    const veLong = veOf('long');

    // How fast does precision decay as the blind interval grows?
    const occPoints = (['visible', 'short', 'long'] as BlockId[])
      .map((b) => {
        const rs = this.results.filter((r) => r.block === b);
        return { occ: rs.length ? mean(rs.map((r) => r.occlusionMs)) : NaN, ve: veOf(b) };
      })
      .filter((p) => Number.isFinite(p.occ) && Number.isFinite(p.ve));
    const occlusionRobustness = occPoints.length >= 2
      ? slope(occPoints.map((p) => p.occ), occPoints.map((p) => p.ve)) * 1000
      : NaN;
    const occlusionBiasShift = Number.isFinite(ceLong) && Number.isFinite(ceVisible) ? ceLong - ceVisible : NaN;

    /* --- velocity scaling ------------------------------------------ */
    const ceAtSpeed = (level: TrialSpec['speedLevel']) => {
      const e = this.results.filter((r) => r.block === 'speed' && r.speedLevel === level).map((r) => r.signedErrorMs);
      return e.length ? mean(e) : NaN;
    };
    const ceFast = ceAtSpeed('fast');
    const ceMedium = ceAtSpeed('medium');
    const ceSlow = ceAtSpeed('slow');
    const speedCes = [ceFast, ceMedium, ceSlow].filter(Number.isFinite);
    // If the participant scales to speed, the bias is the same at every level.
    // If they use one learned interval, the biases fan out.
    const velocityScalingError = speedCes.length >= 2 ? stdev(speedCes) : NaN;

    /* --- constant-velocity assumption ------------------------------ */
    const accelCe = (() => {
      const e = this.results.filter((r) => r.block === 'change' && r.speedFactor > 1).map((r) => r.signedErrorMs);
      return e.length ? mean(e) : NaN;
    })();
    const decelCe = (() => {
      const e = this.results.filter((r) => r.block === 'change' && r.speedFactor < 1).map((r) => r.signedErrorMs);
      return e.length ? mean(e) : NaN;
    })();
    // Blindly extrapolating a constant speed makes you late when the ball
    // speeds up and early when it slows down, so the difference is positive.
    const cvAssumption = Number.isFinite(accelCe) && Number.isFinite(decelCe) ? accelCe - decelCe : NaN;

    /* --- validity checks -------------------------------------------- */
    const invalid = this.trials.filter((t) => t.outcome === 'invalid').length;
    const timeouts = this.trials.filter((t) => t.outcome === 'timeout').length;
    const totalTrials = this.trials.length;
    const earlyRate = totalTrials ? invalid / totalTrials : NaN;
    const timeoutRate = totalTrials ? timeouts / totalTrials : NaN;
    // Someone who reacts instead of anticipating is systematically late even
    // when the whole path is visible. That invalidates every other number here,
    // so it is surfaced rather than buried.
    const reactiveIndex = Number.isFinite(ceVisible) ? clamp(ceVisible / 250, 0, 1) : NaN;
    const headLead = this.headLeadSamples.length ? mean(this.headLeadSamples) : NaN;

    const M: [string, number, string, string?][] = [
      ['constant_error', CE, 'ms'],
      ['variable_error', VE, 'ms'],
      ['absolute_error', AE, 'ms'],
      ['timing_error_ms', AE, 'ms'],
      ['timing_variability', VE, 'ms'],
      ['ce_visible', ceVisible, 'ms', 'visible'],
      ['ve_visible', veVisible, 'ms', 'visible'],
      ['ce_short', ceShort, 'ms', 'short'],
      ['ve_short', veShort, 'ms', 'short'],
      ['ce_long', ceLong, 'ms', 'long'],
      ['ve_long', veLong, 'ms', 'long'],
      ['occlusion_robustness', occlusionRobustness, 'ms/1000ms'],
      ['occlusion_bias_shift', occlusionBiasShift, 'ms'],
      ['ce_fast', ceFast, 'ms', 'speed'],
      ['ce_medium', ceMedium, 'ms', 'speed'],
      ['ce_slow', ceSlow, 'ms', 'speed'],
      ['velocity_scaling_error', velocityScalingError, 'ms', 'speed'],
      ['constant_velocity_assumption', cvAssumption, 'ms', 'change'],
      ['early_response_rate', earlyRate, 'ratio'],
      ['timeout_rate', timeoutRate, 'ratio'],
      ['reactive_strategy_index', reactiveIndex, 'index'],
      ['head_lead_index', headLead, 'ratio'],
    ];
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    // Provisional anchors. Good coincidence-anticipation performance sits
    // around 40-70 ms of variable error; 200 ms is essentially guessing at
    // these travel times.
    const precision = normaliseSoft(VE, 45, 200);
    const accuracy = normaliseSoft(Math.abs(CE), 10, 150);
    const robustness = normaliseSoft(Number.isFinite(occlusionRobustness) ? occlusionRobustness : 90, 0, 90);
    const scaling = normaliseSoft(velocityScalingError, 15, 120);
    const adaptive = normaliseSoft(Math.abs(Number.isFinite(cvAssumption) ? cvAssumption : 250), 0, 250);

    const ops = opsScore([
      { key: 'timing_precision', value: precision, weight: 0.34 },
      { key: 'occlusion_robustness_score', value: robustness, weight: 0.22 },
      { key: 'velocity_scaling', value: scaling, weight: 0.18 },
      { key: 'timing_accuracy', value: accuracy, weight: 0.14 },
      { key: 'adaptive_prediction', value: adaptive, weight: 0.12 },
    ]);

    rec.score('timing_precision', precision, '1.0.0');
    rec.score('timing_accuracy', accuracy, '1.0.0');
    rec.score('occlusion_robustness_score', robustness, '1.0.0');
    rec.score('velocity_scaling', scaling, '1.0.0');
    rec.score('adaptive_prediction', adaptive, '1.0.0');

    const ms = (v: number, signed = false) => {
      if (!Number.isFinite(v)) return '—';
      const r0 = Math.round(v);
      return signed ? `${r0 >= 0 ? '+' : '−'}${Math.abs(r0)} ms` : `${Math.abs(r0)} ms`;
    };

    const headline = [
      { label: 'Időzítési pontosság (VE)', value: ms(VE), hint: 'szórás — a fő mutató' },
      { label: 'Időzítési torzítás (CE)', value: ms(CE, true), hint: Number.isFinite(CE) ? (CE < 0 ? 'korán' : 'későn') : undefined },
      { label: 'Takarás hatása', value: ms(Number.isFinite(veLong) && Number.isFinite(veVisible) ? veLong - veVisible : NaN, true), hint: 'szórásnövekedés' },
      { label: 'Sebesség-skálázás', value: ms(velocityScalingError), hint: 'kisebb = jobb' },
      { label: 'Sebességváltás kezelése', value: ms(cvAssumption, true) },
      { label: 'Érvénytelen próba', value: `${invalid + timeouts} / ${totalTrials}` },
    ];

    if (Number.isFinite(reactiveIndex) && reactiveIndex > 0.7) {
      headline[5] = {
        label: 'FIGYELEM',
        value: 'reagált, nem jelzett előre',
        hint: 'az eredmény óvatosan értelmezendő',
      };
    }

    return {
      opsScore: ops,
      headline,
      summary: {
        overall: { constantErrorMs: r(CE), variableErrorMs: r(VE), absoluteErrorMs: r(AE), n: errs.length },
        byBlock: {
          visible: { ce: r(ceVisible), ve: r(veVisible) },
          short: { ce: r(ceShort), ve: r(veShort) },
          long: { ce: r(ceLong), ve: r(veLong) },
        },
        occlusion: { robustness: r(occlusionRobustness, 2), biasShift: r(occlusionBiasShift) },
        speed: { fast: r(ceFast), medium: r(ceMedium), slow: r(ceSlow), scalingError: r(velocityScalingError) },
        speedChange: { accelerated: r(accelCe), decelerated: r(decelCe), constantVelocityAssumption: r(cvAssumption) },
        validity: {
          earlyRate: r(earlyRate, 3), timeoutRate: r(timeoutRate, 3),
          reactiveStrategyIndex: r(reactiveIndex, 3),
          reactiveWarning: Number.isFinite(reactiveIndex) && reactiveIndex > 0.7,
          headLeadIndex: r(headLead, 3),
        },
        platform: ctx.platform,
        trialsScored: totalTrials,
      },
      axisScores: {
        timing: (precision + robustness + scaling) / 3,
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
      live.resolve({ signedErrorMs: null, outcome: 'timeout', fraction: 0 });
    }
    this.live = null;
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.abort();
    ctx.panels.remove(this.feedbackPanel);
    this.feedbackPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
