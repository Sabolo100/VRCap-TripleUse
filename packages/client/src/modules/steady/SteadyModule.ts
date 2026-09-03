import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, normaliseSoft, opsScore, clamp,
  swayMetrics, dominantFrequency, goertzelAmplitude, bandConcentration,
  type ModuleManifest, type TrialRecord, type SwayResult,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { volumePosition } from '../shared/volume.js';

/**
 * MODULE 13 - STEADY
 * Postural stability and hand steadiness.
 *
 * Every other module treats head tracking as context. Here it is the
 * instrument: the participant does nothing but stand, and the measurement is
 * where their head was, sampled at display rate with millimetre structure.
 *
 * Three conditions do the work.
 *
 *   ROMBERG        the display is blacked out, removing visual position
 *                  information. The ratio of dark to lit sway is the classic
 *                  index of how much the balance system was leaning on vision.
 *
 *   MOVING ROOM    a point lattice surrounding the participant oscillates at a
 *                  known 0.20 Hz. Postural control reads that optic flow as
 *                  self-motion and sways with it, usually without the person
 *                  noticing. Because the frequency is known exactly, the
 *                  evidence is not "they swayed more" - which fatigue also
 *                  produces - but power at precisely that frequency.
 *                  This is Lee and Aronson's swinging room, and it needs a
 *                  visual surround to exist at all.
 *
 *   HAND HOLD      the controller tip is held inside a ring at arm's length.
 *                  The 6-14 Hz band is tremor; anything below 0.5 Hz is drift,
 *                  which is a different failure and gets its own number.
 *
 * IMPORTANT: this module does not sample through `input.pose()`. That path
 * rounds to a millimetre, and tremor amplitude is 0.3-1.2 mm - the signal
 * would be mostly quantisation. Positions are read from the camera and grip
 * objects directly, at full precision.
 */

type BlockId = 'stance' | 'dark' | 'sway' | 'oneleg' | 'hand';

const PERTURB_HZ = 0.20;
const PERTURB_AMPLITUDE_M = 0.06;
/** The settling period at the start of every block, discarded. */
const DISCARD_S = 3;
/** Below this the block did not really happen. */
const MIN_VALID_S = 5;
const TREMOR_LO_HZ = 6;
const TREMOR_HI_HZ = 14;

interface Sample { t: number; x: number; y: number; z: number }

interface BlockTrace {
  block: BlockId;
  condition: string;
  samples: Sample[];
  durationS: number;
  discardedS: number;
  footDownAtMs: number | null;
  aborted: boolean;
}

export class SteadyModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.STEADY!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'stance',
      title: 'NYITOTT SZEM',
      instruction:
        'Csak állj. Harminc másodperc. Lábak vállszélességben, karok lazán, nézz előre a gyűrűre. ' +
        'Semmit nem kell csinálnod — a headset méri, hogyan mozdul a fejed.',
      controlHint: '',
      trials: 1,
      practiceTrials: 1,
      unitLabel: 'mérés',
    },
    {
      id: 'dark',
      title: 'ELSÖTÉTÍTVE',
      instruction:
        'Most elsötétül a kijelző. Ne mozdulj, állj ugyanígy tovább. Ha bizonytalan vagy, ' +
        'nyisd ki a szemed vagy fogódzz meg — a MENÜ gombbal bármikor kiléphetsz.',
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
      unitLabel: 'mérés',
    },
    {
      id: 'sway',
      title: 'MOZGÓ TÉR',
      instruction:
        'Körülötted egy pontokból álló tér lesz. Csak állj, és nézz előre. ' +
        'Ha a tér mozogni kezd, ne kövesd — maradj, ahol vagy.',
      controlHint: '',
      trials: 1,
      practiceTrials: 1,
      unitLabel: 'mérés',
    },
    {
      id: 'oneleg',
      title: 'EGY LÁBON',
      instruction:
        'Van körülötted legalább másfél méter szabad hely, és van valaki a közelben? ' +
        'Ha nincs, nyugodtan hagyd ki ezt a részt — a többi eredmény enélkül is érvényes.',
      controlHint: '',
      trials: 2,
      practiceTrials: 0,
      unitLabel: 'láb',
    },
    {
      id: 'hand',
      title: 'CÉLON TARTÁS',
      instruction:
        'Nyújtsd ki a karod, és tartsd a gömböt a gyűrű közepén, harminc másodpercig. ' +
        'A karodat ne támaszd meg semmihez. Előbb az egyik, aztán a másik kéz.',
      controlHint: '',
      trials: 2,
      practiceTrials: 1,
      unitLabel: 'kéz',
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private root!: THREE.Group;
  private floorRing!: THREE.Mesh;
  private lattice!: THREE.Group;
  private latticeBase = 0;
  private blackout!: THREE.Mesh;
  private handRing!: THREE.Mesh;
  private handDot!: THREE.Mesh;
  private livePanel!: Panel;
  private promptPanel!: Panel;

  private traces: BlockTrace[] = [];
  private active: BlockTrace | null = null;
  private blockStartT = 0;
  private restHeadY = 0;
  private perturbPhase: 'static' | 'moving' | 'after' = 'static';
  private perturbStartT = 0;
  private currentHand: 'left' | 'right' = 'right';
  private oneLegSkipped = false;
  private aborted = false;
  private menuAbort = false;
  private practice = false;

  private offAction: (() => void) | null = null;
  private offPanel: (() => void) | null = null;
  private promptChoice: string | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.root = ctx.root;
    const t = ctx.theme;

    // The measurement IS the motion trace, so it gets the display rate and a
    // cap large enough for the whole run rather than the usual sampling.
    ctx.recorder.setMotionHz(90);

    this.floorRing = makePrimitive({ kind: 'torus', color: t.accent, unlit: true, size: 0.60, opacity: 0.4 });
    this.floorRing.rotation.x = -Math.PI / 2;
    this.floorRing.position.set(0, 0.01, 0);

    // A surrounding lattice: the optic-flow field. Grain angular size is held
    // constant across the depth range so the lattice's structure is carried by
    // parallax rather than by size, which is what makes the flow clean.
    this.lattice = new THREE.Group();
    const rNear = 2.5;
    const rFar = 6.0;
    for (let i = 0; i < 96; i++) {
      const az = (i / 96) * 360 + (i % 3) * 4;
      const el = -22 + ((i * 37) % 55);
      const rad = rNear + ((i * 17) % 100) / 100 * (rFar - rNear);
      const g = makePrimitive({
        kind: 'sphere', color: t.textMuted, unlit: true,
        size: 0.05 * (rad / rNear), opacity: 0.75,
      });
      g.position.copy(volumePosition(az, el, rad, 1.55));
      this.lattice.add(g);
    }
    this.lattice.visible = false;

    // A black shell rather than a black clear colour: it blanks the world
    // without touching the renderer, so the runner's own UI still works.
    this.blackout = makePrimitive({ kind: 'sphere', color: 0x000000, unlit: true, size: 40 });
    (this.blackout.material as THREE.Material).side = THREE.BackSide;
    this.blackout.visible = false;

    this.handRing = makePrimitive({ kind: 'torus', color: t.accent, unlit: true, size: 0.05 });
    this.handRing.visible = false;
    this.handDot = makePrimitive({ kind: 'sphere', color: t.accent2, unlit: true, size: 0.03 });
    this.handDot.visible = false;

    this.root.add(this.floorRing, this.lattice, this.blackout, this.handRing, this.handDot);

    this.livePanel = new Panel({
      width: 0.44, height: 0.44, pxPerMeter: 800, theme: t, frame: false, name: 'steady-live',
    });
    this.livePanel.group.position.set(0, 1.35, -1.4);
    this.livePanel.setDraw((ui) => this.drawLive(ui));
    this.livePanel.group.visible = false;
    this.root.add(this.livePanel.group);
    ctx.panels.add(this.livePanel);

    this.promptPanel = new Panel({
      width: 1.0, height: 0.42, pxPerMeter: 900, theme: t, frame: true, name: 'steady-prompt',
    });
    this.promptPanel.group.position.set(0, 1.5, -1.6);
    this.promptPanel.setDraw((ui) => this.drawPrompt(ui));
    this.promptPanel.group.visible = false;
    this.root.add(this.promptPanel.group);
    ctx.panels.add(this.promptPanel);

    this.offAction = ctx.engine.input.on((e: ActionEvent) => {
      if (e.down && e.action === 'MENU' && this.active) this.menuAbort = true;
    });
    this.offPanel = ctx.panels.onClick((e) => { this.promptChoice = e.widget.id; });

    for (const b of this.blocks) b.controlHint = 'RAVASZ: indítás · MENÜ: megszakítás';

    ctx.recorder.event('steady_setup', {
      platform: ctx.platform,
      blockLengthsS: { stance: 30, dark: 30, sway: 45, oneleg: 20, hand: 30 },
      perturbationHz: PERTURB_HZ,
      perturbationAmplitudeM: PERTURB_AMPLITUDE_M,
      discardS: DISCARD_S,
      note: 'positions sampled from the scene graph, not input.pose(), which rounds to 1 mm',
    });
  }

  /* ------------------------------------------------------- calibration */

  async calibrate(ctx: ModuleContext): Promise<void> {
    this.floorRing.visible = true;
    await this.prompt(
      'BIZTONSÁG',
      'Állj olyan helyre, ahol legalább MÁSFÉL MÉTER szabad hely van körülötted, és nincs bútor a közeledben. ' +
      'Az egyik résznél elsötétül a kijelző. Ha bármikor bizonytalanul állsz, nyúlj ki és fogódzz meg — ' +
      'az eredmény attól még használható.',
      [{ id: 'ok', label: 'KÉSZ VAGYOK', variant: 'primary' }]
    );
    await this.prompt(
      'ALAPHELYZET',
      'Állj kényelmesen, lábak vállszélességben, karok lazán. Nézz előre a gyűrűre.',
      [{ id: 'ok', label: 'INDULHAT', variant: 'primary' }]
    );
    this.restHeadY = this.headPos().y;
    ctx.recorder.event('calibration_done', { restHeadY: +this.restHeadY.toFixed(3) });
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    const id = block.id as BlockId;
    this.practice = practice;
    if (practice && (id === 'dark' || id === 'oneleg')) return;

    switch (id) {
      case 'stance':
        await this.record(id, 'both', practice ? 8 : 30, { ring: true });
        break;

      case 'dark':
        await this.warnDarkness();
        await this.record(id, 'both', 30, { ring: false, blackout: true });
        break;

      case 'sway':
        await this.record(id, 'both', practice ? 8 : 45, { ring: true, lattice: true, perturb: !practice });
        break;

      case 'oneleg': {
        if (this.oneLegSkipped) return;
        const choice = await this.prompt(
          'EGY LÁBON — OPCIONÁLIS',
          'Van körülötted legalább másfél méter szabad hely, és van valaki a közelben? ' +
          'Ha nincs, hagyd ki ezt a részt: a többi eredmény enélkül is teljes értékű.',
          [
            { id: 'go', label: 'FOLYTATOM', variant: 'primary' },
            { id: 'skip', label: 'KIHAGYOM', variant: 'ghost' },
          ]
        );
        if (choice === 'skip') {
          this.oneLegSkipped = true;
          ctx.recorder.event('oneleg_skipped', { reason: 'user' });
          return;
        }
        for (const foot of ['leftfoot', 'rightfoot'] as const) {
          await this.prompt(
            foot === 'leftfoot' ? 'BAL LÁBON' : 'JOBB LÁBON',
            `Állj a ${foot === 'leftfoot' ? 'BAL' : 'JOBB'} lábadra, a másikat emeld fel néhány centire. ` +
            'Húsz másodperc. Ha leteszed, az sem baj — csak jelezd tovább az állást.',
            [{ id: 'ok', label: 'KEZDHETJÜK', variant: 'primary' }]
          );
          await this.record('oneleg', foot, 20, { ring: true, watchFoot: true });
        }
        break;
      }

      case 'hand': {
        const hands: ('right' | 'left')[] = practice ? ['right'] : ['right', 'left'];
        for (const hand of hands) {
          this.currentHand = hand;
          await this.prompt(
            hand === 'right' ? 'JOBB KÉZ' : 'BAL KÉZ',
            `Nyújtsd ki a ${hand === 'right' ? 'JOBB' : 'BAL'} karod, és tartsd a gömböt a gyűrű közepén. ` +
            'A karodat ne támaszd meg semmihez.',
            [{ id: 'ok', label: 'KEZDHETJÜK', variant: 'primary' }]
          );
          await this.record('hand', hand, practice ? 10 : 30, { ring: false, handTarget: true });
        }
        break;
      }
    }
  }

  private async warnDarkness(): Promise<void> {
    this.ctx.recorder.event('darkness_warning', { countdownS: 3 });
    for (let i = 3; i >= 1; i--) {
      this.ctx.audio.click();
      await this.wait(1000);
    }
  }

  /**
   * Record one continuous window. The first `DISCARD_S` seconds are collected
   * but marked: at the start of a block the participant is still settling, and
   * that transient is an order of magnitude larger than the sway it would
   * otherwise contaminate.
   */
  private async record(
    block: BlockId, condition: string, durationS: number,
    o: { ring?: boolean; lattice?: boolean; blackout?: boolean; perturb?: boolean;
         watchFoot?: boolean; handTarget?: boolean }
  ): Promise<void> {
    const ctx = this.ctx;
    this.menuAbort = false;

    this.floorRing.visible = !!o.ring;
    this.lattice.visible = !!o.lattice;
    this.blackout.visible = !!o.blackout;
    this.handRing.visible = !!o.handTarget;
    this.handDot.visible = !!o.handTarget;
    if (o.handTarget) {
      // Arm's length, slightly below eye level: reachable without the shoulder
      // having to hold the arm up at its limit for thirty seconds.
      this.handRing.position.set(this.currentHand === 'right' ? 0.16 : -0.16, 1.42, -0.55);
      this.handRing.lookAt(0, 1.6, 0);
    }

    const trace: BlockTrace = {
      block, condition, samples: [], durationS, discardedS: DISCARD_S,
      footDownAtMs: null, aborted: false,
    };
    this.active = trace;
    this.blockStartT = ctx.engine.clock.frameTime;
    this.perturbStartT = this.blockStartT;
    this.perturbPhase = 'static';
    this.latticeBase = 0;

    ctx.recorder.event('block_start', { block, condition, discardS: DISCARD_S, durationS }, this.blockStartT);
    if (this.practice) this.livePanel.group.visible = true;

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.aborted) { resolve(); return; }
        const elapsed = (ctx.engine.clock.frameTime - this.blockStartT) / 1000;
        if (this.menuAbort) {
          trace.aborted = true;
          ctx.recorder.event('steady_abort', { block, tMs: Math.round(elapsed * 1000), reason: 'menu' });
          resolve(); return;
        }
        if (o.perturb) this.updatePerturbation(elapsed);
        if (o.watchFoot) this.watchFoot(elapsed, trace);
        if (elapsed >= durationS) { resolve(); return; }
        setTimeout(tick, 20);
      };
      tick();
    });

    this.active = null;
    this.livePanel.group.visible = false;
    this.lattice.visible = false;
    this.blackout.visible = false;
    this.handRing.visible = false;
    this.handDot.visible = false;
    this.lattice.position.z = 0;

    if (!this.practice) {
      this.traces.push(trace);
      this.summariseBlock(trace);
    }
    await this.wait(600);
  }

  /**
   * The lattice translates along the line of sight at a fixed, known
   * frequency. Everything downstream depends on that frequency being exact:
   * the evidence for visual dependence is power at 0.20 Hz specifically, not
   * a larger sway in general.
   */
  private updatePerturbation(elapsedS: number): void {
    const moveStart = 15;
    const moveEnd = 35;
    let phase: 'static' | 'moving' | 'after' =
      elapsedS < moveStart ? 'static' : elapsedS < moveEnd ? 'moving' : 'after';

    if (phase !== this.perturbPhase) {
      this.perturbPhase = phase;
      this.ctx.recorder.event('perturbation_phase', {
        phase, tMs: Math.round(elapsedS * 1000), hz: PERTURB_HZ, amplitudeM: PERTURB_AMPLITUDE_M,
      });
    }
    if (phase === 'moving') {
      const tIn = elapsedS - moveStart;
      // A raised-cosine envelope over the first and last two seconds: a sudden
      // start would produce a startle response rather than postural following.
      const env = clamp(Math.min(tIn / 2, (moveEnd - moveStart - tIn) / 2), 0, 1);
      this.lattice.position.z = Math.sin(2 * Math.PI * PERTURB_HZ * tIn) * PERTURB_AMPLITUDE_M * env;
    } else {
      this.lattice.position.z = 0;
    }
  }

  /** A sudden drop in head height means the raised foot went down. */
  private watchFoot(elapsedS: number, trace: BlockTrace): void {
    if (trace.footDownAtMs !== null) return;
    const y = this.headPos().y;
    if (this.restHeadY - y > 0.05 && elapsedS > 1.5) {
      trace.footDownAtMs = Math.round(elapsedS * 1000);
      this.ctx.recorder.event('foot_down', {
        tMs: trace.footDownAtMs, verticalDropM: +(this.restHeadY - y).toFixed(3),
      });
    }
  }

  /* ------------------------------------------------------------ update */

  update(_dt: number, ctx: ModuleContext): void {
    const trace = this.active;
    if (!trace) return;

    // Full-precision sampling straight from the scene graph. Going through
    // input.pose() would round to a millimetre and bury the tremor.
    const t = ctx.engine.clock.frameTime - this.blockStartT;
    const p = trace.block === 'hand' ? this.handPos() : this.headPos();
    if (!p) return;
    trace.samples.push({ t, x: p.x, y: p.y, z: p.z });

    if (trace.block === 'hand') this.handDot.position.copy(p);
    if (this.practice) this.livePanel.invalidate();
  }

  private headPos(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.ctx.engine.camera.getWorldPosition(v);
    return v;
  }

  private handPos(): THREE.Vector3 | null {
    const p = this.ctx.engine.input.pointers.find((x) => x.active && x.id === this.currentHand);
    return p?.object3D ? p.object3D.getWorldPosition(new THREE.Vector3()) : null;
  }

  /* --------------------------------------------------------- analysis */

  private sampleHz(trace: BlockTrace): number {
    const s = trace.samples;
    if (s.length < 2) return 0;
    const span = (s[s.length - 1]!.t - s[0]!.t) / 1000;
    return span > 0 ? (s.length - 1) / span : 0;
  }

  /** Samples after the settling period, and before the foot came down. */
  private usable(trace: BlockTrace): Sample[] {
    const cut = DISCARD_S * 1000;
    const end = trace.footDownAtMs ?? Infinity;
    return trace.samples.filter((s) => s.t >= cut && s.t < end);
  }

  private swayOf(trace: BlockTrace): SwayResult {
    const s = this.usable(trace);
    const durationS = s.length ? (s[s.length - 1]!.t - s[0]!.t) / 1000 : 0;
    return swayMetrics(s.map((v) => v.x), s.map((v) => v.z), durationS);
  }

  private summariseBlock(trace: BlockTrace): void {
    const s = this.swayOf(trace);
    this.ctx.recorder.event('block_summary', {
      block: trace.block, condition: trace.condition,
      areaMm2: r(s.area95Mm2), pathMm: r(s.pathLengthMm), velocityMmS: r(s.meanVelocityMmS),
      samples: s.samples, discardedSamples: trace.samples.length - s.samples,
      sampleHz: r(this.sampleHz(trace), 1),
    });

    const durationS = this.usable(trace).length ? this.usable(trace).length / Math.max(1, this.sampleHz(trace)) : 0;
    const valid = !trace.aborted && durationS >= MIN_VALID_S;
    const rec: TrialRecord = {
      trialNumber: this.traces.length,
      block: trace.block,
      stimulus: {
        block: trace.block, condition: trace.condition, durationS: trace.durationS, discardS: DISCARD_S,
        perturbationHz: trace.block === 'sway' ? PERTURB_HZ : undefined,
        perturbationAmplitudeM: trace.block === 'sway' ? PERTURB_AMPLITUDE_M : undefined,
      },
      response: {
        areaMm2: r(s.area95Mm2), pathMm: r(s.pathLengthMm), velocityMmS: r(s.meanVelocityMmS),
        mlSdMm: r(s.sdMlMm), apSdMm: r(s.sdApMm), samples: s.samples,
        footDownAtMs: trace.footDownAtMs,
      },
      correct: null,
      outcome: valid ? 'hit' : trace.samples.length === 0 ? 'timeout' : 'invalid',
      reactionTimeMs: null,
      startedAt: Math.round(this.blockStartT),
      endedAt: Math.round(this.ctx.engine.clock.frameTime),
    };
    this.ctx.recorder.trial(rec);
  }

  /* ------------------------------------------------------------- UI */

  private prompt(
    title: string, body: string,
    buttons: { id: string; label: string; variant: 'primary' | 'ghost' }[]
  ): Promise<string> {
    this.promptTitle = title;
    this.promptBody = body;
    this.promptButtons = buttons;
    this.promptChoice = null;
    this.promptPanel.group.visible = true;
    this.promptPanel.invalidate();
    return new Promise((resolve) => {
      const poll = () => {
        if (this.aborted) { resolve('skip'); return; }
        const c = this.promptChoice;
        if (c) {
          this.promptChoice = null;
          this.promptPanel.group.visible = false;
          resolve(c);
          return;
        }
        setTimeout(poll, 40);
      };
      poll();
    });
  }

  private promptTitle = '';
  private promptBody = '';
  private promptButtons: { id: string; label: string; variant: 'primary' | 'ghost' }[] = [];

  private drawPrompt(ui: UI): void {
    const t = ui.t;
    ui.background(t.surface, 20);
    ui.title(this.promptTitle, 40, 62, 34, t.accent);
    ui.paragraph(this.promptBody, 40, 108, ui.w - 80, { size: 21, lineHeight: 31 });
    const n = this.promptButtons.length;
    const bw = 240;
    const gap = 20;
    const total = n * bw + (n - 1) * gap;
    let x = (ui.w - total) / 2;
    for (const b of this.promptButtons) {
      ui.button(b.id, x, ui.h - 88, bw, 60, { label: b.label, variant: b.variant, fontSize: 20 });
      x += bw + gap;
    }
  }

  private drawLive(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.85), 16);
    const trace = this.active;
    ui.label('ÉLŐ LENGÉS', ui.w / 2, 32, t.textMuted, 16, 'center');
    if (!trace || trace.samples.length < 4) return;
    const cx = ui.w / 2;
    const cy = ui.h / 2 + 10;
    // 40 mm across the panel: a scale that shows normal sway without a still
    // participant looking like a flat line.
    const scale = (ui.w - 80) / 0.04;
    const recent = trace.samples.slice(-260);
    const mx = mean(recent.map((s) => s.x));
    const mz = mean(recent.map((s) => s.z));
    ui.circle(cx, cy, 6, withAlpha(t.accent, 0.5));
    for (let i = 1; i < recent.length; i++) {
      const a = recent[i - 1]!;
      const b = recent[i]!;
      ui.line(
        cx + (a.x - mx) * scale, cy + (a.z - mz) * scale,
        cx + (b.x - mx) * scale, cy + (b.z - mz) * scale,
        withAlpha(t.accent2, 0.55), 2
      );
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r0) => setTimeout(r0, ms));
  }

  /* ------------------------------------------------------------ finish */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const find = (block: BlockId, condition?: string) =>
      this.traces.find((t) => t.block === block && (!condition || t.condition === condition));

    const stance = find('stance');
    const dark = find('dark');
    const sway = find('sway');
    const legs = this.traces.filter((t) => t.block === 'oneleg');
    const hands = this.traces.filter((t) => t.block === 'hand');

    const stanceS = stance ? this.swayOf(stance) : null;
    const darkS = dark ? this.swayOf(dark) : null;

    const romberg = stanceS && darkS && stanceS.area95Mm2 > 0
      ? darkS.area95Mm2 / stanceS.area95Mm2 : NaN;

    /* ------------------------------------------- moving room */

    let perturbGain = NaN;
    let visualReliance = NaN;
    let driveConcentration = NaN;
    if (sway) {
      const hz = this.sampleHz(sway);
      const all = this.usable(sway);
      const seg = (fromS: number, toS: number) =>
        all.filter((s) => s.t >= fromS * 1000 && s.t < toS * 1000);
      const staticSeg = seg(DISCARD_S, 15);
      const movingSeg = seg(15, 35);
      const sm = swayMetrics(staticSeg.map((s) => s.x), staticSeg.map((s) => s.z), 12);
      const mm = swayMetrics(movingSeg.map((s) => s.x), movingSeg.map((s) => s.z), 20);
      perturbGain = sm.area95Mm2 > 0 ? mm.area95Mm2 / sm.area95Mm2 : NaN;

      // Two numbers, because they answer different questions.
      //
      // The amplitude says HOW MUCH the participant swayed at the room's
      // rhythm, in millimetres - readable, bounded by physics, and directly
      // comparable between people. A power ratio would answer the same
      // question with an unbounded figure that runs to thousands on a clean
      // signal and cannot be put on a result screen.
      //
      // The concentration says whether that sway was SPECIFIC to the drive
      // frequency, which is what separates following the room from simply
      // moving more.
      if (hz > 1 && movingSeg.length > 60) {
        const ap = movingSeg.map((s) => s.z);
        visualReliance = goertzelAmplitude(ap, hz, PERTURB_HZ) * 1000;
        driveConcentration = bandConcentration(ap, hz, PERTURB_HZ, [0.10, 0.35]);
      }
    }

    /* ------------------------------------------------ one leg */

    let legRatio = NaN;
    let legDuration = NaN;
    if (legs.length && stanceS && stanceS.area95Mm2 > 0) {
      const areas = legs.map((l) => this.swayOf(l).area95Mm2).filter(Number.isFinite);
      if (areas.length) legRatio = mean(areas) / stanceS.area95Mm2;
      legDuration = mean(legs.map((l) => (l.footDownAtMs ?? l.durationS * 1000) / 1000));
    }

    /* -------------------------------------------------- hands */

    const handStats = hands.map((h) => {
      const s = this.usable(h);
      const hz = this.sampleHz(h);
      const ring = this.handRing.position;
      // Tremor is the high-frequency content; drift is the slow wander away
      // from the target. Reporting one number for both would hide which of the
      // two actually failed.
      const detrended = (axis: (v: Sample) => number) => {
        const vals = s.map(axis);
        const m = mean(vals);
        return vals.map((v) => v - m);
      };
      const dx = detrended((v) => v.x);
      const dy = detrended((v) => v.y);
      const dz = detrended((v) => v.z);
      const rms = Math.sqrt(mean([
        mean(dx.map((v) => v * v)), mean(dy.map((v) => v * v)), mean(dz.map((v) => v * v)),
      ])) * 1000;
      const peak = hz > 2 * TREMOR_HI_HZ
        ? dominantFrequency(dz, hz, TREMOR_LO_HZ, Math.min(TREMOR_HI_HZ, hz / 2 - 1), 0.25)
        : { freqHz: NaN, power: NaN };
      const drift = s.length
        ? mean(s.map((v) => Math.hypot(v.x - ring.x, v.y - ring.y, v.z - ring.z))) * 1000
        : NaN;
      return { hand: h.condition, rmsMm: rms, peakHz: peak.freqHz, driftMm: drift, hz, samples: s.length };
    });

    for (const h of handStats) {
      rec.event('tremor_summary', {
        hand: h.hand, rmsMm: r(h.rmsMm, 3), peakHz: r(h.peakHz, 2),
        driftMm: r(h.driftMm, 2), samples: h.samples, sampleHz: r(h.hz, 1),
      });
    }
    const tremorRms = handStats.length ? mean(handStats.map((h) => h.rmsMm).filter(Number.isFinite)) : NaN;
    const tremorPeak = handStats.length
      ? mean(handStats.map((h) => h.peakHz).filter(Number.isFinite)) : NaN;
    const handDrift = handStats.length ? mean(handStats.map((h) => h.driftMm).filter(Number.isFinite)) : NaN;
    const asymmetry = handStats.length === 2
      && Number.isFinite(handStats[0]!.rmsMm) && Number.isFinite(handStats[1]!.rmsMm)
      && Math.min(handStats[0]!.rmsMm, handStats[1]!.rmsMm) > 0
      ? Math.max(handStats[0]!.rmsMm, handStats[1]!.rmsMm) / Math.min(handStats[0]!.rmsMm, handStats[1]!.rmsMm)
      : NaN;

    /* ------------------------------------------------ metrics */

    const M: [string, number, string, string?][] = [
      ['sway_path_length_mm', stanceS?.pathLengthMm ?? NaN, 'mm', 'stance'],
      ['sway_area_95_mm2', stanceS?.area95Mm2 ?? NaN, 'mm2', 'stance'],
      ['sway_velocity_mm_s', stanceS?.meanVelocityMmS ?? NaN, 'mm/s', 'stance'],
      ['sway_ml_sd_mm', stanceS?.sdMlMm ?? NaN, 'mm', 'stance'],
      ['sway_ap_sd_mm', stanceS?.sdApMm ?? NaN, 'mm', 'stance'],
      ['dark_area_95_mm2', darkS?.area95Mm2 ?? NaN, 'mm2', 'dark'],
      ['romberg_quotient', romberg, 'ratio'],
      ['perturbation_gain_ratio', perturbGain, 'ratio', 'sway'],
      ['visual_reliance_mm', visualReliance, 'mm', 'sway'],
      ['drive_frequency_concentration', driveConcentration, 'ratio', 'sway'],
      ['tremor_rms_mm', tremorRms, 'mm', 'hand'],
      ['tremor_peak_freq_hz', tremorPeak, 'Hz', 'hand'],
      ['hand_drift_mm', handDrift, 'mm', 'hand'],
      ['hand_asymmetry', asymmetry, 'ratio', 'hand'],
      ['sample_rate_hz', stance ? this.sampleHz(stance) : NaN, 'Hz'],
    ];
    // Absent, not zero: skipping the optional block must not read as perfect
    // single-leg balance.
    if (legs.length) {
      M.push(['single_leg_area_ratio', legRatio, 'ratio', 'oneleg']);
      M.push(['single_leg_duration_s', legDuration, 's', 'oneleg']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* ------------------------------------------------- scores */

    const steadiness = normaliseSoft(Number.isFinite(tremorRms) ? tremorRms : 2.2, 0.25, 2.2);
    const staticStab = normaliseSoft(stanceS?.area95Mm2 ?? 1900, 220, 1900);
    const visualIndep = normaliseSoft(Number.isFinite(visualReliance) ? visualReliance : 12, 1.5, 12);
    const reweighting = normaliseSoft(Number.isFinite(romberg) ? romberg : 3.2, 1.3, 3.2);
    const legScore = normaliseSoft(Number.isFinite(legRatio) ? legRatio : 9.0, 2.0, 9.0);

    const hasLeg = legs.length > 0 && Number.isFinite(legRatio);
    const components = hasLeg
      ? [
          { key: 'hand_steadiness', value: steadiness, weight: 0.26 },
          { key: 'static_stability', value: staticStab, weight: 0.24 },
          { key: 'visual_independence', value: visualIndep, weight: 0.22 },
          { key: 'sensory_reweighting', value: reweighting, weight: 0.16 },
          { key: 'single_leg_balance', value: legScore, weight: 0.12 },
        ]
      : [
          { key: 'hand_steadiness', value: steadiness, weight: 0.295 },
          { key: 'static_stability', value: staticStab, weight: 0.273 },
          { key: 'visual_independence', value: visualIndep, weight: 0.250 },
          { key: 'sensory_reweighting', value: reweighting, weight: 0.182 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const num = (v: number, d = 1, suffix = '') =>
      Number.isFinite(v) ? `${v.toFixed(d)}${suffix}` : '—';

    const headline = [
      { label: 'Testlengés', value: Number.isFinite(stanceS?.area95Mm2 ?? NaN) ? `${Math.round(stanceS!.area95Mm2)} mm²` : '—',
        hint: 'a lengés területe nyitott szemmel' },
      { label: 'Romberg-hányados', value: num(romberg, 1, '×'), hint: 'ennyivel nő sötétben' },
      { label: 'Vizuális függés', value: num(visualReliance, 1, ' mm'),
        hint: Number.isFinite(driveConcentration)
          ? `ennyit lengtél a tér ütemére (${Math.round(driveConcentration * 100)}% arra a frekvenciára esik)`
          : 'ennyit lengtél a tér ütemére' },
      hasLeg
        ? { label: 'Egy lábon', value: num(legRatio, 1, '×'), hint: 'ennyivel nagyobb a lengés' }
        : { label: 'Egy lábon', value: 'kihagyva', hint: 'a pontszám a többi részből áll' },
      { label: 'Kéztremor', value: num(tremorRms, 2, ' mm'),
        hint: Number.isFinite(tremorPeak) ? `domináns ${tremorPeak.toFixed(1)} Hz` : undefined },
      { label: 'Kézkülönbség', value: num(asymmetry, 1, '×'), hint: 'a két kéz eltérése' },
    ];

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        spatialWeightsApplied: true,
        instrument: 'head-tracked, not force-plate; values are not comparable with force-plate norms',
        sampleRateHz: r(stance ? this.sampleHz(stance) : NaN, 1),
        stance: stanceS ? { areaMm2: r(stanceS.area95Mm2), pathMm: r(stanceS.pathLengthMm),
                            velocityMmS: r(stanceS.meanVelocityMmS), mlSdMm: r(stanceS.sdMlMm, 2),
                            apSdMm: r(stanceS.sdApMm, 2), samples: stanceS.samples } : null,
        dark: darkS ? { areaMm2: r(darkS.area95Mm2), samples: darkS.samples } : null,
        rombergQuotient: r(romberg, 2),
        perturbation: { gainRatio: r(perturbGain, 2), amplitudeMm: r(visualReliance, 2),
                        concentration: r(driveConcentration, 3), hz: PERTURB_HZ,
                        roomAmplitudeMm: PERTURB_AMPLITUDE_M * 1000 },
        singleLeg: hasLeg ? { areaRatio: r(legRatio, 2), durationS: r(legDuration, 1), skipped: false }
                          : { skipped: true, reason: this.oneLegSkipped ? 'user' : 'not_run' },
        hands: handStats.map((h) => ({
          hand: h.hand, rmsMm: r(h.rmsMm, 3), peakHz: r(h.peakHz, 2), driftMm: r(h.driftMm, 2),
        })),
        asymmetry: r(asymmetry, 2),
        abortedBlocks: this.traces.filter((t) => t.aborted).map((t) => t.block),
      },
      axisScores: {
        motor: Math.round((steadiness + staticStab) / 2),
        perception: Math.round(visualIndep),
      },
    };
  }

  abort(): void {
    this.aborted = true;
  }

  dispose(ctx: ModuleContext): void {
    this.offAction?.();
    this.offPanel?.();
    ctx.panels.remove(this.livePanel);
    ctx.panels.remove(this.promptPanel);
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
