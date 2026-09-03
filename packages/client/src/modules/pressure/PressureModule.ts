import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, stdev, normaliseSoft, opsScore, clamp,
  type ModuleManifest, type TrialRecord, type TrialOutcome, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { TrialMachine } from '../../engine/task/TrialMachine.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';

/**
 * MODULE 07 - PRESSURE
 * Performance under cognitive load.
 *
 * The module scores almost nothing in absolute terms. Every headline number is
 * a WITHIN-PERSON DIFFERENCE - the same task, the same hand, the same hardware,
 * under two different conditions:
 *
 *   incongruent - congruent      interference control
 *   switch - repeat              cognitive flexibility
 *   after reversal - before      cost of a rule change
 *   after error - after correct  post-error adjustment
 *   pressure - baseline          how far performance falls under load
 *   recovery - baseline          whether it comes back
 *
 * That structure is what makes the result comparable across device classes:
 * the 40-70 ms of extra latency a VR controller adds appears on both sides of
 * every subtraction and cancels out. An absolute reaction time does not have
 * that property.
 *
 * The last two contrasts are the measurable core of "choking": a large drop
 * with full recovery is a different phenomenon from a small drop that never
 * recovers, and the two need different coaching.
 */

type BlockId = 'baseline' | 'interference' | 'switching' | 'pressure' | 'recovery';
type Dimension = 'color' | 'shape';
type Congruency = 'congruent' | 'incongruent' | 'neutral';
type Side = 'left' | 'right';

const CYAN = 0x22d3ee;
const MAGENTA = 0xe879f9;
const GREY = 0x8b97a8;

interface TrialSpec {
  dimension: Dimension;
  congruency: Congruency;
  shapeKind: 'box' | 'sphere' | 'cone';
  colorKind: 'cyan' | 'magenta' | 'grey';
  requiredSide: Side;
  isSwitch: boolean;
}

interface PendingTrial extends TrialSpec {
  onsetT: number | null;
  responded: boolean;
  windowMs: number;
  afterReversal: boolean;
  postError: boolean;
}

export class PressureModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.PRESSURE!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'baseline',
      title: 'ALAPVONAL',
      instruction:
        'Egy alakzat jelenik meg. Most csak a SZÍNE számít: CIÁN → bal, MAGENTA → jobb. ' +
        'Van bőven időd. Ez a blokk azt méri, mire vagy képes nyugodt körülmények között — ' +
        'minden későbbi eredményt ehhez viszonyítunk.',
      controlHint: '',
      trials: 28,
      practiceTrials: 6,
    },
    {
      id: 'interference',
      title: 'INTERFERENCIA',
      instruction:
        'A jelzés megmondja, melyik dimenzió számít: SZÍN vagy ALAK. ' +
        'A másik dimenzió szándékosan az ellenkező oldalra fog húzni. Hagyd figyelmen kívül. ' +
        'CIÁN vagy KOCKA → bal. MAGENTA vagy GÖMB → jobb.',
      controlHint: '',
      trials: 36,
      practiceTrials: 6,
    },
    {
      id: 'switching',
      title: 'VÁLTÁS',
      instruction:
        'Most próbáról próbára változhat, hogy melyik dimenzió számít. ' +
        'A jelzés mindig megmondja — de csak röviden. Figyelj rá minden alkalommal.',
      controlHint: '',
      trials: 40,
      practiceTrials: 6,
    },
    {
      id: 'pressure',
      title: 'NYOMÁS',
      instruction:
        'Ugyanaz a feladat, de az idő fogyni fog, zavaró hangok szólnak, és látod a sorozatodat. ' +
        'A blokk közepén a szabály MEG FOG FORDULNI — figyelj a jelzésre. ' +
        'Nincs benne semmi ijesztő; csak kevesebb idő.',
      controlHint: '',
      trials: 44,
      practiceTrials: 4,
    },
    {
      id: 'recovery',
      title: 'HELYREÁLLÁS',
      instruction:
        'Vissza az első blokk feltételeihez: csak a SZÍN számít, és újra van bőven idő. ' +
        'Nincs hang, nincs számláló. Ez azt méri, elmúlt-e a nyomás hatása.',
      controlHint: '',
      trials: 24,
      practiceTrials: 0,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private stimBox!: THREE.Mesh;
  private stimSphere!: THREE.Mesh;
  private stimCone!: THREE.Mesh;
  private cuePanel!: Panel;
  private stakePanel!: Panel;
  private feedbackPanel!: Panel;

  private machine: TrialMachine | null = null;
  private pending: PendingTrial | null = null;
  private specs: TrialSpec[] = [];
  private currentBlock: BlockId = 'baseline';
  private practice = false;
  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;

  private cueText = '';
  private feedbackText = '';
  private streak = 0;
  private maxStreak = 0;
  private stakePoints = 0;
  private reversed = false;
  private reversalAt = 22;
  private lastWasError = false;
  private distractorTimer: ReturnType<typeof setTimeout> | null = null;

  /** Per-block accumulators, keyed by block id. */
  private blockStats = new Map<BlockId, { correct: number; total: number; rts: number[]; timeouts: number }>();

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    const at = new THREE.Vector3(0, 1.6, -2.2);
    this.stimBox = makePrimitive({ kind: 'box', color: CYAN, unlit: true, size: 0.30 });
    this.stimSphere = makePrimitive({ kind: 'sphere', color: CYAN, unlit: true, size: 0.32 });
    this.stimCone = makePrimitive({ kind: 'cone', color: GREY, unlit: true, size: 0.32 });
    for (const m of [this.stimBox, this.stimSphere, this.stimCone]) {
      m.position.copy(at);
      m.visible = false;
      this.root.add(m);
    }

    const flat = ctx.platform !== 'vr';
    this.cuePanel = new Panel({
      width: 0.55, height: 0.14, pxPerMeter: 1000, theme: ctx.theme, frame: false, name: 'pressure-cue',
    });
    this.cuePanel.group.position.set(0, 2.02, flat ? -1.7 : -2.1);
    this.cuePanel.setDraw((ui) => this.drawCue(ui));
    this.cuePanel.group.visible = false;
    this.root.add(this.cuePanel.group);
    ctx.panels.add(this.cuePanel);

    this.stakePanel = new Panel({
      width: 0.7, height: 0.16, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'pressure-stake',
    });
    this.stakePanel.group.position.set(0, 1.13, flat ? -1.75 : -2.1);
    this.stakePanel.setDraw((ui) => this.drawStake(ui));
    this.stakePanel.group.visible = false;
    this.root.add(this.stakePanel.group);
    ctx.panels.add(this.stakePanel);

    this.feedbackPanel = new Panel({
      width: 0.8, height: 0.18, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'pressure-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.13, flat ? -1.75 : -2.1);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint();

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
  }

  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr':
        return 'CIÁN vagy KOCKA → bal ravasz. MAGENTA vagy GÖMB → jobb ravasz.';
      case 'mobile':
        return 'CIÁN vagy KOCKA → koppints a képernyő bal harmadára. MAGENTA vagy GÖMB → a jobb harmadára.';
      default:
        return 'CIÁN vagy KOCKA → F billentyű (vagy balra nyíl). MAGENTA vagy GÖMB → J billentyű (vagy jobbra nyíl).';
    }
  }

  /* -------------------------------------------------- trial generation */

  /**
   * Build the trial list for a block up front, so the distribution is exact
   * rather than approached in expectation. With 36 trials, sampling
   * independently would routinely land 8 percentage points away from the
   * intended congruency mix, and the interference cost would inherit that noise.
   */
  private buildSpecs(block: BlockId, count: number, rng: Rng): TrialSpec[] {
    const specs: TrialSpec[] = [];

    const make = (dimension: Dimension, congruency: Congruency): TrialSpec => {
      let shapeKind: TrialSpec['shapeKind'];
      let colorKind: TrialSpec['colorKind'];
      const relevantSide: Side = rng.bool() ? 'left' : 'right';

      if (dimension === 'color') {
        colorKind = relevantSide === 'left' ? 'cyan' : 'magenta';
        if (congruency === 'congruent') shapeKind = relevantSide === 'left' ? 'box' : 'sphere';
        else if (congruency === 'incongruent') shapeKind = relevantSide === 'left' ? 'sphere' : 'box';
        else shapeKind = 'cone';
      } else {
        shapeKind = relevantSide === 'left' ? 'box' : 'sphere';
        if (congruency === 'congruent') colorKind = relevantSide === 'left' ? 'cyan' : 'magenta';
        else if (congruency === 'incongruent') colorKind = relevantSide === 'left' ? 'magenta' : 'cyan';
        else colorKind = 'grey';
      }
      return { dimension, congruency, shapeKind, colorKind, requiredSide: relevantSide, isSwitch: false };
    };

    if (block === 'baseline' || block === 'recovery') {
      // Colour only, no conflict: this is the reference the whole module is
      // measured against, so it must be as clean as possible.
      for (let i = 0; i < count; i++) {
        specs.push(make('color', i % 5 === 0 ? 'neutral' : 'congruent'));
      }
      return rng.shuffle(specs);
    }

    const nCong = Math.round(count * 0.5);
    const nIncong = Math.round(count * 0.33);
    const nNeutral = count - nCong - nIncong;

    if (block === 'interference') {
      const dim: Dimension = rng.bool() ? 'color' : 'shape';
      for (let i = 0; i < nCong; i++) specs.push(make(dim, 'congruent'));
      for (let i = 0; i < nIncong; i++) specs.push(make(dim, 'incongruent'));
      for (let i = 0; i < nNeutral; i++) specs.push(make(dim, 'neutral'));
      return rng.shuffle(specs);
    }

    // Switching and pressure blocks: a cued dimension that changes on 40% of
    // trials. Build the congruency pool first, then walk it assigning
    // dimensions so the switch rate is exact.
    const pool: Congruency[] = rng.shuffle([
      ...Array<Congruency>(nCong).fill('congruent'),
      ...Array<Congruency>(nIncong).fill('incongruent'),
      ...Array<Congruency>(nNeutral).fill('neutral'),
    ]);

    const switchFlags = rng.shuffle([
      ...Array<boolean>(Math.round((count - 1) * 0.4)).fill(true),
      ...Array<boolean>(count - 1 - Math.round((count - 1) * 0.4)).fill(false),
    ]);

    let dim: Dimension = rng.bool() ? 'color' : 'shape';
    for (let i = 0; i < count; i++) {
      // The first trial cannot be a switch - there is nothing to switch from.
      const isSwitch = i === 0 ? false : switchFlags[i - 1]!;
      if (isSwitch) dim = dim === 'color' ? 'shape' : 'color';
      const spec = make(dim, pool[i]!);
      spec.isSwitch = isSwitch;
      specs.push(spec);
    }
    return specs;
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    this.specs = this.buildSpecs(this.currentBlock, count, ctx.rng);
    this.reversed = false;
    this.streak = 0;
    this.stakePoints = 0;
    this.lastWasError = false;
    this.reversalAt = this.currentBlock === 'pressure' ? Math.round(count * 0.5) : -1;

    if (!this.blockStats.has(this.currentBlock)) {
      this.blockStats.set(this.currentBlock, { correct: 0, total: 0, rts: [], timeouts: 0 });
    }

    const isPressure = this.currentBlock === 'pressure';
    this.stakePanel.group.visible = isPressure;
    if (isPressure) {
      this.stakePanel.invalidate();
      this.scheduleDistractor();
    }

    await new Promise<void>((resolve) => {
      this.machine = new TrialMachine(ctx.engine.clock, {
        trialCount: count,
        duration: (phase, trial) => this.phaseDuration(phase, trial),
        onEnter: (phase, trial, t) => this.onPhaseEnter(phase, trial, t),
        onExit: (phase, trial, t) => this.onPhaseExit(phase, trial, t),
        onComplete: () => { this.machine = null; resolve(); },
      });
      this.machine.start();
    });

    this.stopDistractor();
    this.stakePanel.group.visible = false;
    this.hideStimuli();

    if (!practice) {
      const st = this.blockStats.get(this.currentBlock)!;
      ctx.recorder.event('block_summary', {
        block: this.currentBlock,
        accuracy: st.total > 0 ? +(st.correct / st.total).toFixed(3) : null,
        medianRt: st.rts.length ? +median(st.rts).toFixed(1) : null,
        timeouts: st.timeouts,
      });
    }
  }

  /** The pressure block's window shrinks every trial down to a 600 ms floor. */
  private windowFor(trial: number): number {
    if (this.currentBlock !== 'pressure') return 2000;
    return Math.max(600, 1400 - trial * 18);
  }

  private phaseDuration(phase: string, trial: number): number | null {
    switch (phase) {
      case 'prepare':
        // The cue-stimulus interval matters: too long and the switch cost
        // disappears because preparation is complete; too short and there is
        // no preparation at all.
        return this.currentBlock === 'switching' || this.currentBlock === 'pressure'
          ? 600
          : this.ctx.rng.range(400, 800);
      case 'countdown': return 0;
      case 'stimulus': return this.windowFor(trial);
      case 'response_window': return 0;
      case 'response': return 0;
      case 'feedback': return this.practice ? 500 : 0;
      case 'inter_trial': return 400;
      default: return 0;
    }
  }

  private onPhaseEnter(phase: string, trial: number, t: number): void {
    const ctx = this.ctx;
    ctx.recorder.trialNumber = trial + 1;
    const spec = this.specs[trial];
    if (!spec) return;

    if (phase === 'prepare') {
      this.hideStimuli();
      this.feedbackPanel.group.visible = false;

      // Rule reversal, announced once and only once.
      if (this.currentBlock === 'pressure' && !this.practice && trial === this.reversalAt && !this.reversed) {
        this.reversed = true;
        this.cueText = 'SZABÁLY MEGFORDULT';
        ctx.recorder.event('rule_reversal', { trialIndex: trial, newMapping: 'reversed' });
        ctx.audio.warn();
      } else {
        this.cueText = spec.dimension === 'color' ? 'SZÍN' : 'ALAK';
      }
      this.cuePanel.group.visible = true;
      this.cuePanel.invalidate();
      ctx.recorder.event('cue_shown', {
        dimension: spec.dimension, block: this.currentBlock,
        csiMs: this.currentBlock === 'switching' || this.currentBlock === 'pressure' ? 600 : null,
      }, t);
      return;
    }

    if (phase === 'stimulus') {
      this.presentStimulus(spec, trial, t);
      return;
    }

    if (phase === 'feedback' && this.practice) {
      this.feedbackPanel.group.visible = true;
      this.feedbackPanel.invalidate();
    }
  }

  private onPhaseExit(phase: string, _trial: number, t: number): void {
    if (phase === 'stimulus' && this.pending && !this.pending.responded) {
      this.commit(null, 'timeout', false, t, {});
      this.feedbackText = 'LEJÁRT';
      this.ctx.audio.error();
      this.breakStreak();
    }
    if (phase === 'inter_trial') {
      this.hideStimuli();
      this.pending = null;
    }
  }

  private presentStimulus(spec: TrialSpec, trial: number, t: number): void {
    const ctx = this.ctx;
    const mesh = spec.shapeKind === 'box' ? this.stimBox : spec.shapeKind === 'sphere' ? this.stimSphere : this.stimCone;
    const color = spec.colorKind === 'cyan' ? CYAN : spec.colorKind === 'magenta' ? MAGENTA : GREY;
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    mesh.visible = true;
    ctx.signals.appear(mesh, t, spec.shapeKind === 'box' ? 0.30 : 0.32, 110);

    const windowMs = this.windowFor(trial);
    this.pending = {
      ...spec,
      onsetT: t,
      responded: false,
      windowMs,
      afterReversal: this.reversed,
      postError: this.lastWasError,
    };

    ctx.audio.click();
    ctx.recorder.event('stimulus_onset', {
      dimension: spec.dimension, congruency: spec.congruency,
      shapeKind: spec.shapeKind, colorKind: spec.colorKind,
      requiredSide: this.effectiveSide(spec), windowMs, isSwitch: spec.isSwitch,
      afterReversal: this.reversed,
      quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
    }, t);
  }

  /** The correct side, after applying the reversal if it is in force. */
  private effectiveSide(spec: TrialSpec): Side {
    if (!this.reversed) return spec.requiredSide;
    return spec.requiredSide === 'left' ? 'right' : 'left';
  }

  private hideStimuli(): void {
    this.stimBox.visible = false;
    this.stimSphere.visible = false;
    this.stimCone.visible = false;
    this.cuePanel.group.visible = false;
  }

  /* ---------------------------------------------------------- response */

  private onAction(e: ActionEvent): void {
    if (!e.down) return;
    if (e.action !== 'LEFT' && e.action !== 'RIGHT') return;
    const m = this.machine;
    const p = this.pending;
    if (!m || !p) return;

    if (m.phase === 'prepare' || m.phase === 'countdown') {
      // Responding to the cue rather than the stimulus.
      this.ctx.recorder.event('premature_response', { action: e.action }, e.t);
      return;
    }
    if (m.phase !== 'stimulus' || p.responded || p.onsetT === null) return;

    const chosen: Side = e.action === 'LEFT' ? 'left' : 'right';
    const required = this.effectiveSide(p);
    const correct = chosen === required;
    const rt = e.t - p.onsetT;

    this.commit(rt, correct ? 'hit' : 'false_alarm', correct, e.t, { chosenSide: chosen });

    if (correct) {
      this.streak++;
      this.maxStreak = Math.max(this.maxStreak, this.streak);
      this.stakePoints += 10 + this.streak * 2;
    } else {
      this.breakStreak();
    }
    this.lastWasError = !correct;

    if (this.practice) {
      this.feedbackText = correct ? `${Math.round(rt)} ms` : 'HIBÁS';
      correct ? this.ctx.audio.ok() : this.ctx.audio.error();
    }
    this.ctx.engine.input.pulse(e.hand === 'none' ? 'both' : e.hand, correct ? 0.28 : 0.6, correct ? 22 : 70);
    if (this.currentBlock === 'pressure') this.stakePanel.invalidate();
    this.hideStimuli();
    m.goto('feedback');
  }

  private breakStreak(): void {
    if (this.streak > 0) {
      this.ctx.recorder.event('streak_broken', {
        atTrial: this.ctx.recorder.trialNumber, length: this.streak,
      });
    }
    this.streak = 0;
    this.lastWasError = true;
    if (this.currentBlock === 'pressure') this.stakePanel.invalidate();
  }

  private commit(
    rtMs: number | null,
    outcome: TrialOutcome,
    correct: boolean,
    endT: number,
    response: Record<string, unknown>
  ): void {
    const p = this.pending;
    if (!p) return;
    p.responded = true;

    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block: this.currentBlock,
      stimulus: {
        kind: 'pressure',
        block: this.currentBlock,
        dimension: p.dimension,
        congruency: p.congruency,
        shapeKind: p.shapeKind,
        colorKind: p.colorKind,
        requiredSide: this.effectiveSide(p),
        isSwitch: p.isSwitch,
        windowMs: p.windowMs,
        afterReversal: p.afterReversal,
        practice: this.practice,
      },
      response: { ...response, rtMs, postError: p.postError, streak: this.streak },
      correct,
      outcome,
      reactionTimeMs: rtMs === null ? null : +rtMs.toFixed(1),
      startedAt: +(p.onsetT ?? endT).toFixed(1),
      endedAt: +endT.toFixed(1),
    };
    this.ctx.recorder.trial(rec);
    this.ctx.recorder.event(outcome === 'timeout' ? 'timeout' : 'response', {
      chosenSide: response.chosenSide ?? null, correct, rtMs: rec.reactionTimeMs,
      postError: p.postError, streak: this.streak, windowMs: p.windowMs,
    }, endT);

    if (!this.practice) {
      this.trials.push(rec);
      const st = this.blockStats.get(this.currentBlock)!;
      st.total++;
      if (correct) st.correct++;
      if (outcome === 'timeout') st.timeouts++;
      if (correct && rtMs !== null) st.rts.push(rtMs);
    }
  }

  /* -------------------------------------------------------- distractor */

  /**
   * Irregular, uninformative tones. They are scheduled to avoid the 250 ms
   * around a stimulus onset: a tone that reliably preceded the stimulus would
   * become a warning signal and would speed responses instead of loading them.
   */
  private scheduleDistractor(): void {
    if (this.aborted || this.currentBlock !== 'pressure') return;
    const delay = this.ctx.rng.range(900, 2600);
    this.distractorTimer = setTimeout(() => {
      if (this.aborted || this.currentBlock !== 'pressure') return;
      const sinceOnset = this.pending?.onsetT ? this.ctx.engine.clock.frameTime - this.pending.onsetT : 9999;
      if (Math.abs(sinceOnset) > 250) {
        const freq = this.ctx.rng.range(200, 1600);
        const durationMs = this.ctx.rng.range(90, 160);
        this.ctx.audio.tone({ freq, durationMs, gain: 0.12, shape: 'triangle' });
        this.ctx.recorder.event('distractor_tone', { freq: Math.round(freq), durationMs: Math.round(durationMs) });
      }
      this.scheduleDistractor();
    }, delay);
  }

  private stopDistractor(): void {
    if (this.distractorTimer) clearTimeout(this.distractorTimer);
    this.distractorTimer = null;
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number): void {
    this.machine?.update(dt);
  }

  /* --------------------------------------------------------------- UI */

  private drawCue(ui: UI): void {
    const t = ui.t;
    const isReversal = this.cueText.includes('MEGFORDULT');
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha(isReversal ? t.warn : '#000000', isReversal ? 0.9 : 0.5));
    ui.text(this.cueText, ui.w / 2, ui.h / 2, {
      size: isReversal ? 34 : 42,
      color: isReversal ? '#0a0d12' : t.text,
      align: 'center', weight: '700', font: t.fontDisplay, letterSpacing: '3px',
    });
  }

  private drawStake(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.55));
    ui.label('SOROZAT', 22, ui.h / 2 - 16, t.textMuted, 14);
    ui.text(String(this.streak), 22, ui.h / 2 + 18, {
      size: 32, color: this.streak >= 5 ? t.ok : t.text, weight: '700', font: t.fontDisplay,
    });
    ui.label('KOCKÁN', ui.w - 22, ui.h / 2 - 16, t.textMuted, 14, 'right');
    ui.text(`${this.stakePoints}`, ui.w - 22, ui.h / 2 + 18, {
      size: 32, color: t.accent, align: 'right', weight: '700', font: t.fontDisplay,
    });
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.55));
    const good = this.feedbackText.includes('ms');
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 38, color: good ? t.ok : t.bad, align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const by = (b: BlockId) => this.trials.filter((t) => t.block === b);
    const correctRts = (list: TrialRecord[]) =>
      list.filter((t) => t.correct && t.reactionTimeMs !== null).map((t) => t.reactionTimeMs!);
    const acc = (list: TrialRecord[]) => (list.length ? list.filter((t) => t.correct).length / list.length : NaN);

    const baseline = by('baseline');
    const interference = by('interference');
    const switching = by('switching');
    const pressure = by('pressure');
    const recovery = by('recovery');

    const baselineAcc = acc(baseline);
    const baselineRt = median(correctRts(baseline));
    const pressureAcc = acc(pressure);
    const pressureRt = median(correctRts(pressure));
    const recoveryAcc = acc(recovery);
    const recoveryRt = median(correctRts(recovery));

    /* --- interference -------------------------------------------- */
    const conflictPool = [...interference, ...switching];
    const cong = conflictPool.filter((t) => t.stimulus.congruency === 'congruent');
    const incong = conflictPool.filter((t) => t.stimulus.congruency === 'incongruent');
    const interferenceRt = median(correctRts(incong)) - median(correctRts(cong));
    const interferenceAcc = acc(cong) - acc(incong);

    /* --- switch cost ---------------------------------------------- */
    const switchTrials = switching.filter((t) => t.stimulus.isSwitch === true);
    const repeatTrials = switching.filter((t) => t.stimulus.isSwitch === false);
    const switchCostRt = median(correctRts(switchTrials)) - median(correctRts(repeatTrials));
    const switchCostAcc = acc(repeatTrials) - acc(switchTrials);

    /* --- rule change ---------------------------------------------- */
    const before = pressure.filter((t) => t.stimulus.afterReversal === false).slice(-5);
    const after = pressure.filter((t) => t.stimulus.afterReversal === true).slice(0, 5);
    const ruleChangeCost = before.length && after.length ? acc(before) - acc(after) : NaN;
    const ruleChangeRt = before.length && after.length
      ? median(correctRts(after)) - median(correctRts(before))
      : NaN;

    /* --- post-error adjustment ------------------------------------ */
    const postError = this.trials.filter((t) => t.response?.postError === true);
    const postCorrect = this.trials.filter((t) => t.response?.postError === false);
    const postErrorSlowing = median(correctRts(postError)) - median(correctRts(postCorrect));
    const postErrorAcc = acc(postError);
    const preErrorAcc = acc(postCorrect);
    const postErrorRecovery = Number.isFinite(preErrorAcc) && preErrorAcc > 0 ? postErrorAcc / preErrorAcc : NaN;

    /* --- pressure contrasts --------------------------------------- */
    const pressureDecrement = Number.isFinite(baselineAcc) && Number.isFinite(pressureAcc)
      ? baselineAcc - pressureAcc
      : NaN;
    const recoveryIndex = Number.isFinite(baselineAcc) && Number.isFinite(recoveryAcc)
      ? recoveryAcc - baselineAcc
      : NaN;
    const pressureRtChange = Number.isFinite(baselineRt) && Number.isFinite(pressureRt)
      ? pressureRt - baselineRt
      : NaN;
    const timeouts = pressure.filter((t) => t.outcome === 'timeout').length;
    const timeoutRate = pressure.length ? timeouts / pressure.length : NaN;

    // Did they trade accuracy for speed as the window closed? Compare the
    // first and second half of the pressure block.
    const half = Math.floor(pressure.length / 2);
    const satShift = half > 2 ? acc(pressure.slice(0, half)) - acc(pressure.slice(half)) : NaN;

    /* --- stability ------------------------------------------------- */
    const blockAccs = [baselineAcc, acc(interference), acc(switching), pressureAcc, recoveryAcc].filter(Number.isFinite);
    const stability = blockAccs.length > 1 && mean(blockAccs) > 0
      ? clamp(1 - stdev(blockAccs) / mean(blockAccs), 0, 1)
      : NaN;

    const M: [string, number, string, string?][] = [
      ['baseline_accuracy', baselineAcc, 'ratio', 'baseline'],
      ['baseline_rt', baselineRt, 'ms', 'baseline'],
      ['interference_cost_rt', interferenceRt, 'ms', 'interference'],
      ['interference_cost_accuracy', interferenceAcc, 'ratio', 'interference'],
      ['switch_cost_rt', switchCostRt, 'ms', 'switching'],
      ['switch_cost_accuracy', switchCostAcc, 'ratio', 'switching'],
      ['rule_change_cost', ruleChangeCost, 'ratio', 'pressure'],
      ['rule_change_rt_cost', ruleChangeRt, 'ms', 'pressure'],
      ['post_error_slowing', postErrorSlowing, 'ms'],
      ['post_error_accuracy', postErrorAcc, 'ratio'],
      ['post_error_recovery', postErrorRecovery, 'ratio'],
      ['accuracy_under_load', pressureAcc, 'ratio', 'pressure'],
      ['pressure_rt', pressureRt, 'ms', 'pressure'],
      ['pressure_decrement', pressureDecrement, 'ratio'],
      ['pressure_rt_change', pressureRtChange, 'ms'],
      ['pressure_timeout_rate', timeoutRate, 'ratio', 'pressure'],
      ['recovery_accuracy', recoveryAcc, 'ratio', 'recovery'],
      ['recovery_rt', recoveryRt, 'ms', 'recovery'],
      ['recovery_index', recoveryIndex, 'ratio'],
      ['stability', stability, 'ratio'],
      ['speed_accuracy_shift', satShift, 'ratio', 'pressure'],
      ['max_streak', this.maxStreak, 'count', 'pressure'],
    ];
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    // Anchors are provisional. 50% is chance on a two-choice task, so it
    // anchors the bottom of the accuracy scale; the cost anchors come from the
    // ranges typically reported for interference and task-switching studies.
    const loadAccuracy = normaliseSoft(pressureAcc, 0.95, 0.55);
    const resilience = normaliseSoft(Number.isFinite(pressureDecrement) ? pressureDecrement : 0.35, 0, 0.35);
    // Recovering to or above baseline is a full score; only falling short costs.
    const recoveryScore = normaliseSoft(Number.isFinite(recoveryIndex) ? Math.min(0, recoveryIndex) : -0.25, 0, -0.25);
    const interferenceControl = normaliseSoft(interferenceRt, 20, 180);
    const flexibility = normaliseSoft(switchCostRt, 40, 350);
    const errorRecovery = normaliseSoft(postErrorAcc, 0.95, 0.55);

    const ops = opsScore([
      { key: 'accuracy_under_load', value: loadAccuracy, weight: 0.24 },
      { key: 'pressure_resilience', value: resilience, weight: 0.22 },
      { key: 'recovery', value: recoveryScore, weight: 0.16 },
      { key: 'interference_control', value: interferenceControl, weight: 0.14 },
      { key: 'flexibility', value: flexibility, weight: 0.14 },
      { key: 'error_recovery', value: errorRecovery, weight: 0.10 },
    ]);

    rec.score('accuracy_under_load', loadAccuracy, '1.0.0');
    rec.score('pressure_resilience', resilience, '1.0.0');
    rec.score('recovery', recoveryScore, '1.0.0');
    rec.score('interference_control', interferenceControl, '1.0.0');
    rec.score('flexibility', flexibility, '1.0.0');
    rec.score('error_recovery', errorRecovery, '1.0.0');

    const pts = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '' : '−'}${Math.abs(Math.round(v * 100))} pont` : '—');
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : '—');

    return {
      opsScore: ops,
      headline: [
        { label: 'Pontosság nyomás alatt', value: pct(pressureAcc), hint: `alapvonal ${pct(baselineAcc)}` },
        { label: 'Nyomás alatti romlás', value: pts(pressureDecrement) },
        { label: 'Helyreállás', value: pts(recoveryIndex), hint: Number.isFinite(recoveryIndex) && recoveryIndex >= -0.03 ? 'teljes' : 'részleges' },
        { label: 'Interferencia-költség', value: ms(interferenceRt) },
        { label: 'Váltási költség', value: ms(switchCostRt) },
        { label: 'Hiba utáni pontosság', value: pct(postErrorAcc), hint: `lassulás ${ms(postErrorSlowing)}` },
      ],
      summary: {
        baseline: { accuracy: r(baselineAcc, 3), rtMs: r(baselineRt) },
        interference: { costRtMs: r(interferenceRt), costAccuracy: r(interferenceAcc, 3) },
        switching: { costRtMs: r(switchCostRt), costAccuracy: r(switchCostAcc, 3) },
        pressure: {
          accuracy: r(pressureAcc, 3), rtMs: r(pressureRt), decrement: r(pressureDecrement, 3),
          timeoutRate: r(timeoutRate, 3), ruleChangeCost: r(ruleChangeCost, 3),
          ruleChangeRtCost: r(ruleChangeRt), maxStreak: this.maxStreak, satShift: r(satShift, 3),
        },
        recovery: { accuracy: r(recoveryAcc, 3), rtMs: r(recoveryRt), index: r(recoveryIndex, 3) },
        postError: { slowingMs: r(postErrorSlowing), accuracy: r(postErrorAcc, 3), recovery: r(postErrorRecovery, 3) },
        stability: r(stability, 3),
        platform: ctx.platform,
        trialsScored: this.trials.length,
      },
      axisScores: {
        cognitive_control: (interferenceControl + flexibility + errorRecovery) / 3,
        workload: (loadAccuracy + resilience) / 2,
        reaction: normaliseSoft(baselineRt, 420, 900),
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.stopDistractor();
    this.machine?.abort();
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.stopDistractor();
    this.machine?.abort();
    ctx.panels.remove(this.cuePanel);
    ctx.panels.remove(this.stakePanel);
    ctx.panels.remove(this.feedbackPanel);
    this.cuePanel.dispose();
    this.stakePanel.dispose();
    this.feedbackPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
