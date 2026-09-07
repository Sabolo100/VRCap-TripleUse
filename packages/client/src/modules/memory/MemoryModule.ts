import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, normaliseSoft, opsScore, clamp, sdt,
  type ModuleManifest, type TrialRecord, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { ObjectPicker } from '../shared/picking.js';
import { volumePosition, Tumbler } from '../shared/volume.js';

/**
 * MODULE 09 - MEMORY
 * Working memory, in a volume.
 *
 * Corsi block-tapping is a set of squares on a table. Putting that on a wall in
 * VR would change nothing. Here the blocks sit in an actual volume - three
 * depth layers, above and below eye level, curving around the participant - and
 * that changes three things:
 *
 *   DEPTH IS A CODING DIMENSION. Two blocks can lie in the same direction at
 *   different distances. `depth_confusion_rate` - right direction, wrong layer -
 *   shows whether distance was encoded at all, and has no flat-screen analogue.
 *
 *   RECALL IS BODY-CENTRED. The participant points into the space around
 *   themselves rather than at a board, so the trace is tied to an egocentric
 *   frame, which is the operationally relevant case.
 *
 *   THE VIEWPOINT CAN MOVE. Block 2 blacks out, rotates the whole array by 90
 *   or 180 degrees, and asks for the sequence in its NEW positions. The
 *   rotation is never visible, so there is nothing to track: a transformation
 *   has to be applied to a stored trace. That is spatial updating, and it is
 *   distinct from how much a person can hold.
 *
 * Block 2 is not mental rotation (module 02): there, two views of a VISIBLE
 * object are compared. Here a REMEMBERED layout is transformed.
 */

type BlockId = 'span' | 'rotate' | 'bind' | 'nback' | 'interfere';
type ShapeKind = 'box' | 'sphere' | 'cone' | 'cylinder' | 'torus' | 'capsule';

const IDLE = 0x2a3a4c;
const FLASH = 0xffd166;
const BIND_SHAPES: ShapeKind[] = ['box', 'sphere', 'cone', 'cylinder', 'torus', 'capsule'];
const BIND_COLORS = [0xff9e1b, 0x4fc3f7, 0x7cf59a, 0xff5c7a, 0xc6a0ff, 0xffd166];

interface Cell {
  index: number;
  layer: number;
  azDeg: number;
  elDeg: number;
  radius: number;
  /** Local position inside the array group, so the group can be rotated. */
  local: THREE.Vector3;
  mesh: THREE.Mesh;
}

export class MemoryModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.MEMORY!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'span',
      title: 'TÉRBELI SOROZAT',
      instruction:
        'A körülötted lévő kockák közül néhány sorban felvillan és megfordul. Jegyezd meg a sorrendet, ' +
        'majd mutass rájuk ugyanabban a sorrendben. A kockák három különböző távolságban vannak — ' +
        'a mélység is a helyük része. A sorozat egyre hosszabb lesz.',
      controlHint: '',
      trials: 14,
      practiceTrials: 2,
    },
    {
      id: 'rotate',
      title: 'ELFORDULT TÉR',
      instruction:
        'Ugyanaz, négy elemmel — de a sorozat után elsötétül a kép, és a kockatömb ELFORDULHAT. ' +
        'Nem fogod látni a fordulást. Amikor visszatér a kép, az ÚJ helyzetben kell megmutatnod ' +
        'ugyanazt a sorozatot. Néha nem fordul el semmi.',
      controlHint: '',
      trials: 10,
      practiceTrials: 2,
    },
    {
      id: 'bind',
      title: 'MI — HOL',
      instruction:
        'Hat különböző alakzat jelenik meg hat helyen. Jegyezd meg, melyik hol volt. ' +
        'Ezután eltűnnek, és egyet megmutatok közelről: mutass oda, ahol AZ AZ alakzat volt.',
      controlHint: '',
      trials: 12,
      practiceTrials: 2,
    },
    {
      id: 'nback',
      title: 'FOLYAMATOS',
      instruction:
        'Egy gömb ugrál a helyek között. NYOMD MEG A RAVASZT, valahányszor ugyanoda kerül, ahol KÉT lépéssel ' +
        'korábban volt. Nem az előzőre — a kettővel korábbira. Ez folyamatos frissítést kíván.',
      controlHint: '',
      trials: 40,
      practiceTrials: 3,
    },
    {
      id: 'interfere',
      title: 'ZAVARÁS UTÁN',
      instruction:
        'Négy elemű sorozat, majd nyolc másodperc várakozás. A várakozás alatt néha egy mozgó gömböt ' +
        'kell követned a mutatóval. Utána jön a felidézés — a sorozat közben is meg kell maradnia.',
      controlHint: '',
      trials: 8,
      practiceTrials: 1,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  /** All cells live here so the whole array can be rotated as one body. */
  private array = new THREE.Group();
  private cells: Cell[] = [];
  private picker!: ObjectPicker;
  private tumbler = new Tumbler();

  private bindMeshes: THREE.Mesh[] = [];
  private probeMesh: THREE.Mesh | null = null;
  private nbackMesh!: THREE.Mesh;
  private interferenceMesh!: THREE.Mesh;

  private promptPanel!: Panel;
  private promptTitle = '';
  private promptSub = '';

  private geo!: { az: number; elMin: number; elMax: number; layers: number[]; minSep: number; count: number };
  private currentBlock: BlockId = 'span';
  private practice = false;
  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;

  /** Recall state. */
  private recallOpen = false;
  private recallExpected = 0;
  private recallPicks: number[] = [];
  private recallStartT = 0;
  private recallResolve: (() => void) | null = null;

  /** Pointing (bind block) state. */
  private pointResolve: ((p: THREE.Vector3 | null) => void) | null = null;

  /** n-back state. */
  private nbackResponded = false;
  private nbackOnsetT = 0;
  private nbackAcceptOpen = false;
  private nbackResult: { type: string; isTarget: boolean; responded: boolean; rtMs: number | null }[] = [];

  /** Accumulators. */
  private spanResults: { length: number; correct: boolean; firstError: number | null; depthConfusion: boolean; rtMs: number }[] = [];
  private rotateResults: { rotationDeg: number; correct: boolean; rtMs: number; firstPickMs: number }[] = [];
  private bindResults: { angErr: number; depthErr: number; swap: boolean; nearestCorrect: boolean }[] = [];
  private interfereResults: { withInterference: boolean; correct: boolean; timeOnTarget: number }[] = [];

  private trackOnTargetMs = 0;
  private trackTotalMs = 0;
  private trackingActive = false;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);
    this.root.add(this.array);

    this.geo = ctx.platform === 'vr'
      ? { az: 48, elMin: -14, elMax: 22, layers: [2.4, 3.4, 4.6], minSep: 11, count: 12 }
      : ctx.platform === 'desktop'
        ? { az: 24, elMin: -10, elMax: 14, layers: [2.6, 3.2, 3.9], minSep: 8, count: 12 }
        : { az: 19, elMin: -9, elMax: 12, layers: [2.6, 3.1, 3.7], minSep: 9, count: 9 };

    // Created before buildCells(), which registers the cells as hover targets
    // on it. Its panel list is filled in below, once the prompt panel exists.
    this.picker = new ObjectPicker(ctx, []);
    this.buildCells();

    this.nbackMesh = makePrimitive({ kind: 'sphere', color: ctx.theme.accent, unlit: true, size: 0.24 });
    this.nbackMesh.visible = false;
    this.array.add(this.nbackMesh);

    this.interferenceMesh = makePrimitive({ kind: 'sphere', color: ctx.theme.accent, unlit: true, size: 0.20 });
    this.interferenceMesh.visible = false;
    this.root.add(this.interferenceMesh);

    const flat = ctx.platform !== 'vr';
    this.promptPanel = new Panel({
      width: 0.8, height: 0.2, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'memory-prompt',
    });
    this.promptPanel.group.position.set(0, 1.05, flat ? -1.7 : -2.0);
    this.promptPanel.setDraw((ui) => this.drawPrompt(ui));
    this.promptPanel.group.visible = false;
    this.root.add(this.promptPanel.group);
    ctx.panels.add(this.promptPanel);

    this.picker.setPanels([this.promptPanel]);

    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));

    ctx.recorder.event('volume_built', {
      positions: this.geo.count, layers: this.geo.layers, azSpan: this.geo.az * 2,
      minSep: this.geo.minSep, platform: ctx.platform,
    });
  }

  /**
   * Touch controls.
   *
   * Most blocks answer by pointing at a cell, which a tap already does. The
   * n-back block is the exception: there the answer is "this one matches",
   * which is not a place on screen - and a tap would be ambiguous with
   * selecting a cell.
   */
  private setupTouchControls(): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    if (this.currentBlock === 'nback') {
      mc.set({
        hint: 'Nyomd meg a gombot, valahányszor a gömb ugyanoda kerül, ahol két lépéssel korábban volt.',
        buttons: [{
          id: 'match', label: 'UGYANOTT', variant: 'primary', wide: true, action: 'PRIMARY',
        }],
      });
      return;
    }
    mc.set({
      hint: this.currentBlock === 'bind'
        ? 'Koppints arra a helyre, ahol a megmutatott alakzat volt.'
        : 'Koppints a kockákra abban a sorrendben, ahogy felvillantak.',
    });
  }

  private controlHint(block: BlockId): string {
    const p = this.ctx.platform;
    const press = p === 'vr' ? 'a ravasszal' : p === 'mobile' ? 'koppintással' : 'kattintással';
    switch (block) {
      case 'nback':
        return p === 'vr'
          ? 'Húzd meg a ravaszt, ha a gömb ugyanott van, mint két lépéssel korábban.'
          : p === 'mobile'
            ? 'Koppints, ha a gömb ugyanott van, mint két lépéssel korábban.'
            : 'Nyomj SZÓKÖZT, ha a gömb ugyanott van, mint két lépéssel korábban.';
      case 'bind':
        return `Mutass ${press} arra a helyre, ahol a megmutatott alakzat volt.`;
      default:
        return `Mutass ${press} a kockákra abban a sorrendben, ahogy felvillantak.`;
    }
  }

  /* ------------------------------------------------------------ volume */

  private buildCells(): void {
    const rng = this.ctx.rng;
    const perLayer = Math.round(this.geo.count / this.geo.layers.length);
    let index = 0;

    for (let l = 0; l < this.geo.layers.length; l++) {
      const radius = this.geo.layers[l]!;
      const sector = (this.geo.az * 2) / perLayer;
      for (let i = 0; i < perLayer; i++) {
        // Stratified azimuth per layer, with the layers offset from each other
        // so cells do not line up in depth and become ambiguous to point at.
        const azDeg = -this.geo.az + (i + 0.5) * sector + (l - 1) * sector * 0.33 + rng.range(-0.18, 0.18) * sector;
        const elDeg = rng.range(this.geo.elMin, this.geo.elMax);
        const local = volumePosition(azDeg, elDeg, radius, 1.6);

        // Angular size is held constant across layers: the far row must not be
        // simply "smaller", or depth would collapse into a size cue.
        const depthScale = radius / this.geo.layers[0]!;
        const mesh = makePrimitive({ kind: 'box', color: IDLE, unlit: true, size: 0.26 * depthScale });
        mesh.position.copy(local);
        mesh.userData.stimulusIndex = index;
        this.array.add(mesh);
        this.tumbler.add(mesh, rng, 0.15, 0.4);

        this.cells.push({ index, layer: l, azDeg, elDeg, radius, local, mesh });
        index++;
      }
    }
    this.relaxCells();
    // The cells are what the participant points at all through the module.
    this.picker.setHoverTargets(this.cells.map((c) => c.mesh));
  }

  private relaxCells(): void {
    // Guarantee the minimum angular separation across layers too, so pointing
    // is never ambiguous between a near and a far cell in the same direction.
    for (let it = 0; it < 12; it++) {
      let moved = false;
      for (let i = 0; i < this.cells.length; i++) {
        for (let j = i + 1; j < this.cells.length; j++) {
          const a = this.cells[i]!;
          const b = this.cells[j]!;
          const dAz = a.azDeg - b.azDeg;
          const dEl = a.elDeg - b.elDeg;
          const sep = Math.hypot(dAz, dEl);
          if (sep >= this.geo.minSep) continue;
          moved = true;
          const push = ((this.geo.minSep - sep) / 2) * 1.05;
          const len = sep || 0.001;
          a.azDeg += (dAz / len) * push;
          a.elDeg += (dEl / len) * push;
          b.azDeg -= (dAz / len) * push;
          b.elDeg -= (dEl / len) * push;
        }
      }
      for (const c of this.cells) {
        c.azDeg = clamp(c.azDeg, -this.geo.az, this.geo.az);
        c.elDeg = clamp(c.elDeg, this.geo.elMin, this.geo.elMax);
        c.local.copy(volumePosition(c.azDeg, c.elDeg, c.radius, 1.6));
        c.mesh.position.copy(c.local);
      }
      if (!moved) break;
    }
  }

  private setCellsVisible(v: boolean): void {
    for (const c of this.cells) c.mesh.visible = v;
  }

  private colorCell(c: Cell, hex: number): void {
    (c.mesh.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  /* ------------------------------------------------------- block driver */

  async calibrate(ctx: ModuleContext): Promise<void> {
    // Familiarisation with the volume. Without it the first sequences would be
    // spent discovering where the cells are and how pointing works, and the
    // span estimate would start low for the wrong reason.
    this.setCellsVisible(true);
    this.promptTitle = 'ISMERKEDÉS A TÉRREL';
    this.promptSub = 'Minden kocka egyszer felvillan. Nézd meg, hol vannak — három különböző távolságban.';
    this.promptPanel.group.visible = true;
    this.promptPanel.invalidate();
    for (const c of this.cells) {
      if (this.aborted) return;
      this.colorCell(c, FLASH);
      c.mesh.rotateY(Math.PI / 2);
      ctx.audio.tone({ freq: 1046, durationMs: 50, gain: 0.14 });
      await this.wait(210);
      this.colorCell(c, IDLE);
      await this.wait(60);
    }
    this.promptPanel.group.visible = false;
  }

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    this.setupTouchControls();
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    this.array.rotation.y = 0;
    this.setCellsVisible(true);

    switch (this.currentBlock) {
      case 'span': await this.runSpan(practice); break;
      case 'rotate': await this.runRotate(count); break;
      case 'bind': await this.runBind(count); break;
      case 'nback': await this.runNback(count); break;
      case 'interfere': await this.runInterfere(count); break;
    }

    this.setCellsVisible(false);
    this.promptPanel.group.visible = false;
  }

  /* ------------------------------------------------------- 1: 3D Corsi */

  private async runSpan(practice: boolean): Promise<void> {
    let length = 3;
    let atLength = 0;
    let correctAtLength = 0;
    const maxLength = 9;
    const maxTrials = practice ? 2 : 24;
    let trialNo = 0;

    while (trialNo < maxTrials && length <= maxLength && !this.aborted) {
      trialNo++;
      this.ctx.recorder.trialNumber = trialNo;
      const seq = this.makeSequence(length);
      await this.showSequence(seq, 'span');
      const res = await this.collectRecall(seq, 'span', 0);
      if (this.aborted) return;

      if (!practice) {
        this.spanResults.push({
          length, correct: res.correct, firstError: res.firstError,
          depthConfusion: res.depthConfusion, rtMs: res.rtMs,
        });
      }
      atLength++;
      if (res.correct) correctAtLength++;

      if (this.practice) {
        this.showPrompt(res.correct ? 'HELYES' : 'NEM EGÉSZEN', res.correct ? '' : 'Nézd meg újra a sorrendet.');
        await this.wait(1200);
      }

      if (atLength >= 2) {
        // Two trials per length: advance on two hits, stop on two misses,
        // otherwise stay and take two more.
        if (correctAtLength === 2) { length++; atLength = 0; correctAtLength = 0; }
        else if (correctAtLength === 0) break;
        else { atLength = 0; correctAtLength = 0; }
      }
      await this.wait(500);
    }
  }

  private makeSequence(length: number): number[] {
    const rng = this.ctx.rng;
    const seq: number[] = [];
    let last = -1;
    for (let i = 0; i < length; i++) {
      let n = rng.int(0, this.cells.length - 1);
      let guard = 0;
      // Never repeat immediately: a repeat is a different (easier) task.
      while (n === last && guard++ < 20) n = rng.int(0, this.cells.length - 1);
      seq.push(n);
      last = n;
    }
    return seq;
  }

  private async showSequence(seq: number[], block: BlockId): Promise<void> {
    const ctx = this.ctx;
    this.promptTitle = 'FIGYELD A SORRENDET';
    this.promptSub = '';
    this.promptPanel.group.visible = true;
    this.promptPanel.invalidate();
    ctx.recorder.event('sequence_shown', { block, length: seq.length, sequence: seq, flashMs: 700, gapMs: 350 });
    await this.wait(700);

    for (let i = 0; i < seq.length; i++) {
      if (this.aborted) return;
      const c = this.cells[seq[i]!]!;
      this.colorCell(c, FLASH);
      // A quarter turn with the flash: the cue is a solid body moving, not a
      // rectangle changing colour, and it disambiguates the depth layers.
      const startRot = c.mesh.rotation.y;
      const t0 = ctx.engine.clock.frameTime;
      const spin = () => {
        const k = clamp((ctx.engine.clock.frameTime - t0) / 250, 0, 1);
        c.mesh.rotation.y = startRot + (Math.PI / 2) * k;
        if (k < 1 && !this.aborted) requestAnimationFrame(spin);
      };
      spin();
      ctx.audio.tone({ freq: 1046, durationMs: 60, gain: 0.18 });
      ctx.recorder.event('sequence_item', { index: i, position: c.index, layer: c.layer, ordinal: i });
      await this.wait(700);
      this.colorCell(c, IDLE);
      await this.wait(350);
    }
    ctx.audio.tone({ freq: 660, durationMs: 120, gain: 0.2 });
    this.promptPanel.group.visible = false;
  }

  private collectRecall(
    seq: number[],
    block: BlockId,
    rotationDeg: number
  ): Promise<{ correct: boolean; firstError: number | null; depthConfusion: boolean; rtMs: number; firstPickMs: number }> {
    return new Promise((resolve) => {
      this.recallOpen = true;
      this.recallExpected = seq.length;
      this.recallPicks = [];
      this.recallStartT = this.ctx.engine.clock.frameTime;
      let firstPickMs = NaN;
      this.promptTitle = 'MOST TE';
      this.promptSub = `${seq.length} kocka, ugyanabban a sorrendben`;
      this.promptPanel.group.visible = true;
      this.promptPanel.invalidate();
      this.ctx.recorder.event('recall_started', { block, expectedLength: seq.length });

      this.recallResolve = () => {
        this.recallOpen = false;
        this.promptPanel.group.visible = false;
        const picks = this.recallPicks;
        let firstError: number | null = null;
        for (let i = 0; i < seq.length; i++) {
          if (picks[i] !== seq[i]) { firstError = i; break; }
        }
        const correct = firstError === null;
        // Depth confusion: right direction, wrong layer. Only meaningful when
        // the layers are perceptually distinct, i.e. in VR.
        let depthConfusion = false;
        if (firstError !== null && this.ctx.platform === 'vr') {
          const expected = this.cells[seq[firstError]!];
          const got = picks[firstError] !== undefined ? this.cells[picks[firstError]!] : undefined;
          if (expected && got && got.layer !== expected.layer) {
            const angSep = Math.hypot(got.azDeg - expected.azDeg, got.elDeg - expected.elDeg);
            depthConfusion = angSep < this.geo.minSep * 1.6;
          }
        }
        const rtMs = this.ctx.engine.clock.frameTime - this.recallStartT;
        this.ctx.recorder.event('recall_complete', {
          correct, firstErrorPosition: firstError, rtMs: +rtMs.toFixed(1), depthConfusion,
        });
        this.pushSeqTrial(block, seq, picks, correct, firstError, rotationDeg, rtMs);
        resolve({ correct, firstError, depthConfusion, rtMs, firstPickMs });
      };

      this.onFirstPick = (ms: number) => { if (Number.isNaN(firstPickMs)) firstPickMs = ms; };
    });
  }

  private onFirstPick: ((ms: number) => void) | null = null;

  private pushSeqTrial(
    block: BlockId, seq: number[], picks: number[], correct: boolean,
    firstError: number | null, rotationDeg: number, rtMs: number
  ): void {
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block,
      stimulus: {
        kind: 'memory', block, seqLength: seq.length, sequence: seq,
        rotationDeg, platform: this.ctx.platform, practice: this.practice,
      },
      response: { picks, correct, firstErrorPosition: firstError, rtMs: +rtMs.toFixed(1) },
      correct,
      outcome: correct ? 'hit' : 'miss',
      reactionTimeMs: +rtMs.toFixed(1),
      startedAt: +this.recallStartT.toFixed(1),
      endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
    };
    this.ctx.recorder.trial(rec);
    if (!this.practice) this.trials.push(rec);
  }

  /* -------------------------------------------- 2: spatial updating */

  private async runRotate(count: number): Promise<void> {
    const rng = this.ctx.rng;
    // 30% control trials with no rotation. Without them the updating cost
    // could not be separated from the general disruption of the blackout.
    const angles: number[] = [];
    const nControl = Math.round(count * 0.3);
    const n180 = Math.round(count * 0.28);
    for (let i = 0; i < count; i++) {
      angles.push(i < nControl ? 0 : i < nControl + n180 ? 180 : 90);
    }
    const shuffled = rng.shuffle(angles);

    for (let i = 0; i < count && !this.aborted; i++) {
      this.ctx.recorder.trialNumber = i + 1;
      const rotation = shuffled[i]! * (rng.bool() ? 1 : -1);
      const seq = this.makeSequence(4);
      await this.showSequence(seq, 'rotate');
      if (this.aborted) return;

      // Blackout, rotate, restore. The rotation is never visible, so there is
      // nothing to follow - the transformation has to be applied to memory.
      this.ctx.recorder.event('blackout', { durationMs: 600 });
      this.setCellsVisible(false);
      await this.wait(600);
      this.array.rotation.y = (rotation * Math.PI) / 180;
      this.ctx.recorder.event('array_rotated', { degrees: Math.abs(rotation), direction: rotation >= 0 ? 'cw' : 'ccw' });
      await this.wait(400);
      this.setCellsVisible(true);
      await this.wait(300);

      const res = await this.collectRecall(seq, 'rotate', rotation);
      if (this.aborted) return;
      if (!this.practice) {
        this.rotateResults.push({
          rotationDeg: Math.abs(rotation), correct: res.correct, rtMs: res.rtMs, firstPickMs: res.firstPickMs,
        });
      }
      if (this.practice) {
        this.showPrompt(res.correct ? 'HELYES' : 'NEM EGÉSZEN',
          rotation === 0 ? 'Ez most nem fordult el.' : `A tömb ${Math.abs(rotation)}°-ot fordult.`);
        await this.wait(1500);
      }
      this.array.rotation.y = 0;
      await this.wait(400);
    }
  }

  /* ------------------------------------------- 3: object-location binding */

  private async runBind(count: number): Promise<void> {
    const rng = this.ctx.rng;

    for (let trial = 0; trial < count && !this.aborted; trial++) {
      this.ctx.recorder.trialNumber = trial + 1;
      this.setCellsVisible(false);
      const chosen = rng.shuffle(this.cells.map((c) => c.index)).slice(0, 6);
      const shapes = rng.shuffle([...BIND_SHAPES]);
      this.bindMeshes = [];

      for (let i = 0; i < 6; i++) {
        const cell = this.cells[chosen[i]!]!;
        const depthScale = cell.radius / this.geo.layers[0]!;
        const m = makePrimitive({
          kind: shapes[i]!, color: BIND_COLORS[i]!, unlit: true, size: 0.28 * depthScale,
        });
        m.position.copy(cell.local);
        m.userData.bindSlot = i;
        this.array.add(m);
        this.tumbler.add(m, rng, 0.2, 0.5);
        this.bindMeshes.push(m);
      }

      this.ctx.recorder.event('bind_array_shown', {
        shapes: shapes.slice(0, 6), positions: chosen, viewMs: 4500,
      });
      this.promptTitle = 'JEGYEZD MEG';
      this.promptSub = 'Melyik alakzat hol van?';
      this.promptPanel.group.visible = true;
      this.promptPanel.invalidate();
      await this.wait(4500);
      if (this.aborted) return;

      for (const m of this.bindMeshes) { m.visible = false; this.tumbler.remove(m); }

      const probeIdx = rng.int(0, 5);
      const trueCell = this.cells[chosen[probeIdx]!]!;
      const probe = makePrimitive({
        kind: shapes[probeIdx]!, color: BIND_COLORS[probeIdx]!, unlit: true, size: 0.18,
      });
      probe.position.set(0, 1.42, -1.2);
      this.root.add(probe);
      this.tumbler.add(probe, rng, 0.4, 0.7);
      this.probeMesh = probe;

      this.promptTitle = 'HOL VOLT EZ?';
      this.promptSub = 'Mutass a helyére.';
      this.promptPanel.invalidate();
      this.ctx.recorder.event('bind_probe', { shape: shapes[probeIdx]!, truePosition: trueCell.index });

      const pointed = await new Promise<THREE.Vector3 | null>((resolve) => { this.pointResolve = resolve; });
      this.pointResolve = null;
      if (this.aborted) return;

      disposeTree(probe);
      this.tumbler.remove(probe);
      this.probeMesh = null;
      this.promptPanel.group.visible = false;

      if (pointed) {
        const truePos = trueCell.local.clone().applyMatrix4(this.array.matrixWorld);
        const eye = new THREE.Vector3();
        this.ctx.engine.camera.getWorldPosition(eye);
        const toTrue = truePos.clone().sub(eye).normalize();
        const toPick = pointed.clone().sub(eye).normalize();
        const angErr = THREE.MathUtils.radToDeg(toTrue.angleTo(toPick));
        const depthErr = Math.abs(pointed.distanceTo(eye) - truePos.distanceTo(eye));

        // Swap error: the answer is closer to a DIFFERENT presented object's
        // location than to the correct one. That is a binding failure, not a
        // location-memory failure, and the two need separating.
        let nearest = -1;
        let nearestDist = Infinity;
        for (let i = 0; i < 6; i++) {
          const p = this.cells[chosen[i]!]!.local.clone().applyMatrix4(this.array.matrixWorld);
          const d = THREE.MathUtils.radToDeg(p.clone().sub(eye).normalize().angleTo(toPick));
          if (d < nearestDist) { nearestDist = d; nearest = i; }
        }
        const swap = nearest !== probeIdx;

        this.ctx.recorder.event('bind_response', {
          angErrorDeg: +angErr.toFixed(1), depthErrorM: +depthErr.toFixed(2),
          nearestShape: shapes[nearest] ?? null, swapError: swap,
        });

        if (!this.practice) {
          this.bindResults.push({ angErr, depthErr, swap, nearestCorrect: !swap });
          this.trials.push({
            trialNumber: trial + 1,
            block: 'bind',
            stimulus: {
              kind: 'memory', block: 'bind', probeShape: shapes[probeIdx]!,
              probeTruePos: trueCell.index, positions: chosen, platform: this.ctx.platform, practice: false,
            },
            response: {
              responseAngErrorDeg: +angErr.toFixed(1), responseDepthErrorM: +depthErr.toFixed(2), swapError: swap,
            },
            correct: !swap,
            outcome: !swap ? 'hit' : 'miss',
            reactionTimeMs: null,
            startedAt: 0, endedAt: 0,
          });
        }
        if (this.practice) {
          this.showPrompt(swap ? 'MÁSIK ALAKZAT HELYE' : `${Math.round(angErr)}° hiba`, '');
          await this.wait(1400);
        }
      }

      for (const m of this.bindMeshes) disposeTree(m);
      this.bindMeshes = [];
      await this.wait(400);
    }
    this.setCellsVisible(true);
  }

  /* ------------------------------------------------ 4: spatial n-back */

  private async runNback(steps: number): Promise<void> {
    const rng = this.ctx.rng;
    const positions = this.buildNbackSequence(steps, rng);
    this.setCellsVisible(true);
    for (const c of this.cells) this.colorCell(c, IDLE);
    this.nbackMesh.visible = true;
    this.nbackResult = [];

    for (let step = 0; step < positions.length && !this.aborted; step++) {
      this.ctx.recorder.trialNumber = step + 1;
      const p = positions[step]!;
      const cell = this.cells[p.pos]!;
      this.nbackMesh.position.copy(cell.local);
      this.nbackMesh.scale.setScalar(0.24 * (cell.radius / this.geo.layers[0]!));
      this.nbackOnsetT = this.ctx.engine.clock.frameTime;
      this.nbackResponded = false;
      this.nbackAcceptOpen = true;
      this.ctx.audio.tone({ freq: 880, durationMs: 40, gain: 0.1 });
      this.ctx.recorder.event('nback_step', { step, position: p.pos, type: p.type, isTarget: p.isTarget });

      await this.wait(2200);
      this.nbackAcceptOpen = false;

      const responded = this.nbackResponded;
      const rt = responded ? this.nbackRt : null;
      this.nbackResult.push({ type: p.type, isTarget: p.isTarget, responded, rtMs: rt });

      if (!this.practice) {
        this.trials.push({
          trialNumber: step + 1,
          block: 'nback',
          stimulus: {
            kind: 'memory', block: 'nback', position: p.pos, nbackType: p.type,
            isTarget: p.isTarget, platform: this.ctx.platform, practice: false,
          },
          response: responded ? { rtMs: rt, responded: true } : null,
          correct: responded === p.isTarget,
          outcome: p.isTarget ? (responded ? 'hit' : 'miss') : (responded ? 'false_alarm' : 'correct_reject'),
          reactionTimeMs: rt,
          startedAt: +this.nbackOnsetT.toFixed(1),
          endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
        });
      }
    }
    this.nbackMesh.visible = false;
  }

  private nbackRt: number | null = null;

  /**
   * Build the n-back stream with a controlled number of targets and lures.
   * The 1-back and 3-back lures are the informative part: a false alarm on a
   * lure means the position was remembered but its ORDER was not, which is a
   * failure of updating rather than of recognition.
   */
  private buildNbackSequence(steps: number, rng: Rng): { pos: number; type: string; isTarget: boolean }[] {
    const n = 2;
    const nTargets = Math.round(steps * 0.3);
    // Five of each. Three apiece (the first sketch) gives six lure trials in
    // total, which cannot support a false-alarm rate estimate; this keeps the
    // target count and block length unchanged and only rebalances the fillers.
    const nLure1 = 5;
    const nLure3 = 5;
    const out: { pos: number; type: string; isTarget: boolean }[] = [];

    const roles: string[] = [];
    for (let i = 0; i < steps; i++) roles.push('filler');
    const slots = rng.shuffle(
      Array.from({ length: steps }, (_, i) => i).filter((i) => i >= n + 1)
    );
    let si = 0;
    for (let i = 0; i < nTargets && si < slots.length; i++) roles[slots[si++]!] = 'target';
    for (let i = 0; i < nLure1 && si < slots.length; i++) roles[slots[si++]!] = 'lure1';
    for (let i = 0; i < nLure3 && si < slots.length; i++) roles[slots[si++]!] = 'lure3';

    for (let i = 0; i < steps; i++) {
      const role = roles[i]!;
      let pos: number;
      if (role === 'target' && i >= n) pos = out[i - n]!.pos;
      else if (role === 'lure1' && i >= 1) pos = out[i - 1]!.pos;
      else if (role === 'lure3' && i >= 3) pos = out[i - 3]!.pos;
      else {
        // A filler must not accidentally match n back, or the target count
        // stops being what the design says it is.
        let guard = 0;
        do { pos = rng.int(0, this.cells.length - 1); }
        while (guard++ < 40 && ((i >= n && pos === out[i - n]!.pos) || (i >= 1 && pos === out[i - 1]!.pos)));
      }
      out.push({ pos, type: role, isTarget: role === 'target' });
    }
    return out;
  }

  /* --------------------------------------------- 5: recall after delay */

  private async runInterfere(count: number): Promise<void> {
    const rng = this.ctx.rng;
    const withInterference = rng.shuffle(
      Array.from({ length: count }, (_, i) => i < Math.floor(count / 2))
    );

    for (let trial = 0; trial < count && !this.aborted; trial++) {
      this.ctx.recorder.trialNumber = trial + 1;
      const interfere = withInterference[trial]!;
      const seq = this.makeSequence(4);
      await this.showSequence(seq, 'interfere');
      if (this.aborted) return;

      this.setCellsVisible(false);
      this.trackOnTargetMs = 0;
      this.trackTotalMs = 0;

      if (interfere) {
        // Spatial-motor interference, deliberately: it competes for the same
        // resource as the stored spatial trace, which a verbal filler would not.
        this.promptTitle = 'KÖVESD A GÖMBÖT';
        this.promptSub = 'A sorozat maradjon meg közben.';
        this.promptPanel.group.visible = true;
        this.promptPanel.invalidate();
        this.interferenceMesh.visible = true;
        this.trackingActive = true;
        this.interferencePhase = rng.range(0, Math.PI * 2);
        this.ctx.recorder.event('interference_start', { durationMs: 8000 });
        await this.wait(8000);
        this.trackingActive = false;
        this.interferenceMesh.visible = false;
        this.ctx.recorder.event('interference_end', {
          durationMs: 8000,
          timeOnTarget: this.trackTotalMs > 0 ? +(this.trackOnTargetMs / this.trackTotalMs).toFixed(3) : null,
        });
      } else {
        this.promptTitle = 'VÁRJ';
        this.promptSub = 'Tartsd meg a sorozatot.';
        this.promptPanel.group.visible = true;
        this.promptPanel.invalidate();
        await this.wait(8000);
      }
      if (this.aborted) return;

      this.setCellsVisible(true);
      await this.wait(300);
      const res = await this.collectRecall(seq, 'interfere', 0);
      if (this.aborted) return;

      if (!this.practice) {
        this.interfereResults.push({
          withInterference: interfere, correct: res.correct,
          timeOnTarget: this.trackTotalMs > 0 ? this.trackOnTargetMs / this.trackTotalMs : NaN,
        });
      }
      if (this.practice) {
        this.showPrompt(res.correct ? 'HELYES' : 'NEM EGÉSZEN', '');
        await this.wait(1200);
      }
      await this.wait(400);
    }
  }

  private interferencePhase = 0;

  /* ------------------------------------------------------------ input */

  private onAction(e: ActionEvent): void {
    if (!e.down || e.action !== 'PRIMARY') return;
    const ray = e.ray ?? this.ctx.engine.input.primaryRay();

    if (this.currentBlock === 'nback') {
      if (!this.nbackAcceptOpen || this.nbackResponded) return;
      this.nbackResponded = true;
      this.nbackRt = e.t - this.nbackOnsetT;
      this.ctx.audio.click();
      this.ctx.recorder.event('nback_response', { rtMs: +this.nbackRt.toFixed(1) }, e.t);
      return;
    }

    if (this.pointResolve) {
      if (!ray) return;
      // Point into the volume: intersect the ray with the sphere at the array's
      // mid depth so a free-space answer still has a position and a distance.
      const hit = this.picker.pick(ray, this.cells.map((c) => c.mesh));
      let point: THREE.Vector3;
      if (hit) {
        point = hit.object.getWorldPosition(new THREE.Vector3());
      } else {
        const eye = new THREE.Vector3();
        this.ctx.engine.camera.getWorldPosition(eye);
        point = eye.clone().addScaledVector(ray.direction, this.geo.layers[1]!);
      }
      this.ctx.audio.ok();
      const resolve = this.pointResolve;
      this.pointResolve = null;
      resolve(point);
      return;
    }

    if (this.recallOpen && ray) {
      const hit = this.picker.pick(ray, this.cells.map((c) => c.mesh));
      if (!hit) return;
      const index = hit.object.userData.stimulusIndex as number;
      const cell = this.cells[index];
      if (!cell) return;
      const ordinal = this.recallPicks.length;
      this.recallPicks.push(index);
      this.onFirstPick?.(e.t - this.recallStartT);
      this.colorCell(cell, FLASH);
      this.ctx.audio.click();
      this.ctx.engine.input.pulse('both', 0.22, 18);
      setTimeout(() => this.colorCell(cell, IDLE), 220);
      this.ctx.recorder.event('recall_pick', {
        ordinal, position: index, elapsedMs: +(e.t - this.recallStartT).toFixed(1),
      }, e.t);
      if (this.recallPicks.length >= this.recallExpected) {
        const r0 = this.recallResolve;
        this.recallResolve = null;
        setTimeout(() => r0?.(), 240);
      }
    }
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.tumbler.update(dt);

    if (this.trackingActive) {
      // Lissajous path through the volume, so the interference task is itself
      // spatial rather than a flat cursor chase.
      this.interferencePhase += dt * 0.6;
      const az = Math.sin(this.interferencePhase) * this.geo.az * 0.7;
      const el = Math.sin(this.interferencePhase * 1.53) * (this.geo.elMax - this.geo.elMin) * 0.4;
      const r = this.geo.layers[1]! + Math.sin(this.interferencePhase * 0.81) * 0.5;
      this.interferenceMesh.position.copy(volumePosition(az, el, r, 1.6));

      const ray = ctx.engine.input.primaryRay();
      if (ray) {
        const err = this.picker.angularErrorTo(ray, this.interferenceMesh.position);
        const on = err <= 4.0;
        this.trackTotalMs += dt * 1000;
        if (on) this.trackOnTargetMs += dt * 1000;
        (this.interferenceMesh.material as THREE.MeshBasicMaterial).color.set(on ? ctx.theme.ok : ctx.theme.accent);
      }
    }
  }

  /* --------------------------------------------------------------- UI */

  private showPrompt(title: string, sub: string): void {
    this.promptTitle = title;
    this.promptSub = sub;
    this.promptPanel.group.visible = true;
    this.promptPanel.invalidate();
  }

  private drawPrompt(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.5));
    const good = /HELYES|ms|hiba/.test(this.promptTitle);
    ui.text(this.promptTitle, ui.w / 2, this.promptSub ? ui.h / 2 - 20 : ui.h / 2, {
      size: 34, color: this.promptTitle.includes('NEM') || this.promptTitle.includes('MÁSIK') ? t.bad : good ? t.ok : t.text,
      align: 'center', weight: '700', font: t.fontDisplay,
    });
    if (this.promptSub) {
      ui.text(this.promptSub, ui.w / 2, ui.h / 2 + 24, {
        size: 20, color: t.textMuted, align: 'center',
      });
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    /* --- span --------------------------------------------------------- */
    const correctSpans = this.spanResults.filter((s) => s.correct);
    const span = correctSpans.length ? Math.max(...correctSpans.map((s) => s.length)) : NaN;
    const totalCorrect = correctSpans.length;
    const products = Number.isFinite(span) ? span * totalCorrect : NaN;
    const firstErrors = this.spanResults.filter((s) => s.firstError !== null).map((s) => s.firstError!);
    const serialFirstError = firstErrors.length ? mean(firstErrors) : NaN;
    const errorTrials = this.spanResults.filter((s) => !s.correct);
    const depthConfusion = isVr && errorTrials.length
      ? errorTrials.filter((s) => s.depthConfusion).length / errorTrials.length
      : NaN;

    /* --- spatial updating --------------------------------------------- */
    const control = this.rotateResults.filter((r0) => r0.rotationDeg === 0);
    const rotated = this.rotateResults.filter((r0) => r0.rotationDeg > 0);
    const rot180 = this.rotateResults.filter((r0) => r0.rotationDeg === 180);
    const accOf = (list: typeof this.rotateResults) => (list.length ? list.filter((x) => x.correct).length / list.length : NaN);
    const controlAcc = accOf(control);
    const rotatedAcc = accOf(rotated);
    const updatingCost = Number.isFinite(controlAcc) && Number.isFinite(rotatedAcc) ? controlAcc - rotatedAcc : NaN;
    const cost180 = Number.isFinite(controlAcc) && rot180.length ? controlAcc - accOf(rot180) : NaN;
    const rotationRt = median(rotated.map((r0) => r0.firstPickMs).filter(Number.isFinite));

    /* --- binding ------------------------------------------------------- */
    const bindAccuracy = this.bindResults.length
      ? this.bindResults.filter((b) => b.nearestCorrect).length / this.bindResults.length : NaN;
    const bindAng = median(this.bindResults.map((b) => b.angErr));
    const bindDepth = isVr ? median(this.bindResults.map((b) => b.depthErr)) : NaN;
    const swapRate = this.bindResults.length
      ? this.bindResults.filter((b) => b.swap).length / this.bindResults.length : NaN;

    /* --- n-back --------------------------------------------------------- */
    const nb = this.nbackResult;
    const targets = nb.filter((x) => x.isTarget);
    const nonTargets = nb.filter((x) => !x.isTarget);
    const lures = nonTargets.filter((x) => x.type === 'lure1' || x.type === 'lure3');
    const plainFillers = nonTargets.filter((x) => x.type === 'filler');
    const nbHits = targets.filter((x) => x.responded).length;
    const nbFa = nonTargets.filter((x) => x.responded).length;
    const nbSdt = sdt(nbHits, targets.length - nbHits, nbFa, nonTargets.length - nbFa);
    const lureFa = lures.length ? lures.filter((x) => x.responded).length / lures.length : NaN;
    const fillerFa = plainFillers.length ? plainFillers.filter((x) => x.responded).length / plainFillers.length : NaN;
    const lureCost = Number.isFinite(lureFa) && Number.isFinite(fillerFa) ? lureFa - fillerFa : NaN;
    const nbRt = median(targets.filter((x) => x.responded && x.rtMs !== null).map((x) => x.rtMs!));

    /* --- interference ---------------------------------------------------- */
    const withI = this.interfereResults.filter((x) => x.withInterference);
    const withoutI = this.interfereResults.filter((x) => !x.withInterference);
    const recallAfterDelay = withoutI.length ? withoutI.filter((x) => x.correct).length / withoutI.length : NaN;
    const recallAfterInterference = withI.length ? withI.filter((x) => x.correct).length / withI.length : NaN;
    const interferenceCost = Number.isFinite(recallAfterDelay) && Number.isFinite(recallAfterInterference)
      ? recallAfterDelay - recallAfterInterference : NaN;
    const trackingQuality = mean(withI.map((x) => x.timeOnTarget).filter(Number.isFinite));

    const M: [string, number, string, string?][] = [
      ['corsi_span', span, 'items', 'span'],
      ['corsi_total_correct', totalCorrect, 'count', 'span'],
      ['corsi_products', products, 'index', 'span'],
      ['serial_position_first_error', serialFirstError, 'position', 'span'],
      ['depth_confusion_rate', depthConfusion, 'ratio', 'span'],
      ['updating_span', rotatedAcc, 'ratio', 'rotate'],
      ['updating_control_accuracy', controlAcc, 'ratio', 'rotate'],
      ['updating_cost', updatingCost, 'ratio', 'rotate'],
      ['updating_cost_180', cost180, 'ratio', 'rotate'],
      ['rotation_response_time', rotationRt, 'ms', 'rotate'],
      ['binding_accuracy', bindAccuracy, 'ratio', 'bind'],
      ['binding_ang_error', bindAng, 'deg', 'bind'],
      ['binding_depth_error', bindDepth, 'm', 'bind'],
      ['swap_error_rate', swapRate, 'ratio', 'bind'],
      ['nback_d_prime', nbSdt.dPrime, 'z', 'nback'],
      ['nback_hit_rate', nbSdt.hitRate, 'ratio', 'nback'],
      ['nback_fa_rate', nbSdt.faRate, 'ratio', 'nback'],
      ['nback_lure_fa_rate', lureFa, 'ratio', 'nback'],
      ['nback_lure_cost', lureCost, 'ratio', 'nback'],
      ['nback_rt', nbRt, 'ms', 'nback'],
      ['recall_after_delay', recallAfterDelay, 'ratio', 'interfere'],
      ['recall_after_interference', recallAfterInterference, 'ratio', 'interfere'],
      ['interference_cost', interferenceCost, 'ratio', 'interfere'],
      ['tracking_during_interference', trackingQuality, 'ratio', 'interfere'],
    ];
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    // Anchors are provisional. A three-dimensional layout typically yields a
    // slightly higher span than the flat original, and these are set for that -
    // but without a normative sample of our own it remains an estimate.
    const spanScore = normaliseSoft(span, 7.5, 3.0);
    const updatingScore = normaliseSoft(Number.isFinite(updatingCost) ? updatingCost : 0.55, 0, 0.55);
    const bindingScore = normaliseSoft(bindAccuracy, 0.92, 0.30);
    const continuousScore = normaliseSoft(nbSdt.dPrime, 3.2, 0.6);
    const interferenceScore = normaliseSoft(Number.isFinite(interferenceCost) ? interferenceCost : 0.45, 0, 0.45);

    const ops = opsScore([
      { key: 'spatial_span', value: spanScore, weight: 0.28 },
      { key: 'spatial_updating', value: updatingScore, weight: 0.22 },
      { key: 'continuous_updating', value: continuousScore, weight: 0.20 },
      { key: 'binding', value: bindingScore, weight: 0.16 },
      { key: 'interference_resistance', value: interferenceScore, weight: 0.14 },
    ]);

    rec.score('spatial_span', spanScore, '1.0.0');
    rec.score('spatial_updating', updatingScore, '1.0.0');
    rec.score('continuous_updating', continuousScore, '1.0.0');
    rec.score('binding', bindingScore, '1.0.0');
    rec.score('interference_resistance', interferenceScore, '1.0.0');

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const pts = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)} pont` : '—');
    const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

    const headline = [
      { label: 'Téri terjedelem', value: Number.isFinite(span) ? `${span}` : '—', hint: `helyes sorozat ${totalCorrect}` },
      { label: 'Frissítési költség', value: pts(updatingCost), hint: Number.isFinite(cost180) ? `180°-nál ${pts(cost180)}` : undefined },
      { label: 'Folyamatos frissítés (d′)', value: num(nbSdt.dPrime), hint: Number.isFinite(lureCost) ? `csali-hiba ${lureCost >= 0 ? '+' : ''}${num(lureCost)}` : undefined },
      { label: 'Tárgy-hely kötés', value: pct(bindAccuracy), hint: `csere-hiba ${pct(swapRate)}` },
      { label: 'Interferencia-költség', value: pts(interferenceCost) },
    ];
    headline.push(isVr
      ? { label: 'Mélységi tévesztés', value: pct(depthConfusion), hint: 'a hibákból' }
      : { label: 'Mélységi mutatók', value: 'VR szükséges', hint: 'a rétegek síkon nem különülnek el' });

    return {
      opsScore: ops,
      headline,
      summary: {
        span: {
          span: Number.isFinite(span) ? span : null, totalCorrect, products: r(products, 1),
          firstErrorPosition: r(serialFirstError, 2), depthConfusionRate: r(depthConfusion, 3),
          byLength: this.spanResults.reduce<Record<number, { n: number; correct: number }>>((acc, s) => {
            const e = acc[s.length] ?? { n: 0, correct: 0 };
            e.n++; if (s.correct) e.correct++;
            acc[s.length] = e;
            return acc;
          }, {}),
        },
        updating: {
          controlAccuracy: r(controlAcc, 3), rotatedAccuracy: r(rotatedAcc, 3),
          cost: r(updatingCost, 3), cost180: r(cost180, 3), firstPickMs: r(rotationRt),
          n: this.rotateResults.length,
        },
        binding: {
          accuracy: r(bindAccuracy, 3), angErrorDeg: r(bindAng, 1),
          depthErrorM: r(bindDepth, 2), swapRate: r(swapRate, 3),
        },
        nback: {
          dPrime: r(nbSdt.dPrime, 3), hitRate: r(nbSdt.hitRate, 3), faRate: r(nbSdt.faRate, 3),
          lureFaRate: r(lureFa, 3), fillerFaRate: r(fillerFa, 3), lureCost: r(lureCost, 3), rtMs: r(nbRt),
        },
        interference: {
          afterDelay: r(recallAfterDelay, 3), afterInterference: r(recallAfterInterference, 3),
          cost: r(interferenceCost, 3), trackingQuality: r(trackingQuality, 3),
        },
        platform: ctx.platform,
        trialsScored: this.trials.length,
      },
      axisScores: {
        working_memory: (spanScore + continuousScore + bindingScore) / 3,
        spatial: (spanScore + updatingScore) / 2,
        cognitive_control: interferenceScore,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.recallResolve?.();
    this.recallResolve = null;
    this.pointResolve?.(null);
    this.pointResolve = null;
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.abort();
    this.tumbler.clear();
    this.picker.dispose();
    for (const m of this.bindMeshes) disposeTree(m);
    if (this.probeMesh) disposeTree(this.probeMesh);
    ctx.panels.remove(this.promptPanel);
    this.promptPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
