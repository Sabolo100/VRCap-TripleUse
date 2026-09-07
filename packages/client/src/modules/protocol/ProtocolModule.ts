import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, median, clamp, normaliseSoft, opsScore,
  type ModuleManifest, type TrialRecord, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import { BodyAnchor } from '../shared/anchor.js';
import { viewRelation } from '../shared/volume.js';
import { fitAngles } from '../../engine/ui/viewport.js';

/**
 * MODULE 18 - PROTOCOL
 * Procedural discipline and checklist compliance.
 *
 * The question is not whether someone can learn a ten step procedure. It is
 * where they lose it: after an interruption, under a deadline, or when one
 * step quietly changes.
 *
 * The headset earns its place by splitting the one number the literature has
 * for this. `resumption_lag` - how long it takes to get going again after an
 * interruption - is a single figure on a screen. With the six stations spread
 * around the participant, no more than two are ever in view, so getting going
 * again has two separable parts: turning to the right station, and knowing
 * what to do once you are facing it. Someone who turns straight there and then
 * stands still has a memory problem. Someone who sweeps the room first has a
 * spatial place-keeping problem. One number hides that difference; two do not.
 */

type BlockId = 'learn' | 'baseline' | 'interrupted' | 'revised';
type Outcome = 'correct' | 'wrong_control' | 'omitted';

const STATIONS = 6;
const CONTROLS = 3;
const STEPS = 10;
const GUIDED_PASSES = 3;
const RUN_TIMEOUT_MS = 90_000;
const PRESSURE_TIMEOUT_MS = 38_000;
const REVISED_STEP = 6;
const CHANGE_NOTICE_MS = 8000;
const INTERRUPTION_TRIALS = 4;
const FACING_THRESHOLD_DEG = 30;
const PX_W = 520;
const PX_H = 354;

const CONTROL_KIND = ['switch', 'valve', 'confirm'] as const;
type ControlKind = (typeof CONTROL_KIND)[number];

interface Step {
  station: number;
  control: number;
}

interface StepRecord {
  blockId: BlockId;
  runIndex: number;
  stepIndex: number;
  expected: string;
  actual: string | null;
  outcome: Outcome;
  stepTimeMs: number;
  afterInterruption: boolean;
  guided: boolean;
  pressure: boolean;
  revised: boolean;
}

interface Resumption {
  runIndex: number;
  lagMs: number;
  reorientationMs: number;
  decisionMs: number;
  wrongStationVisits: number;
  resumedAtStep: number;
  correct: boolean;
}

interface RunResult {
  blockId: BlockId;
  runIndex: number;
  guided: boolean;
  pressure: boolean;
  revised: boolean;
  durationMs: number;
  correct: number;
  omitted: number;
  orderErrors: number;
  offProcedure: number;
  perseverations: number;
  completed: boolean;
}

export class ProtocolModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.PROTOCOL!;

  readonly blocks: BlockDescriptor[] = [

    {
      id: 'learn',
      title: 'TANULÁS',
      instruction: {
        vr:
          'Hat sorszámozott állomás vesz körül, mindegyiken három kezelőszerv: kapcsoló, szelep és ' +
          'visszaigazoló gomb. Az eljárás tíz lépés, meghatározott sorrendben. Háromszor végigvezetlek rajta: ' +
          'mindig a kivilágított kezelőszerv felé fordulj, mutass rá a sugárral, és húzd meg a ravaszt. ' +
          'Negyedszerre már magadtól kell — jegyezd meg a sorrendet.',
        desktop:
          'Hat sorszámozott állomás lesz előtted, mindegyiken három kezelőszerv: kapcsoló, szelep és ' +
          'visszaigazoló gomb. Az eljárás tíz lépés, meghatározott sorrendben. Háromszor végigvezetlek rajta: ' +
          'mindig a kivilágított kezelőszervre kattints. Negyedszerre már magadtól kell — jegyezd meg a sorrendet.',
        mobile:
          'Hat sorszámozott állomás lesz előtted, mindegyiken három kezelőszerv: kapcsoló, szelep és ' +
          'visszaigazoló gomb. Az eljárás tíz lépés, meghatározott sorrendben. Háromszor végigvezetlek rajta: ' +
          'mindig a kivilágított kezelőszervre koppints. Negyedszerre már magadtól kell — jegyezd meg a sorrendet.',
      },
      controlHint: '',
      trials: GUIDED_PASSES + 1,
      practiceTrials: 0,
      unitLabel: 'menet',
    },
    {
      id: 'baseline',
      title: 'ALAPVONAL',
      instruction:
        'Most kivilágítás nélkül hajtsd végre az eljárást, ugyanabban a sorrendben. Kétszer, nyugodt ' +
        'tempóban. Ha eltévesztesz egy lépést, az eljárás nem lép tovább: a következő helyes lépés ' +
        'ugyanaz marad.',
      controlHint: '',
      trials: 2,
      practiceTrials: 0,
      unitLabel: 'menet',
    },
    {
      id: 'interrupted',
      title: 'MEGSZAKÍTÁS',
      instruction: {
        vr:
          'Ugyanez, de közben kétszer félbeszakítalak egy rövid másik feladattal: egy panel jelenik meg négy ' +
          'alakzattal, és azt kell megmutatnod, melyik nem illik a többihez. Ha végeztél vele, fordulj vissza ' +
          'az eljáráshoz, és folytasd pontosan onnan, ahol abbahagytad.',
        desktop:
          'Ugyanez, de közben kétszer félbeszakítalak egy rövid másik feladattal: egy panel jelenik meg négy ' +
          'alakzattal, és arra kell kattintanod, amelyik nem illik a többihez. Ha végeztél vele, folytasd az ' +
          'eljárást pontosan onnan, ahol abbahagytad.',
        mobile:
          'Ugyanez, de közben kétszer félbeszakítalak egy rövid másik feladattal: egy panel jelenik meg négy ' +
          'alakzattal, és arra kell koppintanod, amelyik nem illik a többihez. Ha végeztél vele, folytasd az ' +
          'eljárást pontosan onnan, ahol abbahagytad.',
      },
      controlHint: '',
      trials: 2,
      practiceTrials: 0,
      unitLabel: 'menet',
    },
    {
      id: 'revised',
      title: 'NYOMÁS ÉS VÁLTOZÁS',
      instruction:
        'Két menet. Az elsőben fogy az idő — egy számláló mutatja —, de a sorrend fontosabb, mint a ' +
        'sebesség. A második előtt megváltoztatom az eljárás egy lépését, és ezt csak egyszer mondom el; ' +
        'utána az új lépés szerint hajtsd végre.',
      controlHint: '',
      trials: 2,
      practiceTrials: 0,
      unitLabel: 'menet',
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private anchor!: BodyAnchor;
  private stationPanels: Panel[] = [];
  private interruptPanel!: Panel;
  private statusPanel!: Panel;

  private procedure: Step[] = [];
  private revisedControl: Step | null = null;
  private interruptAfter: number[] = [4, 8];

  // Initialised here rather than in init(): the scoring and step-machine
  // logic is exercised in unit tests that never build a DOM panel.
  private switchOn: boolean[][] = grid(false);
  private valveSet: boolean[][] = grid(false);
  private flashUntil: number[][] = grid(0);

  private currentBlock: BlockId = 'learn';
  private runIndex = 0;
  private guided = false;
  private pressure = false;
  private revisedRun = false;
  private expected = 0;
  private omittedFlags: boolean[] = [];
  private lastStepT = 0;
  private aborted = false;
  private statusText = '';
  private countdownEnd = 0;

  private steps: StepRecord[] = [];
  private runs: RunResult[] = [];
  private resumptions: Resumption[] = [];
  private trialNumber = 0;

  private run: { end: number; resolve: () => void; started: number } | null = null;
  private interruption: {
    resolve: () => void; trial: number; correctIndex: number; startT: number; station: number;
  } | null = null;
  private resume: {
    startT: number; reorientDoneT: number | null; wrongStations: Set<number>;
  } | null = null;
  private facing: number | null = null;

  private offClick: (() => void) | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    ctx.recorder.setMotionHz(20);
    this.anchor = new BodyAnchor(ctx);
    this.anchor.capture();

    this.procedure = generateProcedure(ctx.rng);
    this.revisedControl = pickRevised(this.procedure, REVISED_STEP - 1, ctx.rng);
    // A one-step jitter so the interruption does not always land on the same
    // step of the procedure across participants.
    this.interruptAfter = [4 + ctx.rng.int(-1, 1), 8 + ctx.rng.int(-1, 1)];

    const w = this.panelWidth();
    for (let s = 0; s < STATIONS; s++) {
      const p = new Panel({
        width: w, height: (w * PX_H) / PX_W, pxPerMeter: PX_W / w,
        theme: ctx.theme, frame: true, name: `protocol-s${s}`, superSample: 2,
      });
      p.setDraw((ui) => this.drawStation(ui, s));
      ctx.root.add(p.group);
      ctx.panels.add(p);
      this.stationPanels.push(p);
    }

    this.interruptPanel = new Panel({
      width: w * 1.1, height: (w * 1.1 * PX_H) / PX_W, pxPerMeter: PX_W / (w * 1.1),
      theme: ctx.theme, frame: true, name: 'protocol-interrupt', superSample: 2,
    });
    this.interruptPanel.setDraw((ui) => this.drawInterruption(ui));
    this.interruptPanel.group.visible = false;
    ctx.root.add(this.interruptPanel.group);
    ctx.panels.add(this.interruptPanel);

    this.statusPanel = new Panel({
      width: ctx.platform === 'mobile' ? 0.8 : 1.0, height: 0.16,
      pxPerMeter: 700, theme: ctx.theme, frame: false, name: 'protocol-status', superSample: 2,
    });
    this.statusPanel.setDraw((ui) => this.drawStatus(ui));
    this.statusPanel.group.visible = false;
    ctx.root.add(this.statusPanel.group);
    ctx.panels.add(this.statusPanel);

    this.place();
    this.offClick = ctx.panels.onClick((e) => this.onPanelClick(e.panel, e.widget.id, e.t));
    for (const b of this.blocks) b.controlHint = this.controlHint();

    ctx.recorder.event('protocol_setup', {
      platform: ctx.platform,
      layout: ctx.platform === 'vr' ? 'surround' : 'flat',
      stationAzDeg: this.layout().map((l) => l[0]),
      stationElDeg: this.layout().map((l) => l[1]),
      procedure: this.procedure.map(name),
      controlTypes: CONTROL_KIND,
      revisedStepIndex: REVISED_STEP,
      revisedControl: this.revisedControl ? name(this.revisedControl) : null,
      interruptionAfter: this.interruptAfter,
      facingThresholdDeg: FACING_THRESHOLD_DEG,
      runTimeoutMs: RUN_TIMEOUT_MS,
      pressureTimeoutMs: PRESSURE_TIMEOUT_MS,
      quantisationMs: +(ctx.engine.clock.frameInterval || 11.1).toFixed(1),
    });
  }

  private panelWidth(): number {
    switch (this.ctx.platform) {
      case 'vr': return 0.50;
      case 'desktop': return 0.46;
      default: return 0.40;
    }
  }

  /**
   * Station directions. In VR they ring the participant at 60 degree spacing,
   * so at most two are ever in view and the checklist is never visible whole.
   * A flat viewport cannot show that, so it gets a 3x2 grid with everything
   * visible - a different measurement, and the spatial metrics drop out.
   */
  private layout(): [number, number][] {
    if (this.ctx.platform === 'vr') {
      return [[0, 0], [60, 0], [120, 0], [180, 0], [-120, 0], [-60, 0]];
    }
    return [[-26, 10], [0, 10], [26, 10], [-26, -10], [0, -10], [26, -10]];
  }

  private place(): void {
    const L = this.layout();
    const pos = new THREE.Vector3();
    const fitFor = (panel: Panel, azDeg: number, elDeg: number, distanceM: number) =>
      fitAngles(this.ctx, {
        azDeg, elDeg, distanceM, widthM: panel.width, heightM: panel.height,
      });
    for (let s = 0; s < STATIONS; s++) {
      // VR passes straight through and keeps the 60 degree ring; a flat
      // viewport gets the grid clamped to what it can actually show.
      const f = fitFor(this.stationPanels[s]!, L[s]![0], L[s]![1], 2.0);
      this.anchor.place(f.azDeg, f.elDeg, f.distanceM, pos);
      this.stationPanels[s]!.group.position.copy(pos);
      this.stationPanels[s]!.group.lookAt(this.anchor.origin);
    }
    // The interruption panel is deliberately somewhere that is not a station:
    // being pulled away is part of the manipulation.
    const fi = fitFor(this.interruptPanel,
      this.ctx.platform === 'vr' ? 30 : 0, this.ctx.platform === 'vr' ? -22 : 0, 1.7);
    this.anchor.place(fi.azDeg, fi.elDeg, fi.distanceM, pos);
    this.interruptPanel.group.position.copy(pos);
    this.interruptPanel.group.lookAt(this.anchor.origin);
    const fs = fitFor(this.statusPanel, 0, this.ctx.platform === 'vr' ? -30 : -26, 1.9);
    this.anchor.place(fs.azDeg, fs.elDeg, fs.distanceM, pos);
    this.statusPanel.group.position.copy(pos);
    this.statusPanel.group.lookAt(this.anchor.origin);
  }


  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'Fordulj az állomás felé · sugár a kezelőszervre + RAVASZ';
      case 'desktop': return 'Kattints a kezelőszervre';
      default: return 'Koppints a kezelőszervre';
    }
  }

  async calibrate(ctx: ModuleContext): Promise<void> {
    this.anchor.capture();
    this.place();
    this.statusPanel.group.visible = true;
    if (ctx.platform === 'vr') {
      this.setStatus('Fordulj körbe egyszer. Hat állomás van, sorszámozva — jegyezd meg, hol vannak.');
      await this.wait(6000);
    }
    this.statusPanel.group.visible = false;
    ctx.recorder.event('calibration_done', {
      anchorHeight: +this.anchor.eyeHeight.toFixed(3),
      anchorYawDeg: +((this.anchor.yaw * 180) / Math.PI).toFixed(1),
    });
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    if (practice) return;
    this.currentBlock = block.id as BlockId;
    this.anchor.ensure();
    this.statusPanel.group.visible = true;
    this.setMobileHint();

    switch (this.currentBlock) {
      case 'learn':
        for (let i = 0; i < GUIDED_PASSES; i++) {
          if (this.aborted) return;
          await this.execute({ runIndex: i, guided: true });
        }
        if (this.aborted) return;
        this.setStatus('Most magadtól, kivilágítás nélkül.');
        await this.wait(3000);
        await this.execute({ runIndex: GUIDED_PASSES, guided: false });
        break;

      case 'baseline':
        for (let i = 0; i < 2; i++) {
          if (this.aborted) return;
          await this.execute({ runIndex: i, guided: false });
        }
        break;

      case 'interrupted':
        for (let i = 0; i < 2; i++) {
          if (this.aborted) return;
          await this.execute({ runIndex: i, guided: false, interruptions: this.interruptAfter });
        }
        break;

      case 'revised':
        this.setStatus('Most fogy az idő. A sorrend fontosabb, mint a sebesség.');
        await this.wait(3500);
        await this.execute({ runIndex: 0, guided: false, pressure: true });
        if (this.aborted) return;
        await this.showChangeNotice();
        if (this.aborted) return;
        await this.execute({ runIndex: 1, guided: false, revised: true });
        break;
    }

    this.statusPanel.group.visible = false;
    for (const p of this.stationPanels) p.group.visible = true;
    this.ctx.mobileControls?.clear();
  }

  private setMobileHint(): void {
    const hints: Record<BlockId, string> = {
      learn: 'Kövesd a kivilágított kezelőszervet. Jegyezd meg a sorrendet.',
      baseline: 'Most magadtól, ugyanabban a sorrendben.',
      interrupted: 'Ha megszakítanak, utána folytasd onnan, ahol abbahagytad.',
      revised: 'Ugyanaz, de az idő fogy. Sorrend előbb, sebesség utána.',
    };
    // Hint only, no button bar: the answer IS the control on the panel, and a
    // bar would both cover the bottom row of stations and make the response
    // ambiguous. The hint takes no input, so it reserves no viewport inset.
    this.ctx.mobileControls?.set({ look: 'off', hint: hints[this.currentBlock] });
  }

  private async showChangeNotice(): Promise<void> {
    const old = this.procedure[REVISED_STEP - 1]!;
    const nu = this.revisedControl!;
    this.setStatus(
      `VÁLTOZÁS — a ${REVISED_STEP}. lépés mostantól nem a ${label(old)}, hanem a ${label(nu)}. Minden más marad.`
    );
    this.ctx.audio.warn();
    this.ctx.recorder.event('change_notice', {
      stepIndex: REVISED_STEP, oldControl: name(old), newControl: name(nu), shownMs: CHANGE_NOTICE_MS,
    });
    await this.wait(CHANGE_NOTICE_MS);
    this.setStatus('');
  }

  /* --------------------------------------------------------- execution */

  private activeProcedure(): Step[] {
    if (!this.revisedRun || !this.revisedControl) return this.procedure;
    const p = [...this.procedure];
    p[REVISED_STEP - 1] = this.revisedControl;
    return p;
  }

  private execute(opts: {
    runIndex: number; guided: boolean; pressure?: boolean; revised?: boolean; interruptions?: number[];
  }): Promise<void> {
    const ctx = this.ctx;
    const t0 = ctx.engine.clock.frameTime;
    this.runIndex = opts.runIndex;
    this.guided = opts.guided;
    this.pressure = !!opts.pressure;
    this.revisedRun = !!opts.revised;
    this.expected = 0;
    this.omittedFlags = new Array(STEPS).fill(false);
    this.lastStepT = t0;
    this.resume = null;
    this.pendingInterruptions = [...(opts.interruptions ?? [])];
    this.resetControls();
    this.setStatus(this.pressure ? '' : `${this.currentBlock === 'learn' && this.guided ? 'Kövesd a kivilágítást' : 'Indulhat'}`);

    const timeout = this.pressure ? PRESSURE_TIMEOUT_MS : RUN_TIMEOUT_MS;
    this.countdownEnd = this.pressure ? t0 + timeout : 0;
    ctx.recorder.event('run_start', {
      blockId: this.currentBlock, runIndex: opts.runIndex, guided: opts.guided,
      pressure: this.pressure, revised: this.revisedRun, timeoutMs: timeout,
      procedure: this.activeProcedure().map(name),
    });
    this.invalidateAll();

    return new Promise<void>((resolve) => {
      this.run = { end: t0 + timeout, resolve, started: t0 };
    });
  }

  private pendingInterruptions: number[] = [];

  private finishRun(t: number, completed: boolean): void {
    const r0 = this.run;
    if (!r0) return;
    this.run = null;
    // Anything still unreached at the end of the run is an omission - that is
    // only knowable now, which is why omissions are written at run end and not
    // when the step was skipped.
    for (let i = this.expected; i < STEPS; i++) this.omittedFlags[i] = true;
    const mine = this.steps.filter(
      (s) => s.blockId === this.currentBlock && s.runIndex === this.runIndex
    );
    for (let i = 0; i < STEPS; i++) {
      if (!this.omittedFlags[i]) continue;
      if (mine.some((s) => s.stepIndex === i && s.outcome !== 'omitted')) continue;
      this.pushStep({
        blockId: this.currentBlock, runIndex: this.runIndex, stepIndex: i,
        expected: name(this.activeProcedure()[i]!), actual: null, outcome: 'omitted',
        stepTimeMs: NaN, afterInterruption: false, guided: this.guided,
        pressure: this.pressure, revised: this.revisedRun,
      });
    }
    const scored = this.steps.filter(
      (s) => s.blockId === this.currentBlock && s.runIndex === this.runIndex
    );
    const result: RunResult = {
      blockId: this.currentBlock, runIndex: this.runIndex, guided: this.guided,
      pressure: this.pressure, revised: this.revisedRun,
      durationMs: t - r0.started,
      correct: scored.filter((s) => s.outcome === 'correct').length,
      omitted: scored.filter((s) => s.outcome === 'omitted').length,
      orderErrors: scored.filter((s) => s.outcome === 'wrong_control').length,
      offProcedure: this.offProcedureThisRun,
      perseverations: this.perseverationsThisRun,
      completed,
    };
    this.runs.push(result);
    this.offProcedureThisRun = 0;
    this.perseverationsThisRun = 0;
    this.ctx.recorder.event('run_end', {
      blockId: result.blockId, runIndex: result.runIndex,
      durationMs: Math.round(result.durationMs), correct: result.correct,
      omitted: result.omitted, orderErrors: result.orderErrors,
      offProcedure: result.offProcedure, perseverations: result.perseverations,
      completed,
    });
    this.setStatus(completed ? 'Menet kész.' : 'Lejárt az idő.');
    if (!completed) this.ctx.audio.error();
    if (this.interruptPanel) this.interruptPanel.group.visible = false;
    this.invalidateAll();
    r0.resolve();
  }

  private offProcedureThisRun = 0;
  private perseverationsThisRun = 0;

  private resetControls(): void {
    for (let s = 0; s < STATIONS; s++) {
      this.switchOn[s]!.fill(false);
      this.valveSet[s]!.fill(false);
      this.flashUntil[s]!.fill(0);
    }
  }

  /* ------------------------------------------------------------ clicks */

  private onPanelClick(panel: Panel, widgetId: string, t: number): void {
    if (this.interruption && panel === this.interruptPanel) {
      this.answerInterruption(widgetId, t);
      return;
    }
    if (!this.run || this.interruption) return;
    const station = this.stationPanels.indexOf(panel);
    if (station < 0) return;
    const control = Number(widgetId.replace('c', ''));
    if (!(control >= 0 && control < CONTROLS)) return;
    this.operate({ station, control }, t);
  }

  private operate(hit: Step, t: number): void {
    const proc = this.activeProcedure();
    const expectedStep = proc[this.expected]!;
    const id = name(hit);
    const afterInterruption = this.resume !== null;

    // Which procedural position, if any, this control belongs to.
    const idxInProcedure = proc.findIndex((s, i) => i >= this.expected && name(s) === id);
    this.animate(hit, t);

    if (idxInProcedure === this.expected) {
      const stepTime = t - this.lastStepT;
      this.lastStepT = t;
      this.pushStep({
        blockId: this.currentBlock, runIndex: this.runIndex, stepIndex: this.expected,
        expected: name(expectedStep), actual: id, outcome: 'correct',
        stepTimeMs: stepTime, afterInterruption, guided: this.guided,
        pressure: this.pressure, revised: this.revisedRun,
      });
      if (afterInterruption) this.closeResumption(t, this.expected, true);
      if (this.guided) this.ctx.audio.ok();
      this.expected++;
      this.maybeInterrupt(t);
      this.invalidateAll();
      if (this.expected >= STEPS) this.finishRun(t, true);
      return;
    }

    if (idxInProcedure > this.expected) {
      // A later step: the ones in between are now skipped, and the procedure
      // continues from there. That is how a real checklist failure looks -
      // not a stall, but a jump.
      for (let i = this.expected; i < idxInProcedure; i++) {
        this.omittedFlags[i] = true;
        this.pushStep({
          blockId: this.currentBlock, runIndex: this.runIndex, stepIndex: i,
          expected: name(proc[i]!), actual: null, outcome: 'omitted',
          stepTimeMs: NaN, afterInterruption, guided: this.guided,
          pressure: this.pressure, revised: this.revisedRun,
        });
      }
      this.ctx.recorder.event('omission', { stepIndex: this.expected, skippedTo: idxInProcedure });
      const stepTime = t - this.lastStepT;
      this.lastStepT = t;
      this.pushStep({
        blockId: this.currentBlock, runIndex: this.runIndex, stepIndex: idxInProcedure,
        expected: name(proc[idxInProcedure]!), actual: id, outcome: 'correct',
        stepTimeMs: stepTime, afterInterruption, guided: this.guided,
        pressure: this.pressure, revised: this.revisedRun,
      });
      if (afterInterruption) this.closeResumption(t, idxInProcedure, false);
      this.expected = idxInProcedure + 1;
      this.maybeInterrupt(t);
      this.invalidateAll();
      if (this.expected >= STEPS) this.finishRun(t, true);
      return;
    }

    // Neither the expected step nor a later one. A wrong control does NOT
    // advance the procedure: if it did, order errors and omissions would be
    // indistinguishable in the record.
    const inProcedure = proc.some((s) => name(s) === id);
    if (this.revisedRun && this.revisedControl
      && name(this.procedure[REVISED_STEP - 1]!) === id
      && this.expected === REVISED_STEP - 1) {
      this.perseverationsThisRun++;
      this.ctx.recorder.event('perseveration', { stepIndex: REVISED_STEP, usedControl: id });
    }
    if (inProcedure) {
      this.pushStep({
        blockId: this.currentBlock, runIndex: this.runIndex, stepIndex: this.expected,
        expected: name(expectedStep), actual: id, outcome: 'wrong_control',
        stepTimeMs: t - this.lastStepT, afterInterruption, guided: this.guided,
        pressure: this.pressure, revised: this.revisedRun,
      });
    } else {
      this.offProcedureThisRun++;
      this.ctx.recorder.event('off_procedure_action', { control: id, stepIndex: this.expected });
    }
    if (this.guided) this.ctx.audio.error();
    this.invalidateAll();
  }

  private animate(hit: Step, t: number): void {
    const kind = CONTROL_KIND[hit.control]!;
    if (kind === 'switch') this.switchOn[hit.station]![hit.control] = !this.switchOn[hit.station]![hit.control];
    else if (kind === 'valve') this.valveSet[hit.station]![hit.control] = !this.valveSet[hit.station]![hit.control];
    else this.flashUntil[hit.station]![hit.control] = t + 400;
  }

  private pushStep(s: StepRecord): void {
    this.steps.push(s);
    this.recordTrial(s);
  }

  /* ------------------------------------------------------ interruption */

  private maybeInterrupt(t: number): void {
    if (this.pendingInterruptions.length === 0) return;
    if (this.pendingInterruptions[0] !== this.expected) return;
    this.pendingInterruptions.shift();
    void this.runInterruption(t);
  }

  private async runInterruption(t: number): Promise<void> {
    const ctx = this.ctx;
    const station = ctx.rng.int(0, STATIONS - 1);
    this.interruptPanel.group.visible = true;
    ctx.audio.warn();
    ctx.recorder.event('interruption_start', {
      runIndex: this.runIndex, afterStep: this.expected, panelStation: station,
      trials: INTERRUPTION_TRIALS,
    });
    for (let i = 0; i < INTERRUPTION_TRIALS; i++) {
      if (this.aborted) return;
      await new Promise<void>((resolve) => {
        this.interruption = {
          resolve, trial: i,
          correctIndex: ctx.rng.int(0, 3),
          startT: ctx.engine.clock.frameTime,
          station,
        };
        this.interruptPanel.invalidate();
      });
    }
    const end = ctx.engine.clock.frameTime;
    this.interruptPanel.group.visible = false;
    this.interruption = null;
    ctx.recorder.event('interruption_end', {
      runIndex: this.runIndex, afterStep: this.expected, durationMs: Math.round(end - t),
    });
    // The clock for resumption starts when the interruption DISAPPEARS, not
    // when it began: the lag is about getting going again.
    this.resume = { startT: end, reorientDoneT: null, wrongStations: new Set() };
    this.lastStepT = end;
    this.invalidateAll();
  }

  private answerInterruption(widgetId: string, t: number): void {
    const it = this.interruption;
    if (!it || !widgetId.startsWith('int')) return;
    const idx = Number(widgetId.replace('int', ''));
    this.ctx.recorder.event('interruption_response', {
      trial: it.trial, correct: idx === it.correctIndex, rtMs: +(t - it.startT).toFixed(1),
    });
    const resolve = it.resolve;
    this.interruption = null;
    resolve();
  }

  private closeResumption(t: number, resumedAtStep: number, correct: boolean): void {
    const r0 = this.resume;
    if (!r0) return;
    this.resume = null;
    const lag = t - r0.startT;
    const reorient = r0.reorientDoneT !== null ? r0.reorientDoneT - r0.startT : NaN;
    const rec: Resumption = {
      runIndex: this.runIndex,
      lagMs: lag,
      reorientationMs: reorient,
      // The two parts sum to the whole by construction, so a run can never
      // report a decomposition that does not add up.
      decisionMs: Number.isFinite(reorient) ? lag - reorient : NaN,
      wrongStationVisits: r0.wrongStations.size,
      resumedAtStep,
      correct,
    };
    this.resumptions.push(rec);
    this.ctx.recorder.event('resumption', {
      runIndex: rec.runIndex, lagMs: Math.round(lag),
      reorientationMs: Number.isFinite(reorient) ? Math.round(reorient) : null,
      decisionMs: Number.isFinite(rec.decisionMs) ? Math.round(rec.decisionMs) : null,
      wrongStationVisits: rec.wrongStationVisits,
      resumedAtStep, correctResumption: correct,
    });
  }

  /* ------------------------------------------------------------- frame */

  update(_dt: number, ctx: ModuleContext): void {
    const t = ctx.engine.clock.frameTime;
    const f = this.currentFacing();
    if (f !== this.facing) {
      if (ctx.platform !== 'mobile') {
        ctx.recorder.event('station_gaze', { station: f, previous: this.facing });
      }
      this.facing = f;
    }
    const r0 = this.resume;
    if (r0 && r0.reorientDoneT === null && f !== null) {
      const target = this.activeProcedure()[this.expected]?.station;
      if (f === target) r0.reorientDoneT = t;
      else r0.wrongStations.add(f);
    }
    if (this.pressure && this.run) this.statusPanel.invalidate();
    if (this.run && t >= this.run.end && !this.interruption) this.finishRun(t, false);
  }

  /**
   * Which station the participant is oriented towards.
   *
   * In VR that is head direction within 30 degrees - not gaze, and named so.
   * On a desktop it is the station the pointer ray currently crosses, which is
   * a genuinely different quantity and therefore carries a different metric
   * name. On a phone there is no such thing at all before the tap lands.
   */
  private currentFacing(): number | null {
    const ctx = this.ctx;
    if (ctx.platform === 'mobile') return null;
    if (ctx.platform === 'vr') {
      const p = new THREE.Vector3();
      let best: number | null = null;
      let bestEcc = FACING_THRESHOLD_DEG;
      for (let s = 0; s < STATIONS; s++) {
        this.stationPanels[s]!.group.getWorldPosition(p);
        const rel = viewRelation(ctx.engine.camera, p);
        if (rel.eccentricityDeg < bestEcc) { bestEcc = rel.eccentricityDeg; best = s; }
      }
      return best;
    }
    const ray = ctx.engine.input.primaryRay();
    if (!ray) return null;
    const rc = new THREE.Raycaster(ray.origin, ray.direction, 0.1, 8);
    const meshes = this.stationPanels.map((p) => p.mesh);
    const hit = rc.intersectObjects(meshes, false)[0];
    return hit ? meshes.indexOf(hit.object as THREE.Mesh) : null;
  }

  /* ------------------------------------------------------------ drawing */

  private drawStation(ui: UI, station: number): void {
    const t = ui.t;
    ui.background(t.surface, 18);
    ui.text(String(station + 1), 22, 30, {
      size: 26, color: t.textMuted, weight: '700', font: t.fontMono,
    });
    ui.line(20, 54, ui.w - 20, 54, withAlpha(t.textMuted, 0.22), 2);

    const proc = this.activeProcedure();
    const expected = this.run && this.guided ? proc[this.expected] : null;
    const now = this.ctx.engine.clock.frameTime;

    for (let c = 0; c < CONTROLS; c++) {
      const x = 34 + c * 156;
      const y = 92;
      const w = 136;
      const h = 210;
      ui.hit(`c${c}`, x, y, w, h);
      const highlight = expected && expected.station === station && expected.control === c;
      ui.roundRect(x, y, w, h, 14,
        withAlpha(t.textMuted, 0.08),
        highlight ? t.accent : withAlpha(t.textMuted, 0.28), highlight ? 5 : 2);

      const kind = CONTROL_KIND[c]!;
      const cx = x + w / 2;
      if (kind === 'switch') {
        const on = this.switchOn[station]![c]!;
        ui.roundRect(cx - 26, y + 42, 52, 96, 12, withAlpha(t.textMuted, 0.16), withAlpha(t.textMuted, 0.3), 2);
        ui.roundRect(cx - 20, on ? y + 48 : y + 96, 40, 36, 9, on ? t.ok : withAlpha(t.textMuted, 0.5));
        ui.circle(cx, y + 162, 12, on ? t.ok : withAlpha(t.textMuted, 0.25), withAlpha(t.textMuted, 0.4), 2);
      } else if (kind === 'valve') {
        const set = this.valveSet[station]![c]!;
        ui.circle(cx, y + 92, 44, withAlpha(t.textMuted, 0.1), set ? t.accent : withAlpha(t.textMuted, 0.35), 3);
        const a = set ? -Math.PI / 4 : Math.PI / 2;
        ui.line(cx, y + 92, cx + Math.cos(a) * 36, y + 92 + Math.sin(a) * 36,
          set ? t.accent : t.textMuted, 5);
        ui.circle(cx + Math.cos(-Math.PI / 4) * 52, y + 92 + Math.sin(-Math.PI / 4) * 52, 5,
          withAlpha(t.accent, 0.8));
      } else {
        const flash = now < this.flashUntil[station]![c]!;
        ui.roundRect(cx - 44, y + 60, 88, 66, 14,
          flash ? t.accent2 : withAlpha(t.textMuted, 0.14),
          flash ? t.accent2 : withAlpha(t.textMuted, 0.35), 2);
        ui.text('OK', cx, y + 93, {
          size: 26, color: flash ? '#0a0d12' : t.textMuted, align: 'center',
          weight: '700', font: t.fontDisplay,
        });
      }
      ui.text(kind === 'switch' ? 'KAPCSOLÓ' : kind === 'valve' ? 'SZELEP' : 'VISSZAIG.',
        cx, y + h - 14, {
          size: 14, color: t.textMuted, align: 'center', font: t.fontMono, letterSpacing: '0.08em',
        });
    }
  }

  private drawInterruption(ui: UI): void {
    const t = ui.t;
    const it = this.interruption;
    ui.background(withAlpha(t.bad, 0.14), 18);
    ui.roundRect(0, 0, ui.w, ui.h, 18, 'rgba(0,0,0,0)', t.bad, 3);
    ui.text('MEGSZAKÍTÁS', ui.w / 2, 38, {
      size: 24, color: t.bad, align: 'center', weight: '700',
      font: t.fontMono, letterSpacing: '0.16em',
    });
    ui.text('Melyik nem illik a többihez?', ui.w / 2, 76, {
      size: 22, color: t.text, align: 'center',
    });
    if (!it) return;
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 118;
      const y = 116;
      const w = 100;
      const h = 150;
      ui.hit(`int${i}`, x, y, w, h);
      ui.roundRect(x, y, w, h, 14, withAlpha(t.textMuted, 0.1), withAlpha(t.textMuted, 0.3), 2);
      const cx = x + w / 2;
      const cy = y + h / 2;
      if (i === it.correctIndex) ui.roundRect(cx - 30, cy - 30, 60, 60, 6, t.accent);
      else ui.circle(cx, cy, 32, t.accent);
    }
  }

  private drawStatus(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.9), 14);
    if (this.pressure && this.run) {
      const left = Math.max(0, this.countdownEnd - this.ctx.engine.clock.frameTime) / 1000;
      ui.text(`${left.toFixed(1)} s`, ui.w / 2, ui.h / 2 - 10, {
        size: 40, color: left < 8 ? t.bad : t.accent, align: 'center',
        weight: '700', font: t.fontMono,
      });
      ui.bar(30, ui.h - 26, ui.w - 60, 10, clamp(left / (PRESSURE_TIMEOUT_MS / 1000), 0, 1),
        left < 8 ? t.bad : t.accent);
      return;
    }
    ui.text(this.statusText, ui.w / 2, ui.h / 2, {
      size: 24, color: t.text, align: 'center', weight: '600',
      font: t.fontDisplay, maxWidth: ui.w - 34,
    });
  }

  private setStatus(text: string): void {
    this.statusText = text;
    this.statusPanel?.invalidate();
  }

  private invalidateAll(): void {
    for (const p of this.stationPanels) p.invalidate();
    this.statusPanel?.invalidate();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ------------------------------------------------------------ trials */

  private recordTrial(s: StepRecord): void {
    // The three guided passes are teaching, not measurement.
    if (s.guided) return;
    this.trialNumber++;
    const rec: TrialRecord = {
      trialNumber: this.trialNumber,
      block: s.blockId,
      stimulus: {
        blockId: s.blockId, runIndex: s.runIndex, stepIndex: s.stepIndex + 1,
        expected: s.expected, afterInterruption: s.afterInterruption,
        pressure: s.pressure, revised: s.revised, facingStation: this.facing,
      },
      response: s.outcome === 'omitted' ? null : {
        actual: s.actual, stepTimeMs: Number.isFinite(s.stepTimeMs) ? Math.round(s.stepTimeMs) : null,
      },
      correct: s.outcome === 'correct',
      outcome: s.outcome === 'correct' ? 'hit' : s.outcome === 'omitted' ? 'miss' : 'false_alarm',
      reactionTimeMs: Number.isFinite(s.stepTimeMs) ? s.stepTimeMs : null,
      startedAt: 0,
      endedAt: 0,
    };
    this.ctx.recorder.trial(rec);
  }

  /* ------------------------------------------------------------ finish */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    const scored = this.steps.filter((s) => !s.guided);
    const scoredRuns = this.runs.filter((r0) => !r0.guided);
    const omitted = scored.filter((s) => s.outcome === 'omitted').length;
    const orderErrors = scored.filter((s) => s.outcome === 'wrong_control').length;
    const totalSteps = scoredRuns.length * STEPS;
    const accuracy = totalSteps > 0 ? clamp(1 - (omitted + orderErrors) / totalSteps, 0, 1) : NaN;
    const offProcedure = scoredRuns.reduce((a, r0) => a + r0.offProcedure, 0);

    const correctRate = (pred: (r0: RunResult) => boolean): number => {
      const rs = scoredRuns.filter(pred);
      return rs.length ? rs.reduce((a, r0) => a + r0.correct, 0) / (rs.length * STEPS) : NaN;
    };
    const baselineRate = correctRate((r0) => r0.blockId === 'baseline');
    const pressureRate = correctRate((r0) => r0.pressure);
    // Capped at 1: performing BETTER under a deadline is practice, not
    // discipline, and must not earn a bonus.
    const compliance = Number.isFinite(baselineRate) && Number.isFinite(pressureRate) && baselineRate > 0
      ? Math.min(1, pressureRate / baselineRate) : NaN;

    const learnRun = this.runs.find((r0) => r0.blockId === 'learn' && !r0.guided);
    const recall = learnRun ? learnRun.correct / STEPS : NaN;

    const lags = this.resumptions.map((r0) => r0.lagMs).filter(Number.isFinite);
    const resumptionLag = lags.length ? median(lags) : NaN;
    const reorients = this.resumptions.map((r0) => r0.reorientationMs).filter(Number.isFinite);
    const decisions = this.resumptions.map((r0) => r0.decisionMs).filter(Number.isFinite);
    const wrongVisits = this.resumptions.map((r0) => r0.wrongStationVisits);

    const afterInt = scored.filter((s) => s.afterInterruption);
    const elsewhere = scored.filter((s) => !s.afterInterruption && s.blockId === 'interrupted');
    const errRate = (xs: StepRecord[]) =>
      xs.length ? xs.filter((s) => s.outcome !== 'correct').length / xs.length : NaN;
    const postInterruptionError = Number.isFinite(errRate(afterInt)) && Number.isFinite(errRate(elsewhere))
      ? errRate(afterInt) - errRate(elsewhere) : NaN;

    const revisedRuns = scoredRuns.filter((r0) => r0.revised);
    const perseveration = revisedRuns.length
      ? revisedRuns.reduce((a, r0) => a + r0.perseverations, 0) / revisedRuns.length : NaN;

    const baseTimes = scored
      .filter((s) => s.blockId === 'baseline' && s.outcome === 'correct' && Number.isFinite(s.stepTimeMs))
      .map((s) => s.stepTimeMs);
    const stepTime = baseTimes.length ? median(baseTimes) : NaN;

    const M: [string, number, string, string?][] = [
      ['omitted_steps', omitted, 'count', 'overall'],
      ['order_errors', orderErrors, 'count', 'overall'],
      ['off_procedure_actions', offProcedure, 'count', 'overall'],
      ['procedural_accuracy', accuracy, 'ratio', 'overall'],
      ['resumption_lag', resumptionLag, 'ms', 'interrupted'],
      ['post_interruption_error_rate', postInterruptionError, 'ratio', 'interrupted'],
      ['compliance_under_pressure', compliance, 'ratio', 'revised'],
      ['sequence_recall_accuracy', recall, 'ratio', 'learn'],
      ['perseveration_rate', perseveration, 'count/run', 'revised'],
      ['step_time_median_ms', stepTime, 'ms', 'baseline'],
    ];
    if (isVr) {
      M.push(['reorientation_time', reorients.length ? median(reorients) : NaN, 'ms', 'interrupted']);
      M.push(['decision_time', decisions.length ? median(decisions) : NaN, 'ms', 'interrupted']);
      M.push(['wrong_station_visits', wrongVisits.length ? mean(wrongVisits) : NaN, 'count', 'interrupted']);
    } else if (ctx.platform === 'desktop') {
      // Deliberately a different name: a mouse sweep is not a body turn, and
      // the two must never share a norm group.
      M.push(['pointer_reorientation_time', reorients.length ? median(reorients) : NaN, 'ms', 'interrupted']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* --------------------------------------------------------- scores */

    const accScore = normaliseSoft(Number.isFinite(accuracy) ? accuracy : 0.5, 0.97, 0.72);
    const recovery = normaliseSoft(Number.isFinite(resumptionLag) ? resumptionLag : 9000, 1800, 8000);
    const pressureScore = normaliseSoft(Number.isFinite(compliance) ? compliance : 0.6, 1.0, 0.65);
    const retention = normaliseSoft(Number.isFinite(recall) ? recall : 0.4, 0.95, 0.50);
    const adaptation = normaliseSoft(Number.isFinite(perseveration) ? perseveration : 2, 0, 2);
    const placeKeeping = normaliseSoft(
      reorients.length ? median(reorients) : 5000, 900, 4500);

    const components = isVr
      ? [
          { key: 'procedural_accuracy', value: accScore, weight: 0.26 },
          { key: 'interruption_recovery', value: recovery, weight: 0.22 },
          { key: 'pressure_compliance', value: pressureScore, weight: 0.16 },
          { key: 'sequence_retention', value: retention, weight: 0.14 },
          { key: 'change_adaptation', value: adaptation, weight: 0.12 },
          { key: 'spatial_place_keeping', value: placeKeeping, weight: 0.10 },
        ]
      : [
          { key: 'procedural_accuracy', value: accScore, weight: 0.28 },
          { key: 'interruption_recovery', value: recovery, weight: 0.25 },
          { key: 'pressure_compliance', value: pressureScore, weight: 0.18 },
          { key: 'sequence_retention', value: retention, weight: 0.16 },
          { key: 'change_adaptation', value: adaptation, weight: 0.13 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const sec = (v: number) => (Number.isFinite(v) ? `${(v / 1000).toFixed(1)} s` : '—');

    const headline: ModuleResult['headline'] = [
      {
        label: 'Eljáráshűség', value: pct(accuracy),
        hint: totalSteps > 0 ? `${totalSteps} lépésből ${omitted + orderErrors} hiba` : undefined,
      },
      {
        label: 'Kihagyott lépés', value: String(omitted),
        hint: afterInt.length ? `${afterInt.filter((s) => s.outcome === 'omitted').length} megszakítás után` : undefined,
      },
      {
        label: 'Helyreállás megszakítás után', value: sec(resumptionLag),
        hint: isVr && reorients.length
          ? `ebből ${sec(median(reorients))} a visszatájékozódás`
          : 'a bontásához VR kell',
      },
      {
        label: 'Időnyomás alatt',
        value: Number.isFinite(compliance) ? compliance.toFixed(2) : '—',
        hint: Number.isFinite(compliance)
          ? (compliance > 0.95 ? 'a nyomás nem rontott' : `${Math.round((1 - compliance) * 100)}%-kal több hiba`)
          : undefined,
      },
      { label: 'Sorrend megőrzése', value: pct(recall), hint: 'három vezetett menet után' },
      {
        label: 'Változás átvétele',
        value: Number.isFinite(perseveration) ? `${perseveration.toFixed(1)} perszeveráció` : '—',
        hint: Number.isFinite(perseveration) && perseveration === 0
          ? 'azonnal átálltál az új lépésre' : 'a régi lépés még előjött',
      },
    ];

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        layout: isVr ? 'surround' : 'flat',
        spatialWeightsApplied: isVr,
        procedure: this.procedure.map(name),
        revisedStep: REVISED_STEP,
        revisedControl: this.revisedControl ? name(this.revisedControl) : null,
        steps: totalSteps,
        omitted, orderErrors, offProcedure,
        proceduralAccuracy: r(accuracy, 3),
        resumptionLagMs: r(resumptionLag),
        resumptions: this.resumptions.map((x) => ({
          runIndex: x.runIndex, lagMs: r(x.lagMs), reorientationMs: r(x.reorientationMs),
          decisionMs: r(x.decisionMs), wrongStationVisits: x.wrongStationVisits,
          resumedAtStep: x.resumedAtStep + 1, correct: x.correct,
        })),
        spatial: isVr ? {
          reorientationMs: r(reorients.length ? median(reorients) : NaN),
          decisionMs: r(decisions.length ? median(decisions) : NaN),
          wrongStationVisits: r(wrongVisits.length ? mean(wrongVisits) : NaN, 2),
        } : null,
        postInterruptionErrorRate: r(postInterruptionError, 3),
        complianceUnderPressure: r(compliance, 3),
        sequenceRecallAccuracy: r(recall, 3),
        perseverationRate: r(perseveration, 2),
        stepTimeMedianMs: r(stepTime),
        runs: this.runs.map((x) => ({
          blockId: x.blockId, runIndex: x.runIndex, guided: x.guided,
          pressure: x.pressure, revised: x.revised,
          durationMs: Math.round(x.durationMs), correct: x.correct,
          omitted: x.omitted, orderErrors: x.orderErrors, completed: x.completed,
        })),
      },
      axisScores: {
        executive: Math.round((accScore + recovery + adaptation) / 3),
        memory: Math.round(retention),
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.interruption?.resolve();
    this.interruption = null;
    const r0 = this.run;
    if (r0) { this.run = null; r0.resolve(); }
  }

  dispose(ctx: ModuleContext): void {
    this.aborted = true;
    this.offClick?.();
    for (const p of this.stationPanels) { ctx.panels.remove(p); p.dispose(); }
    ctx.panels.remove(this.interruptPanel);
    ctx.panels.remove(this.statusPanel);
    this.interruptPanel.dispose();
    this.statusPanel.dispose();
    disposeTree(ctx.root);
  }
}

/* ------------------------------------------------------------- helpers */

export function name(s: Step): string {
  return `s${s.station}:${CONTROL_KIND[s.control]}`;
}

function label(s: Step): string {
  const kind = CONTROL_KIND[s.control]!;
  const word = kind === 'switch' ? 'kapcsoló' : kind === 'valve' ? 'szelep' : 'visszaigazoló';
  return `${s.station + 1}. állomás ${word}ja`;
}

/**
 * Ten distinct controls, with no two consecutive steps on the same station.
 *
 * The constraint is what makes every step a move: without it a run could
 * collapse into three taps on one panel, and neither the reorientation
 * measure nor the interruption cost would have anything to bite on.
 */
export function generateProcedure(rng: Rng): Step[] {
  const all: Step[] = [];
  for (let s = 0; s < STATIONS; s++) for (let c = 0; c < CONTROLS; c++) all.push({ station: s, control: c });
  for (let attempt = 0; attempt < 64; attempt++) {
    const pool = rng.shuffle(all);
    const out: Step[] = [];
    for (const cand of pool) {
      if (out.length >= STEPS) break;
      if (out.length && out[out.length - 1]!.station === cand.station) continue;
      out.push(cand);
    }
    if (out.length === STEPS) return out;
  }
  // Deterministic fallback: walk the stations in order, which satisfies the
  // constraint by construction.
  const out: Step[] = [];
  for (let i = 0; i < STEPS; i++) out.push({ station: i % STATIONS, control: i % CONTROLS });
  return out;
}

/** A replacement control for the revised step: a different station from both
 *  neighbours, so the change cannot be executed by habit. */
export function pickRevised(procedure: Step[], index: number, rng: Rng): Step {
  const before = procedure[index - 1]?.station;
  const after = procedure[index + 1]?.station;
  const used = new Set(procedure.map(name));
  const options: Step[] = [];
  for (let s = 0; s < STATIONS; s++) {
    if (s === before || s === after) continue;
    for (let c = 0; c < CONTROLS; c++) {
      const cand = { station: s, control: c };
      if (!used.has(name(cand))) options.push(cand);
    }
  }
  return options.length ? rng.pick(options) : { station: (before ?? 0) + 2 % STATIONS, control: 0 };
}

function grid<T>(v: T): T[][] {
  return Array.from({ length: STATIONS }, () => new Array<T>(CONTROLS).fill(v));
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
