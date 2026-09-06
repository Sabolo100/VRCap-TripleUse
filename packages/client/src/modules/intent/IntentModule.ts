import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, median, clamp, normaliseSoft, opsScore, crossingPoint,
  type ModuleManifest, type TrialRecord, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { BodyAnchor } from '../shared/anchor.js';
import { JOINTS, pose, depthOffsetM, type JointName } from './figure.js';

/**
 * MODULE 19 - INTENT
 * Reading intent from movement kinematics.
 *
 * This is not a reaction-time module. The elite athlete is not faster to
 * respond - they KNOW sooner. So the headline number is a moment in time: the
 * earliest occlusion point at which the participant is still reliably above
 * chance.
 *
 * The figure is thirteen dots and nothing else, and its movement is generated
 * from parameters rather than recorded. That is deliberate: a deceptive trial
 * differs from a genuine one in exactly one sign - which way the preparation
 * leans - so when someone is fooled we know precisely what fooled them.
 *
 * Two things a flat screen cannot do, and both are scored in VR:
 *
 *   DEPTH INTENT   the figure steps towards or away from the viewer with its
 *                  angular size held constant, so the two cases render as the
 *                  same image and only disparity separates them.
 *   PERIPHERAL     the same movement 55 degrees off axis, which does not
 *                  exist inside a 75 degree viewport.
 */

type BlockId = 'frontal' | 'depth' | 'peripheral';
type Viewpoint = 'front' | 'side';

const FIGURE_HEIGHT = 1.70;
const FIGURE_DISTANCE = 3.20;
const MOVEMENT_MS = 1400;
const OCCLUSIONS = [0.40, 0.55, 0.70, 0.85];
const DEPTH_OCCLUSIONS = [0.55, 0.85];
const DECEPTION_RATIO = 0.25;
const SIDE_VIEW_YAW_DEG = 55;
const PERIPHERAL_AZ_DEG = 55;
const JOINT_ANGULAR_DEG = 0.573;
const DEPTH_RANGE_M = 1.0;
const ITI_MS = 600;
const RELIABLE_LEVEL = 0.70;
const FRONTAL_PER_CELL = 6;
const DEPTH_TRIALS = 16;
const PERIPHERAL_TRIALS = 16;
const PRACTICE_TRIALS = 6;

interface Trial {
  block: BlockId;
  occlusion: number;
  dirFinal: number;
  dirEarly: number;
  deceptive: boolean;
  viewpoint: Viewpoint;
  azDeg: number;
}

interface Answer extends Trial {
  answer: number;
  correct: boolean;
  rtMs: number;
  confidence: number;
  confidenceRtMs: number;
}

export class IntentModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.INTENT!;

  blocks: BlockDescriptor[] = [
    {
      id: 'frontal',
      title: 'MERRE INDUL',
      instruction:
        'Az alak elindul bal vagy jobb felé, és menet közben eltűnik — néha korábban, néha később. ' +
        'Válaszolj nyugodtan, nincs időlimit. Figyelem: néha becsapnak, mert az alak elindul egy ' +
        'irányba, aztán mégis a másikba megy. Ez a feladat része.',
      controlHint: '',
      trials: OCCLUSIONS.length * 2 * FRONTAL_PER_CELL,
      practiceTrials: PRACTICE_TRIALS,
      unitLabel: 'próba',
    },
    {
      id: 'depth',
      title: 'FELÉM VAGY EL',
      instruction:
        'Most nem oldalra indul, hanem feléd vagy tőled el. Akkorának látszik végig, amekkora — ' +
        'a távolságát nem a mérete árulja el.',
      controlHint: '',
      trials: DEPTH_TRIALS,
      practiceTrials: 4,
      unitLabel: 'próba',
    },
    {
      id: 'peripheral',
      title: 'OLDALRÓL',
      instruction:
        'Ugyanaz a feladat, de az alak jóval oldalt jelenik meg. Fordulj felé, ha kell — ' +
        'a mozdulat akkor is elindul.',
      controlHint: '',
      trials: PERIPHERAL_TRIALS,
      practiceTrials: 4,
      unitLabel: 'próba',
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private anchor!: BodyAnchor;
  private group!: THREE.Group;
  private dots = new Map<JointName, THREE.Mesh>();
  private ground!: THREE.Mesh;
  private confidencePanel!: Panel;
  private promptPanel!: Panel;

  private currentBlock: BlockId = 'frontal';
  private practice = false;
  private aborted = false;
  private answers: Answer[] = [];
  private trialNumber = 0;
  private promptText = '';

  private live: {
    trial: Trial;
    startT: number;
    occludedAt: number;
    occluded: boolean;
    answered: boolean;
    answer: number;
    answerT: number;
    resolve: () => void;
  } | null = null;
  private awaitingConfidence: ((level: number, t: number) => void) | null = null;

  private offAction: (() => void) | null = null;
  private offClick: (() => void) | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    ctx.recorder.setMotionHz(5);
    this.anchor = new BodyAnchor(ctx);
    this.anchor.capture();

    if (ctx.platform !== 'vr') {
      this.blocks = this.blocks.filter((b) => b.id === 'frontal');
    }

    this.group = new THREE.Group();
    ctx.root.add(this.group);
    const dotSize = 2 * FIGURE_DISTANCE * Math.tan((JOINT_ANGULAR_DEG * Math.PI) / 360);
    for (const j of JOINTS) {
      const m = makePrimitive({ kind: 'sphere', color: ctx.theme.text, unlit: true, size: dotSize });
      m.visible = false;
      this.group.add(m);
      this.dots.set(j, m);
    }
    this.ground = makePrimitive({
      kind: 'torus', color: ctx.theme.textMuted, unlit: true, size: 0.9, opacity: 0.2,
    });
    this.ground.rotation.x = Math.PI / 2;
    this.ground.visible = false;
    this.group.add(this.ground);

    this.confidencePanel = new Panel({
      width: 0.9, height: 0.28, pxPerMeter: 620, theme: ctx.theme,
      frame: true, name: 'intent-confidence', superSample: 2,
    });
    this.confidencePanel.setDraw((ui) => this.drawConfidence(ui));
    this.confidencePanel.group.visible = false;
    ctx.root.add(this.confidencePanel.group);
    ctx.panels.add(this.confidencePanel);

    this.promptPanel = new Panel({
      width: 0.9, height: 0.15, pxPerMeter: 660, theme: ctx.theme,
      frame: false, name: 'intent-prompt', superSample: 2,
    });
    this.promptPanel.setDraw((ui) => this.drawPrompt(ui));
    this.promptPanel.group.visible = false;
    ctx.root.add(this.promptPanel.group);
    ctx.panels.add(this.promptPanel);

    this.place();
    this.offAction = ctx.engine.input.on((e: ActionEvent) => this.onAction(e));
    this.offClick = ctx.panels.onClick((e) => {
      if (e.panel !== this.confidencePanel) return;
      const lvl = Number(e.widget.id.replace('conf', ''));
      if (lvl >= 1 && lvl <= 3) this.answerConfidence(lvl, e.t);
    });
    for (const b of this.blocks) b.controlHint = this.controlHint();

    ctx.recorder.event('intent_setup', {
      platform: ctx.platform,
      blocks: this.blocks.map((b) => b.id),
      joints: JOINTS.length,
      figureHeightM: FIGURE_HEIGHT,
      figureDistanceM: FIGURE_DISTANCE,
      angularHeightDeg: +((2 * Math.atan(FIGURE_HEIGHT / 2 / FIGURE_DISTANCE) * 180) / Math.PI).toFixed(1),
      jointAngularDeg: JOINT_ANGULAR_DEG,
      movementMs: MOVEMENT_MS,
      occlusionFractions: OCCLUSIONS,
      deceptionRatio: DECEPTION_RATIO,
      sideViewYawDeg: SIDE_VIEW_YAW_DEG,
      peripheralAzDeg: PERIPHERAL_AZ_DEG,
      depthRangeM: DEPTH_RANGE_M,
      reliableLevel: RELIABLE_LEVEL,
      quantisationMs: +(ctx.engine.clock.frameInterval || 11.1).toFixed(1),
    });
  }

  private place(): void {
    const p = new THREE.Vector3();
    this.anchor.offset(0, -this.anchor.eyeHeight + 0.02, FIGURE_DISTANCE, p);
    this.group.position.copy(p);
    this.group.rotation.y = this.anchor.yaw;
    this.anchor.offset(0, -0.34, 1.5, p);
    this.confidencePanel.group.position.copy(p);
    this.confidencePanel.group.lookAt(this.anchor.origin);
    this.anchor.offset(0, 0.30, 1.7, p);
    this.promptPanel.group.position.copy(p);
    this.promptPanel.group.lookAt(this.anchor.origin);
  }

  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'BAL / JOBB RAVASZ: az irány · utána a magabiztosság';
      case 'desktop': return 'F vagy ← : bal · J vagy → : jobb';
      default: return 'BAL / JOBB gomb, utána a magabiztosság';
    }
  }

  async calibrate(ctx: ModuleContext): Promise<void> {
    this.anchor.capture();
    this.place();
    this.promptPanel.group.visible = true;
    this.setPrompt('Így néz ki egy teljes mozdulat. Kétszer megmutatom, takarás nélkül.');
    for (const dir of [-1, 1]) {
      if (this.aborted) return;
      await this.playMovement(
        { block: 'frontal', occlusion: 1.0, dirFinal: dir, dirEarly: dir, deceptive: false, viewpoint: 'front', azDeg: 0 },
        false
      );
      await this.wait(700);
    }
    this.hideFigure();
    this.promptPanel.group.visible = false;
    ctx.recorder.event('calibration_done', {
      anchorHeight: +this.anchor.eyeHeight.toFixed(3),
      anchorYawDeg: +((this.anchor.yaw * 180) / Math.PI).toFixed(1),
    });
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.currentBlock = block.id as BlockId;
    this.practice = practice;
    this.anchor.ensure();
    this.promptPanel.group.visible = true;

    const list = practice
      ? this.practiceList(this.currentBlock)
      : this.trialList(this.currentBlock, ctx.rng);

    for (const t of list) {
      if (this.aborted) return;
      await this.runTrial(t);
    }

    if (!practice) {
      const mine = this.answers.filter((a) => a.block === this.currentBlock);
      ctx.recorder.event('block_summary', {
        block: this.currentBlock,
        n: mine.length,
        accuracyByOcclusion: this.accuracyByOcclusion(mine.filter((a) => !a.deceptive)),
        deceptiveAccuracy: rate(mine.filter((a) => a.deceptive)),
      });
    }
    this.hideFigure();
    this.promptPanel.group.visible = false;
    this.ctx.mobileControls?.clear();
  }

  /**
   * The trial list is built to be balanced, then shuffled - direction,
   * viewpoint and occlusion each appear equally often, and the feints are
   * spread evenly across occlusion levels rather than drawn at random. An
   * independent draw routinely leaves one cell with no feints at all, and the
   * deception measure would then be scored against a layout accident.
   */
  trialList(block: BlockId, rng: Rng): Trial[] {
    const out: Trial[] = [];
    if (block === 'frontal') {
      for (const occ of OCCLUSIONS) {
        const cell: Trial[] = [];
        for (const vp of ['front', 'side'] as Viewpoint[]) {
          for (let i = 0; i < FRONTAL_PER_CELL; i++) {
            const dir = i < FRONTAL_PER_CELL / 2 ? -1 : 1;
            cell.push({
              block, occlusion: occ, dirFinal: dir, dirEarly: dir,
              deceptive: false, viewpoint: vp, azDeg: 0,
            });
          }
        }
        const nDeceptive = Math.round(cell.length * DECEPTION_RATIO);
        for (const idx of rng.shuffle(cell.map((_, i) => i)).slice(0, nDeceptive)) {
          cell[idx]!.deceptive = true;
          cell[idx]!.dirEarly = -cell[idx]!.dirFinal;
        }
        out.push(...cell);
      }
      return rng.shuffle(out);
    }
    if (block === 'depth') {
      const per = DEPTH_TRIALS / DEPTH_OCCLUSIONS.length;
      for (const occ of DEPTH_OCCLUSIONS) {
        for (let i = 0; i < per; i++) {
          const dir = i < per / 2 ? -1 : 1;
          out.push({ block, occlusion: occ, dirFinal: dir, dirEarly: dir, deceptive: false, viewpoint: 'front', azDeg: 0 });
        }
      }
      return rng.shuffle(out);
    }
    const per = PERIPHERAL_TRIALS / (DEPTH_OCCLUSIONS.length * 2);
    for (const occ of DEPTH_OCCLUSIONS) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < per; i++) {
          const dir = i < per / 2 ? -1 : 1;
          out.push({
            block, occlusion: occ, dirFinal: dir, dirEarly: dir, deceptive: false,
            viewpoint: 'front', azDeg: side * PERIPHERAL_AZ_DEG,
          });
        }
      }
    }
    return rng.shuffle(out);
  }

  private practiceList(block: BlockId): Trial[] {
    const n = block === 'frontal' ? PRACTICE_TRIALS : 4;
    const out: Trial[] = [];
    for (let i = 0; i < n; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      const deceptive = block === 'frontal' && i === n - 1;
      out.push({
        block,
        occlusion: block === 'frontal' ? OCCLUSIONS[Math.min(3, 2 + (i % 2))]! : DEPTH_OCCLUSIONS[1]!,
        dirFinal: dir, dirEarly: deceptive ? -dir : dir, deceptive,
        viewpoint: 'front',
        azDeg: block === 'peripheral' ? (i % 2 === 0 ? -PERIPHERAL_AZ_DEG : PERIPHERAL_AZ_DEG) : 0,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------- trial */

  private async runTrial(t: Trial): Promise<void> {
    const ctx = this.ctx;
    this.setPrompt('');
    this.setDirectionControls(t.block);
    await this.wait(500);
    if (this.aborted) return;

    ctx.recorder.event('movement_start', {
      trial: this.trialNumber + 1, block: t.block,
      directionFinal: t.dirFinal, directionEarly: t.dirEarly, deceptive: t.deceptive,
      viewpoint: t.viewpoint, azDeg: t.azDeg,
      occlusionFraction: t.occlusion, occlusionMs: Math.round(t.occlusion * MOVEMENT_MS),
      practice: this.practice,
    });

    await this.playMovement(t, true);
    if (this.aborted) return;

    this.setPrompt(t.block === 'depth' ? 'Feléd jött vagy tőled el?' : 'Merre indult?');
    const answerT = await this.awaitDirection();
    if (this.aborted) return;
    const answer = this.lastAnswer;
    const correct = answer === t.dirFinal;
    const rtMs = answerT - this.occludedAtT;

    ctx.recorder.event('response', {
      trial: this.trialNumber + 1, answer, correct, rtMs: +rtMs.toFixed(1),
      quantisationMs: +(ctx.engine.clock.frameInterval || 11.1).toFixed(1),
    });

    if (this.practice) {
      // Only in practice does the movement finish: seeing the outcome is what
      // teaches the task, and in the measured blocks it would teach the answer.
      await this.playRemainder(t);
      this.setPrompt(correct ? 'Helyes' : `Nem — ${t.dirFinal < 0 ? 'balra' : 'jobbra'} ment`);
      if (correct) ctx.audio.ok(); else ctx.audio.error();
      await this.wait(900);
    }

    this.hideFigure();
    this.setPrompt('Mennyire vagy biztos benne?');
    const conf = await this.awaitConfidence();
    if (this.aborted) return;
    ctx.recorder.event('confidence', {
      trial: this.trialNumber + 1, level: conf.level, rtMs: +conf.rtMs.toFixed(1),
    });

    this.trialNumber++;
    const rec: Answer = { ...t, answer, correct, rtMs, confidence: conf.level, confidenceRtMs: conf.rtMs };
    if (!this.practice) {
      this.answers.push(rec);
      this.recordTrial(rec);
    }
    this.setPrompt('');
    await this.wait(ITI_MS);
  }

  private occludedAtT = 0;
  private lastAnswer = 0;

  private playMovement(t: Trial, occlude: boolean): Promise<void> {
    const ctx = this.ctx;
    const start = ctx.engine.clock.frameTime;
    this.ground.visible = true;
    this.showFigure(true);
    return new Promise<void>((resolve) => {
      this.live = {
        trial: t, startT: start,
        occludedAt: start + (occlude ? t.occlusion : 1) * MOVEMENT_MS,
        occluded: false, answered: false, answer: 0, answerT: 0,
        resolve,
      };
    });
  }

  /** Practice only: finish the movement so the outcome can be seen. */
  private async playRemainder(t: Trial): Promise<void> {
    const ctx = this.ctx;
    const start = ctx.engine.clock.frameTime - t.occlusion * MOVEMENT_MS;
    this.showFigure(true);
    await new Promise<void>((resolve) => {
      this.live = {
        trial: t, startT: start, occludedAt: start + MOVEMENT_MS,
        occluded: false, answered: false, answer: 0, answerT: 0, resolve,
      };
    });
  }

  private awaitDirection(): Promise<number> {
    return new Promise<number>((resolve) => { this.directionResolve = resolve; });
  }
  private directionResolve: ((t: number) => void) | null = null;

  private awaitConfidence(): Promise<{ level: number; rtMs: number }> {
    const start = this.ctx.engine.clock.frameTime;
    this.confidencePanel.group.visible = !this.ctx.mobileControls;
    this.confidencePanel.invalidate();
    this.setConfidenceControls();
    return new Promise((resolve) => {
      this.awaitingConfidence = (level, t) => {
        this.awaitingConfidence = null;
        this.confidencePanel.group.visible = false;
        resolve({ level, rtMs: t - start });
      };
    });
  }

  private answerConfidence(level: number, t: number): void {
    this.awaitingConfidence?.(level, t);
  }

  private onAction(e: ActionEvent): void {
    if (!e.down) return;
    if (this.directionResolve && (e.action === 'LEFT' || e.action === 'RIGHT')) {
      const resolve = this.directionResolve;
      this.directionResolve = null;
      this.lastAnswer = e.action === 'LEFT' ? -1 : 1;
      resolve(e.t);
    }
  }

  private setDirectionControls(block: BlockId): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    // Two buttons rather than a dial: a dial lays its segments out starting at
    // the top, which is exactly not the shape of a left-versus-right question.
    // They emit the real LEFT / RIGHT actions, so the module's own handler is
    // the same code on every platform.
    mc.set({
      look: 'off',
      hint: block === 'depth' ? 'Feléd jött vagy tőled el?' : 'Merre indult?',
      buttons: block === 'depth'
        ? [
            { id: 'near', label: 'FELÉM', action: 'LEFT', variant: 'primary' },
            { id: 'far', label: 'TŐLEM EL', action: 'RIGHT', variant: 'accent2' },
          ]
        : [
            { id: 'left', label: 'BAL', action: 'LEFT', variant: 'primary' },
            { id: 'right', label: 'JOBB', action: 'RIGHT', variant: 'accent2' },
          ],
    });
  }

  private setConfidenceControls(): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    mc.set({
      look: 'off',
      hint: 'Mennyire vagy biztos benne?',
      buttons: [
        { id: 'conf1', label: 'TIPP', variant: 'ghost', onTap: (t) => this.answerConfidence(1, t) },
        { id: 'conf2', label: 'TALÁN', variant: 'ghost', onTap: (t) => this.answerConfidence(2, t) },
        { id: 'conf3', label: 'BIZTOS', variant: 'ghost', onTap: (t) => this.answerConfidence(3, t) },
      ],
    });
  }

  /* ------------------------------------------------------------- frame */

  update(_dt: number, ctx: ModuleContext): void {
    const l = this.live;
    if (!l) return;
    const t = ctx.engine.clock.frameTime;
    const frac = clamp((t - l.startT) / MOVEMENT_MS, 0, 1);

    if (!l.occluded && t >= l.occludedAt) {
      l.occluded = true;
      this.occludedAtT = t;
      this.hideFigure();
      ctx.recorder.event('occlusion', {
        trial: this.trialNumber + 1, framesShown: Math.round((l.occludedAt - l.startT) / (ctx.engine.clock.frameInterval || 11.1)),
      });
      this.live = null;
      l.resolve();
      return;
    }
    this.renderPose(l.trial, frac);
  }

  private renderPose(t: Trial, frac: number): void {
    const isDepth = t.block === 'depth';
    // In the depth block the whole figure is rescaled with its distance so its
    // angular size never changes. That is what makes the block VR-only: with
    // size held constant, the two directions render as identical images and
    // only disparity and parallax can separate them.
    const offset = isDepth ? depthOffsetM(frac, t.dirFinal, t.dirEarly, DEPTH_RANGE_M) : 0;
    const distance = FIGURE_DISTANCE + offset;
    const scale = distance / FIGURE_DISTANCE;

    const p = pose({
      t: frac,
      dirEarly: isDepth ? 0 : t.dirEarly,
      dirFinal: isDepth ? 0 : t.dirFinal,
      height: FIGURE_HEIGHT,
    });

    const az = (t.azDeg * Math.PI) / 180;
    const base = this.anchor.place(t.azDeg, 0, distance, new THREE.Vector3());
    base.y = this.anchor.origin.y - this.anchor.eyeHeight + 0.02;
    this.group.position.copy(base);
    // A side view is the same movement seen from 55 degrees round, which is a
    // genuinely different set of kinematic cues - and one a flat screen can
    // render as well, so it is not claimed as a spatial measure.
    this.group.rotation.y = this.anchor.yaw + az
      + (t.viewpoint === 'side' ? (SIDE_VIEW_YAW_DEG * Math.PI) / 180 : 0);
    this.group.scale.setScalar(scale);

    for (const j of JOINTS) {
      const dot = this.dots.get(j)!;
      dot.position.copy(p[j]!);
    }
    this.ground.position.set(0, 0.01, 0);
  }

  private showFigure(on: boolean): void {
    for (const d of this.dots.values()) d.visible = on;
    this.ground.visible = on;
  }

  private hideFigure(): void {
    this.showFigure(false);
  }

  /* ------------------------------------------------------------ panels */

  private setPrompt(text: string): void {
    this.promptText = text;
    this.promptPanel.invalidate();
  }

  private drawPrompt(ui: UI): void {
    const t = ui.t;
    if (!this.promptText) return;
    ui.background(withAlpha(t.surface, 0.86), 14);
    ui.text(this.promptText, ui.w / 2, ui.h / 2, {
      size: 28, color: t.text, align: 'center', weight: '600', font: t.fontDisplay,
    });
  }

  private drawConfidence(ui: UI): void {
    const t = ui.t;
    ui.background(t.surface, 16);
    ui.text('MENNYIRE VAGY BIZTOS BENNE?', ui.w / 2, 34, {
      size: 19, color: t.textMuted, align: 'center', weight: '700',
      font: t.fontMono, letterSpacing: '0.12em',
    });
    const labels = ['TIPP', 'TALÁN', 'BIZTOS'];
    const w = (ui.w - 4 * 22) / 3;
    for (let i = 0; i < 3; i++) {
      ui.button(`conf${i + 1}`, 22 + i * (w + 22), 62, w, 78, {
        label: labels[i]!, variant: i === 2 ? 'primary' : 'ghost',
      });
    }
  }

  /* ------------------------------------------------------------ trials */

  private recordTrial(a: Answer): void {
    const rec: TrialRecord = {
      trialNumber: this.trialNumber,
      block: a.block,
      stimulus: {
        block: a.block, occlusionFraction: a.occlusion,
        occlusionMs: Math.round(a.occlusion * MOVEMENT_MS),
        directionFinal: a.dirFinal, directionEarly: a.dirEarly,
        deceptive: a.deceptive, viewpoint: a.viewpoint, azDeg: a.azDeg,
      },
      response: {
        answer: a.answer, rtMs: Math.round(a.rtMs),
        confidence: a.confidence, confidenceRtMs: Math.round(a.confidenceRtMs),
      },
      correct: a.correct,
      outcome: a.correct ? 'hit' : 'miss',
      reactionTimeMs: a.rtMs,
      startedAt: 0,
      endedAt: 0,
    };
    this.ctx.recorder.trial(rec);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private accuracyByOcclusion(list: Answer[]): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const occ of OCCLUSIONS) {
      const xs = list.filter((a) => a.occlusion === occ);
      out[String(Math.round(occ * MOVEMENT_MS))] = xs.length ? +rate(xs).toFixed(3) : null;
    }
    return out;
  }

  /* ------------------------------------------------------------ finish */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    const frontal = this.answers.filter((a) => a.block === 'frontal');
    const genuine = frontal.filter((a) => !a.deceptive);
    const accuracy = rate(genuine);

    const curve = OCCLUSIONS.map((occ) => ({
      x: occ * MOVEMENT_MS,
      y: rate(genuine.filter((a) => a.occlusion === occ)),
    })).filter((p) => Number.isFinite(p.y));
    const earliest = risingCrossing(curve, RELIABLE_LEVEL);

    // Only the two late occlusions: at 40 % and 55 % the feint is unreadable
    // BY DESIGN, so including them would measure the construction of the task
    // rather than the participant.
    const late = frontal.filter((a) => a.occlusion >= OCCLUSIONS[2]!);
    const lateGenuine = rate(late.filter((a) => !a.deceptive));
    const lateDeceptive = rate(late.filter((a) => a.deceptive));
    const deception = Number.isFinite(lateGenuine) && Number.isFinite(lateDeceptive)
      ? lateGenuine - lateDeceptive : NaN;

    const front = rate(genuine.filter((a) => a.viewpoint === 'front'));
    const side = rate(genuine.filter((a) => a.viewpoint === 'side'));
    const viewpointCost = Number.isFinite(front) && Number.isFinite(side) ? front - side : NaN;

    const high = rate(this.answers.filter((a) => a.confidence === 3));
    const low = rate(this.answers.filter((a) => a.confidence === 1));
    const calibration = Number.isFinite(high) && Number.isFinite(low) ? high - low : NaN;
    const meanConf = this.answers.length
      ? mean(this.answers.map((a) => (a.confidence - 1) / 2)) : NaN;
    const overallAcc = rate(this.answers);
    const overconfidence = Number.isFinite(meanConf) && Number.isFinite(overallAcc)
      ? meanConf - overallAcc : NaN;

    const rts = this.answers.map((a) => a.rtMs).filter(Number.isFinite);

    const depth = this.answers.filter((a) => a.block === 'depth');
    const depthAcc = isVr ? rate(depth) : NaN;
    const depthCurve = DEPTH_OCCLUSIONS.map((occ) => ({
      x: occ * MOVEMENT_MS, y: rate(depth.filter((a) => a.occlusion === occ)),
    })).filter((p) => Number.isFinite(p.y));
    const depthEarliest = isVr ? risingCrossing(depthCurve, RELIABLE_LEVEL) : null;

    const peripheral = this.answers.filter((a) => a.block === 'peripheral');
    const peripheralAcc = isVr ? rate(peripheral) : NaN;
    // Matched on occlusion level, so the cost is about eccentricity and not
    // about the peripheral block happening to use harder occlusions.
    const matched = rate(genuine.filter((a) => DEPTH_OCCLUSIONS.includes(a.occlusion)));
    const peripheralCost = isVr && Number.isFinite(matched) && Number.isFinite(peripheralAcc)
      ? matched - peripheralAcc : NaN;

    const M: [string, number, string, string?][] = [
      ['prediction_accuracy', accuracy, 'ratio', 'frontal'],
      ['earliest_reliable_frame_ms', earliest.ms, 'ms', 'frontal'],
      ['deception_susceptibility', deception, 'ratio', 'frontal'],
      ['confidence_calibration', calibration, 'ratio', 'overall'],
      ['overconfidence', overconfidence, 'ratio', 'overall'],
      ['viewpoint_cost', viewpointCost, 'ratio', 'frontal'],
      ['rt_median_ms', rts.length ? median(rts) : NaN, 'ms', 'overall'],
    ];
    if (isVr) {
      M.push(['depth_intent_accuracy', depthAcc, 'ratio', 'depth']);
      M.push(['depth_earliest_frame_ms', depthEarliest!.ms, 'ms', 'depth']);
      M.push(['peripheral_intent_accuracy', peripheralAcc, 'ratio', 'peripheral']);
      M.push(['peripheral_cost', peripheralCost, 'ratio', 'peripheral']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* --------------------------------------------------------- scores */

    const accScore = normaliseSoft(Number.isFinite(accuracy) ? accuracy : 0.5, 0.88, 0.55);
    // An unbounded curve that never reached the level is scored at the worst
    // anchor - not skipped, because failing to reach it is itself the result.
    const earlyScore = normaliseSoft(
      Number.isFinite(earliest.ms) ? earliest.ms : OCCLUSIONS[3]! * MOVEMENT_MS,
      620, OCCLUSIONS[3]! * MOVEMENT_MS);
    const deceptionScore = normaliseSoft(Number.isFinite(deception) ? deception : 0.4, 0.05, 0.40);
    const calibrationScore = normaliseSoft(Number.isFinite(calibration) ? calibration : 0, 0.35, 0);
    const depthScore = normaliseSoft(Number.isFinite(depthAcc) ? depthAcc : 0.5, 0.85, 0.55);
    const peripheralScore = normaliseSoft(
      Number.isFinite(peripheralCost) ? peripheralCost : 0.3, 0.05, 0.30);

    const components = isVr
      ? [
          { key: 'prediction_accuracy', value: accScore, weight: 0.28 },
          { key: 'early_reading', value: earlyScore, weight: 0.24 },
          { key: 'deception_resistance', value: deceptionScore, weight: 0.18 },
          { key: 'confidence_calibration', value: calibrationScore, weight: 0.14 },
          { key: 'depth_intent', value: depthScore, weight: 0.09 },
          { key: 'peripheral_reading', value: peripheralScore, weight: 0.07 },
        ]
      : [
          { key: 'prediction_accuracy', value: accScore, weight: 0.34 },
          { key: 'early_reading', value: earlyScore, weight: 0.28 },
          { key: 'deception_resistance', value: deceptionScore, weight: 0.21 },
          { key: 'confidence_calibration', value: calibrationScore, weight: 0.17 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const signed = (v: number) =>
      Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}` : '—';

    const headline: ModuleResult['headline'] = [
      { label: 'Előrejelzés pontossága', value: pct(accuracy), hint: 'a nem megtévesztő próbákon' },
      {
        label: 'Legkorábbi megbízható pont', value: earliest.label,
        hint: earliest.bounded
          ? `a mozdulat ${Math.round((earliest.ms / MOVEMENT_MS) * 100)}%-ánál már tudtad`
          : earliest.above
            ? 'már a legrövidebb takarásnál is tudtad'
            : 'a leghosszabb takarásnál sem állt össze a kép',
      },
      {
        label: 'Megtévesztésre', value: signed(-deception),
        hint: Number.isFinite(deception)
          ? `a cseleken ${Math.round(Math.abs(deception) * 100)} százalékponttal ${deception > 0 ? 'rosszabb' : 'jobb'}`
          : undefined,
      },
      {
        label: 'Magabiztosság-kalibráció', value: signed(calibration),
        hint: !Number.isFinite(calibration) ? undefined
          : calibration > 0.2 ? 'tudod, mikor tudod' : 'a magabiztosságod alig hordoz információt',
      },
      { label: 'Nézőpont ára', value: signed(viewpointCost), hint: 'szemből mínusz oldalról' },
    ];
    headline.push(
      isVr
        ? {
            label: 'Mélységi szándék', value: pct(depthAcc),
            hint: 'feléd vagy tőled el, állandó látszó méret mellett',
          }
        : {
            label: 'Mélységi szándék', value: '—',
            hint: 'ehhez VR kell: állandó szögméret mellett a mélységet csak a diszparitás hordozza',
          }
    );

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        spatialWeightsApplied: isVr,
        trials: this.answers.length,
        predictionAccuracy: r(accuracy, 3),
        accuracyByOcclusion: this.accuracyByOcclusion(genuine),
        earliestReliableFrameMs: earliest.bounded ? r(earliest.ms) : null,
        earliestReliableBounded: earliest.bounded,
        earliestReliableLabel: earliest.label,
        deceptionSusceptibility: r(deception, 3),
        deceptiveTrials: frontal.filter((a) => a.deceptive).length,
        viewpointCost: r(viewpointCost, 3),
        confidence: {
          calibration: r(calibration, 3),
          overconfidence: r(overconfidence, 3),
          byLevel: [1, 2, 3].map((l) => ({
            level: l,
            n: this.answers.filter((a) => a.confidence === l).length,
            accuracy: r(rate(this.answers.filter((a) => a.confidence === l)), 3),
          })),
        },
        rtMedianMs: r(rts.length ? median(rts) : NaN),
        depth: isVr ? {
          accuracy: r(depthAcc, 3), n: depth.length,
          earliestFrameMs: depthEarliest!.bounded ? r(depthEarliest!.ms) : null,
          earliestLabel: depthEarliest!.label,
        } : null,
        peripheral: isVr ? {
          accuracy: r(peripheralAcc, 3), n: peripheral.length,
          cost: r(peripheralCost, 3), matchedFrontalAccuracy: r(matched, 3),
        } : null,
        // The feint rate and pattern are learnable; the second time round a
        // lower susceptibility can mean "expected it", not "read it".
        deceptionInterpretable: true,
        reliableLevel: RELIABLE_LEVEL,
      },
      axisScores: {
        perception: Math.round((accScore + earlyScore) / 2),
        spatial: isVr ? Math.round((depthScore + peripheralScore) / 2) : undefined,
      } as Record<string, number>,
    };
  }

  abort(): void {
    this.aborted = true;
    this.live?.resolve();
    this.live = null;
    this.directionResolve?.(this.ctx.engine.clock.frameTime);
    this.directionResolve = null;
    this.awaitingConfidence?.(1, this.ctx.engine.clock.frameTime);
    this.awaitingConfidence = null;
  }

  dispose(ctx: ModuleContext): void {
    this.aborted = true;
    this.offAction?.();
    this.offClick?.();
    ctx.panels.remove(this.confidencePanel);
    ctx.panels.remove(this.promptPanel);
    this.confidencePanel.dispose();
    this.promptPanel.dispose();
    disposeTree(ctx.root);
  }
}

/* ------------------------------------------------------------- helpers */

function rate(list: { correct: boolean }[]): number {
  return list.length ? list.filter((a) => a.correct).length / list.length : NaN;
}

/**
 * Where a RISING accuracy curve first crosses `level`.
 *
 * `crossingPoint` handles the interpolation, but its fallback is written for
 * the falling curves FIELD uses: when the curve never crosses it returns the
 * start of the range. For a rising curve that never gets there the honest
 * answer is the opposite end - "not by the longest occlusion we tested" - so
 * the unbounded cases are resolved here rather than in the shared helper.
 */
export function risingCrossing(
  points: { x: number; y: number }[],
  level: number
): { ms: number; bounded: boolean; above: boolean; label: string } {
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts.length === 0) return { ms: NaN, bounded: false, above: false, label: '—' };
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (first.y >= level) {
    return { ms: first.x, bounded: false, above: true, label: `≤ ${Math.round(first.x)} ms` };
  }
  if (last.y < level) {
    return { ms: last.x, bounded: false, above: false, label: `≥ ${Math.round(last.x)} ms` };
  }
  const c = crossingPoint(pts, level);
  return { ms: c.x, bounded: true, above: false, label: `${Math.round(c.x)} ms` };
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
