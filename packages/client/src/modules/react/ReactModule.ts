import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mad, mean, stdev, percentile, normaliseSoft, opsScore, slope, clamp,
  type ModuleManifest, type TrialRecord, type TrialOutcome,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { TrialMachine } from '../../engine/task/TrialMachine.js';
import { makePrimitive, makeLabel, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';

/**
 * MODULE 04 - REACT
 * Reaction time and psychomotor control.
 *
 * Five blocks, each isolating one layer of the sensorimotor chain:
 *
 *   1 SIMPLE   one stimulus, one response. Pure detection + motor latency.
 *              Long, unpredictable ISIs, PVT style, because the interesting
 *              number is not the mean but the variability and the lapse count.
 *   2 CHOICE   two stimuli, two responses. Adds a decision stage; the
 *              difference from block 1 is the decision cost.
 *   3 POINT    a target appears off-axis and must be acquired. Separates
 *              movement initiation from movement execution and endpoint error.
 *   4 TRACK    continuous pursuit of a moving target. Closed-loop control
 *              rather than discrete responses.
 *   5 TWOHAND  independent left / right targets, sometimes simultaneous.
 *              Bimanual coordination and hand asymmetry.
 *
 * Cross-platform note: blocks 1, 2 and 5 are directly comparable across VR,
 * mouse and touch. Blocks 3 and 4 are not - a controller ray, a mouse and a
 * finger have different control dynamics - so their scores are stored but the
 * leaderboard only compares them within a device class.
 */

type BlockId = 'simple' | 'choice' | 'point' | 'track' | 'twohand';

interface PendingTrial {
  block: BlockId;
  index: number;
  onsetT: number | null;
  onsetQuantMs: number;
  responded: boolean;
  falseStart: boolean;
  /** choice / twohand: which side the stimulus demanded */
  side: 'left' | 'right' | 'both' | null;
  /** point: world position of the target */
  targetPos: THREE.Vector3 | null;
  /** point: angular size of the target, degrees */
  targetAngle: number;
  /** point: index of difficulty, log2(2A/W) */
  fittsId: number;
  stimulus: Record<string, unknown>;
}

const DIM = 0x2b3646;

export class ReactModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.REACT!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'simple',
      title: 'EGYSZERŰ REAKCIÓ',
      instruction:
        'Egyetlen gömb van előtted. Amikor felvillan, reagálj a lehető leggyorsabban. ' +
        'Ne találgass: a korai válasz hibának számít. A várakozási idő szándékosan kiszámíthatatlan.',
      controlHint: '',
      trials: 24,
      practiceTrials: 5,
    },
    {
      id: 'choice',
      title: 'VÁLASZTÁSOS REAKCIÓ',
      instruction:
        'A gömb két szín egyikében villan fel. PIROS esetén a bal, KÉK esetén a jobb oldali válasz kell. ' +
        'A pontosság fontosabb, mint a sebesség — de mindkettőt mérjük.',
      controlHint: '',
      trials: 28,
      practiceTrials: 6,
    },
    {
      id: 'point',
      title: 'CÉLRA MUTATÁS',
      instruction:
        'A célgyűrű véletlenszerű helyen jelenik meg körülötted. Vidd rá a mutatót, és erősítsd meg. ' +
        'Külön mérjük, mikor indult meg a mozdulat, meddig tartott, és mennyire pontosan ért célba.',
      controlHint: '',
      trials: 20,
      practiceTrials: 4,
    },
    {
      id: 'track',
      title: 'FOLYAMATOS KÖVETÉS',
      instruction:
        'A gömb folyamatosan mozog. Tartsd rajta a mutatót, amíg csak tudod. ' +
        'Nem kell semmit megnyomni — a mérés folyamatos, a célon töltött idő és az eltérés számít.',
      controlHint: '',
      trials: 3,
      practiceTrials: 1,
    },
    {
      id: 'twohand',
      title: 'KÉT KÉZ',
      instruction:
        'Két gömb: bal és jobb. Amelyik felvillan, azon az oldalon kell reagálni. ' +
        'Néha mindkettő egyszerre villan — ilyenkor mindkét oldalon reagálj.',
      controlHint: '',
      trials: 26,
      practiceTrials: 6,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private centre!: THREE.Mesh;
  private leftTarget!: THREE.Mesh;
  private rightTarget!: THREE.Mesh;
  private pointTarget!: THREE.Group;
  private pointRing!: THREE.Mesh;
  private trackTarget!: THREE.Mesh;
  private feedbackPanel!: Panel;
  private hintSprite: THREE.Sprite | null = null;

  private machine: TrialMachine | null = null;
  private pending: PendingTrial | null = null;
  private offInput: (() => void) | null = null;
  private trials: TrialRecord[] = [];
  private practice = false;
  private feedbackText = '';
  private blockResolve: (() => void) | null = null;
  private currentBlock: BlockId = 'simple';

  /** Ray-tracking state for the pointing and tracking blocks. */
  private lastRayDir = new THREE.Vector3(0, 0, -1);
  private rayPathDeg = 0;
  private movementStartedAt: number | null = null;
  private onTargetSinceT: number | null = null;

  /** Tracking block accumulators. */
  private trackErrors: number[] = [];
  private trackOnTargetMs = 0;
  private trackTotalMs = 0;
  private trackTrialStats: { rms: number; onTarget: number; lag: number }[] = [];
  private trackSamples: { t: number; err: number }[] = [];

  /** Twohand accumulators. */
  private twoHandPending: { left: number | null; right: number | null } = { left: null, right: null };

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    const accent = new THREE.Color(ctx.theme.accent);

    this.centre = makePrimitive({ kind: 'sphere', color: DIM, unlit: true, size: 0.28 });
    this.centre.position.set(0, 1.6, -2.2);
    this.root.add(this.centre);

    const sideOffset = ctx.platform === 'vr' ? 0.62 : 0.5;
    this.leftTarget = makePrimitive({ kind: 'sphere', color: DIM, unlit: true, size: 0.24 });
    this.leftTarget.position.set(-sideOffset, 1.6, -2.2);
    this.leftTarget.visible = false;
    this.root.add(this.leftTarget);

    this.rightTarget = makePrimitive({ kind: 'sphere', color: DIM, unlit: true, size: 0.24 });
    this.rightTarget.position.set(sideOffset, 1.6, -2.2);
    this.rightTarget.visible = false;
    this.root.add(this.rightTarget);

    // Pointing target: a ring plus a core, so the participant can see both the
    // acceptance area and the exact centre they are being scored against.
    this.pointTarget = new THREE.Group();
    this.pointRing = makePrimitive({
      kind: 'ring', color: accent, unlit: true, size: 0.3, doubleSided: true, opacity: 0.85,
    });
    const core = makePrimitive({ kind: 'sphere', color: accent, unlit: true, size: 0.055 });
    this.pointTarget.add(this.pointRing, core);
    this.pointTarget.visible = false;
    this.root.add(this.pointTarget);

    this.trackTarget = makePrimitive({ kind: 'sphere', color: accent, unlit: true, size: 0.2 });
    this.trackTarget.visible = false;
    this.root.add(this.trackTarget);

    // A small feedback surface below the stimulus - only ever used in practice.
    this.feedbackPanel = new Panel({
      width: 0.9, height: 0.22, pxPerMeter: 900, theme: ctx.theme, frame: false, name: 'react-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.15, ctx.platform === 'vr' ? -2.05 : -1.7);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    // Fill in platform-specific control hints now that we know the platform.
    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
  }

  /**
   * Stimulus geometry per platform. VR gets the full field; a flat viewport
   * gets a spread that actually fits on screen, with slightly larger targets
   * because a mouse or a finger has less angular precision than a tracked
   * controller held at arm's length.
   */
  private pointGeometry(): { az: number; elUp: number; elDown: number; widths: number[] } {
    switch (this.ctx.platform) {
      case 'vr':
        return { az: 42, elUp: 20, elDown: 16, widths: [3.2, 4.6, 6.4] };
      case 'mobile':
        return { az: 20, elUp: 12, elDown: 10, widths: [5.0, 6.5, 8.5] };
      default:
        return { az: 26, elUp: 14, elDown: 12, widths: [3.6, 5.2, 7.0] };
    }
  }

  /** The single place where "how do I respond" is translated per platform. */
  private controlHint(block: BlockId): string {
    const p = this.ctx.platform;
    switch (block) {
      case 'simple':
        return p === 'vr'
          ? 'Húzd meg bármelyik ravaszt, amint a gömb felvillan.'
          : p === 'mobile'
            ? 'Koppints bárhol a képernyőn, amint a gömb felvillan.'
            : 'Kattints vagy nyomd meg a SZÓKÖZT, amint a gömb felvillan.';
      case 'choice':
        return p === 'vr'
          ? 'PIROS → bal ravasz, KÉK → jobb ravasz.'
          : p === 'mobile'
            ? 'PIROS → koppints a képernyő bal harmadára, KÉK → a jobb harmadára.'
            : 'PIROS → F billentyű vagy balra nyíl, KÉK → J billentyű vagy jobbra nyíl.';
      case 'point':
        return p === 'vr'
          ? 'Irányítsd a kontroller sugarát a gyűrű közepére, majd húzd meg a ravaszt.'
          : p === 'mobile'
            ? 'Koppints közvetlenül a gyűrű közepére. Egy koppintás, egy próba.'
            : 'Vidd az egeret a gyűrű közepére és kattints.';
      case 'track':
        return p === 'vr'
          ? 'Tartsd a kontroller sugarát a mozgó gömbön. Nem kell gombot nyomni.'
          : p === 'mobile'
            ? 'Tartsd az ujjad a képernyőn és kövesd a gömböt. Ha felemeled, a mérés szünetel.'
            : 'Kövesd a gömböt az egérrel. Nem kell kattintani.';
      case 'twohand':
        return p === 'vr'
          ? 'Bal gömb → bal ravasz, jobb gömb → jobb ravasz. Ha mindkettő villan, mindkettőt.'
          : p === 'mobile'
            ? 'Bal gömb → bal képernyőharmad, jobb gömb → jobb harmad. Ha mindkettő villan, két ujjal.'
            : 'Bal gömb → F billentyű, jobb gömb → J billentyű. Ha mindkettő villan, mindkettőt.';
    }
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    this.resetVisuals();
    const count = practice ? block.practiceTrials : block.trials;

    if (this.currentBlock === 'track') {
      await this.runTrackingBlock(count);
      return;
    }

    await new Promise<void>((resolve) => {
      this.blockResolve = resolve;
      this.machine = new TrialMachine(ctx.engine.clock, {
        trialCount: count,
        duration: (phase) => this.phaseDuration(phase),
        onEnter: (phase, trial, t) => this.onPhaseEnter(phase, trial, t),
        onExit: (phase, trial, t) => this.onPhaseExit(phase, trial, t),
        onComplete: () => {
          this.machine = null;
          this.resetVisuals();
          resolve();
        },
      });
      this.machine.start();
    });
    this.blockResolve = null;
  }

  private phaseDuration(phase: string): number | null {
    const b = this.currentBlock;
    switch (phase) {
      case 'prepare':
        // Unpredictable foreperiod. An exponential-ish draw removes the
        // "it must be about now" strategy that a uniform ISI invites.
        return b === 'point' ? this.ctx.rng.isi(700, 1600) : this.ctx.rng.isi(1400, 4200);
      case 'countdown':
        return 0;
      case 'stimulus':
        return b === 'point' ? 4000 : b === 'twohand' ? 1800 : 1500;
      case 'response_window':
        return 0;
      case 'response':
        return 0;
      case 'feedback':
        return this.practice ? 700 : 0;
      case 'inter_trial':
        return this.practice ? 250 : 380;
      default:
        return 0;
    }
  }

  private onPhaseEnter(phase: string, trial: number, t: number): void {
    const ctx = this.ctx;
    const rec = ctx.recorder;
    rec.trialNumber = trial + 1;

    if (phase === 'prepare') {
      this.pending = {
        block: this.currentBlock,
        index: trial,
        onsetT: null,
        onsetQuantMs: 0,
        responded: false,
        falseStart: false,
        side: null,
        targetPos: null,
        targetAngle: 0,
        fittsId: 0,
        stimulus: {},
      };
      this.twoHandPending = { left: null, right: null };
      this.movementStartedAt = null;
      this.onTargetSinceT = null;
      this.rayPathDeg = 0;
      this.resetVisuals();
      this.feedbackPanel.group.visible = false;
      rec.event('trial_prepare', { block: this.currentBlock, practice: this.practice }, t);
      return;
    }

    if (phase === 'stimulus') {
      this.presentStimulus(t);
      return;
    }

    if (phase === 'feedback' && this.practice) {
      this.feedbackPanel.group.visible = true;
      this.feedbackPanel.invalidate();
    }
  }

  private onPhaseExit(phase: string, _trial: number, t: number): void {
    if (phase === 'stimulus' && this.pending && !this.pending.responded) {
      // No response inside the window.
      this.commitTrial(this.pending, null, 'timeout', false, t);
      this.feedbackText = 'KIMARADT';
      this.ctx.audio.error();
    }
    if (phase === 'inter_trial') {
      this.pending = null;
    }
  }

  /* --------------------------------------------------------- stimuli */

  private presentStimulus(t: number): void {
    const ctx = this.ctx;
    const p = this.pending;
    if (!p) return;
    const accent = new THREE.Color(ctx.theme.accent);

    switch (this.currentBlock) {
      case 'simple': {
        this.centre.visible = true;
        ctx.signals.setColor(this.centre, accent, t);
        ctx.signals.flash(this.centre, t, 180, 2.2);
        ctx.signals.scaleTo(this.centre, t, 0.34, 120);
        p.stimulus = { kind: 'simple' };
        break;
      }

      case 'choice': {
        const isRed = ctx.rng.bool(0.5);
        p.side = isRed ? 'left' : 'right';
        const color = isRed ? 0xff4d4d : 0x3d9dff;
        this.centre.visible = true;
        ctx.signals.setColor(this.centre, color, t);
        ctx.signals.scaleTo(this.centre, t, 0.34, 120);
        p.stimulus = { kind: 'choice', color: isRed ? 'red' : 'blue', required: p.side };
        break;
      }

      case 'point': {
        // Random position on a shell in front of the participant. Amplitude and
        // width vary so an index of difficulty can be fitted per participant.
        //
        // The angular spread is platform dependent, and deliberately so: in VR
        // the participant turns their head and the useful field is wide, while
        // a 65-degree browser viewport simply cannot show a target 42 degrees
        // off axis. The range used is recorded on every trial, and pointing
        // results are only ever compared within a device class.
        const g = this.pointGeometry();
        const az = ctx.rng.range(-g.az, g.az) * (Math.PI / 180);
        const el = ctx.rng.range(-g.elDown, g.elUp) * (Math.PI / 180);
        const dist = 2.2;
        const pos = new THREE.Vector3(
          Math.sin(az) * Math.cos(el) * dist,
          1.6 + Math.sin(el) * dist,
          -Math.cos(az) * Math.cos(el) * dist
        );
        const widthDeg = ctx.rng.pick(g.widths);
        const scale = 2 * dist * Math.tan((widthDeg * Math.PI) / 360);
        this.pointTarget.position.copy(pos);
        this.pointTarget.lookAt(0, 1.6, 0);
        this.pointTarget.scale.setScalar(1);
        this.pointRing.scale.setScalar(scale / 0.3);
        this.pointTarget.visible = true;
        ctx.signals.appear(this.pointTarget, t, 1, 120);

        const amplitudeDeg = THREE.MathUtils.radToDeg(
          this.lastRayDir.angleTo(pos.clone().sub(this.headPos()).normalize())
        );
        p.targetPos = pos;
        p.targetAngle = widthDeg;
        p.fittsId = Math.log2((2 * Math.max(1, amplitudeDeg)) / widthDeg);
        p.stimulus = {
          kind: 'point',
          azimuthDeg: +THREE.MathUtils.radToDeg(az).toFixed(1),
          elevationDeg: +THREE.MathUtils.radToDeg(el).toFixed(1),
          widthDeg,
          amplitudeDeg: +amplitudeDeg.toFixed(1),
          indexOfDifficulty: +p.fittsId.toFixed(2),
          spreadDeg: g.az,
          platform: this.ctx.platform,
        };
        break;
      }

      case 'twohand': {
        const roll = ctx.rng.next();
        p.side = roll < 0.4 ? 'left' : roll < 0.8 ? 'right' : 'both';
        this.leftTarget.visible = true;
        this.rightTarget.visible = true;
        ctx.signals.setColor(this.leftTarget, p.side === 'right' ? DIM : accent, t);
        ctx.signals.setColor(this.rightTarget, p.side === 'left' ? DIM : accent, t);
        if (p.side !== 'right') ctx.signals.scaleTo(this.leftTarget, t, 0.3, 110);
        if (p.side !== 'left') ctx.signals.scaleTo(this.rightTarget, t, 0.3, 110);
        p.stimulus = { kind: 'twohand', required: p.side };
        break;
      }
    }

    p.onsetT = t;
    p.onsetQuantMs = this.ctx.engine.clock.frameInterval;
    this.ctx.audio.click();
    this.ctx.recorder.event(
      'stimulus_onset',
      { block: this.currentBlock, ...p.stimulus, quantisationMs: +p.onsetQuantMs.toFixed(1) },
      t
    );
  }

  private resetVisuals(): void {
    const ctx = this.ctx;
    const t = ctx.engine.clock.frameTime;
    this.centre.visible = this.currentBlock === 'simple' || this.currentBlock === 'choice';
    ctx.signals.setColor(this.centre, DIM, t);
    this.centre.scale.setScalar(0.28);
    this.leftTarget.visible = this.currentBlock === 'twohand';
    this.rightTarget.visible = this.currentBlock === 'twohand';
    ctx.signals.setColor(this.leftTarget, DIM, t);
    ctx.signals.setColor(this.rightTarget, DIM, t);
    this.leftTarget.scale.setScalar(0.24);
    this.rightTarget.scale.setScalar(0.24);
    this.pointTarget.visible = false;
    this.trackTarget.visible = this.currentBlock === 'track';
  }

  /* -------------------------------------------------------- responses */

  private onAction(e: ActionEvent): void {
    if (!e.down) return;
    const m = this.machine;
    const p = this.pending;
    if (!m || !p) return;

    // A response before the stimulus is a false start, not a fast reaction.
    if (m.phase === 'prepare' || m.phase === 'countdown') {
      if (this.currentBlock === 'point' && e.action !== 'PRIMARY') return;
      p.falseStart = true;
      this.ctx.recorder.event('false_start', { block: this.currentBlock, action: e.action }, e.t);
      this.commitTrial(p, null, 'invalid', false, e.t);
      this.feedbackText = 'TÚL KORAI';
      this.ctx.audio.error();
      m.goto('feedback');
      return;
    }

    if (m.phase !== 'stimulus') return;

    switch (this.currentBlock) {
      case 'simple': {
        if (e.action !== 'PRIMARY') return;
        this.finishDiscrete(p, e, true, 'hit', m);
        break;
      }

      case 'choice': {
        if (e.action !== 'LEFT' && e.action !== 'RIGHT') return;
        const chosen = e.action === 'LEFT' ? 'left' : 'right';
        const correct = chosen === p.side;
        this.finishDiscrete(p, e, correct, correct ? 'hit' : 'false_alarm', m, { chosen });
        break;
      }

      case 'point': {
        if (e.action !== 'PRIMARY' || !p.targetPos) return;
        const ray = e.ray ?? this.ctx.engine.input.primaryRay();
        const errDeg = ray ? this.angularErrorTo(ray.direction, p.targetPos) : 999;
        const correct = errDeg <= p.targetAngle / 2;
        this.finishDiscrete(p, e, correct, correct ? 'hit' : 'false_alarm', m, {
          endpointErrorDeg: +errDeg.toFixed(2),
          movementInitiationMs:
            this.movementStartedAt !== null && p.onsetT !== null
              ? +(this.movementStartedAt - p.onsetT).toFixed(1)
              : null,
          rayPathDeg: +this.rayPathDeg.toFixed(1),
        });
        break;
      }

      case 'twohand': {
        if (e.action !== 'LEFT' && e.action !== 'RIGHT') return;
        const side = e.action === 'LEFT' ? 'left' : 'right';
        if (this.twoHandPending[side] !== null) return;
        this.twoHandPending[side] = e.t;

        const needBoth = p.side === 'both';
        const wrongSide = !needBoth && side !== p.side;
        if (wrongSide) {
          this.finishDiscrete(p, e, false, 'false_alarm', m, { chosen: side });
          return;
        }
        if (needBoth) {
          const { left, right } = this.twoHandPending;
          if (left === null || right === null) return; // wait for the other hand
          const first = Math.min(left, right);
          const asynchrony = Math.abs(left - right);
          this.finishDiscrete(
            p,
            { ...e, t: first },
            true,
            'hit',
            m,
            { asynchronyMs: +asynchrony.toFixed(1), leftT: left, rightT: right, chosen: 'both' }
          );
          return;
        }
        this.finishDiscrete(p, e, true, 'hit', m, { chosen: side });
        break;
      }
    }
  }

  private finishDiscrete(
    p: PendingTrial,
    e: ActionEvent,
    correct: boolean,
    outcome: TrialOutcome,
    m: TrialMachine,
    extra: Record<string, unknown> = {}
  ): void {
    if (p.responded || p.onsetT === null) return;
    p.responded = true;
    const rt = e.t - p.onsetT;
    this.commitTrial(p, rt, outcome, correct, e.t, { ...extra, source: e.source, hand: e.hand });

    if (this.practice) {
      this.feedbackText = correct ? `${Math.round(rt)} ms` : 'HIBÁS';
      correct ? this.ctx.audio.ok() : this.ctx.audio.error();
    }
    this.ctx.engine.input.pulse(e.hand === 'none' ? 'both' : e.hand, correct ? 0.3 : 0.6, correct ? 25 : 70);
    this.resetVisuals();
    m.goto('feedback');
  }

  private commitTrial(
    p: PendingTrial,
    rtMs: number | null,
    outcome: TrialOutcome,
    correct: boolean,
    endT: number,
    response: Record<string, unknown> = {}
  ): void {
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? p.index + 1,
      block: p.block,
      stimulus: { ...p.stimulus, practice: this.practice },
      response: rtMs === null && Object.keys(response).length === 0 ? null : { ...response, rtMs },
      correct,
      outcome,
      reactionTimeMs: rtMs === null ? null : +rtMs.toFixed(1),
      startedAt: +(p.onsetT ?? endT).toFixed(1),
      endedAt: +endT.toFixed(1),
    };
    this.ctx.recorder.trial(rec);
    this.ctx.recorder.event('response', { outcome, correct, rtMs: rec.reactionTimeMs, ...response }, endT);
    // Practice trials are recorded for completeness but never scored.
    if (!this.practice) this.trials.push(rec);
  }

  /* --------------------------------------------------- tracking block */

  private async runTrackingBlock(count: number): Promise<void> {
    const ctx = this.ctx;
    this.trackTarget.visible = true;
    for (let i = 0; i < count; i++) {
      ctx.recorder.trialNumber = i + 1;
      this.trackErrors = [];
      this.trackSamples = [];
      this.trackOnTargetMs = 0;
      this.trackTotalMs = 0;

      const durationMs = 22000;
      const speed = 0.34 + i * 0.12;
      const centre = new THREE.Vector3(0, 1.62, -2.2);
      // Same reasoning as the pointing block: the path has to stay inside the
      // viewport the participant actually has.
      const amp = ctx.platform === 'vr'
        ? new THREE.Vector3(1.05, 0.42, 0.18)
        : ctx.platform === 'mobile'
          ? new THREE.Vector3(0.5, 0.3, 0.1)
          : new THREE.Vector3(0.72, 0.34, 0.12);
      ctx.motion.attach(this.trackTarget, {
        kind: 'lissajous',
        speed,
        centre,
        amplitude: amp,
        freq: [1, 1.61 + ctx.rng.range(-0.12, 0.12)],
        phase: ctx.rng.range(0, Math.PI * 2),
      });
      this.trackTarget.position.copy(centre);
      ctx.signals.appear(this.trackTarget, ctx.engine.clock.frameTime, 0.2, 200);
      ctx.recorder.event('track_start', { trial: i + 1, speed, durationMs });

      await this.wait(durationMs);

      ctx.motion.detach(this.trackTarget);
      const rms = Math.sqrt(mean(this.trackErrors.map((e) => e * e)) || 0);
      const onTarget = this.trackTotalMs > 0 ? this.trackOnTargetMs / this.trackTotalMs : 0;
      const lag = this.estimateLag();
      if (!this.practice) this.trackTrialStats.push({ rms, onTarget, lag });
      ctx.recorder.event('track_end', {
        trial: i + 1,
        rmsErrorDeg: +rms.toFixed(2),
        timeOnTarget: +onTarget.toFixed(3),
        estimatedLagMs: +lag.toFixed(0),
      });
      if (this.practice) {
        this.feedbackText = `CÉLON: ${Math.round(onTarget * 100)}%`;
        this.feedbackPanel.group.visible = true;
        this.feedbackPanel.invalidate();
        await this.wait(1200);
        this.feedbackPanel.group.visible = false;
      } else {
        await this.wait(700);
      }
    }
    this.trackTarget.visible = false;
  }

  /**
   * Rough tracking lag: the error series is dominated by the target's own
   * velocity when the participant is behind it, so the correlation between
   * error magnitude and target speed gives a usable lag proxy without needing
   * a full cross-correlation over resampled signals.
   */
  private estimateLag(): number {
    if (this.trackSamples.length < 30) return 0;
    const errs = this.trackSamples.map((s) => s.err);
    const p50 = percentile(errs, 0.5);
    // Angular error of e degrees at angular speed w deg/s corresponds to e/w seconds.
    const speeds: number[] = [];
    for (let i = 1; i < this.trackSamples.length; i++) {
      const dt = this.trackSamples[i]!.t - this.trackSamples[i - 1]!.t;
      if (dt > 0) speeds.push(Math.abs(this.trackSamples[i]!.err - this.trackSamples[i - 1]!.err) / (dt / 1000));
    }
    const w = median(speeds.filter((s) => s > 0.5)) || 1;
    return clamp((p50 / w) * 1000, 0, 600);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.machine?.update(dt);

    const ray = ctx.engine.input.primaryRay();
    const now = ctx.engine.clock.frameTime;

    if (ray) {
      const angle = THREE.MathUtils.radToDeg(this.lastRayDir.angleTo(ray.direction));
      this.rayPathDeg += angle;
      // Movement onset: the first frame the pointer moves meaningfully after
      // the stimulus. 1.5 deg/frame filters out tremor and head-borne drift.
      if (
        this.currentBlock === 'point' &&
        this.movementStartedAt === null &&
        this.pending?.onsetT !== null &&
        this.machine?.phase === 'stimulus' &&
        angle > 1.5
      ) {
        this.movementStartedAt = now;
      }
      this.lastRayDir.copy(ray.direction);
    }

    if (this.currentBlock === 'track' && this.trackTarget.visible && ray) {
      const err = this.angularErrorTo(ray.direction, this.trackTarget.position);
      this.trackErrors.push(err);
      this.trackSamples.push({ t: now, err });
      this.trackTotalMs += dt * 1000;
      const onTarget = err <= 3.2;
      if (onTarget) this.trackOnTargetMs += dt * 1000;
      const m = this.trackTarget.material as THREE.MeshBasicMaterial;
      m.color.set(onTarget ? ctx.theme.ok : ctx.theme.accent);
      if (this.trackSamples.length % 6 === 0) {
        ctx.recorder.event('track_sample', { errDeg: +err.toFixed(2), onTarget }, now);
      }
    }
  }

  private headPos(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.ctx.engine.camera.getWorldPosition(v);
    return v;
  }

  /** Angle between the pointer direction and the direction to a world point. */
  private angularErrorTo(dir: THREE.Vector3, target: THREE.Vector3): number {
    const origin = this.ctx.engine.input.primaryRay()?.origin ?? this.headPos();
    const toTarget = target.clone().sub(origin).normalize();
    return THREE.MathUtils.radToDeg(dir.angleTo(toTarget));
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 16, withAlpha('#000000', 0.55));
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 46, color: this.feedbackText.includes('ms') || this.feedbackText.includes('CÉLON') ? t.ok : t.bad,
      align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const by = (b: BlockId) => this.trials.filter((t) => t.block === b);

    /* --- block 1: simple reaction --------------------------------- */
    const simple = by('simple');
    const simpleRts = simple.filter((t) => t.outcome === 'hit' && t.reactionTimeMs !== null).map((t) => t.reactionTimeMs!);
    const simpleMedian = median(simpleRts);
    const simpleMad = mad(simpleRts);
    const lapses = simpleRts.filter((r) => r > 500).length;
    const falseStarts = simple.filter((t) => t.outcome === 'invalid').length;
    const misses = simple.filter((t) => t.outcome === 'timeout').length;

    // Reciprocal RT is the standard fatigue-sensitive PVT summary: it weights
    // the slow tail without letting a single lapse dominate the mean.
    const rrt = simpleRts.length ? mean(simpleRts.map((r) => 1000 / r)) : 0;

    /* --- block 2: choice reaction ---------------------------------- */
    const choice = by('choice');
    const choiceHits = choice.filter((t) => t.outcome === 'hit' && t.reactionTimeMs !== null);
    const choiceRts = choiceHits.map((t) => t.reactionTimeMs!);
    const choiceMedian = median(choiceRts);
    const choiceAccuracy = choice.length ? choiceHits.length / choice.length : 0;
    const decisionCost = Number.isFinite(choiceMedian) && Number.isFinite(simpleMedian) ? choiceMedian - simpleMedian : NaN;

    /* --- block 3: pointing ----------------------------------------- */
    const point = by('point');
    const pointHits = point.filter((t) => t.outcome === 'hit');
    const pointAccuracy = point.length ? pointHits.length / point.length : 0;
    const endpointErrors = point
      .map((t) => (t.response?.endpointErrorDeg as number | undefined) ?? null)
      .filter((v): v is number => v !== null && v < 90);
    const initiations = point
      .map((t) => (t.response?.movementInitiationMs as number | null | undefined) ?? null)
      .filter((v): v is number => v !== null && v > 0);
    const pointRts = point.filter((t) => t.reactionTimeMs !== null).map((t) => t.reactionTimeMs!);
    const movementTimes = point
      .map((t, i) => {
        const init = initiations[i];
        const total = t.reactionTimeMs;
        return init !== undefined && total !== null ? total - init : null;
      })
      .filter((v): v is number => v !== null && v > 0);
    // Fitts slope: how much extra time each unit of index of difficulty costs.
    const ids = point.map((t) => (t.stimulus.indexOfDifficulty as number) ?? 0);
    const fittsSlope = pointRts.length > 3 ? slope(ids, pointRts) : 0;
    const pathEfficiency = (() => {
      const ratios = point
        .map((t) => {
          const path = t.response?.rayPathDeg as number | undefined;
          const amp = t.stimulus.amplitudeDeg as number | undefined;
          return path && amp && path > 0 ? clamp(amp / path, 0, 1) : null;
        })
        .filter((v): v is number => v !== null);
      return ratios.length ? mean(ratios) : NaN;
    })();

    /* --- block 4: tracking ----------------------------------------- */
    const trackRms = this.trackTrialStats.length ? mean(this.trackTrialStats.map((s) => s.rms)) : NaN;
    const trackOnTarget = this.trackTrialStats.length ? mean(this.trackTrialStats.map((s) => s.onTarget)) : NaN;
    const trackLag = this.trackTrialStats.length ? mean(this.trackTrialStats.map((s) => s.lag)) : NaN;
    // Does control degrade as the target speeds up?
    const trackDecay =
      this.trackTrialStats.length > 1
        ? slope(this.trackTrialStats.map((_, i) => i), this.trackTrialStats.map((s) => s.onTarget))
        : 0;

    /* --- block 5: bimanual ----------------------------------------- */
    const two = by('twohand');
    const twoHits = two.filter((t) => t.outcome === 'hit');
    const twoAccuracy = two.length ? twoHits.length / two.length : 0;
    const bothTrials = twoHits.filter((t) => (t.response?.chosen as string) === 'both');
    const asynchronies = bothTrials
      .map((t) => t.response?.asynchronyMs as number | undefined)
      .filter((v): v is number => v !== undefined);
    const bimanualAsync = asynchronies.length ? median(asynchronies) : NaN;
    const leftRts = two
      .filter((t) => t.outcome === 'hit' && (t.response?.chosen as string) === 'left')
      .map((t) => t.reactionTimeMs!)
      .filter((v) => v !== null);
    const rightRts = two
      .filter((t) => t.outcome === 'hit' && (t.response?.chosen as string) === 'right')
      .map((t) => t.reactionTimeMs!)
      .filter((v) => v !== null);
    const handAsymmetry =
      leftRts.length && rightRts.length ? median(leftRts) - median(rightRts) : NaN;

    /* --- speed / accuracy trade-off (catalog item 134) -------------- */
    // Correlate RT against correctness across the choice block: a strongly
    // negative relationship means the participant is buying speed with errors.
    const sat = (() => {
      const withRt = choice.filter((t) => t.reactionTimeMs !== null);
      if (withRt.length < 8) return NaN;
      const fast = withRt.filter((t) => t.reactionTimeMs! < median(withRt.map((x) => x.reactionTimeMs!)));
      const slow = withRt.filter((t) => t.reactionTimeMs! >= median(withRt.map((x) => x.reactionTimeMs!)));
      const accFast = fast.length ? fast.filter((t) => t.correct).length / fast.length : 0;
      const accSlow = slow.length ? slow.filter((t) => t.correct).length / slow.length : 0;
      return accSlow - accFast;
    })();

    /* ------------------------------------------------------ metrics */

    const M: [string, number, string, string?][] = [
      ['simple_rt_median', simpleMedian, 'ms', 'simple'],
      ['simple_rt_mean', mean(simpleRts), 'ms', 'simple'],
      ['simple_rt_sd', stdev(simpleRts), 'ms', 'simple'],
      ['simple_rt_mad', simpleMad, 'ms', 'simple'],
      ['simple_rt_p10', percentile(simpleRts, 0.1), 'ms', 'simple'],
      ['simple_rt_p90', percentile(simpleRts, 0.9), 'ms', 'simple'],
      ['reciprocal_rt', rrt, '1/s', 'simple'],
      ['lapses', lapses, 'count', 'simple'],
      ['false_starts', falseStarts, 'count', 'simple'],
      ['omissions', misses, 'count', 'simple'],
      ['choice_rt_median', choiceMedian, 'ms', 'choice'],
      ['choice_rt_sd', stdev(choiceRts), 'ms', 'choice'],
      ['choice_accuracy', choiceAccuracy, 'ratio', 'choice'],
      ['decision_cost', decisionCost, 'ms', 'choice'],
      ['speed_accuracy_tradeoff', sat, 'ratio', 'choice'],
      ['point_accuracy', pointAccuracy, 'ratio', 'point'],
      ['endpoint_error_median', median(endpointErrors), 'deg', 'point'],
      ['movement_initiation_median', median(initiations), 'ms', 'point'],
      ['movement_time_median', median(movementTimes), 'ms', 'point'],
      ['fitts_slope', fittsSlope, 'ms/bit', 'point'],
      ['path_efficiency', pathEfficiency, 'ratio', 'point'],
      ['tracking_rms_error', trackRms, 'deg', 'track'],
      ['time_on_target', trackOnTarget, 'ratio', 'track'],
      ['tracking_lag', trackLag, 'ms', 'track'],
      ['tracking_speed_decay', trackDecay, 'ratio/step', 'track'],
      ['bimanual_accuracy', twoAccuracy, 'ratio', 'twohand'],
      ['bimanual_asynchrony', bimanualAsync, 'ms', 'twohand'],
      ['hand_asymmetry', handAsymmetry, 'ms', 'twohand'],
    ];
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    // Normalisation anchors are provisional: they come from published PVT and
    // choice-RT ranges for healthy adults, adjusted for the fact that a VR
    // controller adds roughly 40-70 ms of end-to-end latency versus a physical
    // button box. They are placeholders until this platform has its own norms,
    // and the version is recorded so old runs can be rescored later.
    const speedScore = normaliseSoft(simpleMedian, 240, 520);
    const choiceScore = normaliseSoft(choiceMedian, 340, 700);
    const stabilityScore = normaliseSoft(simpleMad, 18, 95);
    const lapseScore = normaliseSoft(lapses, 0, Math.max(3, simpleRts.length * 0.25));
    const accuracyScore = ((choiceAccuracy + pointAccuracy + twoAccuracy) / 3) * 100;
    const precisionScore = normaliseSoft(median(endpointErrors), 0.6, 4.5);
    const trackingScore = Number.isFinite(trackOnTarget) ? trackOnTarget * 100 : 0;
    const bimanualScore = Number.isFinite(bimanualAsync)
      ? (twoAccuracy * 100) * 0.6 + normaliseSoft(bimanualAsync, 20, 260) * 0.4
      : twoAccuracy * 100;

    const ops = opsScore([
      { key: 'speed', value: (speedScore + choiceScore) / 2, weight: 0.26 },
      { key: 'accuracy', value: accuracyScore, weight: 0.24 },
      { key: 'stability', value: (stabilityScore + lapseScore) / 2, weight: 0.18 },
      { key: 'precision', value: precisionScore, weight: 0.12 },
      { key: 'tracking', value: trackingScore, weight: 0.14 },
      { key: 'bimanual', value: bimanualScore, weight: 0.06 },
    ]);

    rec.score('speed', speedScore, '1.0.0');
    rec.score('accuracy', accuracyScore, '1.0.0');
    rec.score('stability', stabilityScore, '1.0.0');
    rec.score('precision', precisionScore, '1.0.0');
    rec.score('tracking', trackingScore, '1.0.0');
    rec.score('bimanual', bimanualScore, '1.0.0');

    const fmt = (v: number, digits = 0, suffix = '') =>
      Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : '—';

    return {
      opsScore: ops,
      headline: [
        { label: 'Egyszerű reakció (medián)', value: fmt(simpleMedian, 0, ' ms'), hint: `szórás ${fmt(simpleMad, 0, ' ms')}` },
        { label: 'Választásos reakció', value: fmt(choiceMedian, 0, ' ms'), hint: `${Math.round(choiceAccuracy * 100)}% pontos` },
        { label: 'Döntési többletidő', value: fmt(decisionCost, 0, ' ms') },
        { label: 'Lapszusok (>500 ms)', value: `${lapses} / ${simpleRts.length}` },
        { label: 'Célon töltött idő', value: Number.isFinite(trackOnTarget) ? `${Math.round(trackOnTarget * 100)}%` : '—' },
        { label: 'Kétkezes eltérés', value: fmt(bimanualAsync, 0, ' ms') },
      ],
      summary: {
        simple: { median: r(simpleMedian), mad: r(simpleMad), lapses, falseStarts, misses, reciprocal: r(rrt, 3) },
        choice: { median: r(choiceMedian), accuracy: r(choiceAccuracy, 3), decisionCost: r(decisionCost) },
        point: {
          accuracy: r(pointAccuracy, 3),
          endpointErrorDeg: r(median(endpointErrors), 2),
          initiationMs: r(median(initiations)),
          movementMs: r(median(movementTimes)),
          fittsSlope: r(fittsSlope, 1),
          pathEfficiency: r(pathEfficiency, 3),
        },
        track: { rmsDeg: r(trackRms, 2), onTarget: r(trackOnTarget, 3), lagMs: r(trackLag), decay: r(trackDecay, 4) },
        twohand: { accuracy: r(twoAccuracy, 3), asynchronyMs: r(bimanualAsync), handAsymmetryMs: r(handAsymmetry) },
        platform: ctx.platform,
        inputMode: ctx.engine.device?.inputMode,
        frameIntervalMs: r(ctx.engine.clock.frameInterval, 2),
        trialsScored: this.trials.length,
      },
      axisScores: {
        reaction: (speedScore + choiceScore) / 2,
        psychomotor: (precisionScore + trackingScore + bimanualScore) / 3,
        timing: trackingScore,
      },
    };
  }

  abort(): void {
    this.machine?.abort();
    this.blockResolve?.();
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.machine?.abort();
    ctx.panels.remove(this.feedbackPanel);
    this.feedbackPanel.dispose();
    this.hintSprite && disposeTree(this.hintSprite);
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
