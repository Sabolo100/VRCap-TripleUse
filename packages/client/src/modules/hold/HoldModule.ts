import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, stdev, percentile, normaliseSoft, opsScore, clamp, sdt,
  type ModuleManifest, type TrialRecord, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { volumePosition, Tumbler } from '../shared/volume.js';

/**
 * MODULE 08 - HOLD
 * Response inhibition.
 *
 * Objects fly TOWARDS the participant rather than appearing on a surface, and
 * that changes what can be measured:
 *
 *   The deadline is physical. On a screen the response window is a number the
 *   experimenter picked. Here it is the object arriving - visible, estimable,
 *   and felt. Urgency is intrinsic rather than instructed.
 *
 *   Commitment becomes observable. The stimulus grows and clarifies over the
 *   whole flight, so WHEN the participant commits is itself a measure:
 *   `commitment_fraction` separates someone who waits for evidence from
 *   someone who fires on the first impression.
 *
 *   The trajectory can be the decision. In block 3 colour is irrelevant and
 *   only objects actually on a collision course require a response. Judging
 *   that needs depth and expansion cues, which a flat display does not provide.
 *
 * The scientific core is block 2: the stop-signal task. Go/no-go tells you HOW
 * OFTEN inhibition failed; only a stop-signal staircase tells you HOW FAST the
 * inhibitory process is (SSRT), and that is the number that survives across
 * device classes because the motor chain cancels out of the subtraction.
 */

type BlockId = 'gonogo' | 'stop' | 'trajectory' | 'reversal';
type TrialType = 'go' | 'nogo_red' | 'nogo_blue' | 'stop' | 'hit_path' | 'miss_path';
type ShapeKind = 'box' | 'sphere' | 'cone' | 'torus';

const RED = 0xff4d4d;
const BLUE = 0x3d9dff;
const NEUTRAL = 0x8fa6bf;
const WHITE = 0xffffff;
const PASS_RADIUS = 1.2;
const HEAD_RADIUS = 0.35;

interface Flight {
  type: TrialType;
  shapeKind: ShapeKind;
  colorKind: 'red' | 'blue' | 'neutral';
  pulsing: boolean;
  travelMs: number;
  startAzDeg: number;
  startElDeg: number;
  startRadius: number;
  collision: boolean;
  /** Lateral offset of the pass-by point, metres. 0 for collision courses. */
  missOffset: number;
  ssdMs: number | null;
}

interface LiveFlight extends Flight {
  launchT: number;
  arrivalT: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  responded: boolean;
  stopFired: boolean;
  afterReversal: boolean;
  resolve: (r: { responded: boolean; rtMs: number | null; fraction: number; early: boolean }) => void;
}

export class HoldModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.HOLD!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'gonogo',
      title: 'GO / NO-GO',
      instruction:
        'Testek repülnek feléd. HÚZD MEG A RAVASZT arra, amelyik PIROS ÉS PULZÁL — még mielőtt ideérne. ' +
        'A piros, de nem pulzáló testre, és minden kék testre NE nyomj semmit: hagyd elrepülni. ' +
        'A legtöbb test go lesz — ettől lesz nehéz visszatartani a választ, amikor kell.',
      controlHint: '',
      trials: 60,
      practiceTrials: 8,
    },
    {
      id: 'stop',
      title: 'STOP-JEL',
      instruction:
        'Most MINDEN testre reagálnod kell — kivéve, ha repülés közben FEHÉRRE VÁLT és megszólal egy hang. ' +
        'Akkor tartsd vissza a választ. A jel néha korán jön, néha az utolsó pillanatban. ' +
        'Ha egyszer sem sikerül megállnod, az azt jelenti, hogy túl korán kötelezed el magad.',
      controlHint: '',
      trials: 56,
      practiceTrials: 8,
    },
    {
      id: 'trajectory',
      title: 'PÁLYA',
      instruction:
        'A szín most nem számít — minden test szürke. Csak arra húzd meg a ravaszt, amelyik ELTALÁLNA. ' +
        'Amelyik elmegy melletted, arra ne. Ehhez meg kell ítélned, merre tart a test a térben.',
      controlHint: '',
      trials: 36,
      practiceTrials: 6,
    },
    {
      id: 'reversal',
      title: 'SZABÁLYVÁLTÁS',
      instruction:
        'Ugyanaz a szabály, mint az első blokkban: piros + pulzáló → ravasz. ' +
        'De a blokk közepén a szabály MEG FOG FORDULNI. Figyelj a jelzésre, mert onnantól ' +
        'pont az ellenkezője lesz igaz.',
      controlHint: '',
      trials: 40,
      practiceTrials: 4,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private shapes = new Map<ShapeKind, THREE.Mesh>();
  private activeMesh: THREE.Mesh | null = null;
  private passRing!: THREE.Mesh;
  private rulePanel!: Panel;
  private feedbackPanel!: Panel;
  private tumbler = new Tumbler();

  private currentBlock: BlockId = 'gonogo';
  private practice = false;
  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;

  private live: LiveFlight | null = null;
  private reversed = false;
  private lastWasError = false;
  private feedbackText = '';
  private ruleText = '';

  /** Stop-signal staircase state. */
  private ssd = 250;
  private ssdHistory: number[] = [];

  /** Per-trial results kept for scoring. */
  private records: {
    block: BlockId; type: TrialType; responded: boolean; rtMs: number | null;
    fraction: number; ssdMs: number | null; stopFired: boolean; correct: boolean;
    afterReversal: boolean; travelMs: number;
  }[] = [];

  private headTrackSamples: number[] = [];
  private sampleTimer = 0;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    for (const kind of ['box', 'sphere', 'cone', 'torus'] as ShapeKind[]) {
      const m = makePrimitive({ kind, color: RED, unlit: true, size: 0.34 });
      m.visible = false;
      this.root.add(m);
      this.shapes.set(kind, m);
    }

    // A faint ring at the pass distance: it makes "arrival" a visible place in
    // the world rather than an invisible deadline.
    this.passRing = makePrimitive({
      kind: 'torus', color: ctx.theme.textMuted, unlit: true, opacity: 0.18, size: PASS_RADIUS * 2,
    });
    this.passRing.rotation.x = Math.PI / 2;
    this.passRing.position.y = 1.6;
    this.root.add(this.passRing);

    const flat = ctx.platform !== 'vr';
    this.rulePanel = new Panel({
      width: 0.52, height: 0.13, pxPerMeter: 1000, theme: ctx.theme, frame: false, name: 'hold-rule',
    });
    this.rulePanel.group.position.set(0, 2.16, flat ? -1.9 : -2.3);
    this.rulePanel.setDraw((ui) => this.drawRule(ui));
    this.rulePanel.group.visible = false;
    this.root.add(this.rulePanel.group);
    ctx.panels.add(this.rulePanel);

    this.feedbackPanel = new Panel({
      width: 0.8, height: 0.18, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'hold-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.14, flat ? -1.9 : -2.3);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
  }

  private controlHint(block: BlockId): string {
    const p = this.ctx.platform;
    const press = p === 'vr' ? 'Húzd meg a ravaszt' : p === 'mobile' ? 'Koppints' : 'Kattints vagy nyomj SZÓKÖZT';
    switch (block) {
      case 'gonogo':
      case 'reversal':
        return `${press}, ha a test PIROS ÉS PULZÁL. Minden másra ne nyomj semmit — hagyd elrepülni.`;
      case 'stop':
        return `${press} minden testre — kivéve, ha közben FEHÉRRE VÁLT és megszólal a hang.`;
      case 'trajectory':
        return `${press} arra, ami ELTALÁLNA. Ami elmegy melletted, arra ne.`;
    }
  }

  /* -------------------------------------------------- flight generation */

  /**
   * Where a flight may start.
   *
   * The azimuth used to be +/- 70 degrees, which is outside the Quest 3's
   * roughly +/- 55 degree half-field: the object was literally off-display at
   * onset and only became visible once it had travelled some way in. This
   * module measures inhibition - go/no-go accuracy and stop-signal reaction
   * time - and a stimulus you cannot see at onset puts an unknown search
   * period inside every reaction time, which is precisely the quantity SSRT
   * is subtracting.
   *
   * 38 degrees keeps the whole flight on-display from the first frame while
   * still using the affordance this module actually claims: approach along a
   * trajectory, judged from expansion and depth. Finding things around you is
   * WATCH's construct, not this one.
   */
  private geometry() {
    switch (this.ctx.platform) {
      case 'vr': return { az: 38, el: 18, missNear: 0.9, missFar: 1.8 };
      case 'mobile': return { az: 20, el: 11, missNear: 2.6, missFar: 3.8 };
      default: return { az: 24, el: 12, missNear: 2.4, missFar: 3.6 };
    }
  }

  private buildFlights(block: BlockId, count: number, rng: Rng): Flight[] {
    const g = this.geometry();
    const shapes: ShapeKind[] = ['box', 'sphere', 'cone', 'torus'];
    const base = (): Omit<Flight, 'type' | 'colorKind' | 'pulsing' | 'collision' | 'missOffset' | 'ssdMs'> => ({
      shapeKind: rng.pick(shapes),
      travelMs: rng.range(1600, 3600),
      startAzDeg: rng.range(-g.az, g.az),
      startElDeg: rng.range(-g.el, g.el),
      startRadius: rng.range(9, 14),
    });

    const out: Flight[] = [];

    if (block === 'gonogo' || block === 'reversal') {
      // 72% go. The go majority is the point: without a prepotent response
      // there is nothing to inhibit, and commission errors stop being informative.
      const nGo = Math.round(count * 0.72);
      const nNoGo = count - nGo;
      const nRed = Math.round(nNoGo / 2);
      for (let i = 0; i < nGo; i++) {
        out.push({ ...base(), type: 'go', colorKind: 'red', pulsing: true, collision: true, missOffset: 0, ssdMs: null });
      }
      for (let i = 0; i < nRed; i++) {
        // The harder no-go: colour says go, only the missing pulse says stop.
        out.push({ ...base(), type: 'nogo_red', colorKind: 'red', pulsing: false, collision: true, missOffset: 0, ssdMs: null });
      }
      for (let i = 0; i < nNoGo - nRed; i++) {
        out.push({ ...base(), type: 'nogo_blue', colorKind: 'blue', pulsing: rng.bool(), collision: true, missOffset: 0, ssdMs: null });
      }
      return rng.shuffle(out);
    }

    if (block === 'stop') {
      const nStop = Math.round(count * 0.28);
      for (let i = 0; i < count; i++) {
        out.push({
          ...base(), type: i < nStop ? 'stop' : 'go',
          colorKind: 'red', pulsing: true, collision: true, missOffset: 0, ssdMs: null,
        });
      }
      return rng.shuffle(out);
    }

    // Trajectory: colour carries nothing, only the path matters.
    const nHit = Math.round(count * 0.5);
    for (let i = 0; i < count; i++) {
      const collision = i < nHit;
      out.push({
        ...base(), type: collision ? 'hit_path' : 'miss_path',
        colorKind: 'neutral', pulsing: false, collision,
        missOffset: collision ? 0 : rng.range(g.missNear, g.missFar) * (rng.bool() ? 1 : -1),
        ssdMs: null,
      });
    }
    return rng.shuffle(out);
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    this.reversed = false;
    this.lastWasError = false;
    if (this.currentBlock === 'stop') {
      this.ssd = 250;
      this.ssdHistory = [];
    }

    const flights = this.buildFlights(this.currentBlock, count, ctx.rng);
    const reversalAt = this.currentBlock === 'reversal' && !practice ? Math.round(count * 0.5) : -1;

    this.ruleText = this.ruleLabel();
    this.rulePanel.group.visible = true;
    this.rulePanel.invalidate();
    this.passRing.visible = true;

    for (let i = 0; i < flights.length && !this.aborted; i++) {
      ctx.recorder.trialNumber = i + 1;

      if (i === reversalAt && !this.reversed) {
        this.reversed = true;
        this.ruleText = 'SZABÁLY MEGFORDULT';
        this.rulePanel.invalidate();
        ctx.recorder.event('rule_reversal', { trialIndex: i });
        ctx.audio.warn();
        await this.wait(1500);
        this.ruleText = this.ruleLabel();
        this.rulePanel.invalidate();
      }

      await this.wait(ctx.rng.range(700, 1400));
      if (this.aborted) break;
      await this.runFlight(flights[i]!);
    }

    this.rulePanel.group.visible = false;
    this.passRing.visible = false;
    this.hideObject();
  }

  private ruleLabel(): string {
    switch (this.currentBlock) {
      case 'trajectory': return 'ELTALÁL → REAGÁLJ';
      case 'stop': return 'MINDEN → REAGÁLJ · FEHÉR → ÁLLJ';
      default: return this.reversed ? 'NEM PULZÁLÓ PIROS → REAGÁLJ' : 'PULZÁLÓ PIROS → REAGÁLJ';
    }
  }

  private runFlight(f: Flight): Promise<void> {
    return new Promise((resolve) => {
      void this.launch(f, resolve);
    });
  }

  private async launch(f: Flight, done: () => void): Promise<void> {
    const ctx = this.ctx;
    const mesh = this.shapes.get(f.shapeKind)!;
    this.activeMesh = mesh;

    const from = volumePosition(f.startAzDeg, f.startElDeg, f.startRadius, 1.6);
    // Collision courses aim at the head; misses aim at a laterally offset
    // point at the same distance, so the two differ only in trajectory.
    const toBase = new THREE.Vector3(0, 1.6, 0);
    const lateral = new THREE.Vector3(-from.z, 0, from.x).normalize();
    const to = f.collision
      ? toBase.clone().add(lateral.clone().multiplyScalar(ctx.rng.range(-HEAD_RADIUS * 0.6, HEAD_RADIUS * 0.6)))
      : toBase.clone().add(lateral.clone().multiplyScalar(f.missOffset));

    mesh.position.copy(from);
    mesh.scale.setScalar(0.34);
    mesh.visible = true;
    this.tumbler.clear();
    this.tumbler.add(mesh, ctx.rng, 0.6, 1.6);
    this.applyColor(mesh, f.colorKind, 1);

    const launchT = ctx.engine.clock.frameTime;
    const arrivalT = launchT + f.travelMs;
    this.headTrackSamples = [];

    // Stop signal: only schedule it if there is still real time left after the
    // delay. Otherwise the staircase would be measuring the flight length
    // rather than the participant's inhibition.
    let ssdMs: number | null = null;
    if (f.type === 'stop') {
      const candidate = this.ssd;
      ssdMs = candidate + 300 <= f.travelMs ? candidate : null;
    }

    const live: LiveFlight = {
      ...f, ssdMs,
      launchT, arrivalT, from, to,
      responded: false, stopFired: false,
      afterReversal: this.reversed,
      resolve: () => {},
    };

    const finish = (r: { responded: boolean; rtMs: number | null; fraction: number; early: boolean }) => {
      this.live = null;
      this.hideObject();
      this.commit(live, r);
      done();
    };
    live.resolve = finish;
    this.live = live;

    ctx.recorder.event('object_launched', {
      shapeKind: f.shapeKind, colorKind: f.colorKind, pulsing: f.pulsing,
      travelMs: Math.round(f.travelMs), startAz: +f.startAzDeg.toFixed(1),
      startEl: +f.startElDeg.toFixed(1), startRadius: +f.startRadius.toFixed(2),
      trialType: f.type, collision: f.collision, ssdMs,
      quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
    }, launchT);

    // Watchdog: if nothing happens the object simply passes.
    setTimeout(() => {
      const l = this.live;
      if (!l || l !== live || l.responded) return;
      ctx.recorder.event('object_passed', { responded: false, trialType: f.type });
      finish({ responded: false, rtMs: null, fraction: 1, early: false });
    }, f.travelMs + 220);
  }

  private applyColor(mesh: THREE.Mesh, kind: 'red' | 'blue' | 'neutral' | 'white', brightness: number): void {
    const hex = kind === 'red' ? RED : kind === 'blue' ? BLUE : kind === 'white' ? WHITE : NEUTRAL;
    const c = new THREE.Color(hex);
    c.multiplyScalar(brightness);
    (mesh.material as THREE.MeshBasicMaterial).color.copy(c);
  }

  private hideObject(): void {
    if (this.activeMesh) {
      this.activeMesh.visible = false;
      this.tumbler.remove(this.activeMesh);
    }
    this.activeMesh = null;
  }

  /* ---------------------------------------------------------- response */

  private onAction(e: ActionEvent): void {
    if (!e.down || e.action !== 'PRIMARY') return;
    const live = this.live;
    if (!live || live.responded) return;

    const elapsed = e.t - live.launchT;
    const fraction = clamp(elapsed / live.travelMs, 0, 1);

    if (fraction < 0.15) {
      live.responded = true;
      this.ctx.recorder.event('early_reject', { fraction: +fraction.toFixed(3) });
      this.ctx.audio.error();
      if (this.practice) this.showFeedback('TÚL KORAI', false);
      live.resolve({ responded: true, rtMs: elapsed, fraction, early: true });
      return;
    }

    live.responded = true;
    this.ctx.recorder.event('hold_response', {
      rtMs: +elapsed.toFixed(1), commitmentFraction: +fraction.toFixed(3),
      trialType: live.type, stopFired: live.stopFired,
    }, e.t);
    this.ctx.engine.input.pulse(e.hand === 'none' ? 'both' : e.hand, 0.3, 22);
    live.resolve({ responded: true, rtMs: elapsed, fraction, early: false });
  }

  /** Should a response have been made on this flight, under the rule in force? */
  private shouldRespond(f: LiveFlight): boolean {
    switch (this.currentBlock) {
      case 'trajectory':
        return f.collision;
      case 'stop':
        return !f.stopFired;
      default: {
        const isPulsingRed = f.colorKind === 'red' && f.pulsing;
        const isSteadyRed = f.colorKind === 'red' && !f.pulsing;
        // After the reversal the two red cases swap; blue is never a go.
        if (f.afterReversal) return isSteadyRed;
        return isPulsingRed;
      }
    }
  }

  private commit(f: LiveFlight, r: { responded: boolean; rtMs: number | null; fraction: number; early: boolean }): void {
    const expected = this.shouldRespond(f);
    const correct = r.early ? false : r.responded === expected;

    if (r.early) {
      // An early fire is neither a hit nor an inhibition failure in the usual
      // sense: it happened before the stimulus could be identified. It is
      // recorded, and kept out of the staircase.
      this.pushTrial(f, r, 'invalid', false);
      this.lastWasError = true;
      return;
    }

    if (this.currentBlock === 'stop' && f.stopFired) {
      // Staircase: harder after a successful stop, easier after a failure.
      // This converges on p(respond|signal) = 0.5, which is the condition
      // the SSRT estimate depends on.
      const stopped = !r.responded;
      const used = f.ssdMs ?? this.ssd;
      this.ssdHistory.push(used);
      this.ssd = clamp(this.ssd + (stopped ? 50 : -50), 50, 1200);
      this.ctx.recorder.event('ssd_step', { direction: stopped ? 'up' : 'down', newSsdMs: this.ssd });
    }

    if (!r.responded) {
      this.ctx.recorder.event('hold_inhibited', { trialType: f.type, ssdMs: f.ssdMs });
    }

    const outcome = expected
      ? (r.responded ? 'hit' : 'miss')
      : (r.responded ? 'false_alarm' : 'correct_reject');
    this.pushTrial(f, r, outcome, correct);
    this.lastWasError = !correct;

    if (this.practice) {
      if (correct && r.responded) this.showFeedback(`${Math.round(r.rtMs ?? 0)} ms`, true);
      else if (correct) this.showFeedback('VISSZATARTVA', true);
      else if (r.responded) this.showFeedback('NEM KELLETT VOLNA', false);
      else this.showFeedback('KIMARADT', false);
    }
  }

  private pushTrial(
    f: LiveFlight,
    r: { responded: boolean; rtMs: number | null; fraction: number },
    outcome: TrialRecord['outcome'],
    correct: boolean
  ): void {
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block: this.currentBlock,
      stimulus: {
        kind: 'hold', block: this.currentBlock, trialType: f.type,
        shapeKind: f.shapeKind, colorKind: f.colorKind, pulsing: f.pulsing,
        travelMs: Math.round(f.travelMs), startAzDeg: +f.startAzDeg.toFixed(1),
        startElDeg: +f.startElDeg.toFixed(1), startRadius: +f.startRadius.toFixed(2),
        ssdMs: f.ssdMs, stopSignalFired: f.stopFired, collision: f.collision,
        afterReversal: f.afterReversal, platform: this.ctx.platform, practice: this.practice,
      },
      response: r.responded
        ? { rtMs: r.rtMs === null ? null : +r.rtMs.toFixed(1), commitmentFraction: +r.fraction.toFixed(3), responded: true }
        : null,
      correct,
      outcome,
      reactionTimeMs: r.rtMs === null ? null : +r.rtMs.toFixed(1),
      startedAt: +f.launchT.toFixed(1),
      endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
    };
    this.ctx.recorder.trial(rec);
    if (!this.practice) {
      this.trials.push(rec);
      this.records.push({
        block: this.currentBlock, type: f.type, responded: r.responded, rtMs: r.rtMs,
        fraction: r.fraction, ssdMs: f.ssdMs, stopFired: f.stopFired, correct,
        afterReversal: f.afterReversal, travelMs: f.travelMs,
      });
    }
  }

  private showFeedback(text: string, good: boolean): void {
    this.feedbackText = text;
    this.feedbackGood = good;
    this.feedbackPanel.group.visible = true;
    this.feedbackPanel.invalidate();
    good ? this.ctx.audio.ok() : this.ctx.audio.error();
    setTimeout(() => { this.feedbackPanel.group.visible = false; }, 600);
  }

  private feedbackGood = true;

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.tumbler.update(dt);
    const live = this.live;
    if (!live) return;

    const now = ctx.engine.clock.frameTime;
    const elapsed = now - live.launchT;
    const t = clamp(elapsed / live.travelMs, 0, 1);
    const mesh = this.activeMesh;
    if (!mesh) return;

    mesh.position.lerpVectors(live.from, live.to, t);

    // Stop signal: the object turns white and a tone sounds at the same frame.
    if (live.ssdMs !== null && !live.stopFired && elapsed >= live.ssdMs) {
      live.stopFired = true;
      this.applyColor(mesh, 'white', 2.4);
      ctx.audio.tone({ freq: 320, durationMs: 120, gain: 0.3 });
      ctx.recorder.event('stop_signal', {
        ssdMs: Math.round(live.ssdMs),
        remainingMs: Math.round(live.travelMs - elapsed),
        elapsedMs: Math.round(elapsed),
      }, now);
    }

    if (!live.stopFired) {
      // The go feature: a 3.3 Hz brightness pulse, visible from any angle so a
      // tumbling object is never disadvantaged.
      const brightness = live.pulsing ? 0.45 + 0.55 * (0.5 - 0.5 * Math.cos((now / 1000) * 3.3 * Math.PI * 2)) : 0.85;
      this.applyColor(mesh, live.colorKind, brightness);
    }

    // Head tracking gain: did the participant follow the object, or wait?
    this.sampleTimer += dt;
    if (this.sampleTimer >= 0.04) {
      this.sampleTimer = 0;
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      ctx.engine.camera.getWorldQuaternion(q);
      ctx.engine.camera.getWorldPosition(p);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const toObj = mesh.position.clone().sub(p).normalize();
      this.headTrackSamples.push(THREE.MathUtils.radToDeg(fwd.angleTo(toObj)));
    }
  }

  /* --------------------------------------------------------------- UI */

  private drawRule(ui: UI): void {
    const t = ui.t;
    const isReversal = this.ruleText.includes('MEGFORDULT');
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha(isReversal ? t.warn : '#000000', isReversal ? 0.92 : 0.45));
    ui.text(this.ruleText, ui.w / 2, ui.h / 2, {
      size: isReversal ? 30 : 26, color: isReversal ? '#0a0d12' : withAlpha(t.textMuted, 0.95),
      align: 'center', weight: '700', font: t.fontDisplay, letterSpacing: '1.5px',
    });
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.55));
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 36, color: this.feedbackGood ? t.ok : t.bad, align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const R = this.records;
    const inBlock = (b: BlockId) => R.filter((x) => x.block === b);

    /* --- go / no-go --------------------------------------------------- */
    const gng = inBlock('gonogo');
    const goTrials = gng.filter((x) => x.type === 'go');
    const nogoTrials = gng.filter((x) => x.type === 'nogo_red' || x.type === 'nogo_blue');
    const goRts = goTrials.filter((x) => x.responded && x.rtMs !== null).map((x) => x.rtMs!);
    const goRtMedian = median(goRts);
    const goOmission = goTrials.length ? goTrials.filter((x) => !x.responded).length / goTrials.length : NaN;
    const commissions = nogoTrials.filter((x) => x.responded).length;
    const commissionRate = nogoTrials.length ? commissions / nogoTrials.length : NaN;
    const redNogo = nogoTrials.filter((x) => x.type === 'nogo_red');
    const blueNogo = nogoTrials.filter((x) => x.type === 'nogo_blue');
    const commissionRed = redNogo.length ? redNogo.filter((x) => x.responded).length / redNogo.length : NaN;
    const commissionBlue = blueNogo.length ? blueNogo.filter((x) => x.responded).length / blueNogo.length : NaN;
    const nogoSdt = sdt(
      goTrials.filter((x) => x.responded).length,
      goTrials.filter((x) => !x.responded).length,
      commissions,
      nogoTrials.length - commissions
    );

    /* --- commitment ---------------------------------------------------- */
    const allResponded = R.filter((x) => x.responded && x.rtMs !== null);
    const commitment = median(allResponded.map((x) => x.fraction));
    const commitmentError = median(
      nogoTrials.filter((x) => x.responded).map((x) => x.fraction)
    );

    /* --- stop-signal ---------------------------------------------------- */
    const stopBlock = inBlock('stop');
    const stopSignalTrials = stopBlock.filter((x) => x.stopFired);
    const stopGoTrials = stopBlock.filter((x) => !x.stopFired);
    const stopGoRts = stopGoTrials.filter((x) => x.responded && x.rtMs !== null).map((x) => x.rtMs!).sort((a, b) => a - b);
    const stopFailures = stopSignalTrials.filter((x) => x.responded);
    const pRespond = stopSignalTrials.length ? stopFailures.length / stopSignalTrials.length : NaN;
    const meanSsd = this.ssdHistory.length ? mean(this.ssdHistory) : NaN;

    // Integration method: the SSRT is the point in the go-RT distribution that
    // the stop process must beat, minus the delay it was given. The mean method
    // is biased when the staircase has not landed exactly on 0.5, which with
    // 16 signal trials it usually has not.
    const ssrt = (() => {
      if (!Number.isFinite(pRespond) || !Number.isFinite(meanSsd) || stopGoRts.length < 6) return NaN;
      const nth = percentile(stopGoRts, clamp(pRespond, 0.01, 0.99));
      return nth - meanSsd;
    })();
    const stopFailureRt = median(stopFailures.filter((x) => x.rtMs !== null).map((x) => x.rtMs!));
    const stopGoRtMedian = median(stopGoRts);
    // Race-model check: failed stops should be faster than the go median. If
    // they are not, the SSRT estimate is not interpretable.
    const raceModelOk = Number.isFinite(stopFailureRt) && Number.isFinite(stopGoRtMedian)
      ? (stopFailureRt <= stopGoRtMedian ? 1 : 0) : NaN;
    const ssdConvergence = Number.isFinite(pRespond) ? Math.abs(pRespond - 0.5) : NaN;

    /* --- trajectory ----------------------------------------------------- */
    const traj = inBlock('trajectory');
    const hitPaths = traj.filter((x) => x.type === 'hit_path');
    const missPaths = traj.filter((x) => x.type === 'miss_path');
    const trajHits = hitPaths.filter((x) => x.responded).length;
    const trajFa = missPaths.filter((x) => x.responded).length;
    const trajSdt = sdt(trajHits, hitPaths.length - trajHits, trajFa, missPaths.length - trajFa);

    /* --- reversal -------------------------------------------------------- */
    const rev = inBlock('reversal');
    const before = rev.filter((x) => !x.afterReversal).slice(-5);
    const after = rev.filter((x) => x.afterReversal).slice(0, 5);
    const accOf = (list: typeof R) => (list.length ? list.filter((x) => x.correct).length / list.length : NaN);
    const ruleChangeCost = before.length && after.length ? accOf(before) - accOf(after) : NaN;
    // Perseveration: responding as the OLD rule would have required.
    const perseveration = rev.filter((x) => x.afterReversal).slice(0, 10)
      .filter((x) => !x.correct && x.responded && x.type === 'go').length;

    /* --- post-error slowing ---------------------------------------------- */
    const postErrorRts: number[] = [];
    const postCorrectRts: number[] = [];
    for (let i = 1; i < R.length; i++) {
      const prev = R[i - 1]!;
      const cur = R[i]!;
      if (!cur.responded || cur.rtMs === null) continue;
      (prev.correct ? postCorrectRts : postErrorRts).push(cur.rtMs);
    }
    const postErrorSlowing = postErrorRts.length && postCorrectRts.length
      ? median(postErrorRts) - median(postCorrectRts) : NaN;

    const headGain = this.headTrackSamples.length && ctx.platform === 'vr'
      ? clamp(1 - mean(this.headTrackSamples) / 90, 0, 1) : NaN;

    const M: [string, number, string, string?][] = [
      ['go_rt_median', goRtMedian, 'ms', 'gonogo'],
      ['go_rt_sd', stdev(goRts), 'ms', 'gonogo'],
      ['go_omission_rate', goOmission, 'ratio', 'gonogo'],
      ['commission_error_rate', commissionRate, 'ratio', 'gonogo'],
      ['commission_rate_red', commissionRed, 'ratio', 'gonogo'],
      ['commission_rate_blue', commissionBlue, 'ratio', 'gonogo'],
      ['nogo_d_prime', nogoSdt.dPrime, 'z', 'gonogo'],
      ['commitment_fraction', commitment, 'ratio'],
      ['commitment_fraction_error', commitmentError, 'ratio'],
      ['ssrt', ssrt, 'ms', 'stop'],
      ['mean_ssd', meanSsd, 'ms', 'stop'],
      ['p_respond_signal', pRespond, 'ratio', 'stop'],
      ['ssd_convergence', ssdConvergence, 'ratio', 'stop'],
      ['stop_failure_rt', stopFailureRt, 'ms', 'stop'],
      ['stop_go_rt_median', stopGoRtMedian, 'ms', 'stop'],
      ['race_model_ok', raceModelOk, 'flag', 'stop'],
      ['trajectory_d_prime', trajSdt.dPrime, 'z', 'trajectory'],
      ['trajectory_hit_rate', trajSdt.hitRate, 'ratio', 'trajectory'],
      ['trajectory_fa_rate', trajSdt.faRate, 'ratio', 'trajectory'],
      ['rule_change_cost', ruleChangeCost, 'ratio', 'reversal'],
      ['perseveration_errors', perseveration, 'count', 'reversal'],
      ['post_error_slowing', postErrorSlowing, 'ms'],
      ['head_tracking_gain', headGain, 'ratio'],
    ];
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    // Asymmetric anchors, deliberately: a missed go is operationally cheaper
    // than a no-go that was not held, so the omission scale is more forgiving
    // than the commission scale.
    const inhibitionAccuracy = normaliseSoft(commissionRate, 0.02, 0.45);
    const inhibitionSpeed = Number.isFinite(ssrt) ? normaliseSoft(ssrt, 180, 420) : 0;
    const goPerformance = (normaliseSoft(goOmission, 0.01, 0.20) + normaliseSoft(goRtMedian, 420, 900)) / 2;
    const trajectory = normaliseSoft(trajSdt.dPrime, 3.0, 0.5);
    const flexibility = normaliseSoft(Number.isFinite(ruleChangeCost) ? ruleChangeCost : 0.45, 0, 0.45);
    const discipline = normaliseSoft(commitment, 0.75, 0.35);

    const ops = opsScore([
      { key: 'inhibition_accuracy', value: inhibitionAccuracy, weight: 0.26 },
      { key: 'inhibition_speed', value: inhibitionSpeed, weight: Number.isFinite(ssrt) ? 0.24 : 0 },
      { key: 'go_performance', value: goPerformance, weight: 0.16 },
      { key: 'trajectory_judgement', value: trajectory, weight: 0.14 },
      { key: 'rule_flexibility', value: flexibility, weight: 0.12 },
      { key: 'decision_discipline', value: discipline, weight: 0.08 },
    ]);

    rec.score('inhibition_accuracy', inhibitionAccuracy, '1.0.0');
    if (Number.isFinite(ssrt)) rec.score('inhibition_speed', inhibitionSpeed, '1.0.0');
    rec.score('go_performance', goPerformance, '1.0.0');
    rec.score('trajectory_judgement', trajectory, '1.0.0');
    rec.score('rule_flexibility', flexibility, '1.0.0');
    rec.score('decision_discipline', discipline, '1.0.0');

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : '—');
    const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

    const ssrtHint = !Number.isFinite(ssrt)
      ? 'nem becsülhető'
      : ssdConvergence > 0.15
        ? 'bizonytalan — a lépcső nem konvergált'
        : raceModelOk === 0
          ? 'bizonytalan — versenymodell sérül'
          : `SSD átlag ${ms(meanSsd)}`;

    return {
      opsScore: ops,
      headline: [
        { label: 'Gátlási hiba (commission)', value: pct(commissionRate), hint: `nehéz eset ${pct(commissionRed)}` },
        { label: 'Gátlási sebesség (SSRT)', value: ms(ssrt), hint: ssrtHint },
        { label: 'Go reakcióidő', value: ms(goRtMedian), hint: `kimaradás ${pct(goOmission)}` },
        { label: 'Pályaítélet (d′)', value: num(trajSdt.dPrime) },
        { label: 'Szabályváltás költsége', value: Number.isFinite(ruleChangeCost) ? `${Math.round(ruleChangeCost * 100)} pont` : '—', hint: `perszeveráció ${perseveration}` },
        { label: 'Döntési fegyelem', value: num(commitment), hint: 'a pálya arányában' },
      ],
      summary: {
        gonogo: {
          goRtMedian: r(goRtMedian), goRtSd: r(stdev(goRts)), omissionRate: r(goOmission, 3),
          commissionRate: r(commissionRate, 3), commissionRed: r(commissionRed, 3),
          commissionBlue: r(commissionBlue, 3), dPrime: r(nogoSdt.dPrime, 3),
        },
        stop: {
          ssrt: r(ssrt), meanSsd: r(meanSsd), pRespondSignal: r(pRespond, 3),
          convergence: r(ssdConvergence, 3), stopFailureRt: r(stopFailureRt),
          goRtMedian: r(stopGoRtMedian), raceModelOk: raceModelOk === 1,
          signalTrials: stopSignalTrials.length,
          valid: Number.isFinite(ssrt) && ssdConvergence <= 0.15 && raceModelOk === 1,
        },
        trajectory: {
          dPrime: r(trajSdt.dPrime, 3), hitRate: r(trajSdt.hitRate, 3), faRate: r(trajSdt.faRate, 3),
        },
        reversal: { cost: r(ruleChangeCost, 3), perseveration },
        commitment: { median: r(commitment, 3), onErrors: r(commitmentError, 3) },
        postErrorSlowingMs: r(postErrorSlowing),
        headTrackingGain: r(headGain, 3),
        platform: ctx.platform,
        trialsScored: this.trials.length,
      },
      axisScores: {
        cognitive_control: (inhibitionAccuracy + inhibitionSpeed + flexibility) / 3,
        reaction: goPerformance,
        decision_style: discipline,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    const live = this.live;
    if (live && !live.responded) {
      live.responded = true;
      live.resolve({ responded: false, rtMs: null, fraction: 0, early: false });
    }
    this.live = null;
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.abort();
    this.tumbler.clear();
    ctx.panels.remove(this.rulePanel);
    ctx.panels.remove(this.feedbackPanel);
    this.rulePanel.dispose();
    this.feedbackPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
