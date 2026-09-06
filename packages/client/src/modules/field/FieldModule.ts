import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, median, normaliseSoft, opsScore, clamp,
  Staircase, crossingPoint,
  type ModuleManifest, type TrialRecord,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { volumePosition, Tumbler } from '../shared/volume.js';

/**
 * MODULE 12 - FIELD
 * Useful field of view and dynamic visual acuity.
 *
 * The UFOV paradigm is a flat-screen test: identify something in the centre
 * while marking where something else flashed in the periphery, with the
 * display duration driven down to a threshold. It is one of the best validated
 * perceptual predictors there is - and a monitor at arm's length can only
 * present about sixteen degrees of eccentricity.
 *
 * That limit is not a detail. The measured quantity IS an angular extent, so a
 * flat display does not merely lose a metric here; it truncates the scale.
 * In a headset the same paradigm runs out to fifty degrees, which is where
 * "seeing it out of the corner of your eye" actually lives.
 *
 * Three things follow that a screen cannot do:
 *
 *   FIELD RADIUS      accuracy is sampled at 10, 20, 35 and 50 degrees and the
 *                     crossing point of the 50% level is interpolated. On a
 *                     laptop the outer two points do not exist.
 *   DEPTH FIELD       the central task sits at 1.6 m and the peripheral flash
 *                     at either 1.6 m or 5.2 m, with angular size held equal.
 *                     Attention is not distributed evenly in depth, and this
 *                     is the cost of that.
 *   FIXATION CONTROL  a screen cannot tell whether the participant simply
 *                     looked at the target. Head pose can: any trial with more
 *                     than six degrees of head rotation is excluded from the
 *                     threshold and reported separately.
 *
 * The fourth block replaces static acuity with the approaching kind: a ring
 * with a gap flies in, and the gap direction has to be read before it arrives.
 */

type BlockId = 'threshold' | 'cluttered' | 'depthfield' | 'dva';
type Shape = 'cube' | 'sphere';

const NEAR_DEPTH = 1.6;
const FAR_DEPTH = 5.2;
/** Above this much head rotation between flash and response, the trial does
 *  not measure a peripheral field - it measures a glance. */
const FIXATION_TOLERANCE_DEG = 6;
const TARGET_ANGULAR_DEG = 3.6;
const DIRECTIONS = 8;

interface FieldTrial {
  block: BlockId;
  /** True on the central-only catch trials that give the dual-task baseline. */
  centralOnly: boolean;
  durationMs: number;
  frames: number;
  eccentricityDeg: number;
  directionIndex: number;
  depthM: number;
  centralShape: Shape;
  centralAnswer: Shape | null;
  centralCorrect: boolean;
  peripheralAnswer: number | null;
  peripheralCorrect: boolean;
  errorDirections: number;
  rtCentralMs: number | null;
  rtPeripheralMs: number | null;
  headMoveDeg: number;
  fixationBreak: boolean;
}

interface DvaTrial {
  speedMps: number;
  angularSpeedDegPerSec: number;
  gapDirection: number;
  answer: number | null;
  correct: boolean;
  distanceAtResponseM: number;
}

export class FieldModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.FIELD!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'threshold',
      title: 'MEZŐ',
      instruction:
        'Középen egy gyűrű lesz — VÉGIG AZT NÉZD. A közepén egy pillanatra megjelenik egy KOCKA vagy egy GÖMB: ' +
        'ezt kell először megmondanod. Ugyanabban a pillanatban oldalt is felvillan valami — utána azt jelöld meg, ' +
        'merre volt. Ne fordítsd oda a fejed: a lényeg épp az, mennyit veszel észre odanézés nélkül.',
      controlHint: '',
      trials: 48,
      practiceTrials: 6,
    },
    {
      id: 'cluttered',
      title: 'ZSÚFOLT MEZŐ',
      instruction:
        'Ugyanaz a feladat, de most sok hasonló gyűrű is látszik körben. A felvillanás ezek között történik. ' +
        'A központi alakzat továbbra is elsőbbséget élvez.',
      controlHint: '',
      trials: 36,
      practiceTrials: 4,
    },
    {
      id: 'depthfield',
      title: 'MÉLYSÉGI MEZŐ',
      instruction:
        'Most a felvillanás néha ugyanolyan távol van, mint a gyűrű, néha viszont jóval TÁVOLABB. ' +
        'Ugyanakkorának látszik — csak messzebb van. Ugyanaz a feladat.',
      controlHint: '',
      trials: 32,
      practiceTrials: 4,
    },
    {
      id: 'dva',
      title: 'MOZGÓ CÉL',
      instruction:
        'Egy gyűrű repül feléd, és van rajta egy RÉS. Mondd meg, merre néz a rés: fent, lent, balra vagy jobbra. ' +
        'Minél gyorsabban jön, annál nehezebb — addig gyorsítok, amíg meg nem találom a határodat.',
      controlHint: '',
      trials: 28,
      practiceTrials: 4,
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private root!: THREE.Group;
  private fixation!: THREE.Mesh;
  private central!: THREE.Group;
  private centralCube!: THREE.Mesh;
  private centralSphere!: THREE.Mesh;
  private peripheral!: THREE.Mesh;
  private mask!: THREE.Mesh;
  private distractors: THREE.Mesh[] = [];
  private dvaRing!: THREE.Group;
  private dvaTorus!: THREE.Mesh;
  private dvaGap!: THREE.Mesh;
  private tumbler = new Tumbler();

  private dialPanel!: Panel;
  private feedbackPanel!: Panel;

  private trials: FieldTrial[] = [];
  private dvaTrials: DvaTrial[] = [];
  private records: TrialRecord[] = [];

  private staircases = new Map<BlockId, Staircase>();
  private currentBlock: BlockId = 'threshold';
  private practice = false;
  private aborted = false;

  /** Head yaw/pitch captured at calibration; the reference for fixation. */
  private restYawDeg = 0;
  private restPitchDeg = 0;

  private live: {
    phase: 'central' | 'peripheral' | 'gap';
    onsetT: number;
    resolve: () => void;
    centralShape: Shape;
    centralOnly: boolean;
    centralAnswer: Shape | null;
    centralRt: number | null;
    directionIndex: number;
    gapDirection: number;
    answer: number | null;
    headAtOnset: { yaw: number; pitch: number };
    maxHeadMove: number;
  } | null = null;

  private offAction: (() => void) | null = null;
  private offPanel: (() => void) | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.root = ctx.root;
    const flat = ctx.platform !== 'vr';
    const t = ctx.theme;

    // Angular sizes are held to the values in the spec by deriving physical
    // size from distance, so the same numbers hold on every platform.
    const angSize = (deg: number, dist: number) => 2 * dist * Math.tan((deg * Math.PI) / 360);

    this.fixation = makePrimitive({
      kind: 'torus', color: t.accent, unlit: true, size: angSize(2.7, NEAR_DEPTH),
    });
    this.fixation.position.copy(volumePosition(0, 0, NEAR_DEPTH, 1.6));
    this.fixation.lookAt(0, 1.6, 0);

    this.central = new THREE.Group();
    this.central.position.copy(this.fixation.position);
    this.centralCube = makePrimitive({ kind: 'box', color: t.text, unlit: true, size: angSize(2.0, NEAR_DEPTH) });
    this.centralSphere = makePrimitive({ kind: 'sphere', color: t.text, unlit: true, size: angSize(2.0, NEAR_DEPTH) });
    this.centralCube.visible = false;
    this.centralSphere.visible = false;
    this.central.add(this.centralCube, this.centralSphere);

    this.peripheral = makePrimitive({
      kind: 'sphere', color: 0xffffff, unlit: true, size: angSize(TARGET_ANGULAR_DEG, NEAR_DEPTH),
    });
    this.peripheral.visible = false;

    this.mask = makePrimitive({ kind: 'ring', color: t.textMuted, unlit: true, size: angSize(5.7, NEAR_DEPTH), opacity: 0.9 });
    this.mask.visible = false;

    this.dvaRing = new THREE.Group();
    this.dvaTorus = makePrimitive({ kind: 'torus', color: t.accent2, unlit: true, size: 0.30 });
    // The gap is cut by an occluder the colour of the void, so the ring's
    // physical gap width stays constant as it approaches - only its angular
    // size grows, which is what makes the speed threshold interpretable.
    this.dvaGap = makePrimitive({ kind: 'box', color: 0x05070a, unlit: true, size: [0.075, 0.11, 0.11] });
    this.dvaGap.position.set(0.15, 0, 0);
    this.dvaRing.add(this.dvaTorus, this.dvaGap);
    this.dvaRing.visible = false;

    this.root.add(this.fixation, this.central, this.peripheral, this.mask, this.dvaRing);

    // Distractor field: rings at the same angular size as the target, tumbling
    // so they read as bodies rather than as a printed pattern.
    for (let i = 0; i < 24; i++) {
      const d = makePrimitive({
        kind: 'torus', color: t.textMuted, unlit: true,
        size: angSize(TARGET_ANGULAR_DEG, NEAR_DEPTH), opacity: 0.55,
      });
      d.visible = false;
      this.distractors.push(d);
      this.root.add(d);
      this.tumbler.add(d, ctx.rng, 0.15, 0.4);
    }

    this.dialPanel = new Panel({
      width: flat ? 0.42 : 0.50, height: flat ? 0.42 : 0.50,
      pxPerMeter: 900, theme: t, frame: false, name: 'field-dial',
    });
    // The dial sits on the fixation point so answering never requires looking
    // away from it - the whole measurement depends on that.
    this.dialPanel.group.position.copy(volumePosition(0, 0, NEAR_DEPTH - 0.02, 1.6));
    this.dialPanel.setDraw((ui) => this.drawDial(ui));
    this.dialPanel.group.visible = false;
    this.root.add(this.dialPanel.group);
    ctx.panels.add(this.dialPanel);

    this.feedbackPanel = new Panel({
      width: 0.66, height: 0.14, pxPerMeter: 950, theme: t, frame: false, name: 'field-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.16, -(NEAR_DEPTH - 0.1));
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    this.offAction = ctx.engine.input.on((e: ActionEvent) => this.onAction(e));
    this.offPanel = ctx.panels.onClick((e) => this.onPanelClick(e.widget.id, e.t));

    for (const b of this.blocks) b.controlHint = this.controlHint();

    ctx.recorder.event('field_geometry', {
      platform: ctx.platform,
      eccentricities: this.eccentricities(),
      directions: DIRECTIONS,
      depthsM: [NEAR_DEPTH, FAR_DEPTH],
      fixationToleranceDeg: FIXATION_TOLERANCE_DEG,
      targetAngularDeg: TARGET_ANGULAR_DEG,
    });
  }

  /**
   * A laptop at reading distance subtends about 32 degrees in total. Asking
   * for 50 degrees there would place the target off the screen, so the flat
   * platforms get a compressed set - and the resulting field radius is
   * explicitly not comparable with the VR one.
   */
  private eccentricities(): number[] {
    switch (this.ctx.platform) {
      case 'vr': return [10, 20, 35, 50];
      case 'desktop': return [5, 9, 13, 16];
      default: return [4, 7, 10, 13];
    }
  }

  /**
   * Touch controls.
   *
   * The answer here is two answers in sequence, and both were headset-shaped:
   * a shape choice on two different controller buttons, then a direction
   * picked off a dial you aim at with a ray. On a phone the shape choice
   * becomes two buttons and the dial becomes a real ring of touch targets -
   * which is also faster to hit, and the whole point of this module is how
   * little time the participant needs.
   */
  private setTouchPhase(phase: 'central' | 'peripheral' | 'gap'): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    if (phase === 'central') {
      mc.set({
        hint: 'Mi volt középen?',
        buttons: [
          { id: 'cube', label: 'KOCKA', action: 'PRIMARY', variant: 'ghost' },
          { id: 'sphere', label: 'GÖMB', action: 'SECONDARY', variant: 'ghost' },
        ],
      });
      return;
    }
    if (phase === 'peripheral') {
      mc.set({
        hint: 'Merre villant?',
        dial: { segments: DIRECTIONS, onPick: (i, t) => this.pickDirection(i, t) },
      });
      return;
    }
    mc.set({
      hint: 'Merre néz a rés?',
      dial: {
        segments: 4,
        labels: ['FENT', 'JOBB', 'LENT', 'BAL'],
        onPick: (i, t) => this.pickGap(i, t),
      },
    });
  }

  /** Peripheral direction answer, from the dial rather than a panel widget. */
  private pickDirection(idx: number, t: number): void {
    const l = this.live;
    if (!l || l.phase !== 'peripheral') return;
    this.ctx.recorder.event('peripheral_response', {
      answer: idx, correct: idx === l.directionIndex,
      rtMs: +(t - l.onsetT).toFixed(1),
      errorDirections: Math.min(
        Math.abs(idx - l.directionIndex), DIRECTIONS - Math.abs(idx - l.directionIndex)
      ),
    }, t);
    l.answer = idx;
    l.resolve();
  }

  private pickGap(idx: number, t: number): void {
    const l = this.live;
    if (!l || l.phase !== 'gap') return;
    l.answer = idx;
    this.ctx.recorder.event('gap_response', { answer: idx, correct: idx === l.gapDirection }, t);
    l.resolve();
  }

  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'RAVASZ: kocka · GRIP: gömb · majd a TÁRCSÁN az irány';
      case 'desktop': return 'Z: kocka · M: gömb · NYILAK: irány · ENTER: rögzít';
      default: return 'KOCKA / GÖMB gomb, majd a körből az irány';
    }
  }

  /* ------------------------------------------------------- calibration */

  async calibrate(ctx: ModuleContext): Promise<void> {
    this.fixation.visible = true;
    this.feedbackPanel.group.visible = true;
    this.setFeedback('Nézz a gyűrűre, és nyomd meg a gombot.', 'neutral');

    await new Promise<void>((resolve) => {
      const off = ctx.engine.input.on((e: ActionEvent) => {
        if (!e.down || (e.action !== 'PRIMARY' && e.action !== 'CONFIRM')) return;
        off();
        resolve();
      });
    });

    const h = this.headAngles();
    this.restYawDeg = h.yaw;
    this.restPitchDeg = h.pitch;
    ctx.recorder.event('fixation_ready', { headYawDeg: +h.yaw.toFixed(2), headPitchDeg: +h.pitch.toFixed(2) });
    this.feedbackPanel.group.visible = false;
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.currentBlock = block.id as BlockId;
    this.practice = practice;
    const count = practice ? block.practiceTrials : block.trials;
    if (count <= 0) return;

    this.fixation.visible = this.currentBlock !== 'dva';
    this.showDistractors(this.currentBlock === 'cluttered' ? 24 : this.currentBlock === 'dva' ? 12 : 0);

    if (this.currentBlock === 'dva') {
      await this.runDva(count);
    } else {
      await this.runField(count);
    }

    this.showDistractors(0);
    const sc = this.staircases.get(this.currentBlock);
    if (sc && !practice) {
      ctx.recorder.event('block_summary', {
        block: this.currentBlock,
        thresholdMs: +sc.threshold(8).toFixed(1),
        reversals: sc.reversals.length,
        validTrials: this.trials.filter((t) => t.block === this.currentBlock && !t.fixationBreak).length,
        fixationBreaks: this.trials.filter((t) => t.block === this.currentBlock && t.fixationBreak).length,
      });
    }
  }

  private staircaseFor(block: BlockId): Staircase {
    let sc = this.staircases.get(block);
    if (!sc) {
      sc = block === 'dva'
        // Speed staircase: higher is harder, so the polarity flips.
        ? new Staircase({ start: 4.0, down: 3, coarseFactor: 0.78, fineFactor: 0.9, coarseAfter: 5,
                          min: 1.2, max: 14, lowerIsHarder: false })
        : new Staircase({ start: 320, down: 3, coarseFactor: 0.75, fineFactor: 0.87, coarseAfter: 6,
                          min: this.ctx.engine.clock.frameInterval, max: 640, lowerIsHarder: true });
      this.staircases.set(block, sc);
    }
    return sc;
  }

  /** Trial order: every eccentricity and direction equally often, then shuffled. */
  private buildOrder(count: number): { ecc: number; dir: number; depth: number; shape: Shape; centralOnly: boolean }[] {
    const rng = this.ctx.rng;
    const eccs = this.currentBlock === 'depthfield'
      ? [this.eccentricities()[1]!, this.eccentricities()[2]!]
      : this.eccentricities();
    const depths = this.currentBlock === 'depthfield' ? [NEAR_DEPTH, FAR_DEPTH] : [NEAR_DEPTH];

    // One trial in six carries no peripheral flash. These are UFOV's first
    // subtest - the central identification on its own - and they are the only
    // way to measure what the peripheral load costs the central task.
    const catchCount = this.currentBlock === 'threshold' ? Math.round(count / 6) : 0;

    const out: { ecc: number; dir: number; depth: number; shape: Shape; centralOnly: boolean }[] = [];
    let i = 0;
    while (out.length < count - catchCount) {
      out.push({
        ecc: eccs[i % eccs.length]!,
        dir: (i * 3 + Math.floor(i / DIRECTIONS)) % DIRECTIONS,
        depth: depths[Math.floor(i / eccs.length) % depths.length]!,
        shape: i % 2 === 0 ? 'cube' : 'sphere',
        centralOnly: false,
      });
      i++;
    }
    for (let c = 0; c < catchCount; c++) {
      out.push({
        ecc: eccs[c % eccs.length]!, dir: 0, depth: NEAR_DEPTH,
        shape: c % 2 === 0 ? 'cube' : 'sphere', centralOnly: true,
      });
    }
    return rng.shuffle(out);
  }

  private async runField(count: number): Promise<void> {
    const ctx = this.ctx;
    const sc = this.staircaseFor(this.currentBlock);
    const order = this.buildOrder(count);

    for (let i = 0; i < order.length && !this.aborted; i++) {
      ctx.recorder.trialNumber = i + 1;
      const spec = order[i]!;

      this.fixation.visible = true;
      await this.wait(600);
      if (this.aborted) return;

      // Practice runs at a fixed, generous duration: the staircase is an
      // estimator, not a teaching tool, and starting it before the participant
      // understands the task wastes its first reversals.
      const requested = this.practice ? 320 : sc.value;
      const frameMs = ctx.engine.clock.frameInterval || 11.1;
      const frames = Math.max(1, Math.round(requested / frameMs));
      const durationMs = frames * frameMs;

      const pos = this.peripheralPosition(spec.ecc, spec.dir, spec.depth);
      this.peripheral.position.copy(pos);
      // Angular size held constant across depth: the far target is physically
      // larger by exactly the distance ratio, so "far" cannot be read off as
      // "smaller".
      this.peripheral.scale.setScalar(spec.depth / NEAR_DEPTH);

      const shape = spec.shape;
      this.centralCube.visible = shape === 'cube';
      this.centralSphere.visible = shape === 'sphere';

      this.setTouchPhase('central');
      const head = this.headAngles();
      const onsetT = ctx.engine.clock.frameTime;
      this.peripheral.visible = !spec.centralOnly;
      ctx.audio.click();

      ctx.recorder.event('stimulus_onset', {
        block: this.currentBlock, durationMs: +durationMs.toFixed(2), frames,
        eccentricityDeg: spec.centralOnly ? null : spec.ecc,
        directionIndex: spec.centralOnly ? null : spec.dir,
        depthM: spec.depth, centralOnly: spec.centralOnly,
        centralShape: shape, distractors: this.currentBlock === 'cluttered' ? 24 : 0,
        quantisationMs: +frameMs.toFixed(1),
      }, onsetT);

      const result = await this.awaitResponses(shape, spec.dir, onsetT, head, durationMs, spec.centralOnly);
      if (this.aborted) return;

      const headMove = result.headMoveDeg;
      const fixationBreak = headMove > FIXATION_TOLERANCE_DEG;
      const bothCorrect = result.centralCorrect && result.peripheralCorrect;

      const rec: FieldTrial = {
        block: this.currentBlock, centralOnly: spec.centralOnly, durationMs, frames,
        eccentricityDeg: spec.ecc, directionIndex: spec.dir, depthM: spec.depth,
        centralShape: shape, centralAnswer: result.centralAnswer,
        centralCorrect: result.centralCorrect,
        peripheralAnswer: result.peripheralAnswer,
        peripheralCorrect: result.peripheralCorrect,
        errorDirections: result.errorDirections,
        rtCentralMs: result.rtCentralMs, rtPeripheralMs: result.rtPeripheralMs,
        headMoveDeg: headMove, fixationBreak,
      };
      if (!this.practice) this.trials.push(rec);

      if (fixationBreak) {
        ctx.recorder.event('fixation_break', { headMoveDeg: +headMove.toFixed(2), phase: 'response' });
      }

      // A trial where the head moved does not describe the peripheral field,
      // so it must not move the staircase either.
      if (!this.practice && !fixationBreak && !spec.centralOnly) {
        const before = sc.value;
        const after = sc.record(bothCorrect);
        if (after !== before) {
          const reversal = sc.reversals.length;
          ctx.recorder.event('staircase_step', {
            block: this.currentBlock, fromMs: +before.toFixed(1), toMs: +after.toFixed(1),
            reversal: sc.reversals[sc.reversals.length - 1]?.trial === sc.reversals.length ? true : undefined,
            reversalIndex: reversal,
          });
        }
      }

      this.pushRecord(rec, i + 1);

      if (this.practice) {
        this.showFeedback(
          fixationBreak ? 'ELFORDULT A FEJ — maradj a gyűrűn'
            : bothCorrect ? 'JÓ' : !result.centralCorrect ? 'A KÖZÉPSŐ ALAKZAT NEM STIMMEL' : 'AZ IRÁNY NEM STIMMEL',
          bothCorrect && !fixationBreak
        );
        await this.wait(700);
      }
      await this.wait(ctx.rng.range(700, 1300));
    }
  }

  private peripheralPosition(eccDeg: number, dirIndex: number, depth: number): THREE.Vector3 {
    const ang = (dirIndex / DIRECTIONS) * Math.PI * 2;
    // Elevation is capped well below the neck-comfort limit; the horizontal
    // component takes the remainder so the outer ring stays inside the display.
    const az = Math.sin(ang) * eccDeg;
    const el = Math.cos(ang) * eccDeg * 0.62;
    return volumePosition(az, el, depth, 1.6);
  }

  private awaitResponses(
    shape: Shape, dir: number, onsetT: number,
    head: { yaw: number; pitch: number }, durationMs: number, centralOnly = false
  ): Promise<{
    centralAnswer: Shape | null; centralCorrect: boolean;
    peripheralAnswer: number | null; peripheralCorrect: boolean; errorDirections: number;
    rtCentralMs: number | null; rtPeripheralMs: number | null; headMoveDeg: number;
  }> {
    return new Promise((resolve) => {
      const ctx = this.ctx;
      this.live = {
        phase: 'central', onsetT, centralShape: shape, centralOnly, centralAnswer: null, centralRt: null,
        directionIndex: dir, gapDirection: -1, answer: null,
        headAtOnset: head, maxHeadMove: 0,
        resolve: () => {
          const l = this.live!;
          this.live = null;
          this.dialPanel.group.visible = false;
          const answer = l.answer;
          const err = answer === null ? 4 : Math.min(
            Math.abs(answer - dir), DIRECTIONS - Math.abs(answer - dir)
          );
          resolve({
            centralAnswer: l.centralAnswer,
            centralCorrect: l.centralAnswer === shape,
            peripheralAnswer: centralOnly ? null : answer,
            // A catch trial has nothing peripheral to get right or wrong; it
            // counts as correct so it never drags the peripheral accuracy down.
            peripheralCorrect: centralOnly ? true : answer === dir,
            errorDirections: err,
            rtCentralMs: l.centralRt,
            rtPeripheralMs: answer === null ? null : ctx.engine.clock.frameTime - onsetT,
            headMoveDeg: l.maxHeadMove,
          });
        },
      };

      // Stimulus off after the staircase duration, then a mask so the estimate
      // is of perception rather than of how long the afterimage lasted.
      setTimeout(() => {
        this.peripheral.visible = false;
        this.centralCube.visible = false;
        this.centralSphere.visible = false;
        this.mask.position.copy(this.peripheral.position);
        this.mask.scale.copy(this.peripheral.scale);
        this.mask.visible = true;
        ctx.recorder.event('mask_onset', { tAfterStimulusMs: +durationMs.toFixed(1) });
        setTimeout(() => { this.mask.visible = false; }, 100);
      }, durationMs);

      setTimeout(() => {
        if (this.live) { this.live.resolve(); }
      }, durationMs + 4000);
    });
  }

  /* --------------------------------------------------------------- DVA */

  private async runDva(count: number): Promise<void> {
    const ctx = this.ctx;
    const sc = this.staircaseFor('dva');
    const rng = ctx.rng;

    for (let i = 0; i < count && !this.aborted; i++) {
      ctx.recorder.trialNumber = i + 1;
      const gap = rng.int(0, 3);
      const speed = this.practice ? 2.4 : sc.value;

      this.dvaGap.position.set(
        Math.cos((gap * Math.PI) / 2) * 0.15,
        Math.sin((gap * Math.PI) / 2) * 0.15,
        0
      );
      this.dvaGap.rotation.set(0, 0, (gap * Math.PI) / 2);

      const start = 9.0;
      const stop = 1.2;
      this.dvaRing.position.set(0, 1.6, -start);
      this.dvaRing.lookAt(0, 1.6, 0);
      this.dvaRing.visible = true;

      const onsetT = ctx.engine.clock.frameTime;
      this.setTouchPhase('gap');
      ctx.recorder.event('dva_trial_start', {
        speedMps: +speed.toFixed(2), gapDirection: gap, startM: start,
        quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
      }, onsetT);

      const res = await this.flyRing(speed, start, stop, gap, onsetT);
      this.dvaRing.visible = false;
      if (this.aborted) return;

      // Angular speed of the ring's edge at the moment of the answer - the
      // figure a dynamic-acuity result is normally quoted in.
      const d = Math.max(0.3, res.distanceM);
      const angularSpeed = (speed / d) * (180 / Math.PI);

      const rec: DvaTrial = {
        speedMps: speed, angularSpeedDegPerSec: angularSpeed,
        gapDirection: gap, answer: res.answer, correct: res.answer === gap,
        distanceAtResponseM: res.distanceM,
      };
      if (!this.practice) {
        this.dvaTrials.push(rec);
        sc.record(rec.correct);
      }

      ctx.recorder.event('dva_trial', {
        speedMps: +speed.toFixed(2), angularSpeedDegPerSec: +angularSpeed.toFixed(1),
        gapDirection: gap, answer: res.answer, correct: rec.correct,
        distanceAtResponseM: +res.distanceM.toFixed(2),
      });

      const trialRec: TrialRecord = {
        trialNumber: this.records.length + 1,
        block: 'dva',
        stimulus: { block: 'dva', approachSpeedMps: +speed.toFixed(2), gapDirection: gap, platform: ctx.platform },
        response: { gapAnswer: res.answer, gapCorrect: rec.correct, distanceAtResponseM: +res.distanceM.toFixed(2) },
        correct: res.answer === null ? null : rec.correct,
        outcome: res.answer === null ? 'timeout' : rec.correct ? 'hit' : 'miss',
        reactionTimeMs: null,
        startedAt: Math.round(onsetT),
        endedAt: Math.round(ctx.engine.clock.frameTime),
      };
      this.records.push(trialRec);
      if (!this.practice) ctx.recorder.trial(trialRec);

      if (this.practice) {
        this.showFeedback(rec.correct ? 'JÓ' : 'NEM JÓ IRÁNY', rec.correct);
        await this.wait(600);
      }
      await this.wait(rng.range(600, 1000));
    }
  }

  private flyRing(
    speed: number, start: number, stop: number, gap: number, onsetT: number
  ): Promise<{ answer: number | null; distanceM: number }> {
    return new Promise((resolve) => {
      const ctx = this.ctx;
      this.live = {
        phase: 'gap', onsetT, centralShape: 'cube', centralOnly: false, centralAnswer: null, centralRt: null,
        directionIndex: -1, gapDirection: gap, answer: null,
        headAtOnset: this.headAngles(), maxHeadMove: 0,
        resolve: () => {
          const l = this.live!;
          this.live = null;
          const dist = -this.dvaRing.position.z;
          resolve({ answer: l.answer, distanceM: dist });
        },
      };

      const travelMs = ((start - stop) / speed) * 1000;
      const step = () => {
        const l = this.live;
        if (!l || this.aborted) return;
        const el = ctx.engine.clock.frameTime - onsetT;
        const frac = clamp(el / travelMs, 0, 1);
        this.dvaRing.position.z = -(start - (start - stop) * frac);
        if (frac >= 1) { l.resolve(); return; }
        setTimeout(step, 16);
      };
      step();
    });
  }

  /* ------------------------------------------------------------- input */

  private onAction(e: ActionEvent): void {
    if (!e.down) return;
    const l = this.live;
    if (!l) return;

    if (l.phase === 'central') {
      let answer: Shape | null = null;
      if (e.action === 'PRIMARY' || e.action === 'LEFT') answer = 'cube';
      else if (e.action === 'SECONDARY' || e.action === 'RIGHT') answer = 'sphere';
      if (!answer) return;
      l.centralAnswer = answer;
      l.centralRt = e.t - l.onsetT;
      this.ctx.recorder.event('central_response', {
        answer, correct: answer === l.centralShape, rtMs: +(e.t - l.onsetT).toFixed(1),
        centralOnly: l.centralOnly,
      }, e.t);
      if (l.centralOnly) { l.resolve(); return; }
      l.phase = 'peripheral';
      this.setTouchPhase('peripheral');
      // The dial only appears after the central answer, which enforces the
      // ordering the UFOV paradigm depends on.
      // The 3D dial is redundant once the touch ring is up.
      this.dialPanel.group.visible = !this.ctx.mobileControls;
      this.dialPanel.invalidate();
      return;
    }

    if (l.phase === 'gap') {
      const map: Partial<Record<string, number>> = { PRIMARY: 0, RIGHT: 1, SECONDARY: 2, LEFT: 3 };
      const a = map[e.action];
      if (a === undefined) return;
      l.answer = a;
      this.ctx.recorder.event('gap_response', { answer: a, correct: a === l.gapDirection }, e.t);
      l.resolve();
    }
  }

  private onPanelClick(id: string, t: number): void {
    const l = this.live;
    if (!l) return;
    if (l.phase === 'peripheral' && id.startsWith('dir:')) {
      const idx = Number(id.slice(4));
      l.answer = idx;
      this.ctx.recorder.event('peripheral_response', {
        answer: idx, correct: idx === l.directionIndex,
        rtMs: +(t - l.onsetT).toFixed(1),
        errorDirections: Math.min(Math.abs(idx - l.directionIndex), DIRECTIONS - Math.abs(idx - l.directionIndex)),
      }, t);
      l.resolve();
    }
    if (l.phase === 'gap' && id.startsWith('gap:')) {
      const idx = Number(id.slice(4));
      l.answer = idx;
      l.resolve();
    }
  }

  /* ------------------------------------------------------------ update */

  update(dt: number, ctx: ModuleContext): void {
    this.tumbler.update(dt);
    const l = this.live;
    if (!l) return;
    // Head movement is tracked continuously, not only at the response: a
    // glance that returns to centre before answering would otherwise pass.
    const h = this.headAngles();
    const move = Math.hypot(h.yaw - l.headAtOnset.yaw, h.pitch - l.headAtOnset.pitch);
    if (move > l.maxHeadMove) l.maxHeadMove = move;
    void ctx;
  }

  private headAngles(): { yaw: number; pitch: number } {
    const q = new THREE.Quaternion();
    this.ctx.engine.camera.getWorldQuaternion(q);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    return { yaw: THREE.MathUtils.radToDeg(e.y), pitch: THREE.MathUtils.radToDeg(e.x) };
  }

  private showDistractors(n: number): void {
    const eccs = this.eccentricities();
    for (let i = 0; i < this.distractors.length; i++) {
      const d = this.distractors[i]!;
      d.visible = i < n;
      if (!d.visible) continue;
      const ecc = eccs[i % eccs.length]! * this.ctx.rng.range(0.85, 1.15);
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + this.ctx.rng.range(-0.2, 0.2);
      d.position.copy(volumePosition(Math.sin(ang) * ecc, Math.cos(ang) * ecc * 0.62, NEAR_DEPTH, 1.6));
      d.lookAt(0, 1.6, 0);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private setFeedback(text: string, kind: 'ok' | 'bad' | 'neutral'): void {
    this.feedbackText = text;
    this.feedbackKind = kind;
    this.feedbackPanel.invalidate();
  }

  private feedbackText = '';
  private feedbackKind: 'ok' | 'bad' | 'neutral' = 'neutral';

  private showFeedback(text: string, ok: boolean): void {
    this.setFeedback(text, ok ? 'ok' : 'bad');
    this.feedbackPanel.group.visible = true;
    setTimeout(() => { this.feedbackPanel.group.visible = false; }, 650);
  }

  /* ---------------------------------------------------------- drawing */

  private drawDial(ui: UI): void {
    const t = ui.t;
    const cx = ui.w / 2;
    const cy = ui.h / 2;
    const r = Math.min(cx, cy) - 34;
    ui.background('rgba(0,0,0,0)', 0);
    ui.circle(cx, cy, 16, withAlpha(t.accent, 0.8));

    if (this.live?.phase === 'gap') {
      const labels = ['FENT', 'JOBB', 'LENT', 'BAL'];
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r - 52;
        const y = cy + Math.sin(a) * r - 22;
        ui.button(`gap:${i}`, x, y, 104, 44, { label: labels[i]!, variant: 'ghost', fontSize: 20 });
      }
      return;
    }

    for (let i = 0; i < DIRECTIONS; i++) {
      const a = (i / DIRECTIONS) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r - 30;
      const y = cy + Math.sin(a) * r - 30;
      ui.button(`dir:${i}`, x, y, 60, 60, { label: '', variant: 'ghost', fontSize: 16 });
      ui.circle(x + 30, y + 30, 9, withAlpha(t.accent2, 0.85));
    }
    ui.label('MERRE VILLANT?', cx, cy - 8, t.textMuted, 16, 'center');
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.9), 16);
    const color = this.feedbackKind === 'ok' ? t.ok : this.feedbackKind === 'bad' ? t.bad : t.text;
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2 + 10, { size: 26, color, align: 'center', weight: '600' });
  }

  private pushRecord(rec: FieldTrial, n: number): void {
    const outcome = rec.fixationBreak ? 'invalid'
      : rec.peripheralAnswer === null ? 'timeout'
      : rec.centralCorrect && rec.peripheralCorrect ? 'hit'
      : rec.centralCorrect ? 'miss' : 'false_alarm';
    const now = this.ctx.engine.clock.frameTime;
    const trialRec: TrialRecord = {
      trialNumber: n,
      block: rec.block,
      stimulus: {
        block: rec.block, durationMs: +rec.durationMs.toFixed(2), frames: rec.frames,
        eccentricityDeg: rec.eccentricityDeg, directionIndex: rec.directionIndex,
        depthM: rec.depthM, centralShape: rec.centralShape,
        distractorCount: rec.block === 'cluttered' ? 24 : 0,
        centralOnly: rec.centralOnly,
        platform: this.ctx.platform,
      },
      response: {
        centralAnswer: rec.centralAnswer, centralCorrect: rec.centralCorrect,
        peripheralAnswer: rec.peripheralAnswer, peripheralCorrect: rec.peripheralCorrect,
        errorDirections: rec.errorDirections,
        rtCentralMs: rec.rtCentralMs === null ? null : +rec.rtCentralMs.toFixed(1),
        rtPeripheralMs: rec.rtPeripheralMs === null ? null : +rec.rtPeripheralMs.toFixed(1),
        headMoveDeg: +rec.headMoveDeg.toFixed(2), fixationBreak: rec.fixationBreak,
      },
      correct: rec.fixationBreak ? null : rec.centralCorrect && rec.peripheralCorrect,
      outcome,
      reactionTimeMs: rec.rtPeripheralMs === null ? null : Math.round(rec.rtPeripheralMs),
      startedAt: Math.round(now - (rec.rtPeripheralMs ?? 0)),
      endedAt: Math.round(now),
    };
    this.records.push(trialRec);
    this.ctx.recorder.trial(trialRec);
  }

  /* ------------------------------------------------------------ finish */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';
    const eccs = this.eccentricities();
    const valid = this.trials.filter((t) => !t.fixationBreak);

    const thresholdMs = this.staircases.get('threshold')?.threshold(8) ?? NaN;
    const clutteredMs = this.staircases.get('cluttered')?.threshold(8) ?? NaN;
    const distractorCost = Number.isFinite(thresholdMs) && Number.isFinite(clutteredMs)
      ? clutteredMs - thresholdMs : NaN;

    const accAt = (ecc: number) => {
      const rows = valid.filter((t) => t.eccentricityDeg === ecc && !t.centralOnly && t.block !== 'dva');
      return rows.length ? rows.filter((t) => t.peripheralCorrect).length / rows.length : NaN;
    };
    const accByEcc = eccs.map((e) => ({ x: e, y: accAt(e) }));

    // The field radius is where localisation falls to 50%. On a flat platform
    // the outer eccentricities were never presented, so this is not computed
    // at all - a radius interpolated over 16 degrees of tested range would be
    // a different quantity wearing the same name.
    const cross = isVr ? crossingPoint(accByEcc, 0.5) : { x: NaN, bounded: false };
    const fieldRadius = cross.x;

    const inner = accAt(eccs[0]!);
    const outer = accAt(eccs[eccs.length - 1]!);
    const outerRatio = Number.isFinite(inner) && inner > 0 ? outer / inner : NaN;

    // The dual-task cost: how much the central identification suffers when a
    // peripheral flash has to be localised at the same time. The catch trials
    // are the single-task baseline; without them this subtraction has no
    // second term.
    const acc = (rows: FieldTrial[]) =>
      rows.length ? rows.filter((t) => t.centralCorrect).length / rows.length : NaN;
    const dual = valid.filter((t) => !t.centralOnly);
    const single = valid.filter((t) => t.centralOnly);
    const centralAll = acc(dual);
    const centralSingle = acc(single);
    const centralCost = Number.isFinite(centralSingle) && Number.isFinite(centralAll)
      ? centralSingle - centralAll : NaN;

    const depthRows = valid.filter((t) => t.block === 'depthfield' && !t.centralOnly);
    const accDepth = (d: number) => {
      const rows = depthRows.filter((t) => Math.abs(t.depthM - d) < 0.01);
      return rows.length ? rows.filter((t) => t.peripheralCorrect).length / rows.length : NaN;
    };
    const nearAcc = accDepth(NEAR_DEPTH);
    const farAcc = accDepth(FAR_DEPTH);
    const depthFieldCost = isVr && Number.isFinite(nearAcc) && Number.isFinite(farAcc)
      ? nearAcc - farAcc : NaN;

    const dvaSpeed = this.staircases.get('dva')?.threshold(6) ?? NaN;
    const dvaDeg = this.dvaTrials.length && Number.isFinite(dvaSpeed)
      ? median(this.dvaTrials.filter((t) => t.correct).map((t) => t.angularSpeedDegPerSec))
      : NaN;

    const breaks = this.trials.length
      ? this.trials.filter((t) => t.fixationBreak).length / this.trials.length : NaN;

    const M: [string, number, string, string?][] = [
      ['ufov_threshold_ms', thresholdMs, 'ms', 'threshold'],
      ['cluttered_threshold_ms', clutteredMs, 'ms', 'cluttered'],
      ['distractor_cost', distractorCost, 'ms'],
      ['central_cost', centralCost, 'ratio'],
      ['central_accuracy_dual', centralAll, 'ratio'],
      ['central_accuracy_single', centralSingle, 'ratio'],
      ['fixation_break_rate', isVr ? breaks : NaN, 'ratio'],
      ['dva_threshold_speed_mps', dvaSpeed, 'm/s', 'dva'],
    ];
    eccs.forEach((e, i) => {
      // On a flat platform only the inner two are meaningful as "field"
      // measurements; all four are still logged because they are real data.
      M.push([`peripheral_accuracy_${isVr ? [10, 20, 35, 50][i] : e}`, accAt(e), 'ratio']);
    });
    if (isVr) {
      M.push(['field_radius_deg', fieldRadius, 'deg']);
      M.push(['field_radius_bounded', cross.bounded ? 1 : 0, 'bool']);
      M.push(['outer_field_ratio', outerRatio, 'ratio']);
      M.push(['depth_field_cost', depthFieldCost, 'ratio']);
      M.push(['depth_accuracy_near', nearAcc, 'ratio', 'depthfield']);
      M.push(['depth_accuracy_far', farAcc, 'ratio', 'depthfield']);
      M.push(['dva_threshold_dps', dvaDeg, 'deg/s', 'dva']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* -------------------------------------------------------- scores */

    const fieldSize = normaliseSoft(Number.isFinite(fieldRadius) ? fieldRadius : 18, 50, 18);
    const speedScore = normaliseSoft(
      isVr ? thresholdMs : mean([thresholdMs, clutteredMs].filter(Number.isFinite)),
      40, 220
    );
    const divided = normaliseSoft(Number.isFinite(centralCost) ? centralCost : 0.28, 0.02, 0.28);
    const acuity = normaliseSoft(Number.isFinite(dvaDeg) ? dvaDeg : 12, 60, 12);
    const depthField = normaliseSoft(Number.isFinite(depthFieldCost) ? depthFieldCost : 0.30, 0.03, 0.30);
    const clutter = normaliseSoft(Number.isFinite(distractorCost) ? distractorCost : 120, 10, 120);

    const components = isVr
      ? [
          { key: 'field_size', value: fieldSize, weight: 0.26 },
          { key: 'threshold_speed', value: speedScore, weight: 0.24 },
          { key: 'divided_attention', value: divided, weight: 0.18 },
          { key: 'dynamic_acuity', value: acuity, weight: 0.18 },
          { key: 'depth_field', value: depthField, weight: 0.14 },
        ]
      : [
          // The three spatial components are absent, not zero. The remaining
          // weights are rescaled so the score is still out of the same range.
          { key: 'threshold_speed', value: speedScore, weight: 0.44 },
          { key: 'divided_attention', value: divided, weight: 0.33 },
          { key: 'clutter_resistance', value: clutter, weight: 0.23 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : '—');

    const headline: { label: string; value: string; hint?: string }[] = [];
    if (isVr) {
      headline.push({
        label: 'Hasznos látómező sugara',
        value: Number.isFinite(fieldRadius) ? `${cross.bounded ? '' : '≥'}${Math.round(fieldRadius)}°` : '—',
        hint: cross.bounded ? 'eddig veszed észre a felvillanást' : 'a mért tartomány végén sem esett le',
      });
    }
    headline.push({ label: 'Küszöbidő', value: ms(thresholdMs), hint: 'ennyi elég a felismeréshez' });
    headline.push({
      label: 'Zsúfolt háttér ára',
      value: Number.isFinite(distractorCost) ? `+${Math.round(distractorCost)} ms` : '—',
    });
    headline.push({ label: 'Megosztott figyelem', value: pct(centralAll), hint: 'a központi feladat pontossága' });
    if (isVr) {
      headline.push({
        label: 'Mélységi mező ára',
        value: Number.isFinite(depthFieldCost) ? `−${Math.round(depthFieldCost * 100)} pont` : '—',
        hint: 'más távolságban gyengébb',
      });
      headline.push({
        label: 'Mozgó cél',
        value: Number.isFinite(dvaDeg) ? `${Math.round(dvaDeg)}°/s` : '—',
        hint: 'eddig olvasható a rés',
      });
    } else {
      headline.push({
        label: 'Külső látómező',
        value: 'headset kell',
        hint: 'a mezősugár és a mélységi alteszt kimaradt',
      });
    }

    if (isVr && Number.isFinite(breaks) && breaks > 0.25) {
      headline[headline.length - 1] = {
        label: 'FIGYELEM',
        value: `a próbák ${Math.round(breaks * 100)}%-ában elfordult a fej`,
        hint: 'a mezősugár túlbecsült lehet',
      };
    }

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        spatialWeightsApplied: isVr,
        eccentricitiesDeg: eccs,
        thresholds: {
          plainMs: r(thresholdMs), clutteredMs: r(clutteredMs), distractorCostMs: r(distractorCost),
          reversals: this.staircases.get('threshold')?.reversals.length ?? 0,
        },
        peripheral: Object.fromEntries(eccs.map((e) => [`${e}deg`, r(accAt(e), 3)])),
        fieldRadiusDeg: isVr ? r(fieldRadius, 1) : null,
        fieldRadiusBounded: isVr ? cross.bounded : null,
        depth: isVr ? { near: r(nearAcc, 3), far: r(farAcc, 3), costRatio: r(depthFieldCost, 3) } : null,
        dva: isVr ? { thresholdMps: r(dvaSpeed, 2), thresholdDps: r(dvaDeg, 1), n: this.dvaTrials.length } : null,
        fixation: { breakRate: r(breaks, 3), toleranceDeg: FIXATION_TOLERANCE_DEG },
        validTrials: valid.length,
        totalTrials: this.trials.length,
      },
      axisScores: {
        perception: Math.round((fieldSize + acuity) / 2),
        attention: Math.round(divided),
        speed: Math.round(speedScore),
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.live?.resolve();
  }

  dispose(ctx: ModuleContext): void {
    this.offAction?.();
    this.offPanel?.();
    ctx.panels.remove(this.dialPanel);
    ctx.panels.remove(this.feedbackPanel);
    this.tumbler.clear();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
