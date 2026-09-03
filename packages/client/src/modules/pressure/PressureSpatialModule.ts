import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, stdev, slope, normaliseSoft, opsScore, clamp,
  type ModuleManifest, type TrialRecord, type TrialOutcome, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { volumePosition, Tumbler } from '../shared/volume.js';

/**
 * MODULE 07 - PRESSURE, variant B
 * Spatial conflict, and what pressure does to the field of view.
 *
 * Variant A shows one object dead ahead. Nothing about it is spatial, and
 * nothing would change if it were drawn on a monitor.
 *
 * This variant is built on the Simon effect - the finding that a response is
 * slower when the stimulus appears on the side opposite to the required
 * answer, even though location is entirely irrelevant to the task. It is one
 * of the most robust effects in cognitive psychology, and it is spatial by
 * definition: it cannot exist without a stimulus having a place.
 *
 * Two extensions the flat version cannot reach:
 *
 *   DEPTH SIMON. Near and far stimuli, and near and far responses (push the
 *   controller out, pull it back). The same compatibility logic on the depth
 *   axis, which requires an axis that only exists in a headset.
 *
 *   ATTENTIONAL NARROWING. Under time pressure the useful field is known to
 *   contract. Peripheral targets at 20, 40 and 60 degrees are probed
 *   throughout, and the block compares early against late: the eccentricity at
 *   which detection collapses is the measurement. On a 65-degree monitor there
 *   is no periphery to lose.
 */

type BlockId = 'baseline' | 'simon' | 'depthsimon' | 'squeeze' | 'recovery';
type Side = 'left' | 'right';
type DepthSide = 'near' | 'far';
type Congruency = 'congruent' | 'incongruent' | 'neutral';

const CYAN = 0x22d3ee;
const MAGENTA = 0xe879f9;
const GREY = 0x8b97a8;

interface SpatialTrial {
  colorSide: Side;
  stimulusSide: Side;
  congruency: Congruency;
  azDeg: number;
  elDeg: number;
  radius: number;
}

interface DepthTrial {
  requiredDepth: DepthSide;
  stimulusDepth: DepthSide;
  congruency: Congruency;
  azDeg: number;
  elDeg: number;
}

export class PressureSpatialModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.PRESSURE!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'baseline',
      title: 'ALAPVONAL',
      instruction:
        'Színes gömbök jelennek meg körülötted. Csak a SZÍN számít: CIÁN → bal, MAGENTA → jobb. ' +
        'Az, hogy hol jelenik meg, teljesen lényegtelen. Van bőven időd.',
      controlHint: '',
      trials: 28,
      practiceTrials: 6,
    },
    {
      id: 'simon',
      title: 'HELY–VÁLASZ ÜTKÖZÉS',
      instruction:
        'Ugyanaz a szabály, de most a gömbök gyakran a válasszal ELLENTÉTES oldalon jelennek meg: ' +
        'a bal oldalon felvillanó magenta gömbre is jobbal kell válaszolnod. A helyét hagyd figyelmen kívül — ' +
        'nehezebb lesz, mint hangzik.',
      controlHint: '',
      trials: 40,
      practiceTrials: 6,
    },
    {
      id: 'depthsimon',
      title: 'MÉLYSÉGI ÜTKÖZÉS',
      instruction:
        'Most a válasz iránya előre-hátra: TOLD ELŐRE a kontrollert a távoli válaszhoz, HÚZD VISSZA a közelihez. ' +
        'A gömb hol közel, hol távol jelenik meg — és ez is ütközhet a helyes válasszal.',
      controlHint: '',
      trials: 36,
      practiceTrials: 6,
    },
    {
      id: 'squeeze',
      title: 'NYOMÁS',
      instruction:
        'Fogyni fog az idő, zavaró hangok szólnak, és látod a sorozatodat. Közben a látómeződ szélén ' +
        'is felvillannak célok — azokra is reagálj. Figyeld, meddig veszed észre őket, ahogy nő a nyomás.',
      controlHint: '',
      trials: 48,
      practiceTrials: 5,
    },
    {
      id: 'recovery',
      title: 'HELYREÁLLÁS',
      instruction:
        'Vissza az első blokk feltételeihez. Nincs hang, nincs számláló, van idő. ' +
        'Ez azt méri, elmúlt-e a nyomás hatása.',
      controlHint: '',
      trials: 24,
      practiceTrials: 0,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private stim!: THREE.Mesh;
  private peripheral!: THREE.Mesh;
  private nearMarker!: THREE.Mesh;
  private farMarker!: THREE.Mesh;
  private stakePanel!: Panel;
  private feedbackPanel!: Panel;
  private tumbler = new Tumbler();

  private currentBlock: BlockId = 'baseline';
  private practice = false;
  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;

  private streak = 0;
  private stakePoints = 0;
  private feedbackText = '';
  private distractorTimer: ReturnType<typeof setTimeout> | null = null;

  private results: {
    block: BlockId; congruency: Congruency; correct: boolean; rtMs: number | null;
    axis: 'lateral' | 'depth'; half: 0 | 1;
  }[] = [];
  private peripheralResults: { eccDeg: number; detected: boolean; rtMs: number | null; half: 0 | 1 }[] = [];

  private live: {
    requiredSide?: Side;
    requiredDepth?: DepthSide;
    onsetT: number;
    windowMs: number;
    responded: boolean;
    resolve: () => void;
    axis: 'lateral' | 'depth';
    congruency: Congruency;
    handStart?: THREE.Vector3;
  } | null = null;

  private peripheralLive: { onsetT: number; eccDeg: number; responded: boolean } | null = null;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    this.stim = makePrimitive({ kind: 'sphere', color: CYAN, unlit: true, size: 0.24 });
    this.stim.visible = false;
    this.peripheral = makePrimitive({ kind: 'sphere', color: 0xffffff, unlit: true, size: 0.16 });
    this.peripheral.visible = false;
    // Two rings mark the near and far response zones, so "push out" and "pull
    // back" are places in the world rather than instructions to remember.
    this.nearMarker = makePrimitive({ kind: 'torus', color: 0x4fc3f7, unlit: true, opacity: 0.3, size: 0.34 });
    this.farMarker = makePrimitive({ kind: 'torus', color: 0xff9e1b, unlit: true, opacity: 0.3, size: 0.34 });
    this.nearMarker.position.set(0, 1.35, -0.3);
    this.farMarker.position.set(0, 1.45, -0.85);
    this.nearMarker.visible = false;
    this.farMarker.visible = false;
    this.root.add(this.stim, this.peripheral, this.nearMarker, this.farMarker);

    this.stakePanel = new Panel({
      width: 0.66, height: 0.15, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'pressure-b-stake',
    });
    this.stakePanel.setDraw((ui) => this.drawStake(ui));
    this.stakePanel.group.visible = false;
    ctx.root.add(this.stakePanel.group);
    ctx.panels.add(this.stakePanel);

    this.feedbackPanel = new Panel({
      width: 0.7, height: 0.15, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'pressure-b-feedback',
    });
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    ctx.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);
    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
  }

  private controlHint(block: BlockId): string {
    if (block === 'depthsimon') {
      return 'TOLD ELŐRE a kontrollert a távoli (narancs) gyűrűig, vagy HÚZD VISSZA a közeliig (kék). A szín mondja meg, melyik kell.';
    }
    if (block === 'squeeze') {
      return 'CIÁN → bal ravasz, MAGENTA → jobb ravasz. A periférián felvillanó fehér gömbre bármelyik markolattal (grip) reagálj.';
    }
    return 'CIÁN → bal ravasz, MAGENTA → jobb ravasz. Az inger helye lényegtelen.';
  }

  /* -------------------------------------------------- trial generation */

  private spread(): { az: number; el: number } {
    return this.ctx.platform === 'vr' ? { az: 62, el: 22 } : { az: 24, el: 13 };
  }

  private buildLateral(count: number, withConflict: boolean, rng: Rng): SpatialTrial[] {
    const S = this.spread();
    const out: SpatialTrial[] = [];
    // Congruent trials outnumber incongruent ones. If incongruent trials were
    // in the majority the participant would start actively suppressing
    // location, and the Simon effect would disappear - which is the standard
    // reason the ratio is kept this way.
    const nCong = withConflict ? Math.round(count * 0.5) : count;
    const nIncong = withConflict ? Math.round(count * 0.34) : 0;
    const nNeutral = count - nCong - nIncong;

    const make = (congruency: Congruency): SpatialTrial => {
      const colorSide: Side = rng.bool() ? 'left' : 'right';
      const stimulusSide: Side = congruency === 'congruent' ? colorSide
        : congruency === 'incongruent' ? (colorSide === 'left' ? 'right' : 'left')
        : (rng.bool() ? 'left' : 'right');
      const magnitude = congruency === 'neutral' ? rng.range(0, 6) : rng.range(22, S.az);
      return {
        colorSide, stimulusSide, congruency,
        azDeg: (stimulusSide === 'left' ? -1 : 1) * magnitude,
        elDeg: rng.range(-S.el * 0.6, S.el),
        radius: rng.range(2.4, 3.4),
      };
    };
    for (let i = 0; i < nCong; i++) out.push(make('congruent'));
    for (let i = 0; i < nIncong; i++) out.push(make('incongruent'));
    for (let i = 0; i < nNeutral; i++) out.push(make('neutral'));
    return rng.shuffle(out);
  }

  private buildDepth(count: number, rng: Rng): DepthTrial[] {
    const S = this.spread();
    const out: DepthTrial[] = [];
    const nCong = Math.round(count * 0.5);
    const nIncong = Math.round(count * 0.34);
    const nNeutral = count - nCong - nIncong;
    const make = (congruency: Congruency): DepthTrial => {
      const requiredDepth: DepthSide = rng.bool() ? 'near' : 'far';
      const stimulusDepth: DepthSide = congruency === 'congruent' ? requiredDepth
        : congruency === 'incongruent' ? (requiredDepth === 'near' ? 'far' : 'near')
        : (rng.bool() ? 'near' : 'far');
      return {
        requiredDepth, stimulusDepth, congruency,
        azDeg: rng.range(-S.az * 0.35, S.az * 0.35),
        elDeg: rng.range(-S.el * 0.5, S.el * 0.6),
      };
    };
    for (let i = 0; i < nCong; i++) out.push(make('congruent'));
    for (let i = 0; i < nIncong; i++) out.push(make('incongruent'));
    for (let i = 0; i < nNeutral; i++) out.push(make('neutral'));
    return rng.shuffle(out);
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    this.streak = 0;
    this.stakePoints = 0;
    const isDepth = this.currentBlock === 'depthsimon';
    const isSqueeze = this.currentBlock === 'squeeze';

    this.nearMarker.visible = isDepth;
    this.farMarker.visible = isDepth;
    this.stakePanel.group.visible = isSqueeze;
    if (isSqueeze) this.scheduleDistractor();

    if (isDepth) {
      const specs = this.buildDepth(count, ctx.rng);
      for (let i = 0; i < specs.length && !this.aborted; i++) {
        ctx.recorder.trialNumber = i + 1;
        await this.wait(ctx.rng.range(500, 900));
        if (this.aborted) break;
        await this.runDepthTrial(specs[i]!, i, count);
      }
    } else {
      const withConflict = this.currentBlock === 'simon' || isSqueeze;
      const specs = this.buildLateral(count, withConflict, ctx.rng);
      for (let i = 0; i < specs.length && !this.aborted; i++) {
        ctx.recorder.trialNumber = i + 1;
        await this.wait(ctx.rng.range(450, 850));
        if (this.aborted) break;
        await this.runLateralTrial(specs[i]!, i, count, isSqueeze);
      }
    }

    this.stopDistractor();
    this.nearMarker.visible = false;
    this.farMarker.visible = false;
    this.stakePanel.group.visible = false;
    this.stim.visible = false;
    this.peripheral.visible = false;
  }

  private windowFor(index: number, count: number, squeeze: boolean): number {
    if (!squeeze) return 2000;
    return Math.max(600, 1400 - Math.round((index / Math.max(1, count)) * 800));
  }

  private runLateralTrial(spec: SpatialTrial, index: number, count: number, squeeze: boolean): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.ctx;
      const pos = volumePosition(spec.azDeg, spec.elDeg, spec.radius, 1.6);
      (this.stim.material as THREE.MeshBasicMaterial).color.setHex(
        spec.congruency === 'neutral' && spec.colorSide === 'left' ? CYAN
          : spec.colorSide === 'left' ? CYAN : MAGENTA
      );
      this.stim.position.copy(pos);
      this.stim.visible = true;
      this.tumbler.clear();
      this.tumbler.add(this.stim, ctx.rng, 0.2, 0.5);

      const windowMs = this.windowFor(index, count, squeeze);
      const onsetT = ctx.engine.clock.frameTime;
      const half: 0 | 1 = index < count / 2 ? 0 : 1;

      this.live = {
        requiredSide: spec.colorSide, onsetT, windowMs, responded: false,
        axis: 'lateral', congruency: spec.congruency,
        resolve: () => { this.live = null; this.stim.visible = false; this.tumbler.remove(this.stim); resolve(); },
      };
      this.currentHalf = half;
      ctx.audio.click();
      ctx.recorder.event('stimulus_onset', {
        block: this.currentBlock, axis: 'lateral', congruency: spec.congruency,
        colorSide: spec.colorSide, stimulusSide: spec.stimulusSide,
        azDeg: +spec.azDeg.toFixed(1), windowMs,
        quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
      }, onsetT);

      // In the pressure block a peripheral probe may accompany the central
      // task. Losing those probes as the block goes on is the narrowing effect.
      if (squeeze && index % 3 === 1) this.firePeripheral();

      setTimeout(() => {
        const l = this.live;
        if (!l || l.responded) return;
        l.responded = true;
        this.commit(null, 'timeout', false, 'lateral', spec.congruency, half);
        this.breakStreak();
        if (this.practice) this.showFeedback('LEJÁRT', false);
        l.resolve();
      }, windowMs + 30);
    });
  }

  private runDepthTrial(spec: DepthTrial, index: number, count: number): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.ctx;
      // Stimulus depth is the irrelevant dimension; the colour says which way
      // to move. Angular size is compensated so near and far look the same
      // size and only disparity distinguishes them.
      const radius = spec.stimulusDepth === 'near' ? 1.5 : 3.6;
      const pos = volumePosition(spec.azDeg, spec.elDeg, radius, 1.6);
      this.stim.position.copy(pos);
      this.stim.scale.setScalar(radius / 1.5);
      (this.stim.material as THREE.MeshBasicMaterial).color.setHex(
        spec.requiredDepth === 'near' ? CYAN : spec.congruency === 'neutral' ? GREY : MAGENTA
      );
      if (spec.congruency === 'neutral') {
        (this.stim.material as THREE.MeshBasicMaterial).color.setHex(spec.requiredDepth === 'near' ? CYAN : MAGENTA);
      }
      this.stim.visible = true;

      const onsetT = ctx.engine.clock.frameTime;
      const half: 0 | 1 = index < count / 2 ? 0 : 1;
      const hand = this.handPos();
      this.live = {
        requiredDepth: spec.requiredDepth, onsetT, windowMs: 2600, responded: false,
        axis: 'depth', congruency: spec.congruency, handStart: hand ?? undefined,
        resolve: () => { this.live = null; this.stim.visible = false; this.stim.scale.setScalar(1); resolve(); },
      };
      this.currentHalf = half;
      ctx.audio.click();
      ctx.recorder.event('stimulus_onset', {
        block: 'depthsimon', axis: 'depth', congruency: spec.congruency,
        requiredDepth: spec.requiredDepth, stimulusDepth: spec.stimulusDepth,
        quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
      }, onsetT);

      // The response is a push or a pull, detected from controller travel
      // along the line of sight.
      const poll = () => {
        const l = this.live;
        if (!l || l.responded) return;
        const now = ctx.engine.clock.frameTime;
        const h = this.handPos();
        if (h && l.handStart) {
          const eye = new THREE.Vector3();
          ctx.engine.camera.getWorldPosition(eye);
          const q = new THREE.Quaternion();
          ctx.engine.camera.getWorldQuaternion(q);
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
          const travel = h.clone().sub(l.handStart).dot(fwd);
          if (Math.abs(travel) > 0.18) {
            const chosen: DepthSide = travel > 0 ? 'far' : 'near';
            const correct = chosen === spec.requiredDepth;
            l.responded = true;
            this.commit(now - onsetT, correct ? 'hit' : 'false_alarm', correct, 'depth', spec.congruency, half, { chosen });
            correct ? this.streak++ : this.breakStreak();
            ctx.engine.input.pulse('both', correct ? 0.3 : 0.6, correct ? 25 : 70);
            if (this.practice) this.showFeedback(correct ? `${Math.round(now - onsetT)} ms` : 'ROSSZ IRÁNY', correct);
            l.resolve();
            return;
          }
        }
        if (now - onsetT > l.windowMs) {
          l.responded = true;
          this.commit(null, 'timeout', false, 'depth', spec.congruency, half);
          this.breakStreak();
          if (this.practice) this.showFeedback('LEJÁRT', false);
          l.resolve();
          return;
        }
        setTimeout(poll, 16);
      };
      poll();
    });
  }

  private currentHalf: 0 | 1 = 0;

  private handPos(): THREE.Vector3 | null {
    const p = this.ctx.engine.input.pointers.find((x) => x.active && (x.id === 'left' || x.id === 'right'));
    return p?.object3D ? p.object3D.getWorldPosition(new THREE.Vector3()) : null;
  }

  /* ------------------------------------------- peripheral probes */

  private firePeripheral(): void {
    const ctx = this.ctx;
    // Three eccentricities. The one that stops being detected as pressure
    // rises is the measurement; a 65-degree monitor has no 60-degree periphery
    // to lose, which is why this is a VR-only block.
    const eccs = ctx.platform === 'vr' ? [20, 40, 60] : [12, 18, 24];
    const ecc = eccs[ctx.rng.int(0, eccs.length - 1)]!;
    const angle = ctx.rng.range(0, Math.PI * 2);
    const az = Math.cos(angle) * ecc;
    const el = Math.sin(angle) * ecc * 0.55;
    this.peripheral.position.copy(volumePosition(az, el, 3.0, 1.6));
    this.peripheral.visible = true;
    const onsetT = ctx.engine.clock.frameTime;
    this.peripheralLive = { onsetT, eccDeg: ecc, responded: false };
    ctx.recorder.event('peripheral_probe', { eccentricityDeg: ecc, half: this.currentHalf }, onsetT);

    setTimeout(() => { this.peripheral.visible = false; }, 260);
    setTimeout(() => {
      const p = this.peripheralLive;
      if (!p || p.responded) return;
      this.peripheralLive = null;
      if (!this.practice) this.peripheralResults.push({ eccDeg: ecc, detected: false, rtMs: null, half: this.currentHalf });
      ctx.recorder.event('peripheral_miss', { eccentricityDeg: ecc, half: this.currentHalf });
    }, 1100);
  }

  /* ------------------------------------------------------------ input */

  private onAction(e: ActionEvent): void {
    if (!e.down) return;

    // The peripheral probe answers on the grip, so it never competes with the
    // central left/right response.
    if (e.action === 'SECONDARY') {
      const p = this.peripheralLive;
      if (p && !p.responded) {
        p.responded = true;
        this.peripheralLive = null;
        const rt = e.t - p.onsetT;
        if (!this.practice) this.peripheralResults.push({ eccDeg: p.eccDeg, detected: true, rtMs: rt, half: this.currentHalf });
        this.ctx.recorder.event('peripheral_response', { rtMs: +rt.toFixed(1), eccentricityDeg: p.eccDeg }, e.t);
        this.ctx.audio.click();
      }
      return;
    }

    const l = this.live;
    if (!l || l.responded || l.axis !== 'lateral') return;
    if (e.action !== 'LEFT' && e.action !== 'RIGHT') return;
    const chosen: Side = e.action === 'LEFT' ? 'left' : 'right';
    const correct = chosen === l.requiredSide;
    l.responded = true;
    const rt = e.t - l.onsetT;
    this.commit(rt, correct ? 'hit' : 'false_alarm', correct, 'lateral', l.congruency, this.currentHalf, { chosen });
    if (correct) { this.streak++; this.stakePoints += 10 + this.streak * 2; } else this.breakStreak();
    this.ctx.engine.input.pulse(e.hand === 'none' ? 'both' : e.hand, correct ? 0.28 : 0.6, correct ? 22 : 70);
    if (this.practice) this.showFeedback(correct ? `${Math.round(rt)} ms` : 'HIBÁS', correct);
    if (this.currentBlock === 'squeeze') this.stakePanel.invalidate();
    l.resolve();
  }

  private breakStreak(): void {
    this.streak = 0;
    if (this.currentBlock === 'squeeze') this.stakePanel.invalidate();
  }

  private commit(
    rtMs: number | null, outcome: TrialOutcome, correct: boolean,
    axis: 'lateral' | 'depth', congruency: Congruency, half: 0 | 1,
    extra: Record<string, unknown> = {}
  ): void {
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block: this.currentBlock,
      stimulus: {
        kind: 'pressure_spatial', block: this.currentBlock, axis, congruency,
        half, variant: 'B', platform: this.ctx.platform, practice: this.practice,
      },
      response: { ...extra, rtMs },
      correct, outcome,
      reactionTimeMs: rtMs === null ? null : +rtMs.toFixed(1),
      startedAt: 0, endedAt: 0,
    };
    this.ctx.recorder.trial(rec);
    if (!this.practice) {
      this.trials.push(rec);
      this.results.push({ block: this.currentBlock, congruency, correct, rtMs, axis, half });
    }
  }

  /* -------------------------------------------------------- distractor */

  private scheduleDistractor(): void {
    if (this.aborted || this.currentBlock !== 'squeeze') return;
    this.distractorTimer = setTimeout(() => {
      if (this.aborted || this.currentBlock !== 'squeeze') return;
      const since = this.live ? this.ctx.engine.clock.frameTime - this.live.onsetT : 9999;
      if (Math.abs(since) > 250) {
        this.ctx.audio.tone({
          freq: this.ctx.rng.range(200, 1600),
          durationMs: this.ctx.rng.range(90, 160), gain: 0.12, shape: 'triangle',
        });
      }
      this.scheduleDistractor();
    }, this.ctx.rng.range(900, 2600));
  }

  private stopDistractor(): void {
    if (this.distractorTimer) clearTimeout(this.distractorTimer);
    this.distractorTimer = null;
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.tumbler.update(dt);
    // The stake and feedback panels follow the head, because the participant
    // is expected to be turning toward stimuli all over the field.
    if (this.stakePanel.group.visible || this.feedbackPanel.group.visible) {
      const cam = ctx.engine.camera;
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      cam.getWorldPosition(p);
      cam.getWorldQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      fwd.y = 0;
      fwd.normalize();
      this.stakePanel.group.position.copy(p).addScaledVector(fwd, 1.8);
      this.stakePanel.group.position.y = 1.06;
      this.stakePanel.group.lookAt(p);
      this.feedbackPanel.group.position.copy(p).addScaledVector(fwd, 1.7);
      this.feedbackPanel.group.position.y = 1.22;
      this.feedbackPanel.group.lookAt(p);
    }
  }

  /* --------------------------------------------------------------- UI */

  private showFeedback(text: string, good: boolean): void {
    this.feedbackText = text;
    this.feedbackGood = good;
    this.feedbackPanel.group.visible = true;
    this.feedbackPanel.invalidate();
    setTimeout(() => { this.feedbackPanel.group.visible = false; }, 500);
  }

  private feedbackGood = true;

  private drawStake(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.55));
    ui.label('SOROZAT', 20, ui.h / 2 - 14, t.textMuted, 13);
    ui.text(String(this.streak), 20, ui.h / 2 + 16, {
      size: 28, color: this.streak >= 5 ? t.ok : t.text, weight: '700', font: t.fontDisplay,
    });
    ui.label('KOCKÁN', ui.w - 20, ui.h / 2 - 14, t.textMuted, 13, 'right');
    ui.text(String(this.stakePoints), ui.w - 20, ui.h / 2 + 16, {
      size: 28, color: t.accent, align: 'right', weight: '700', font: t.fontDisplay,
    });
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.5));
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 30, color: this.feedbackGood ? t.ok : t.bad, align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';
    const inBlock = (b: BlockId) => this.results.filter((r) => r.block === b);
    const rts = (l: typeof this.results) => l.filter((r) => r.correct && r.rtMs !== null).map((r) => r.rtMs!);
    const acc = (l: typeof this.results) => (l.length ? l.filter((r) => r.correct).length / l.length : NaN);

    const baseline = inBlock('baseline');
    const simon = inBlock('simon');
    const depth = inBlock('depthsimon');
    const squeeze = inBlock('squeeze');
    const recovery = inBlock('recovery');

    const baselineAcc = acc(baseline);
    const baselineRt = median(rts(baseline));

    /* --- the Simon effect ---------------------------------------------- */
    const simonPool = [...simon, ...squeeze];
    const cong = simonPool.filter((r) => r.congruency === 'congruent');
    const incong = simonPool.filter((r) => r.congruency === 'incongruent');
    const simonEffect = median(rts(incong)) - median(rts(cong));
    const simonAccCost = acc(cong) - acc(incong);

    /* --- the depth Simon ------------------------------------------------ */
    const dCong = depth.filter((r) => r.congruency === 'congruent');
    const dIncong = depth.filter((r) => r.congruency === 'incongruent');
    const depthSimonEffect = median(rts(dIncong)) - median(rts(dCong));
    const depthSimonAccCost = acc(dCong) - acc(dIncong);
    const depthRt = median(rts(depth));

    /* --- attentional narrowing ------------------------------------------ */
    // The flagship measure. Peripheral detection is compared between the first
    // and second half of the pressure block, per eccentricity. A field that
    // contracts under load shows up as loss concentrated at the far ring.
    const periphAt = (ecc: number, half?: 0 | 1) => {
      const sub = this.peripheralResults.filter((p) => p.eccDeg === ecc && (half === undefined || p.half === half));
      return sub.length ? sub.filter((p) => p.detected).length / sub.length : NaN;
    };
    const eccs = [...new Set(this.peripheralResults.map((p) => p.eccDeg))].sort((a, b) => a - b);
    const early = eccs.map((e) => periphAt(e, 0));
    const late = eccs.map((e) => periphAt(e, 1));
    const narrowingByEcc = eccs.map((e, i) => ({
      ecc: e,
      early: early[i]!,
      late: late[i]!,
      loss: Number.isFinite(early[i]!) && Number.isFinite(late[i]!) ? early[i]! - late[i]! : NaN,
    }));
    // A positive slope of loss against eccentricity means the outer field is
    // what gets given up - the signature of narrowing rather than of a uniform
    // drop in effort.
    const usable = narrowingByEcc.filter((n) => Number.isFinite(n.loss));
    const narrowingSlope = usable.length >= 2
      ? slope(usable.map((n) => n.ecc), usable.map((n) => n.loss)) : NaN;
    const outerLoss = usable.length ? usable[usable.length - 1]!.loss : NaN;
    const periphOverall = this.peripheralResults.length
      ? this.peripheralResults.filter((p) => p.detected).length / this.peripheralResults.length : NaN;
    const periphRt = median(this.peripheralResults.filter((p) => p.detected && p.rtMs !== null).map((p) => p.rtMs!));

    /* --- pressure contrasts ---------------------------------------------- */
    const squeezeAcc = acc(squeeze);
    const recoveryAcc = acc(recovery);
    const pressureDecrement = Number.isFinite(baselineAcc) && Number.isFinite(squeezeAcc) ? baselineAcc - squeezeAcc : NaN;
    const recoveryIndex = Number.isFinite(baselineAcc) && Number.isFinite(recoveryAcc) ? recoveryAcc - baselineAcc : NaN;
    const blockAccs = [baselineAcc, acc(simon), acc(depth), squeezeAcc, recoveryAcc].filter(Number.isFinite);
    const stability = blockAccs.length > 1 && mean(blockAccs) > 0
      ? clamp(1 - stdev(blockAccs) / mean(blockAccs), 0, 1) : NaN;

    const M: [string, number, string, string?][] = [
      ['baseline_accuracy', baselineAcc, 'ratio', 'baseline'],
      ['baseline_rt', baselineRt, 'ms', 'baseline'],
      ['simon_effect', simonEffect, 'ms', 'simon'],
      ['simon_accuracy_cost', simonAccCost, 'ratio', 'simon'],
      ['depth_simon_effect', depthSimonEffect, 'ms', 'depthsimon'],
      ['depth_simon_accuracy_cost', depthSimonAccCost, 'ratio', 'depthsimon'],
      ['depth_response_rt', depthRt, 'ms', 'depthsimon'],
      ['accuracy_under_load', squeezeAcc, 'ratio', 'squeeze'],
      ['pressure_decrement', pressureDecrement, 'ratio'],
      ['recovery_accuracy', recoveryAcc, 'ratio', 'recovery'],
      ['recovery_index', recoveryIndex, 'ratio'],
      ['attentional_narrowing_slope', narrowingSlope, 'ratio/deg'],
      ['peripheral_outer_loss', outerLoss, 'ratio'],
      ['peripheral_hit_rate', periphOverall, 'ratio'],
      ['peripheral_rt', periphRt, 'ms'],
      ['stability', stability, 'ratio'],
    ];
    eccs.forEach((e, i) => {
      M.push([`peripheral_hit_${e}_early`, early[i]!, 'ratio']);
      M.push([`peripheral_hit_${e}_late`, late[i]!, 'ratio']);
    });
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* -------------------------------------------------------- scores */

    const loadAccuracy = normaliseSoft(squeezeAcc, 0.95, 0.55);
    const resilience = normaliseSoft(Number.isFinite(pressureDecrement) ? pressureDecrement : 0.35, 0, 0.35);
    const recoveryScore = normaliseSoft(Number.isFinite(recoveryIndex) ? Math.min(0, recoveryIndex) : -0.25, 0, -0.25);
    const simonControl = normaliseSoft(simonEffect, 15, 130);
    const depthControl = normaliseSoft(depthSimonEffect, 20, 180);
    // Field stability: no extra loss at the outer ring under pressure.
    const fieldStability = isVr
      ? normaliseSoft(Number.isFinite(narrowingSlope) ? narrowingSlope : 0.012, 0, 0.012)
      : 0;

    const ops = opsScore([
      { key: 'accuracy_under_load', value: loadAccuracy, weight: 0.22 },
      { key: 'pressure_resilience', value: resilience, weight: 0.20 },
      { key: 'spatial_interference_control', value: simonControl, weight: 0.16 },
      { key: 'field_stability', value: fieldStability, weight: isVr ? 0.16 : 0 },
      { key: 'depth_interference_control', value: depthControl, weight: 0.14 },
      { key: 'recovery', value: recoveryScore, weight: 0.12 },
    ]);

    rec.score('accuracy_under_load', loadAccuracy, '1.0.0');
    rec.score('pressure_resilience', resilience, '1.0.0');
    rec.score('spatial_interference_control', simonControl, '1.0.0');
    if (isVr) rec.score('field_stability', fieldStability, '1.0.0');
    rec.score('depth_interference_control', depthControl, '1.0.0');
    rec.score('recovery', recoveryScore, '1.0.0');

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const pts = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '' : '−'}${Math.abs(Math.round(v * 100))} pont` : '—');
    const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : '—');

    const headline = [
      { label: 'Simon-hatás (hely)', value: ms(simonEffect), hint: `pontosságköltség ${pts(simonAccCost)}` },
      { label: 'Mélységi Simon-hatás', value: ms(depthSimonEffect) },
      { label: 'Pontosság nyomás alatt', value: pct(squeezeAcc), hint: `alapvonal ${pct(baselineAcc)}` },
      { label: 'Nyomás alatti romlás', value: pts(pressureDecrement) },
      { label: 'Helyreállás', value: pts(recoveryIndex) },
    ];
    headline.push(isVr
      ? {
          label: 'Látómező-szűkülés',
          value: Number.isFinite(outerLoss) ? pts(outerLoss) : '—',
          hint: Number.isFinite(narrowingSlope) && narrowingSlope > 0.004 ? 'a periféria esik ki előbb' : 'a mező stabil',
        }
      : { label: 'Látómező-szűkülés', value: 'VR szükséges', hint: 'síkon nincs mit elveszíteni' });

    return {
      opsScore: ops,
      headline,
      summary: {
        variant: 'B',
        baseline: { accuracy: r(baselineAcc, 3), rtMs: r(baselineRt) },
        simon: { effectMs: r(simonEffect), accuracyCost: r(simonAccCost, 3) },
        depthSimon: { effectMs: r(depthSimonEffect), accuracyCost: r(depthSimonAccCost, 3), rtMs: r(depthRt) },
        pressure: { accuracy: r(squeezeAcc, 3), decrement: r(pressureDecrement, 3) },
        recovery: { accuracy: r(recoveryAcc, 3), index: r(recoveryIndex, 3) },
        narrowing: isVr ? {
          byEccentricity: narrowingByEcc.map((n) => ({
            eccDeg: n.ecc, early: r(n.early, 3), late: r(n.late, 3), loss: r(n.loss, 3),
          })),
          slope: r(narrowingSlope, 5), outerLoss: r(outerLoss, 3),
          overallHitRate: r(periphOverall, 3), rtMs: r(periphRt),
        } : { available: false, reason: 'flat_platform' },
        stability: r(stability, 3),
        platform: ctx.platform,
        spatialWeightsApplied: isVr,
        trialsScored: this.trials.length,
      },
      axisScores: {
        cognitive_control: (simonControl + depthControl) / 2,
        workload: (loadAccuracy + resilience) / 2,
        attention: isVr ? fieldStability : loadAccuracy,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.stopDistractor();
    this.live?.resolve();
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.abort();
    this.tumbler.clear();
    ctx.panels.remove(this.stakePanel);
    ctx.panels.remove(this.feedbackPanel);
    this.stakePanel.dispose();
    this.feedbackPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
