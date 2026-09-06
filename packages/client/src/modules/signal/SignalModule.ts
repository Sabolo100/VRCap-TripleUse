import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, slope, normaliseSoft, opsScore, clamp,
  sdt, capacityK, normalisedEntropy,
  type ModuleManifest, type TrialRecord, type TrialOutcome,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { TrialMachine } from '../../engine/task/TrialMachine.js';
import { makePrimitive, disposeTree, Pool } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { ObjectPicker } from '../shared/picking.js';
import { layoutShell, shellPosition, fieldFor, type ShellField, type ShellSlot } from '../shared/layout.js';

/**
 * MODULE 01 - SIGNAL
 * Visual search and anomaly detection.
 *
 * Five blocks, built around one measurement that the others support: the
 * SEARCH SLOPE - how much longer a search takes for every extra object in the
 * display.
 *
 *   1 FEATURE      the target differs on one dimension and pops out. Slope
 *                  near zero; this block mostly measures the sensory and motor
 *                  chain, and exists to give block 2 something to subtract.
 *   2 CONJUNCTION  the target is defined by two features together, so the
 *                  display must be checked serially. Slope is the real
 *                  attentional measure, and the difference from block 1 is a
 *                  within-person contrast that cancels device latency.
 *   3 TRACK        multiple object tracking: how many moving items can be held
 *                  at once among identical distractors.
 *   4 CHANGE       flicker change detection: what survives a 250 ms blank.
 *   5 PERIPHERAL   detection at 15/30/45 degrees while a central task holds
 *                  attention in the middle.
 *
 * Target-present and target-absent trials are balanced 50/50 throughout the
 * search blocks. That is not decoration: in serial search the absent slope
 * should be roughly twice the present slope, and their ratio is an internal
 * validity check that the participant actually searched rather than guessed.
 */

type BlockId = 'feature' | 'conjunction' | 'mot' | 'change' | 'peripheral';

const COLOR_NEUTRAL = 0x3d7bb8;
const COLOR_TARGET = 0xff9e1b;
const COLOR_MOT = 0x8fa6bf;
const CHANGE_PALETTE = [0xff9e1b, 0x4fc3f7, 0x7cf59a, 0xff5c7a, 0xc6a0ff];

interface SearchItem {
  mesh: THREE.Mesh;
  slot: ShellSlot;
  isTarget: boolean;
}

interface MotSphere {
  mesh: THREE.Mesh;
  azDeg: number;
  elDeg: number;
  vAz: number;
  vEl: number;
  isTarget: boolean;
  selected: boolean;
}

interface ChangeItem {
  mesh: THREE.Mesh;
  slot: ShellSlot;
  baseColor: number;
  baseScale: number;
  altColor: number;
  altScale: number;
  altSlot: ShellSlot;
}

interface PendingSearch {
  setSize: number;
  targetPresent: boolean;
  targetIndex: number;
  onsetT: number | null;
  responded: boolean;
  extentDeg: number;
}

export class SignalModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.SIGNAL!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'feature',
      title: 'JELLEMZŐKERESÉS',
      instruction:
        'A tömbben minden objektum kék kocka, kivéve egyet: a cél NARANCSSÁRGA. ' +
        'Találd meg és jelöld meg a lehető leggyorsabban. A próbák felében nincs cél — ' +
        'ilyenkor a NINCS CÉL gombot használd.',
      controlHint: '',
      trials: 24,
      practiceTrials: 4,
    },
    {
      id: 'conjunction',
      title: 'KONJUNKCIÓS KERESÉS',
      instruction:
        'Most a cél a NARANCSSÁRGA KOCKA. Vannak narancssárga gömbök és kék kockák is — ' +
        'egyik jellemző önmagában nem elég. Csak az számít célnak, amelyik mindkettő. ' +
        'A próbák felében nincs cél.',
      controlHint: '',
      trials: 30,
      practiceTrials: 4,
    },
    {
      id: 'mot',
      title: 'KÖVETÉS',
      instruction:
        'Néhány gömb felvillan — ezeket kell megjegyezned. Ezután minden gömb egyformává válik ' +
        'és mozogni kezd. Amikor megállnak, jelöld ki azokat, amelyek az elején felvillantak.',
      controlHint: '',
      trials: 12,
      practiceTrials: 2,
    },
    {
      id: 'change',
      title: 'VÁLTOZÁS',
      instruction:
        'A jelenet villogni fog, és közben egy objektum folyamatosan változik: színe, mérete ' +
        'vagy helye. Találd meg, melyik az, és jelöld meg. Nem kell sietned — a pontosság számít.',
      controlHint: '',
      trials: 18,
      practiceTrials: 3,
    },
    {
      id: 'peripheral',
      title: 'PERIFÉRIA',
      instruction:
        'Két dolgod van egyszerre. Tartsd a mutatót a középen lassan sodródó gyűrűn, ' +
        'ÉS nyomd meg a MARKOLATGOMBOT (grip) a lehető leggyorsabban, valahányszor a látómeződ szélén felvillan valami. ' +
        'Néha nem villan fel semmi — ilyenkor ne nyomj semmit.',
      controlHint: '',
      trials: 30,
      practiceTrials: 4,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private picker!: ObjectPicker;
  private field!: ShellField;
  private motField!: ShellField;

  private cubePool!: Pool<THREE.Mesh>;
  private spherePool!: Pool<THREE.Mesh>;
  private conePool!: Pool<THREE.Mesh>;

  private fixation!: THREE.Mesh;
  private centralRing!: THREE.Mesh;
  private peripheralFlash!: THREE.Mesh;

  private controlPanel!: Panel;
  private feedbackPanel!: Panel;
  private controlMode: 'none' | 'absent' | 'submit' = 'none';
  private feedbackText = '';

  private machine: TrialMachine | null = null;
  private pending: PendingSearch | null = null;
  private items: SearchItem[] = [];
  private motSpheres: MotSphere[] = [];
  private changeItems: ChangeItem[] = [];
  private changeIndex = -1;
  private changeShowingAlt = false;
  private changeCycles = 0;

  private currentBlock: BlockId = 'feature';
  private practice = false;
  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private offPanel: (() => void) | null = null;
  private blockResolve: (() => void) | null = null;
  private aborted = false;

  /** Head direction samples for scan coverage (VR only). */
  private headYaw: number[] = [];
  private headBins = new Array(18).fill(0);
  private sampleTimer = 0;

  /** Peripheral block accumulators. */
  private centralOnTargetMs = 0;
  private centralTotalMs = 0;
  private peripheralActive = false;
  private peripheralOnsetT = 0;
  private peripheralEcc = 0;
  private peripheralResponded = false;
  private peripheralCatch = false;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    this.field = fieldFor(ctx.platform, {
      vr: [55, 25, 6.0],
      desktop: [26, 14, 5.0],
      mobile: [20, 13, 6.0],
    });
    this.motField = fieldFor(ctx.platform, {
      vr: [38, 20, 5.0],
      desktop: [22, 12, 4.5],
      mobile: [17, 11, 5.5],
    });

    const objScale = ctx.platform === 'mobile' ? 1.32 : 1;
    this.cubePool = new Pool<THREE.Mesh>(
      () => makePrimitive({ kind: 'box', color: COLOR_NEUTRAL, unlit: true, size: 0.16 * objScale }),
      (m) => { m.scale.setScalar(0.16 * objScale); (m.material as THREE.MeshBasicMaterial).color.setHex(COLOR_NEUTRAL); },
      28
    );
    this.spherePool = new Pool<THREE.Mesh>(
      () => makePrimitive({ kind: 'sphere', color: COLOR_NEUTRAL, unlit: true, size: 0.17 * objScale }),
      (m) => { m.scale.setScalar(0.17 * objScale); (m.material as THREE.MeshBasicMaterial).color.setHex(COLOR_NEUTRAL); },
      28
    );
    this.conePool = new Pool<THREE.Mesh>(
      () => makePrimitive({ kind: 'cone', color: COLOR_NEUTRAL, unlit: true, size: 0.18 * objScale }),
      (m) => { m.scale.setScalar(0.18 * objScale); (m.material as THREE.MeshBasicMaterial).color.setHex(COLOR_NEUTRAL); },
      8
    );

    this.fixation = makePrimitive({ kind: 'sphere', color: 0x5c6b7d, unlit: true, size: 0.04 });
    this.fixation.position.copy(shellPosition(0, 0, this.field));
    this.fixation.visible = false;
    this.root.add(this.fixation);

    this.centralRing = makePrimitive({
      kind: 'ring', color: ctx.theme.accent, unlit: true, size: 0.09, doubleSided: true,
    });
    this.centralRing.visible = false;
    this.root.add(this.centralRing);

    this.peripheralFlash = makePrimitive({ kind: 'sphere', color: 0xffffff, unlit: true, size: 0.13 });
    this.peripheralFlash.visible = false;
    this.root.add(this.peripheralFlash);

    // Control surface below the array: "no target" in search, "done" in MOT.
    this.controlPanel = new Panel({
      width: 0.62, height: 0.16, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'signal-control',
    });
    this.controlPanel.group.position.copy(shellPosition(0, -(this.field.elDeg + 9), this.field));
    this.controlPanel.group.lookAt(0, this.field.height, 0);
    this.controlPanel.setDraw((ui) => this.drawControl(ui));
    this.controlPanel.group.visible = false;
    this.root.add(this.controlPanel.group);
    ctx.panels.add(this.controlPanel);

    this.feedbackPanel = new Panel({
      width: 0.9, height: 0.2, pxPerMeter: 900, theme: ctx.theme, frame: false, name: 'signal-feedback',
    });
    this.feedbackPanel.group.position.copy(shellPosition(0, -(this.field.elDeg + 17), this.field));
    this.feedbackPanel.group.lookAt(0, this.field.height, 0);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    this.picker = new ObjectPicker(ctx, [this.controlPanel, this.feedbackPanel]);

    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
    this.offPanel = ctx.panels.onClick((e) => {
      if (e.panel !== this.controlPanel) return;
      if (e.widget.id === 'ctl:absent') this.onAbsentPressed(e.t);
      if (e.widget.id === 'ctl:submit') this.onMotSubmit();
    });
  }

  private controlHint(block: BlockId): string {
    const p = this.ctx.platform;
    switch (block) {
      case 'feature':
      case 'conjunction':
        return p === 'vr'
          ? 'Irányítsd a sugarat a célra és húzd meg a ravaszt. Ha nincs cél, a NINCS CÉL gombot használd.'
          : p === 'mobile'
            ? 'Koppints a célra. Ha nincs ott, a képernyő alján a NINCS CÉL gombra koppints.'
            : 'Kattints a célra. Ha nincs cél, a NINCS CÉL gombra kattints.';
      case 'mot':
        return p === 'vr'
          ? 'Jelöld ki a ravasszal a felvillant gömböket, majd nyomd meg a KÉSZ gombot.'
          : p === 'mobile'
            ? 'Koppints a felvillant gömbökre, majd a képernyő alján a KÉSZ gombra.'
            : 'Kattints a felvillant gömbökre, majd a KÉSZ gombra.';
      case 'change':
        return p === 'vr'
          ? 'Mutass arra az objektumra, amelyik változik, és húzd meg a ravaszt.'
          : p === 'mobile'
            ? 'Koppints arra az objektumra, amelyik változik.'
            : 'Kattints arra az objektumra, amelyik változik.';
      case 'peripheral':
        return p === 'vr'
          ? 'Tartsd a sugarat a középső gyűrűn, és húzd meg a ravaszt, amint a szélén felvillan valami.'
          : p === 'mobile'
            ? 'Tartsd az ujjad a középső gyűrűn, és koppints a másik ujjaddal a felvillanásra.'
            : 'Kövesd az egérrel a középső gyűrűt, és nyomj SZÓKÖZT, amint felvillan valami.';
    }
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    this.clearScene();
    this.setupTouchControls();
    const count = practice ? block.practiceTrials : block.trials;

    switch (this.currentBlock) {
      case 'feature':
      case 'conjunction':
        await this.runSearchBlock(count);
        break;
      case 'mot':
        await this.runMotBlock(count);
        break;
      case 'change':
        await this.runChangeBlock(count);
        break;
      case 'peripheral':
        await this.runPeripheralBlock(count);
        break;
    }
    this.clearScene();
  }

  /* --------------------------------------------------- search blocks */

  private setSizeSequence(count: number): number[] {
    const sizes = [6, 12, 24];
    const seq: number[] = [];
    for (let i = 0; i < count; i++) seq.push(sizes[i % sizes.length]!);
    return this.ctx.rng.shuffle(seq);
  }

  private presentSequence(count: number): boolean[] {
    // Exactly half target-present, shuffled. An unbalanced split would bias
    // the criterion estimate and make the absent/present slope ratio unusable.
    const seq: boolean[] = [];
    for (let i = 0; i < count; i++) seq.push(i < Math.round(count / 2));
    return this.ctx.rng.shuffle(seq);
  }

  private async runSearchBlock(count: number): Promise<void> {
    const sizes = this.setSizeSequence(count);
    const presents = this.presentSequence(count);
    const window = this.currentBlock === 'feature' ? 8000 : 12000;

    await new Promise<void>((resolve) => {
      this.blockResolve = resolve;
      this.machine = new TrialMachine(this.ctx.engine.clock, {
        trialCount: count,
        duration: (phase) => {
          switch (phase) {
            case 'prepare': return this.ctx.rng.range(600, 1100);
            case 'stimulus': return window;
            case 'feedback': return this.practice ? 600 : 0;
            case 'inter_trial': return 350;
            default: return 0;
          }
        },
        onEnter: (phase, trial, t) => {
          const rec = this.ctx.recorder;
          rec.trialNumber = trial + 1;
          if (phase === 'prepare') {
            this.clearItems();
            this.fixation.visible = true;
            this.controlPanel.group.visible = false;
            this.feedbackPanel.group.visible = false;
            this.headBins.fill(0);
            this.headYaw = [];
            this.pending = null;
          }
          if (phase === 'stimulus') {
            this.fixation.visible = false;
            this.buildSearchArray(sizes[trial]!, presents[trial]!, t);
            this.controlMode = 'absent';
            this.controlPanel.group.visible = !this.ctx.mobileControls;
            this.controlPanel.invalidate();
          }
          if (phase === 'feedback' && this.practice) {
            this.feedbackPanel.group.visible = true;
            this.feedbackPanel.invalidate();
          }
        },
        onExit: (phase, _trial, t) => {
          if (phase === 'stimulus' && this.pending && !this.pending.responded) {
            this.commitSearch(null, 'timeout', false, t, {});
            this.feedbackText = 'KIMARADT';
            this.ctx.audio.error();
          }
          if (phase === 'inter_trial') this.clearItems();
        },
        onComplete: () => { this.machine = null; resolve(); },
      });
      this.machine.start();
    });
    this.blockResolve = null;
  }

  private buildSearchArray(setSize: number, targetPresent: boolean, t: number): void {
    const rng = this.ctx.rng;
    const slots = layoutShell(setSize, this.field, rng);
    const targetIndex = targetPresent ? rng.int(0, setSize - 1) : -1;
    this.items = [];

    for (let i = 0; i < setSize; i++) {
      const slot = slots[i]!;
      const isTarget = i === targetIndex;
      let mesh: THREE.Mesh;

      if (this.currentBlock === 'feature') {
        // One dimension separates target from distractors: colour.
        mesh = this.cubePool.acquire();
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(isTarget ? COLOR_TARGET : COLOR_NEUTRAL);
      } else {
        // Conjunction: the target is the orange CUBE. Distractors are orange
        // spheres and blue cubes in roughly equal numbers, so neither feature
        // alone identifies the target and search has to be serial.
        if (isTarget) {
          mesh = this.cubePool.acquire();
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_TARGET);
        } else if (rng.bool(0.5)) {
          mesh = this.spherePool.acquire();
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_TARGET);
        } else {
          mesh = this.cubePool.acquire();
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_NEUTRAL);
        }
      }

      mesh.position.copy(slot.position);
      mesh.lookAt(0, this.field.height, 0);
      mesh.rotation.z = rng.range(0, Math.PI);
      mesh.userData.stimulusIndex = i;
      this.root.add(mesh);
      this.items.push({ mesh, slot, isTarget });
    }

    // Ray termination + cursor on the selectable stimuli.
    this.picker.setHoverTargets(this.items.map((i) => i.mesh));

    this.pending = {
      setSize,
      targetPresent,
      targetIndex,
      onsetT: t,
      responded: false,
      extentDeg: this.field.azDeg,
    };

    this.ctx.audio.click();
    this.ctx.recorder.event('array_onset', {
      block: this.currentBlock,
      setSize,
      targetPresent,
      targetIndex,
      arrayExtentDeg: this.field.azDeg,
      quantisationMs: +this.ctx.engine.clock.frameInterval.toFixed(1),
    }, t);
  }

  /**
   * The phone's version of this module's controls.
   *
   * On a headset "no target" is a panel floating below the array and the
   * peripheral response is a trigger. Neither survives a small screen: the
   * panel ends up behind the stimuli, and a tap anywhere is already how you
   * select one. Each block therefore states what it needs as on-screen
   * buttons, and the 3D control panel steps aside.
   */
  private setupTouchControls(): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    switch (this.currentBlock) {
      case 'feature':
      case 'conjunction':
        mc.set({
          hint: 'Koppints a narancssárga célra. Ha nincs ott, használd a gombot.',
          buttons: [{
            id: 'absent', label: 'NINCS CÉL', variant: 'ghost', wide: true,
            onTap: (t) => this.onAbsentPressed(t),
          }],
        });
        break;
      case 'mot':
        mc.set({
          hint: 'Koppints a felvillant gömbökre, majd KÉSZ.',
          buttons: [{
            id: 'submit', label: 'KÉSZ', variant: 'primary', wide: true,
            onTap: () => this.onMotSubmit(),
          }],
        });
        break;
      case 'change':
        mc.set({ hint: 'Koppints arra az objektumra, amelyik változik.' });
        break;
      case 'peripheral':
        // A tap cannot mean both "I saw the flash" and "I am tracking the
        // centre", so the peripheral answer gets a button of its own and the
        // scene keeps the tap.
        mc.set({
          hint: 'Tartsd a tekinteted középen. Amint a szélén felvillan valami, nyomd meg a gombot.',
          buttons: [{
            id: 'flash', label: 'VILLANÁS', sub: 'a szemem sarkából láttam',
            variant: 'accent2', wide: true,
            onTap: (t) => this.onPeripheralResponse(t),
          }],
        });
        break;
    }
  }

  private onAbsentPressed(t: number): void {
    const p = this.pending;
    if (!p || p.responded || !this.machine || this.machine.phase !== 'stimulus') return;
    const correct = !p.targetPresent;
    this.commitSearch(t - (p.onsetT ?? t), correct ? 'correct_reject' : 'miss', correct, t, { responseType: 'absent' });
    if (this.practice) {
      this.feedbackText = correct ? 'HELYES' : 'VOLT OTT CÉL';
      correct ? this.ctx.audio.ok() : this.ctx.audio.error();
    }
    this.machine.goto('feedback');
  }

  private onSearchPick(index: number, rtMs: number, errDeg: number, t: number): void {
    const p = this.pending;
    if (!p || p.responded || !this.machine) return;
    const correct = p.targetPresent && index === p.targetIndex;
    const outcome: TrialOutcome = correct ? 'hit' : 'false_alarm';
    this.commitSearch(rtMs, outcome, correct, t, {
      responseType: 'located',
      selectedIndex: index,
      localisationErrorDeg: +errDeg.toFixed(2),
    });
    if (this.practice) {
      this.feedbackText = correct ? `${Math.round(rtMs)} ms` : p.targetPresent ? 'NEM AZ' : 'NINCS OTT CÉL';
      correct ? this.ctx.audio.ok() : this.ctx.audio.error();
    }
    this.ctx.engine.input.pulse('both', correct ? 0.3 : 0.6, correct ? 25 : 70);
    this.machine.goto('feedback');
  }

  private commitSearch(
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
        kind: 'search',
        mode: this.currentBlock,
        setSize: p.setSize,
        targetPresent: p.targetPresent,
        targetIndex: p.targetIndex,
        arrayExtentDeg: p.extentDeg,
        platform: this.ctx.platform,
        practice: this.practice,
      },
      response: { ...response, rtMs },
      correct,
      outcome,
      reactionTimeMs: rtMs === null ? null : +rtMs.toFixed(1),
      startedAt: +(p.onsetT ?? endT).toFixed(1),
      endedAt: +endT.toFixed(1),
    };
    // Scan coverage is a per-trial property of how the display was inspected.
    if (this.ctx.platform === 'vr' && this.headYaw.length > 4) {
      (rec.response as Record<string, unknown>).headScanRangeDeg = +this.scanRange().toFixed(1);
    }
    this.ctx.recorder.trial(rec);
    this.ctx.recorder.event('search_response', {
      outcome, correct, rtMs: rec.reactionTimeMs, setSize: p.setSize, ...response,
    }, endT);
    if (!this.practice) this.trials.push(rec);
  }

  private scanRange(): number {
    if (this.headYaw.length < 2) return 0;
    const sorted = [...this.headYaw].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.05)]!;
    const hi = sorted[Math.floor(sorted.length * 0.95)]!;
    return hi - lo;
  }

  /* ------------------------------------------------------- MOT block */

  private async runMotBlock(count: number): Promise<void> {
    const rng = this.ctx.rng;
    const targetCounts = rng.shuffle(
      Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 3 : 4))
    );

    for (let trial = 0; trial < count; trial++) {
      if (this.aborted) return;
      this.ctx.recorder.trialNumber = trial + 1;
      const nTargets = targetCounts[trial]!;
      const total = 10;
      const trackMs = 8000;
      const speedDeg = (0.22 / this.motField.radius) * (180 / Math.PI); // deg/s

      this.buildMotSpheres(total, nTargets);
      const startT = this.ctx.engine.clock.frameTime;
      this.ctx.recorder.event('mot_targets_shown', {
        targetCount: nTargets,
        indices: this.motSpheres.map((s, i) => (s.isTarget ? i : -1)).filter((i) => i >= 0),
      }, startT);

      // Show which spheres are targets.
      for (const s of this.motSpheres) {
        if (s.isTarget) (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_TARGET);
      }
      await this.wait(2000);
      for (const s of this.motSpheres) (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_MOT);
      await this.wait(400);

      this.motMoving = true;
      this.motSpeedDeg = speedDeg;
      this.ctx.recorder.event('mot_motion_start', { trial: trial + 1, speed: 0.22, durationMs: trackMs });
      await this.wait(trackMs);
      this.motMoving = false;
      this.ctx.recorder.event('mot_motion_end', { trial: trial + 1 });

      // Selection phase.
      this.controlMode = 'submit';
      this.controlPanel.group.visible = !this.ctx.mobileControls;
      this.controlPanel.invalidate();
      this.motSelectionOpen = true;
      const selectionStart = this.ctx.engine.clock.frameTime;
      await new Promise<void>((resolve) => { this.motResolve = resolve; });
      this.motSelectionOpen = false;
      this.controlPanel.group.visible = false;
      const endT = this.ctx.engine.clock.frameTime;

      const selected = this.motSpheres.map((s, i) => (s.selected ? i : -1)).filter((i) => i >= 0);
      const targets = this.motSpheres.map((s, i) => (s.isTarget ? i : -1)).filter((i) => i >= 0);
      const correctCount = selected.filter((i) => targets.includes(i)).length;

      const rec: TrialRecord = {
        trialNumber: trial + 1,
        block: 'mot',
        stimulus: {
          kind: 'mot', targetCount: nTargets, targetIndices: targets,
          speed: 0.22, trackMs, total, practice: this.practice,
        },
        response: { selectedIndices: selected, correctCount, rtMs: endT - selectionStart },
        correct: correctCount === nTargets,
        outcome: correctCount === nTargets ? 'hit' : 'miss',
        reactionTimeMs: +(endT - selectionStart).toFixed(1),
        startedAt: +startT.toFixed(1),
        endedAt: +endT.toFixed(1),
      };
      this.ctx.recorder.trial(rec);
      this.ctx.recorder.event('mot_submitted', { selected, correctCount, targetCount: nTargets }, endT);
      if (!this.practice) this.trials.push(rec);

      if (this.practice) {
        this.feedbackText = `${correctCount} / ${nTargets} helyes`;
        this.feedbackPanel.group.visible = true;
        this.feedbackPanel.invalidate();
        correctCount === nTargets ? this.ctx.audio.ok() : this.ctx.audio.error();
        await this.wait(1400);
        this.feedbackPanel.group.visible = false;
      }
      this.clearMot();
      await this.wait(400);
    }
  }

  private motMoving = false;
  private motSpeedDeg = 0;
  private motSelectionOpen = false;
  private motResolve: (() => void) | null = null;

  private buildMotSpheres(total: number, nTargets: number): void {
    const rng = this.ctx.rng;
    const slots = layoutShell(total, this.motField, rng);
    const targetSet = new Set(rng.shuffle(Array.from({ length: total }, (_, i) => i)).slice(0, nTargets));
    this.motSpheres = [];
    for (let i = 0; i < total; i++) {
      const mesh = this.spherePool.acquire();
      mesh.scale.setScalar(0.20);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_MOT);
      mesh.position.copy(slots[i]!.position);
      mesh.userData.stimulusIndex = i;
      this.root.add(mesh);
      const dir = rng.range(0, Math.PI * 2);
      this.motSpheres.push({
        mesh,
        azDeg: slots[i]!.azDeg,
        elDeg: slots[i]!.elDeg,
        vAz: Math.cos(dir),
        vEl: Math.sin(dir) * 0.6,
        isTarget: targetSet.has(i),
        selected: false,
      });
    }
  }

  private updateMot(dt: number): void {
    if (!this.motMoving) return;
    const f = this.motField;
    const step = this.motSpeedDeg * dt;
    for (const s of this.motSpheres) {
      s.azDeg += s.vAz * step;
      s.elDeg += s.vEl * step;
      // Reflect off the field boundary so items stay in the measured area.
      if (s.azDeg < -f.azDeg || s.azDeg > f.azDeg) {
        s.vAz *= -1;
        s.azDeg = clamp(s.azDeg, -f.azDeg, f.azDeg);
      }
      if (s.elDeg < -f.elDeg || s.elDeg > f.elDeg) {
        s.vEl *= -1;
        s.elDeg = clamp(s.elDeg, -f.elDeg, f.elDeg);
      }
    }
    // Pairwise repulsion: two spheres that merge become one perceptual object,
    // and tracking would silently become easier.
    for (let i = 0; i < this.motSpheres.length; i++) {
      for (let j = i + 1; j < this.motSpheres.length; j++) {
        const a = this.motSpheres[i]!;
        const b = this.motSpheres[j]!;
        const dAz = a.azDeg - b.azDeg;
        const dEl = a.elDeg - b.elDeg;
        const d = Math.hypot(dAz, dEl);
        if (d >= f.minSepDeg || d < 1e-4) continue;
        const push = (f.minSepDeg - d) / 2;
        const ux = (dAz / d) * push;
        const uy = (dEl / d) * push;
        a.azDeg += ux; a.elDeg += uy;
        b.azDeg -= ux; b.elDeg -= uy;
        a.vAz = -a.vAz * 0.6 + ux; b.vAz = -b.vAz * 0.6 - ux;
      }
    }
    for (const s of this.motSpheres) {
      s.azDeg = clamp(s.azDeg, -f.azDeg, f.azDeg);
      s.elDeg = clamp(s.elDeg, -f.elDeg, f.elDeg);
      s.mesh.position.copy(shellPosition(s.azDeg, s.elDeg, f));
    }
  }

  private onMotPick(index: number): void {
    if (!this.motSelectionOpen) return;
    const s = this.motSpheres[index];
    if (!s) return;
    const targetCount = this.motSpheres.filter((x) => x.isTarget).length;
    const selectedCount = this.motSpheres.filter((x) => x.selected).length;
    if (!s.selected && selectedCount >= targetCount) {
      this.ctx.audio.error();
      return;
    }
    s.selected = !s.selected;
    (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(s.selected ? COLOR_TARGET : COLOR_MOT);
    s.mesh.scale.setScalar(s.selected ? 0.24 : 0.20);
    this.ctx.audio.click();
    this.ctx.recorder.event('mot_selection', { index, selected: s.selected });
    this.controlPanel.invalidate();
  }

  private onMotSubmit(): void {
    if (!this.motSelectionOpen) return;
    const targetCount = this.motSpheres.filter((x) => x.isTarget).length;
    const selectedCount = this.motSpheres.filter((x) => x.selected).length;
    if (selectedCount !== targetCount) {
      this.ctx.audio.error();
      return;
    }
    this.motResolve?.();
    this.motResolve = null;
  }

  private clearMot(): void {
    for (const s of this.motSpheres) this.spherePool.release(s.mesh);
    this.motSpheres = [];
  }

  /* ---------------------------------------------------- change block */

  private async runChangeBlock(count: number): Promise<void> {
    const rng = this.ctx.rng;
    for (let trial = 0; trial < count; trial++) {
      if (this.aborted) return;
      this.ctx.recorder.trialNumber = trial + 1;
      const sceneSize = 8;
      const roll = rng.next();
      const changeType: 'color' | 'size' | 'position' = roll < 0.4 ? 'color' : roll < 0.7 ? 'size' : 'position';

      this.buildChangeScene(sceneSize, changeType);
      this.changeCycles = 0;
      this.changeShowingAlt = false;
      const startT = this.ctx.engine.clock.frameTime;
      this.ctx.recorder.event('change_scene_shown', { sceneSize, changeType, index: this.changeIndex }, startT);

      this.changeResponse = null;
      const deadline = startT + 15000;

      // Flicker: scene / blank / modified scene / blank / ... The blank is what
      // makes this a memory task - without it the change produces a local
      // motion transient that peripheral vision picks up for free.
      while (this.takeChangeResponse() === null && this.ctx.engine.clock.frameTime < deadline && !this.aborted) {
        this.setChangeVisible(true);
        await this.wait(1200);
        if (this.takeChangeResponse() !== null) break;
        this.setChangeVisible(false);
        await this.wait(250);
        if (this.takeChangeResponse() !== null) break;
        this.changeShowingAlt = !this.changeShowingAlt;
        this.applyChangeState();
        this.changeCycles++;
        this.ctx.recorder.event('change_applied', {
          changeType, index: this.changeIndex, showingAlt: this.changeShowingAlt, cycle: this.changeCycles,
        });
      }

      const endT = this.ctx.engine.clock.frameTime;
      const resp = this.takeChangeResponse();
      const correct = resp !== null && resp.index === this.changeIndex;
      const rec: TrialRecord = {
        trialNumber: trial + 1,
        block: 'change',
        stimulus: { kind: 'change', sceneSize, changeType, changeIndex: this.changeIndex, blankMs: 250, practice: this.practice },
        response: resp === null ? null : { selectedIndex: resp.index, cycles: this.changeCycles, rtMs: resp.t - startT },
        correct,
        outcome: resp === null ? 'timeout' : correct ? 'hit' : 'false_alarm',
        reactionTimeMs: resp === null ? null : +(resp.t - startT).toFixed(1),
        startedAt: +startT.toFixed(1),
        endedAt: +endT.toFixed(1),
      };
      this.ctx.recorder.trial(rec);
      this.ctx.recorder.event('change_response', {
        correct, index: resp?.index ?? null, cycles: this.changeCycles, rtMs: rec.reactionTimeMs,
      }, endT);
      if (!this.practice) this.trials.push(rec);

      if (this.practice) {
        this.feedbackText = correct ? `HELYES · ${this.changeCycles} ciklus` : 'NEM AZ VOLT';
        this.feedbackPanel.group.visible = true;
        this.feedbackPanel.invalidate();
        correct ? this.ctx.audio.ok() : this.ctx.audio.error();
        await this.wait(1300);
        this.feedbackPanel.group.visible = false;
      }
      this.clearChange();
      await this.wait(350);
    }
  }

  private changeResponse: { index: number; t: number } | null = null;

  /** Read through a call so the flicker loop's null-check does not narrow the
   *  field for the rest of the trial - the input handler writes it. */
  private takeChangeResponse(): { index: number; t: number } | null {
    return this.changeResponse;
  }

  private buildChangeScene(sceneSize: number, changeType: 'color' | 'size' | 'position'): void {
    const rng = this.ctx.rng;
    const slots = layoutShell(sceneSize + 1, this.field, rng);
    this.changeIndex = rng.int(0, sceneSize - 1);
    this.changeItems = [];

    for (let i = 0; i < sceneSize; i++) {
      const slot = slots[i]!;
      const kindRoll = rng.next();
      const mesh = kindRoll < 0.4 ? this.cubePool.acquire() : kindRoll < 0.8 ? this.spherePool.acquire() : this.conePool.acquire();
      const baseColor = CHANGE_PALETTE[rng.int(0, CHANGE_PALETTE.length - 1)]!;
      const baseScale = mesh.scale.x;
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(baseColor);
      mesh.position.copy(slot.position);
      mesh.lookAt(0, this.field.height, 0);
      mesh.userData.stimulusIndex = i;
      this.root.add(mesh);

      const isChanging = i === this.changeIndex;
      // Every change is far above threshold: this measures whether the change
      // was noticed, not whether it was visible.
      let altColor = baseColor;
      let altScale = baseScale;
      let altSlot = slot;
      if (isChanging) {
        if (changeType === 'color') {
          const others = CHANGE_PALETTE.filter((c) => c !== baseColor);
          altColor = others[rng.int(0, others.length - 1)]!;
        } else if (changeType === 'size') {
          altScale = baseScale * (rng.bool() ? 1.45 : 0.55);
        } else {
          altSlot = slots[sceneSize]!;
        }
      }
      this.changeItems.push({ mesh, slot, baseColor, baseScale, altColor, altScale, altSlot });
    }
  }

  private applyChangeState(): void {
    const it = this.changeItems[this.changeIndex];
    if (!it) return;
    const alt = this.changeShowingAlt;
    (it.mesh.material as THREE.MeshBasicMaterial).color.setHex(alt ? it.altColor : it.baseColor);
    it.mesh.scale.setScalar(alt ? it.altScale : it.baseScale);
    it.mesh.position.copy(alt ? it.altSlot.position : it.slot.position);
  }

  private setChangeVisible(v: boolean): void {
    for (const it of this.changeItems) it.mesh.visible = v;
  }

  private clearChange(): void {
    for (const it of this.changeItems) {
      it.mesh.visible = true;
      it.mesh.scale.setScalar(it.baseScale);
      if (it.mesh.geometry.type === 'BoxGeometry') this.cubePool.release(it.mesh);
      else if (it.mesh.geometry.type === 'SphereGeometry') this.spherePool.release(it.mesh);
      else this.conePool.release(it.mesh);
    }
    this.changeItems = [];
  }

  /* ------------------------------------------------ peripheral block */

  private peripheralTrials: { ecc: number; azimuth: number; isCatch: boolean }[] = [];
  private peripheralResults: { ecc: number; rtMs: number | null; hit: boolean; isCatch: boolean; falseAlarm: boolean }[] = [];
  private centralPhase = 0;

  private async runPeripheralBlock(count: number): Promise<void> {
    const rng = this.ctx.rng;
    const eccs = this.ctx.platform === 'vr' ? [15, 30, 45] : this.ctx.platform === 'desktop' ? [10, 17, 24] : [8, 13, 18];
    const catchCount = Math.round(count * 0.2);
    this.peripheralTrials = [];
    for (let i = 0; i < count; i++) {
      const isCatch = i < catchCount;
      this.peripheralTrials.push({
        ecc: eccs[i % eccs.length]!,
        azimuth: rng.range(0, 360),
        isCatch,
      });
    }
    this.peripheralTrials = rng.shuffle(this.peripheralTrials);
    this.peripheralResults = [];
    this.centralOnTargetMs = 0;
    this.centralTotalMs = 0;

    this.centralRing.visible = true;
    this.centralActive = true;

    for (let trial = 0; trial < count; trial++) {
      if (this.aborted) break;
      this.ctx.recorder.trialNumber = trial + 1;
      const spec = this.peripheralTrials[trial]!;

      await this.wait(rng.range(2200, 5200));
      if (this.aborted) break;

      const onsetT = this.ctx.engine.clock.frameTime;
      this.peripheralResponded = false;
      this.peripheralCatch = spec.isCatch;
      this.peripheralEcc = spec.ecc;
      this.peripheralOnsetT = onsetT;
      this.peripheralActive = true;

      if (!spec.isCatch) {
        const az = Math.cos((spec.azimuth * Math.PI) / 180) * spec.ecc;
        const el = Math.sin((spec.azimuth * Math.PI) / 180) * spec.ecc * 0.6;
        this.peripheralFlash.position.copy(shellPosition(az, el, this.field));
        this.peripheralFlash.visible = true;
        this.ctx.recorder.event('peripheral_flash', {
          eccentricityDeg: spec.ecc, azimuthDeg: +spec.azimuth.toFixed(1), catchTrial: false,
          quantisationMs: +this.ctx.engine.clock.frameInterval.toFixed(1),
        }, onsetT);
        await this.wait(220);
        this.peripheralFlash.visible = false;
      } else {
        this.ctx.recorder.event('peripheral_flash', { eccentricityDeg: spec.ecc, catchTrial: true }, onsetT);
      }

      // Response window continues past the flash: a detection response can
      // legitimately arrive after the stimulus has gone.
      await this.wait(spec.isCatch ? 900 : 780);
      this.peripheralActive = false;

      const res = this.peripheralResults.find((r) => r.ecc === spec.ecc && r.rtMs !== null && r.hit && !r.isCatch);
      void res;
      if (!this.peripheralResponded) {
        this.peripheralResults.push({ ecc: spec.ecc, rtMs: null, hit: false, isCatch: spec.isCatch, falseAlarm: false });
        const rec: TrialRecord = {
          trialNumber: trial + 1,
          block: 'peripheral',
          stimulus: { kind: 'peripheral', eccentricityDeg: spec.ecc, azimuthDeg: +spec.azimuth.toFixed(1), catchTrial: spec.isCatch, practice: this.practice },
          response: null,
          correct: spec.isCatch,
          outcome: spec.isCatch ? 'correct_reject' : 'miss',
          reactionTimeMs: null,
          startedAt: +onsetT.toFixed(1),
          endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
        };
        this.ctx.recorder.trial(rec);
        if (!this.practice) this.trials.push(rec);
      }
    }

    this.centralActive = false;
    this.centralRing.visible = false;
    this.peripheralFlash.visible = false;
  }

  private centralActive = false;

  private onPeripheralResponse(t: number): void {
    if (!this.centralActive) return;
    if (this.peripheralResponded) return;
    const inWindow = this.peripheralActive || (t - this.peripheralOnsetT) < 1200;
    if (!inWindow) return;
    this.peripheralResponded = true;
    const rtMs = t - this.peripheralOnsetT;
    const hit = !this.peripheralCatch;
    this.peripheralResults.push({
      ecc: this.peripheralEcc, rtMs, hit, isCatch: this.peripheralCatch, falseAlarm: this.peripheralCatch,
    });
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block: 'peripheral',
      stimulus: { kind: 'peripheral', eccentricityDeg: this.peripheralEcc, catchTrial: this.peripheralCatch, practice: this.practice },
      response: { rtMs: +rtMs.toFixed(1) },
      correct: hit,
      outcome: hit ? 'hit' : 'false_alarm',
      reactionTimeMs: +rtMs.toFixed(1),
      startedAt: +this.peripheralOnsetT.toFixed(1),
      endedAt: +t.toFixed(1),
    };
    this.ctx.recorder.trial(rec);
    this.ctx.recorder.event('peripheral_response', {
      rtMs: +rtMs.toFixed(1), hit, eccentricityDeg: this.peripheralEcc, catchTrial: this.peripheralCatch,
    }, t);
    if (!this.practice) this.trials.push(rec);
    if (this.practice) {
      this.feedbackText = hit ? `${Math.round(rtMs)} ms` : 'NEM VOLT INGER';
      hit ? this.ctx.audio.ok() : this.ctx.audio.error();
    }
  }

  /* ------------------------------------------------------------ input */

  private onAction(e: ActionEvent): void {
    if (!e.down) return;

    if (this.currentBlock === 'peripheral') {
      // With a button on screen, a tap on the scene is not an answer - it
      // would fire every time the participant steadies their grip.
      if (e.action === 'PRIMARY' && !this.ctx.mobileControls) this.onPeripheralResponse(e.t);
      return;
    }

    if (e.action !== 'PRIMARY') return;
    const ray = e.ray ?? this.ctx.engine.input.primaryRay();
    if (!ray) return;

    if (this.currentBlock === 'mot') {
      if (!this.motSelectionOpen) return;
      const hit = this.picker.pick(ray, this.motSpheres.map((s) => s.mesh));
      if (hit) this.onMotPick(hit.object.userData.stimulusIndex as number);
      return;
    }

    if (this.currentBlock === 'change') {
      if (this.changeResponse !== null) return;
      const hit = this.picker.pick(ray, this.changeItems.map((c) => c.mesh));
      if (hit) {
        this.changeResponse = { index: hit.object.userData.stimulusIndex as number, t: e.t };
        this.ctx.audio.click();
      }
      return;
    }

    // Search blocks.
    const p = this.pending;
    if (!p || p.responded || !this.machine || this.machine.phase !== 'stimulus') return;
    const hit = this.picker.pick(ray, this.items.map((i) => i.mesh));
    if (!hit) return;
    const index = hit.object.userData.stimulusIndex as number;
    const item = this.items[index];
    if (!item) return;
    const errDeg = this.picker.angularErrorTo(ray, item.mesh.position);
    this.onSearchPick(index, e.t - (p.onsetT ?? e.t), errDeg, e.t);
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.machine?.update(dt);
    this.updateMot(dt);

    // Central drifting ring plus its tracking measurement.
    if (this.centralActive) {
      this.centralPhase += dt * 0.55;
      const az = Math.sin(this.centralPhase) * 3.4;
      const el = Math.sin(this.centralPhase * 1.37) * 2.2;
      this.centralRing.position.copy(shellPosition(az, el, this.field));
      this.centralRing.lookAt(0, this.field.height, 0);
      const ray = ctx.engine.input.primaryRay();
      if (ray) {
        const err = this.picker.angularErrorTo(ray, this.centralRing.position);
        const onTarget = err <= 3.0;
        this.centralTotalMs += dt * 1000;
        if (onTarget) this.centralOnTargetMs += dt * 1000;
        (this.centralRing.material as THREE.MeshBasicMaterial).color.set(onTarget ? ctx.theme.ok : ctx.theme.accent);
      }
    }

    // Head direction sampling for scan coverage, VR only.
    if (ctx.platform === 'vr') {
      this.sampleTimer += dt;
      if (this.sampleTimer >= 0.1) {
        this.sampleTimer = 0;
        const q = new THREE.Quaternion();
        ctx.engine.camera.getWorldQuaternion(q);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const yaw = THREE.MathUtils.radToDeg(Math.atan2(fwd.x, -fwd.z));
        this.headYaw.push(yaw);
        const bin = clamp(Math.floor((yaw + 90) / 10), 0, this.headBins.length - 1);
        this.headBins[bin]++;
        if (this.headYaw.length % 5 === 0) {
          ctx.recorder.event('head_sample', { yawDeg: +yaw.toFixed(1) });
        }
      }
    }
  }

  /* ------------------------------------------------------------- UI */

  private drawControl(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 14, withAlpha('#000000', 0.5));
    if (this.controlMode === 'absent') {
      ui.button('ctl:absent', 12, 12, ui.w - 24, ui.h - 24, { label: 'NINCS CÉL', variant: 'ghost', fontSize: 34 });
    } else if (this.controlMode === 'submit') {
      const targets = this.motSpheres.filter((s) => s.isTarget).length;
      const selected = this.motSpheres.filter((s) => s.selected).length;
      ui.button('ctl:submit', 12, 12, ui.w - 24, ui.h - 24, {
        label: `KÉSZ  ${selected} / ${targets}`,
        variant: selected === targets ? 'primary' : 'ghost',
        disabled: selected !== targets,
        fontSize: 32,
      });
      void t;
    }
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 14, withAlpha('#000000', 0.55));
    const good = /ms|HELYES|ciklus|helyes/.test(this.feedbackText);
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 40, color: good ? t.ok : t.bad, align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  /* ------------------------------------------------------- housekeeping */

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private clearItems(): void {
    for (const it of this.items) {
      if (it.mesh.geometry.type === 'BoxGeometry') this.cubePool.release(it.mesh);
      else this.spherePool.release(it.mesh);
    }
    this.items = [];
  }

  private clearScene(): void {
    this.clearItems();
    this.clearMot();
    this.clearChange();
    this.fixation.visible = false;
    this.centralRing.visible = false;
    this.peripheralFlash.visible = false;
    this.controlPanel.group.visible = false;
    this.feedbackPanel.group.visible = false;
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const by = (b: BlockId) => this.trials.filter((t) => t.block === b);

    /* --- search slopes ------------------------------------------- */
    const searchStats = (block: BlockId) => {
      const all = by(block);
      const present = all.filter((t) => t.stimulus.targetPresent === true);
      const absent = all.filter((t) => t.stimulus.targetPresent === false);
      const correctPresent = present.filter((t) => t.outcome === 'hit' && t.reactionTimeMs !== null);
      const correctAbsent = absent.filter((t) => t.outcome === 'correct_reject' && t.reactionTimeMs !== null);

      const sizesP = correctPresent.map((t) => t.stimulus.setSize as number);
      const rtsP = correctPresent.map((t) => t.reactionTimeMs!);
      const sizesA = correctAbsent.map((t) => t.stimulus.setSize as number);
      const rtsA = correctAbsent.map((t) => t.reactionTimeMs!);

      const slopeP = rtsP.length >= 4 ? slope(sizesP, rtsP) : NaN;
      const slopeA = rtsA.length >= 4 ? slope(sizesA, rtsA) : NaN;
      // Intercept from the present-trial regression: the part of the response
      // time that is not search - encoding plus the motor act of pointing.
      const intercept = rtsP.length >= 4 && Number.isFinite(slopeP)
        ? mean(rtsP) - slopeP * mean(sizesP)
        : NaN;

      const hits = present.filter((t) => t.outcome === 'hit').length;
      const misses = present.length - hits;
      const fa = absent.filter((t) => t.outcome === 'false_alarm').length;
      const cr = absent.filter((t) => t.outcome === 'correct_reject').length;

      return {
        slopeP, slopeA, intercept,
        medianRt: median(rtsP),
        sdt: sdt(hits, misses, fa, cr),
        n: all.length,
        localisation: median(
          present.map((t) => (t.response?.localisationErrorDeg as number | undefined) ?? NaN).filter(Number.isFinite)
        ),
      };
    };

    const feat = searchStats('feature');
    const conj = searchStats('conjunction');
    const slopeDiff = Number.isFinite(conj.slopeP) && Number.isFinite(feat.slopeP) ? conj.slopeP - feat.slopeP : NaN;
    const absentRatio = Number.isFinite(conj.slopeA) && Number.isFinite(conj.slopeP) && conj.slopeP > 1
      ? conj.slopeA / conj.slopeP
      : NaN;

    // Combined search sensitivity across both blocks.
    const allSearch = [...by('feature'), ...by('conjunction')];
    const sHits = allSearch.filter((t) => t.outcome === 'hit').length;
    const sMiss = allSearch.filter((t) => t.stimulus.targetPresent === true && t.outcome !== 'hit').length;
    const sFa = allSearch.filter((t) => t.outcome === 'false_alarm').length;
    const sCr = allSearch.filter((t) => t.outcome === 'correct_reject').length;
    const searchSdt = sdt(sHits, sMiss, sFa, sCr);

    /* --- MOT ------------------------------------------------------ */
    const mot = by('mot');
    let motHits = 0;
    let motTargets = 0;
    let motSelections = 0;
    const kValues: number[] = [];
    for (const t of mot) {
      const n = t.stimulus.targetCount as number;
      const total = (t.stimulus.total as number) ?? 10;
      const correct = (t.response?.correctCount as number) ?? 0;
      motHits += correct;
      motTargets += n;
      motSelections += ((t.response?.selectedIndices as number[]) ?? []).length;
      const hitRate = n > 0 ? correct / n : 0;
      const faRate = total - n > 0 ? (n - correct) / (total - n) : 0;
      kValues.push(capacityK(n, hitRate, faRate));
    }
    const motAccuracy = motTargets > 0 ? motHits / motTargets : NaN;
    const motK = kValues.length ? mean(kValues) : NaN;

    /* --- change --------------------------------------------------- */
    const change = by('change');
    const changeCorrect = change.filter((t) => t.correct).length;
    const changeAccuracy = change.length ? changeCorrect / change.length : NaN;
    const changeRt = median(change.filter((t) => t.correct && t.reactionTimeMs !== null).map((t) => t.reactionTimeMs!));
    const changeCycles = median(
      change.filter((t) => t.correct).map((t) => (t.response?.cycles as number) ?? NaN).filter(Number.isFinite)
    );
    const changeByType = (type: string) => {
      const sub = change.filter((t) => t.stimulus.changeType === type);
      return sub.length ? sub.filter((t) => t.correct).length / sub.length : NaN;
    };

    /* --- peripheral ----------------------------------------------- */
    const periph = by('peripheral');
    const real = periph.filter((t) => t.stimulus.catchTrial !== true);
    const catches = periph.filter((t) => t.stimulus.catchTrial === true);
    const periphHitRate = (ecc: number) => {
      const sub = real.filter((t) => t.stimulus.eccentricityDeg === ecc);
      return sub.length ? sub.filter((t) => t.outcome === 'hit').length / sub.length : NaN;
    };
    const eccs = [...new Set(real.map((t) => t.stimulus.eccentricityDeg as number))].sort((a, b) => a - b);
    const hitRates = eccs.map((e) => periphHitRate(e));
    const eccCost = eccs.length >= 2 ? slope(eccs, hitRates.map((h) => (Number.isFinite(h) ? h : 0))) : NaN;
    const periphRt = median(real.filter((t) => t.outcome === 'hit' && t.reactionTimeMs !== null).map((t) => t.reactionTimeMs!));
    const periphOverall = real.length ? real.filter((t) => t.outcome === 'hit').length / real.length : NaN;
    const periphFa = catches.filter((t) => t.outcome === 'false_alarm').length;
    const centralOnTarget = this.centralTotalMs > 0 ? this.centralOnTargetMs / this.centralTotalMs : NaN;

    /* --- scan coverage -------------------------------------------- */
    const headRange = ctx.platform === 'vr' ? this.scanRange() : NaN;
    const headEntropy = ctx.platform === 'vr' ? normalisedEntropy(this.headBins) : NaN;

    /* ------------------------------------------------------ metrics */

    const M: [string, number, string, string?][] = [
      ['feature_slope', feat.slopeP, 'ms/item', 'feature'],
      ['feature_slope_absent', feat.slopeA, 'ms/item', 'feature'],
      ['feature_intercept', feat.intercept, 'ms', 'feature'],
      ['feature_median_rt', feat.medianRt, 'ms', 'feature'],
      ['conjunction_slope', conj.slopeP, 'ms/item', 'conjunction'],
      ['conjunction_slope_absent', conj.slopeA, 'ms/item', 'conjunction'],
      ['conjunction_intercept', conj.intercept, 'ms', 'conjunction'],
      ['conjunction_median_rt', conj.medianRt, 'ms', 'conjunction'],
      ['search_slope_difference', slopeDiff, 'ms/item'],
      ['absent_present_slope_ratio', absentRatio, 'ratio', 'conjunction'],
      ['search_hit_rate', searchSdt.hitRate, 'ratio'],
      ['search_false_alarm_rate', searchSdt.faRate, 'ratio'],
      ['search_d_prime', searchSdt.dPrime, 'z'],
      ['search_criterion', searchSdt.criterion, 'z'],
      ['median_search_time', median([feat.medianRt, conj.medianRt].filter(Number.isFinite)), 'ms'],
      ['localisation_error_median', median([feat.localisation, conj.localisation].filter(Number.isFinite)), 'deg'],
      ['mot_accuracy', motAccuracy, 'ratio', 'mot'],
      ['mot_capacity_k', motK, 'items', 'mot'],
      ['mot_selections', motSelections, 'count', 'mot'],
      ['change_accuracy', changeAccuracy, 'ratio', 'change'],
      ['change_detection_time', changeRt, 'ms', 'change'],
      ['change_cycles_needed', changeCycles, 'count', 'change'],
      ['change_accuracy_color', changeByType('color'), 'ratio', 'change'],
      ['change_accuracy_size', changeByType('size'), 'ratio', 'change'],
      ['change_accuracy_position', changeByType('position'), 'ratio', 'change'],
      ['peripheral_hit_rate', periphOverall, 'ratio', 'peripheral'],
      ['peripheral_rt_median', periphRt, 'ms', 'peripheral'],
      ['peripheral_eccentricity_cost', eccCost, 'ratio/deg', 'peripheral'],
      ['peripheral_false_alarms', periphFa, 'count', 'peripheral'],
      ['central_time_on_target', centralOnTarget, 'ratio', 'peripheral'],
      ['head_scan_range', headRange, 'deg'],
      ['head_scan_entropy', headEntropy, 'ratio'],
    ];
    eccs.forEach((e, i) => M.push([`peripheral_hit_rate_${e}`, hitRates[i]!, 'ratio', 'peripheral']));
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    // Anchors are provisional. The conjunction-slope range comes from the
    // spread typically seen in serial search; the rest are best estimates
    // pending this platform's own normative sample.
    const efficiency = normaliseSoft(conj.slopeP, 12, 90);
    const accuracy = normaliseSoft(searchSdt.dPrime, 4.0, 0.8);
    const tracking = normaliseSoft(motK, 4.0, 1.2);
    const changeScore = normaliseSoft(changeAccuracy, 0.95, 0.35);
    const peripheralScore = normaliseSoft(periphOverall, 0.95, 0.4);
    const speed = normaliseSoft(conj.medianRt, 900, 4200);

    const ops = opsScore([
      { key: 'search_efficiency', value: efficiency, weight: 0.26 },
      { key: 'search_accuracy', value: accuracy, weight: 0.22 },
      { key: 'tracking_capacity', value: tracking, weight: 0.18 },
      { key: 'change_sensitivity', value: changeScore, weight: 0.14 },
      { key: 'peripheral_awareness', value: peripheralScore, weight: 0.12 },
      { key: 'search_speed', value: speed, weight: 0.08 },
    ]);

    rec.score('search_efficiency', efficiency, '1.0.0');
    rec.score('search_accuracy', accuracy, '1.0.0');
    rec.score('tracking_capacity', tracking, '1.0.0');
    rec.score('change_sensitivity', changeScore, '1.0.0');
    rec.score('peripheral_awareness', peripheralScore, '1.0.0');
    rec.score('search_speed', speed, '1.0.0');

    const fmt = (v: number, d = 0, s = '') => (Number.isFinite(v) ? `${v.toFixed(d)}${s}` : '—');
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

    return {
      opsScore: ops,
      headline: [
        { label: 'Keresési meredekség (konjunkció)', value: fmt(conj.slopeP, 0, ' ms/elem'), hint: `jellemző ${fmt(feat.slopeP, 0, ' ms/elem')}` },
        { label: 'Keresési pontosság (d′)', value: fmt(searchSdt.dPrime, 2), hint: `${searchSdt.criterion > 0.2 ? 'óvatos' : searchSdt.criterion < -0.2 ? 'kockázatvállaló' : 'kiegyensúlyozott'}` },
        { label: 'Követési kapacitás', value: fmt(motK, 1, ' objektum') },
        { label: 'Változásészlelés', value: pct(changeAccuracy), hint: `${fmt(changeCycles, 1)} ciklus` },
        { label: 'Perifériás detekció', value: pct(periphOverall), hint: fmt(periphRt, 0, ' ms') },
        { label: 'Téves riasztás', value: `${sFa + periphFa} / ${sCr + catches.length}` },
      ],
      summary: {
        feature: { slope: r(feat.slopeP, 2), slopeAbsent: r(feat.slopeA, 2), intercept: r(feat.intercept), medianRt: r(feat.medianRt) },
        conjunction: { slope: r(conj.slopeP, 2), slopeAbsent: r(conj.slopeA, 2), intercept: r(conj.intercept), medianRt: r(conj.medianRt) },
        slopeDifference: r(slopeDiff, 2),
        absentPresentRatio: r(absentRatio, 2),
        sdt: { dPrime: r(searchSdt.dPrime, 3), criterion: r(searchSdt.criterion, 3), hitRate: r(searchSdt.hitRate, 3), faRate: r(searchSdt.faRate, 3), corrected: searchSdt.corrected },
        mot: { accuracy: r(motAccuracy, 3), k: r(motK, 2) },
        change: { accuracy: r(changeAccuracy, 3), cycles: r(changeCycles, 1), rtMs: r(changeRt) },
        peripheral: { hitRate: r(periphOverall, 3), rtMs: r(periphRt), falseAlarms: periphFa, eccentricityCost: r(eccCost, 5), centralOnTarget: r(centralOnTarget, 3) },
        scan: { rangeDeg: r(headRange, 1), entropy: r(headEntropy, 3) },
        platform: ctx.platform,
        trialsScored: this.trials.length,
      },
      axisScores: {
        attention: (efficiency + accuracy + peripheralScore) / 3,
        working_memory: (tracking + changeScore) / 2,
        reaction: speed,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.machine?.abort();
    this.motResolve?.();
    this.blockResolve?.();
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.offPanel?.();
    this.machine?.abort();
    this.clearScene();
    this.picker.dispose();
    ctx.panels.remove(this.controlPanel);
    ctx.panels.remove(this.feedbackPanel);
    this.controlPanel.dispose();
    this.feedbackPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
