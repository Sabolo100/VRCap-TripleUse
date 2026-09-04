import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, slope, normaliseSoft, opsScore, clamp, sdt, normalisedEntropy,
  type ModuleManifest, type TrialRecord, type TrialOutcome, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree, Pool } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { ObjectPicker } from '../shared/picking.js';
import { layoutVolume, volumePosition, viewRelation, wrapDeg, volumeFor, Tumbler, type VolumeField } from '../shared/volume.js';

/**
 * MODULE 01 - SIGNAL, variant B
 * Search through a volume, all the way around.
 *
 * Variant A lays the array out on a single shell at one distance. That is a
 * curved screen: flatten it and every number stays the same.
 *
 * This variant makes three things true that cannot be true on a surface.
 *
 *   DEPTH CAN GUIDE SEARCH. Items sit in three depth layers with angular size
 *   held constant, so distance is carried by disparity alone. On half the
 *   trials the participant is told which layer the target is in. If depth is
 *   usable as a segmenting cue, the search slope collapses when it is cued -
 *   and `depth_guidance_benefit` is the size of that collapse.
 *
 *   SEARCH COSTS BODY ROTATION. The array wraps a full 360 degrees, so a
 *   target behind you cannot be found without turning. Search time then has a
 *   component proportional to how far you had to turn, which is measurable and
 *   has no analogue in a windowed display.
 *
 *   TRACKED OBJECTS CAN HIDE BEHIND EACH OTHER. In depth, moving items occlude
 *   one another. Tracking has to survive those disappearances, and
 *   `occlusion_tracking_cost` isolates exactly that.
 */

type BlockId = 'depth' | 'surround' | 'occlusion' | 'depthchange';

const COLOR_NEUTRAL = 0x3d7bb8;
const COLOR_TARGET = 0xff9e1b;
const COLOR_MOT = 0x8fa6bf;

interface Item {
  mesh: THREE.Mesh;
  layer: number;
  azDeg: number;
  elDeg: number;
  radius: number;
  isTarget: boolean;
}

interface MotItem {
  mesh: THREE.Mesh;
  azDeg: number;
  elDeg: number;
  radius: number;
  vAz: number;
  vEl: number;
  vR: number;
  isTarget: boolean;
  selected: boolean;
  occludedMs: number;
}

interface Pending {
  setSize: number;
  targetPresent: boolean;
  targetIndex: number;
  depthCued: boolean;
  cuedLayer: number | null;
  targetLayer: number;
  targetYawDeg: number;
  requiredRotationDeg: number;
  onsetT: number;
  responded: boolean;
}

/** How far the head must turn before the panels follow, radians (~14 deg). */
const PANEL_FOLLOW_DEADZONE_RAD = 0.25;
const PANEL_FOLLOW_EASE = 0.12;

export class SignalSpatialModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.SIGNAL!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'depth',
      title: 'MÉLYSÉGI KERESÉS',
      instruction:
        'A cél a NARANCSSÁRGA KOCKA, narancssárga gömbök és kék kockák között. Az objektumok most ' +
        'három különböző TÁVOLSÁGBAN vannak. A próbák felében megmondom, melyik rétegben van a cél — ' +
        'ilyenkor elég ott keresned.',
      controlHint: '',
      trials: 30,
      practiceTrials: 4,
    },
    {
      id: 'surround',
      title: 'KÖRKÖRÖS KERESÉS',
      instruction:
        'Most körülötted vannak az objektumok — teljes körben, akár mögötted is. ' +
        'Ugyanaz a cél. Fordulj nyugodtan: amit nem nézel, azt nem találod meg.',
      controlHint: '',
      trials: 24,
      practiceTrials: 4,
    },
    {
      id: 'occlusion',
      title: 'KÖVETÉS TAKARÁSSAL',
      instruction:
        'Néhány gömb felvillan — ezeket kell követned. Mozgás közben a gömbök MÉLYSÉGBEN is mozognak, ' +
        'tehát néha eltűnnek egymás mögött. Attól még kövesd őket tovább.',
      controlHint: '',
      trials: 12,
      practiceTrials: 2,
    },
    {
      id: 'depthchange',
      title: 'MÉLYSÉGI VÁLTOZÁS',
      instruction:
        'A jelenet villogni fog, és egy objektum folyamatosan változik. Most a változás lehet az is, ' +
        'hogy KÖZELEBB vagy TÁVOLABB kerül — nem csak a színe vagy a mérete.',
      controlHint: '',
      trials: 18,
      practiceTrials: 3,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private picker!: ObjectPicker;
  private tumbler = new Tumbler();
  private cubePool!: Pool<THREE.Mesh>;
  private spherePool!: Pool<THREE.Mesh>;

  private frontField!: VolumeField;
  private surroundField!: VolumeField;
  private motField!: VolumeField;
  private layers: number[] = [];

  private controlPanel!: Panel;
  private cuePanel!: Panel;
  private controlMode: 'none' | 'absent' | 'submit' = 'none';
  private cueText = '';
  private feedbackText = '';

  private items: Item[] = [];
  private motItems: MotItem[] = [];
  private pending: Pending | null = null;
  private currentBlock: BlockId = 'depth';
  private practice = false;
  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private offPanel: (() => void) | null = null;
  private aborted = false;

  private searchResults: {
    block: BlockId; setSize: number; targetPresent: boolean; depthCued: boolean;
    rtMs: number | null; correct: boolean; outcome: TrialOutcome; requiredRotationDeg: number;
  }[] = [];
  private motResults: { targets: number; correct: number; occlusionEvents: number }[] = [];
  private changeResults: { type: 'color' | 'size' | 'depth'; correct: boolean; cycles: number; rtMs: number | null }[] = [];

  private yawBins = new Array(24).fill(0);
  private sampleTimer = 0;
  /** Damped yaw the panels are anchored to. */
  private panelYaw: number | null = null;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    // Three depth layers with angular size compensated, so "far" never simply
    // means "smaller" - otherwise the depth manipulation collapses into a size
    // manipulation and stops measuring depth at all.
    this.layers = ctx.platform === 'vr' ? [2.2, 3.6, 5.4] : [2.4, 3.2, 4.2];

    this.frontField = volumeFor(ctx.platform, {
      vr: { azDeg: 52, elMinDeg: -20, elMaxDeg: 24, rNear: 2.2, rFar: 5.4, minSepDeg: 8 },
      desktop: { azDeg: 25, elMinDeg: -13, elMaxDeg: 14, rNear: 2.4, rFar: 4.2, minSepDeg: 6 },
      mobile: { azDeg: 19, elMinDeg: -11, elMaxDeg: 12, rNear: 2.4, rFar: 4.2, minSepDeg: 7 },
    });
    this.surroundField = volumeFor(ctx.platform, {
      vr: { azDeg: 180, elMinDeg: -16, elMaxDeg: 24, rNear: 2.6, rFar: 5.4, minSepDeg: 9 },
      desktop: { azDeg: 25, elMinDeg: -13, elMaxDeg: 14, rNear: 2.4, rFar: 4.2, minSepDeg: 6 },
      mobile: { azDeg: 19, elMinDeg: -11, elMaxDeg: 12, rNear: 2.4, rFar: 4.2, minSepDeg: 7 },
    });
    this.motField = volumeFor(ctx.platform, {
      vr: { azDeg: 44, elMinDeg: -18, elMaxDeg: 20, rNear: 2.4, rFar: 5.0, minSepDeg: 6 },
      desktop: { azDeg: 23, elMinDeg: -12, elMaxDeg: 13, rNear: 2.6, rFar: 4.0, minSepDeg: 5 },
      mobile: { azDeg: 18, elMinDeg: -10, elMaxDeg: 11, rNear: 2.6, rFar: 4.0, minSepDeg: 6 },
    });

    this.cubePool = new Pool<THREE.Mesh>(
      () => makePrimitive({ kind: 'box', color: COLOR_NEUTRAL, unlit: true, size: 0.16 }),
      (m) => { (m.material as THREE.MeshBasicMaterial).color.setHex(COLOR_NEUTRAL); m.rotation.set(0, 0, 0); },
      36
    );
    this.spherePool = new Pool<THREE.Mesh>(
      () => makePrimitive({ kind: 'sphere', color: COLOR_NEUTRAL, unlit: true, size: 0.17 }),
      (m) => { (m.material as THREE.MeshBasicMaterial).color.setHex(COLOR_NEUTRAL); m.rotation.set(0, 0, 0); },
      36
    );

    this.controlPanel = new Panel({
      width: 0.62, height: 0.16, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'signalb-control',
    });
    this.controlPanel.setDraw((ui) => this.drawControl(ui));
    this.controlPanel.group.visible = false;
    ctx.root.add(this.controlPanel.group);
    ctx.panels.add(this.controlPanel);

    this.cuePanel = new Panel({
      width: 0.7, height: 0.15, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'signalb-cue',
    });
    this.cuePanel.setDraw((ui) => this.drawCue(ui));
    this.cuePanel.group.visible = false;
    ctx.root.add(this.cuePanel.group);
    ctx.panels.add(this.cuePanel);

    this.picker = new ObjectPicker(ctx, [this.controlPanel, this.cuePanel]);
    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);
    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
    this.offPanel = ctx.panels.onClick((e) => {
      if (e.panel !== this.controlPanel) return;
      if (e.widget.id === 'ctl:absent') this.onAbsent(e.t);
      if (e.widget.id === 'ctl:submit') this.onMotSubmit();
    });
  }

  private controlHint(block: BlockId): string {
    const p = this.ctx.platform;
    const press = p === 'vr' ? 'a ravasszal' : p === 'mobile' ? 'koppintással' : 'kattintással';
    switch (block) {
      case 'depth': return p === 'vr'
        ? 'RAVASZ: célra mutatva kijelölöd · GRIP: nincs cél. A felső felirat megmondja, ha ismert a réteg.'
        : `Jelöld meg a célt ${press}. Ha nincs cél, a NINCS CÉL gombot használd.`;
      case 'surround': return p === 'vr'
        ? 'Fordulj körbe. RAVASZ: célra mutatva kijelölöd · GRIP: nincs cél.'
        : `Fordulj körbe, és jelöld meg a célt ${press}. Ha nincs cél, a NINCS CÉL gombot használd.`;
      case 'occlusion': return `Jelöld ki ${press} a felvillant gömböket, majd KÉSZ.`;
      case 'depthchange': return `Mutass ${press} arra az objektumra, amelyik változik.`;
    }
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    this.clearAll();
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    switch (this.currentBlock) {
      case 'depth': await this.runSearch(count, this.frontField, true); break;
      case 'surround': await this.runSearch(count, this.surroundField, false); break;
      case 'occlusion': await this.runOcclusionTracking(count); break;
      case 'depthchange': await this.runDepthChange(count); break;
    }
    this.clearAll();
  }

  /* ------------------------------------------------------ search blocks */

  private async runSearch(count: number, field: VolumeField, useDepthCue: boolean): Promise<void> {
    const rng = this.ctx.rng;
    const sizes: number[] = [];
    const presents: boolean[] = [];
    const cued: boolean[] = [];
    for (let i = 0; i < count; i++) {
      sizes.push([9, 18, 27][i % 3]!);
      presents.push(i < Math.round(count / 2));
      cued.push(useDepthCue && i % 2 === 0);
    }
    const S = rng.shuffle(sizes);
    const P = rng.shuffle(presents);
    const C = rng.shuffle(cued);

    for (let i = 0; i < count && !this.aborted; i++) {
      this.ctx.recorder.trialNumber = i + 1;
      this.yawBins.fill(0);
      await this.wait(rng.range(700, 1200));
      if (this.aborted) return;
      await this.runSearchTrial(S[i]!, P[i]!, C[i]!, field);
      await this.wait(400);
    }
  }

  private runSearchTrial(setSize: number, targetPresent: boolean, depthCued: boolean, field: VolumeField): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.ctx;
      const rng = ctx.rng;
      const slots = layoutVolume(setSize, field, rng);
      const targetIndex = targetPresent ? rng.int(0, setSize - 1) : -1;
      const layerOf = (radius: number) => {
        let best = 0;
        let bd = Infinity;
        this.layers.forEach((l, li) => { const d = Math.abs(l - radius); if (d < bd) { bd = d; best = li; } });
        return best;
      };

      this.items = [];
      for (let i = 0; i < setSize; i++) {
        const slot = slots[i]!;
        // Snap radius onto one of the three layers so "which layer" is a
        // categorical fact the cue can refer to.
        const layer = layerOf(slot.radius);
        const radius = this.layers[layer]!;
        const isTarget = i === targetIndex;
        const depthScale = radius / this.layers[0]!;

        let mesh: THREE.Mesh;
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
        mesh.scale.setScalar((mesh.geometry.type === 'BoxGeometry' ? 0.16 : 0.17) * depthScale);
        mesh.position.copy(volumePosition(slot.azDeg, slot.elDeg, radius, field.height));
        mesh.userData.stimulusIndex = i;
        this.root.add(mesh);
        this.tumbler.add(mesh, rng, 0.1, 0.3);
        this.items.push({ mesh, layer, azDeg: slot.azDeg, elDeg: slot.elDeg, radius, isTarget });
      }

      const targetItem = targetIndex >= 0 ? this.items[targetIndex]! : null;
      const cuedLayer = depthCued && targetItem ? targetItem.layer : depthCued ? rng.int(0, 2) : null;
      const targetYaw = targetItem ? targetItem.azDeg : 0;
      const required = targetItem ? Math.abs(wrapDeg(targetYaw)) : 0;

      // The ray terminates on these and shows a cursor, so the participant
      // can see WHICH object they are about to select rather than only the
      // direction they are aiming in.
      this.picker.setHoverTargets(this.items.map((i) => i.mesh));

      this.cueText = depthCued
        ? `${['KÖZELI', 'KÖZÉPSŐ', 'TÁVOLI'][cuedLayer ?? 0]} RÉTEG`
        : 'BÁRHOL';
      this.positionPanels();
      this.cuePanel.group.visible = true;
      this.cuePanel.invalidate();
      this.controlMode = 'absent';
      this.controlPanel.group.visible = true;
      this.controlPanel.invalidate();

      const onsetT = ctx.engine.clock.frameTime;
      this.pending = {
        setSize, targetPresent, targetIndex, depthCued,
        cuedLayer, targetLayer: targetItem?.layer ?? -1,
        targetYawDeg: targetYaw, requiredRotationDeg: required,
        onsetT, responded: false,
      };
      ctx.audio.click();
      ctx.recorder.event('array_onset', {
        block: this.currentBlock, setSize, targetPresent, targetIndex,
        depthCued, cuedLayer, targetLayer: targetItem?.layer ?? null,
        requiredRotationDeg: +required.toFixed(1),
        quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
      }, onsetT);

      this.searchResolve = () => {
        this.searchResolve = null;
        this.cuePanel.group.visible = false;
        this.controlPanel.group.visible = false;
        this.clearItems();
        resolve();
      };
      // Generous window: a 27-item conjunction search across a full surround
      // legitimately takes a long time, and truncating it would turn misses
      // into a measure of the deadline rather than of the search.
      this.searchTimer = setTimeout(() => {
        if (this.pending && !this.pending.responded) {
          this.commitSearch(null, 'timeout', false, ctx.engine.clock.frameTime, {});
          this.feedbackText = 'KIMARADT';
          ctx.audio.error();
        }
        this.searchResolve?.();
      }, this.currentBlock === 'surround' ? 20000 : 15000);
    });
  }

  private searchResolve: (() => void) | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private finishSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.searchResolve?.();
  }

  private onAbsent(t: number): void {
    const p = this.pending;
    if (!p || p.responded) return;
    const correct = !p.targetPresent;
    this.commitSearch(t - p.onsetT, correct ? 'correct_reject' : 'miss', correct, t, { responseType: 'absent' });
    if (this.practice) {
      this.feedbackText = correct ? 'HELYES' : 'VOLT OTT CÉL';
      correct ? this.ctx.audio.ok() : this.ctx.audio.error();
    }
    this.finishSearch();
  }

  private onSearchPick(index: number, t: number): void {
    const p = this.pending;
    if (!p || p.responded) return;
    const item = this.items[index];
    if (!item) return;
    const correct = p.targetPresent && index === p.targetIndex;
    this.commitSearch(t - p.onsetT, correct ? 'hit' : 'false_alarm', correct, t, {
      responseType: 'located', selectedIndex: index, selectedLayer: item.layer,
    });
    if (this.practice) {
      this.feedbackText = correct ? `${Math.round(t - p.onsetT)} ms` : p.targetPresent ? 'NEM AZ' : 'NINCS OTT CÉL';
      correct ? this.ctx.audio.ok() : this.ctx.audio.error();
    }
    this.ctx.engine.input.pulse('both', correct ? 0.3 : 0.6, correct ? 25 : 70);
    this.finishSearch();
  }

  private commitSearch(
    rtMs: number | null, outcome: TrialOutcome, correct: boolean, endT: number,
    response: Record<string, unknown>
  ): void {
    const p = this.pending;
    if (!p) return;
    p.responded = true;
    const scanned = (this.yawBins.filter((c) => c > 0).length / 24) * 360;
    const rec: TrialRecord = {
      trialNumber: this.ctx.recorder.trialNumber ?? 0,
      block: this.currentBlock,
      stimulus: {
        kind: 'search_volume', block: this.currentBlock, setSize: p.setSize,
        targetPresent: p.targetPresent, targetIndex: p.targetIndex,
        depthCued: p.depthCued, cuedLayer: p.cuedLayer, targetLayer: p.targetLayer,
        requiredRotationDeg: +p.requiredRotationDeg.toFixed(1),
        variant: 'B', platform: this.ctx.platform, practice: this.practice,
      },
      response: { ...response, rtMs, scannedSectorDeg: +scanned.toFixed(1) },
      correct, outcome,
      reactionTimeMs: rtMs === null ? null : +rtMs.toFixed(1),
      startedAt: +p.onsetT.toFixed(1),
      endedAt: +endT.toFixed(1),
    };
    this.ctx.recorder.trial(rec);
    this.ctx.recorder.event('search_response', { outcome, correct, rtMs: rec.reactionTimeMs, ...response }, endT);
    if (!this.practice) {
      this.trials.push(rec);
      this.searchResults.push({
        block: this.currentBlock, setSize: p.setSize, targetPresent: p.targetPresent,
        depthCued: p.depthCued, rtMs, correct, outcome, requiredRotationDeg: p.requiredRotationDeg,
      });
    }
  }

  /* ----------------------------------------- tracking through occlusion */

  private async runOcclusionTracking(count: number): Promise<void> {
    const rng = this.ctx.rng;
    for (let trial = 0; trial < count && !this.aborted; trial++) {
      this.ctx.recorder.trialNumber = trial + 1;
      const nTargets = trial % 2 === 0 ? 3 : 4;
      const total = 10;

      const slots = layoutVolume(total, this.motField, rng);
      const targetSet = new Set(rng.shuffle(Array.from({ length: total }, (_, i) => i)).slice(0, nTargets));
      this.motItems = [];
      for (let i = 0; i < total; i++) {
        const s = slots[i]!;
        const mesh = this.spherePool.acquire();
        mesh.scale.setScalar(0.20 * (s.radius / this.motField.rNear));
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_MOT);
        mesh.position.copy(s.position);
        mesh.userData.stimulusIndex = i;
        this.root.add(mesh);
        const dir = rng.range(0, Math.PI * 2);
        this.motItems.push({
          mesh, azDeg: s.azDeg, elDeg: s.elDeg, radius: s.radius,
          vAz: Math.cos(dir), vEl: Math.sin(dir) * 0.55,
          // Radial velocity is the whole point: items move in depth, so they
          // pass in front of and behind one another.
          vR: rng.range(-0.35, 0.35),
          isTarget: targetSet.has(i), selected: false, occludedMs: 0,
        });
      }

      for (const m of this.motItems) {
        if (m.isTarget) (m.mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_TARGET);
      }
      this.ctx.recorder.event('mot_targets_shown', { targetCount: nTargets });
      await this.wait(2000);
      for (const m of this.motItems) (m.mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOR_MOT);
      await this.wait(400);

      this.motMoving = true;
      this.occlusionEvents = 0;
      this.picker.setHoverTargets(this.motItems.map((m) => m.mesh));
      await this.wait(9000);
      this.motMoving = false;

      this.controlMode = 'submit';
      this.positionPanels();
      this.controlPanel.group.visible = true;
      this.controlPanel.invalidate();
      this.motSelectionOpen = true;
      await new Promise<void>((resolve) => { this.motResolve = resolve; });
      this.motSelectionOpen = false;
      this.controlPanel.group.visible = false;
      if (this.aborted) return;

      const selected = this.motItems.filter((m) => m.selected);
      const correct = selected.filter((m) => m.isTarget).length;
      this.ctx.recorder.event('mot_submitted', { correctCount: correct, targetCount: nTargets, occlusionEvents: this.occlusionEvents });

      if (!this.practice) {
        this.motResults.push({ targets: nTargets, correct, occlusionEvents: this.occlusionEvents });
        this.trials.push({
          trialNumber: trial + 1,
          block: 'occlusion',
          stimulus: {
            kind: 'mot_occlusion', targetCount: nTargets, total,
            occlusionEvents: this.occlusionEvents, variant: 'B',
            platform: this.ctx.platform, practice: false,
          },
          response: { correctCount: correct },
          correct: correct === nTargets,
          outcome: correct === nTargets ? 'hit' : 'miss',
          reactionTimeMs: null, startedAt: 0, endedAt: 0,
        });
      } else {
        this.feedbackText = `${correct} / ${nTargets} helyes`;
        correct === nTargets ? this.ctx.audio.ok() : this.ctx.audio.error();
      }
      this.clearMot();
      await this.wait(500);
    }
  }

  private motMoving = false;
  private motSelectionOpen = false;
  private motResolve: (() => void) | null = null;
  private occlusionEvents = 0;

  private updateMot(dt: number): void {
    if (!this.motMoving) return;
    const f = this.motField;
    const angStep = 9 * dt;
    for (const m of this.motItems) {
      m.azDeg += m.vAz * angStep;
      m.elDeg += m.vEl * angStep;
      m.radius += m.vR * dt;
      if (m.azDeg < -f.azDeg || m.azDeg > f.azDeg) { m.vAz *= -1; m.azDeg = clamp(m.azDeg, -f.azDeg, f.azDeg); }
      if (m.elDeg < f.elMinDeg || m.elDeg > f.elMaxDeg) { m.vEl *= -1; m.elDeg = clamp(m.elDeg, f.elMinDeg, f.elMaxDeg); }
      if (m.radius < f.rNear || m.radius > f.rFar) { m.vR *= -1; m.radius = clamp(m.radius, f.rNear, f.rFar); }
      m.mesh.position.copy(volumePosition(m.azDeg, m.elDeg, m.radius, f.height));
      m.mesh.scale.setScalar(0.20 * (m.radius / f.rNear));
    }
    // Count genuine occlusions: a nearer item covering a farther one in the
    // same direction. This is the event the block exists to create, and it is
    // only possible because the items differ in depth.
    for (let i = 0; i < this.motItems.length; i++) {
      for (let j = i + 1; j < this.motItems.length; j++) {
        const a = this.motItems[i]!;
        const b = this.motItems[j]!;
        const sep = Math.hypot(wrapDeg(a.azDeg - b.azDeg), a.elDeg - b.elDeg);
        const near = a.radius < b.radius ? a : b;
        const far = a.radius < b.radius ? b : a;
        const farMat = far.mesh.material as THREE.MeshBasicMaterial;
        if (sep < 3.5) {
          far.occludedMs += dt * 1000;
          if (far.occludedMs > 0 && far.occludedMs < dt * 1000 * 2) this.occlusionEvents++;
          farMat.transparent = true;
          farMat.opacity = 0.25;
          void near;
        } else {
          farMat.opacity = 1;
        }
      }
    }
  }

  private onMotPick(index: number): void {
    if (!this.motSelectionOpen) return;
    const m = this.motItems[index];
    if (!m) return;
    const targets = this.motItems.filter((x) => x.isTarget).length;
    const selected = this.motItems.filter((x) => x.selected).length;
    if (!m.selected && selected >= targets) { this.ctx.audio.error(); return; }
    m.selected = !m.selected;
    (m.mesh.material as THREE.MeshBasicMaterial).color.setHex(m.selected ? COLOR_TARGET : COLOR_MOT);
    this.ctx.audio.click();
    this.controlPanel.invalidate();
  }

  private onMotSubmit(): void {
    if (!this.motSelectionOpen) return;
    const targets = this.motItems.filter((x) => x.isTarget).length;
    const selected = this.motItems.filter((x) => x.selected).length;
    if (selected !== targets) { this.ctx.audio.error(); return; }
    this.motResolve?.();
    this.motResolve = null;
  }

  /* -------------------------------------------------- depth change block */

  private async runDepthChange(count: number): Promise<void> {
    const rng = this.ctx.rng;
    for (let trial = 0; trial < count && !this.aborted; trial++) {
      this.ctx.recorder.trialNumber = trial + 1;
      const roll = rng.next();
      const type: 'color' | 'size' | 'depth' = roll < 0.34 ? 'color' : roll < 0.62 ? 'size' : 'depth';
      const sceneSize = 8;

      const slots = layoutVolume(sceneSize, this.frontField, rng);
      const changeIndex = rng.int(0, sceneSize - 1);
      this.items = [];
      const palette = [0xff9e1b, 0x4fc3f7, 0x7cf59a, 0xff5c7a, 0xc6a0ff];
      const alt: { color: number; scale: number; radius: number }[] = [];

      for (let i = 0; i < sceneSize; i++) {
        const s = slots[i]!;
        const layerIdx = Math.min(2, Math.floor(rng.next() * 3));
        const radius = this.layers[layerIdx]!;
        const depthScale = radius / this.layers[0]!;
        const mesh = rng.bool() ? this.cubePool.acquire() : this.spherePool.acquire();
        const baseColor = palette[rng.int(0, palette.length - 1)]!;
        const baseScale = 0.17 * depthScale;
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(baseColor);
        mesh.scale.setScalar(baseScale);
        mesh.position.copy(volumePosition(s.azDeg, s.elDeg, radius, this.frontField.height));
        mesh.userData.stimulusIndex = i;
        this.root.add(mesh);
        this.tumbler.add(mesh, rng, 0.1, 0.3);
        this.items.push({ mesh, layer: layerIdx, azDeg: s.azDeg, elDeg: s.elDeg, radius, isTarget: i === changeIndex });

        if (i === changeIndex) {
          // The depth change moves the object to a different layer while its
          // ANGULAR SIZE is kept constant - so the only cue is disparity, not
          // a size change. That is what makes it a depth-detection measure.
          const newLayer = layerIdx === 0 ? 2 : layerIdx === 2 ? 0 : rng.bool() ? 0 : 2;
          const newRadius = this.layers[newLayer]!;
          alt[i] = {
            color: type === 'color' ? palette.filter((c) => c !== baseColor)[rng.int(0, 3)]! : baseColor,
            scale: type === 'size' ? baseScale * (rng.bool() ? 1.5 : 0.6) : type === 'depth' ? 0.17 * (newRadius / this.layers[0]!) : baseScale,
            radius: type === 'depth' ? newRadius : radius,
          };
        } else {
          alt[i] = { color: baseColor, scale: baseScale, radius };
        }
      }

      const startT = this.ctx.engine.clock.frameTime;
      this.ctx.recorder.event('change_scene_shown', { sceneSize, changeType: type, index: changeIndex });
      this.changeResponse = null;
      let cycles = 0;
      let showingAlt = false;
      const deadline = startT + 16000;

      while (this.takeChangeResponse() === null && this.ctx.engine.clock.frameTime < deadline && !this.aborted) {
        for (const it of this.items) it.mesh.visible = true;
        await this.wait(1200);
        if (this.takeChangeResponse() !== null) break;
        for (const it of this.items) it.mesh.visible = false;
        await this.wait(250);
        if (this.takeChangeResponse() !== null) break;
        showingAlt = !showingAlt;
        const it = this.items[changeIndex]!;
        const a = alt[changeIndex]!;
        (it.mesh.material as THREE.MeshBasicMaterial).color.setHex(showingAlt ? a.color : palette.find((c) => true)!);
        if (showingAlt) {
          (it.mesh.material as THREE.MeshBasicMaterial).color.setHex(a.color);
          it.mesh.scale.setScalar(a.scale);
          it.mesh.position.copy(volumePosition(it.azDeg, it.elDeg, a.radius, this.frontField.height));
        } else {
          it.mesh.scale.setScalar(0.17 * (it.radius / this.layers[0]!));
          it.mesh.position.copy(volumePosition(it.azDeg, it.elDeg, it.radius, this.frontField.height));
        }
        cycles++;
      }

      const resp = this.takeChangeResponse();
      const correct = resp !== null && resp.index === changeIndex;
      if (!this.practice) {
        this.changeResults.push({ type, correct, cycles, rtMs: resp ? resp.t - startT : null });
        this.trials.push({
          trialNumber: trial + 1,
          block: 'depthchange',
          stimulus: { kind: 'change_volume', changeType: type, changeIndex, sceneSize, variant: 'B', platform: this.ctx.platform, practice: false },
          response: resp ? { selectedIndex: resp.index, cycles, rtMs: resp.t - startT } : null,
          correct,
          outcome: resp === null ? 'timeout' : correct ? 'hit' : 'false_alarm',
          reactionTimeMs: resp ? +(resp.t - startT).toFixed(1) : null,
          startedAt: +startT.toFixed(1), endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
        });
      } else {
        this.feedbackText = correct ? `HELYES · ${cycles} ciklus` : 'NEM AZ VOLT';
        correct ? this.ctx.audio.ok() : this.ctx.audio.error();
      }
      this.ctx.recorder.event('change_response', { correct, changeType: type, cycles });
      this.clearItems();
      await this.wait(400);
    }
  }

  private changeResponse: { index: number; t: number } | null = null;
  private takeChangeResponse(): { index: number; t: number } | null {
    return this.changeResponse;
  }

  /* ------------------------------------------------------------ input */

  private onAction(e: ActionEvent): void {
    if (!e.down) return;

    // "No target" on the grip as well as on the panel. Aiming at a control
    // that lives in the same space as the stimuli is exactly the situation
    // where the control can be in the way, so the answer is also available
    // without pointing at anything.
    if (e.action === 'SECONDARY' || e.action === 'CANCEL') {
      if (this.currentBlock === 'depth' || this.currentBlock === 'surround') {
        const pend = this.pending;
        if (pend && !pend.responded) this.onAbsent(e.t);
      }
      return;
    }

    if (e.action !== 'PRIMARY') return;
    const ray = e.ray ?? this.ctx.engine.input.primaryRay();
    if (!ray) return;

    if (this.currentBlock === 'occlusion') {
      if (!this.motSelectionOpen) return;
      const hit = this.picker.pick(ray, this.motItems.map((m) => m.mesh));
      if (hit) this.onMotPick(hit.object.userData.stimulusIndex as number);
      return;
    }
    if (this.currentBlock === 'depthchange') {
      if (this.changeResponse !== null) return;
      const hit = this.picker.pick(ray, this.items.map((i) => i.mesh));
      if (hit) { this.changeResponse = { index: hit.object.userData.stimulusIndex as number, t: e.t }; this.ctx.audio.click(); }
      return;
    }
    const p = this.pending;
    if (!p || p.responded) return;
    const hit = this.picker.pick(ray, this.items.map((i) => i.mesh));
    if (hit) this.onSearchPick(hit.object.userData.stimulusIndex as number, e.t);
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.tumbler.update(dt);
    this.updateMot(dt);
    if (this.controlPanel.group.visible || this.cuePanel.group.visible) this.positionPanels();

    this.sampleTimer += dt;
    if (this.sampleTimer >= 0.1) {
      this.sampleTimer = 0;
      const q = new THREE.Quaternion();
      ctx.engine.camera.getWorldQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const yaw = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
      const bin = clamp(Math.floor(((yaw + 180) / 360) * 24), 0, 23);
      this.yawBins[bin] = (this.yawBins[bin] ?? 0) + 1;
    }
  }

  /**
   * Panels follow the head, because in the surround block the participant may
   * be facing anywhere - but they must never sit where a stimulus can be.
   *
   * The stimulus volume spans -20 to +24 degrees of elevation. The control
   * panel used to sit at -20, i.e. exactly on the lower edge, which is why it
   * could end up covering the target the participant was trying to select.
   * Both panels are now placed outside that band: the control well below it,
   * the layer cue well above it.
   *
   * The follow is also damped. Re-aiming the panel every frame makes it feel
   * glued to the face; it now only catches up once the head has turned enough
   * to matter, and then eases rather than snapping.
   */
  private positionPanels(): void {
    const cam = this.ctx.engine.camera;
    const eye = new THREE.Vector3();
    const q = new THREE.Quaternion();
    cam.getWorldPosition(eye);
    cam.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) return;
    fwd.normalize();

    const yaw = Math.atan2(fwd.x, -fwd.z);
    if (this.panelYaw === null) this.panelYaw = yaw;
    let delta = yaw - this.panelYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // Dead zone: small head movements leave the panels where they are, so the
    // participant can look away from the control and back to it.
    if (Math.abs(delta) > PANEL_FOLLOW_DEADZONE_RAD) {
      this.panelYaw += delta * PANEL_FOLLOW_EASE;
    }
    const dir = new THREE.Vector3(Math.sin(this.panelYaw), 0, -Math.cos(this.panelYaw));

    const place = (g: THREE.Object3D, dist: number, elevDeg: number) => {
      const rad = (elevDeg * Math.PI) / 180;
      g.position.copy(eye)
        .addScaledVector(dir, dist * Math.cos(rad))
        .setY(eye.y + dist * Math.sin(rad));
      g.lookAt(eye);
    };
    // -36 and +34 degrees: clear of the -20..+24 stimulus band in both
    // directions, with margin for the panels' own height.
    place(this.controlPanel.group, 1.45, -36);
    place(this.cuePanel.group, 1.75, 34);
  }

  /* --------------------------------------------------------------- UI */

  private drawControl(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 14, withAlpha('#000000', 0.5));
    if (this.controlMode === 'absent') {
      ui.button('ctl:absent', 12, 12, ui.w - 24, ui.h - 40, { label: 'NINCS CÉL', variant: 'ghost', fontSize: 32 });
      ui.text('vagy nyomd meg a GRIP gombot', ui.w / 2, ui.h - 16,
        { size: 18, color: ui.t.textMuted, align: 'center' });
    } else if (this.controlMode === 'submit') {
      const targets = this.motItems.filter((m) => m.isTarget).length;
      const selected = this.motItems.filter((m) => m.selected).length;
      ui.button('ctl:submit', 12, 12, ui.w - 24, ui.h - 24, {
        label: `KÉSZ  ${selected} / ${targets}`, variant: selected === targets ? 'primary' : 'ghost',
        disabled: selected !== targets, fontSize: 30,
      });
    }
    void t;
  }

  private drawCue(ui: UI): void {
    const t = ui.t;
    const cued = this.cueText !== 'BÁRHOL';
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha(cued ? t.accent2 : '#000000', cued ? 0.85 : 0.42));
    ui.text(this.cueText, ui.w / 2, ui.h / 2, {
      size: 30, color: cued ? '#0a0d12' : withAlpha(t.textMuted, 0.9),
      align: 'center', weight: '700', font: t.fontDisplay, letterSpacing: '2px',
    });
  }

  /* ------------------------------------------------------- housekeeping */

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private clearItems(): void {
    for (const it of this.items) {
      this.tumbler.remove(it.mesh);
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      it.mesh.visible = true;
      if (it.mesh.geometry.type === 'BoxGeometry') this.cubePool.release(it.mesh);
      else this.spherePool.release(it.mesh);
    }
    this.items = [];
  }

  private clearMot(): void {
    for (const m of this.motItems) {
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      this.spherePool.release(m.mesh);
    }
    this.motItems = [];
  }

  private clearAll(): void {
    this.clearItems();
    this.clearMot();
    this.controlPanel.group.visible = false;
    this.cuePanel.group.visible = false;
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    const slopeOf = (list: typeof this.searchResults) => {
      const ok = list.filter((r) => r.correct && r.rtMs !== null && r.targetPresent);
      return ok.length >= 4 ? slope(ok.map((r) => r.setSize), ok.map((r) => r.rtMs!)) : NaN;
    };

    const depthBlock = this.searchResults.filter((r) => r.block === 'depth');
    const cued = depthBlock.filter((r) => r.depthCued);
    const uncued = depthBlock.filter((r) => !r.depthCued);
    const slopeCued = slopeOf(cued);
    const slopeUncued = slopeOf(uncued);
    // If depth can act as a segmenting cue, telling the participant which
    // layer to search should flatten the slope. That difference is the point
    // of the block, and it cannot exist on a single-distance display.
    const depthGuidanceBenefit = Number.isFinite(slopeCued) && Number.isFinite(slopeUncued)
      ? slopeUncued - slopeCued : NaN;

    const surround = this.searchResults.filter((r) => r.block === 'surround');
    const surroundOk = surround.filter((r) => r.correct && r.rtMs !== null && r.targetPresent);
    // How much longer does a target cost per degree you had to turn to find it?
    const rotationCost = surroundOk.length >= 4
      ? slope(surroundOk.map((r) => r.requiredRotationDeg), surroundOk.map((r) => r.rtMs!))
      : NaN;
    const rearTargets = surroundOk.filter((r) => r.requiredRotationDeg > 100);
    const frontTargets = surroundOk.filter((r) => r.requiredRotationDeg <= 100);
    const rearSearchTime = median(rearTargets.map((r) => r.rtMs!));
    const frontSearchTime = median(frontTargets.map((r) => r.rtMs!));

    const allSearch = this.searchResults;
    const present = allSearch.filter((r) => r.targetPresent);
    const absent = allSearch.filter((r) => !r.targetPresent);
    const hits = present.filter((r) => r.outcome === 'hit').length;
    const fa = absent.filter((r) => r.outcome === 'false_alarm').length;
    const stats = sdt(hits, present.length - hits, fa, absent.length - fa);
    const medianSearch = median(allSearch.filter((r) => r.correct && r.rtMs !== null).map((r) => r.rtMs!));

    /* --- tracking through occlusion ---------------------------------- */
    const motAccuracy = this.motResults.length
      ? this.motResults.reduce((a, m) => a + m.correct, 0) / this.motResults.reduce((a, m) => a + m.targets, 0)
      : NaN;
    const occSorted = [...this.motResults].sort((a, b) => a.occlusionEvents - b.occlusionEvents);
    const lowHalf = occSorted.slice(0, Math.floor(occSorted.length / 2));
    const highHalf = occSorted.slice(Math.ceil(occSorted.length / 2));
    const accOf = (l: typeof this.motResults) =>
      l.length ? l.reduce((a, m) => a + m.correct, 0) / l.reduce((a, m) => a + m.targets, 0) : NaN;
    // The measurement that needs depth: how much does tracking suffer when the
    // tracked items keep disappearing behind other items?
    const occlusionTrackingCost = lowHalf.length && highHalf.length ? accOf(lowHalf) - accOf(highHalf) : NaN;
    const meanOcclusions = this.motResults.length ? mean(this.motResults.map((m) => m.occlusionEvents)) : NaN;

    /* --- change detection by type -------------------------------------- */
    const changeAcc = (type: 'color' | 'size' | 'depth') => {
      const sub = this.changeResults.filter((c) => c.type === type);
      return sub.length ? sub.filter((c) => c.correct).length / sub.length : NaN;
    };
    const depthChangeAcc = changeAcc('depth');
    const surfaceChangeAcc = mean([changeAcc('color'), changeAcc('size')].filter(Number.isFinite));
    const depthChangeCost = Number.isFinite(surfaceChangeAcc) && Number.isFinite(depthChangeAcc)
      ? surfaceChangeAcc - depthChangeAcc : NaN;

    const scanCoverage = isVr ? (this.yawBins.filter((c) => c > 0).length / 24) * 360 : NaN;
    const scanEntropy = isVr ? normalisedEntropy(this.yawBins) : NaN;

    const M: [string, number, string, string?][] = [
      ['search_slope_uncued', slopeUncued, 'ms/item', 'depth'],
      ['search_slope_depth_cued', slopeCued, 'ms/item', 'depth'],
      ['depth_guidance_benefit', depthGuidanceBenefit, 'ms/item'],
      ['rotation_search_cost', rotationCost, 'ms/deg', 'surround'],
      ['rear_search_time', rearSearchTime, 'ms', 'surround'],
      ['front_search_time', frontSearchTime, 'ms', 'surround'],
      ['search_d_prime', stats.dPrime, 'z'],
      ['search_criterion', stats.criterion, 'z'],
      ['search_hit_rate', stats.hitRate, 'ratio'],
      ['search_false_alarm_rate', stats.faRate, 'ratio'],
      ['median_search_time', medianSearch, 'ms'],
      ['mot_accuracy', motAccuracy, 'ratio', 'occlusion'],
      ['occlusion_tracking_cost', occlusionTrackingCost, 'ratio', 'occlusion'],
      ['mean_occlusion_events', meanOcclusions, 'count', 'occlusion'],
      ['change_accuracy_depth', depthChangeAcc, 'ratio', 'depthchange'],
      ['change_accuracy_surface', surfaceChangeAcc, 'ratio', 'depthchange'],
      ['depth_change_cost', depthChangeCost, 'ratio', 'depthchange'],
      ['head_scan_range', scanCoverage, 'deg'],
      ['head_scan_entropy', scanEntropy, 'ratio'],
    ];
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* -------------------------------------------------------- scores */

    const efficiency = normaliseSoft(slopeUncued, 14, 95);
    const depthUse = normaliseSoft(Number.isFinite(depthGuidanceBenefit) ? depthGuidanceBenefit : 0, 30, -5);
    const accuracy = normaliseSoft(stats.dPrime, 4.0, 0.8);
    const tracking = normaliseSoft(motAccuracy, 0.95, 0.45);
    const occlusionResilience = normaliseSoft(Number.isFinite(occlusionTrackingCost) ? occlusionTrackingCost : 0.3, 0, 0.35);
    const surroundScore = isVr ? normaliseSoft(Number.isFinite(rotationCost) ? rotationCost : 25, 3, 30) : 0;

    const ops = opsScore([
      { key: 'search_efficiency', value: efficiency, weight: 0.22 },
      { key: 'depth_guidance', value: depthUse, weight: 0.18 },
      { key: 'search_accuracy', value: accuracy, weight: 0.18 },
      { key: 'tracking_capacity', value: tracking, weight: 0.16 },
      { key: 'occlusion_resilience', value: occlusionResilience, weight: 0.14 },
      { key: 'surround_search', value: surroundScore, weight: isVr ? 0.12 : 0 },
    ]);

    rec.score('search_efficiency', efficiency, '1.0.0');
    rec.score('depth_guidance', depthUse, '1.0.0');
    rec.score('search_accuracy', accuracy, '1.0.0');
    rec.score('tracking_capacity', tracking, '1.0.0');
    rec.score('occlusion_resilience', occlusionResilience, '1.0.0');
    if (isVr) rec.score('surround_search', surroundScore, '1.0.0');

    const fmt = (v: number, d = 0, s = '') => (Number.isFinite(v) ? `${v.toFixed(d)}${s}` : '—');
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

    const headline = [
      { label: 'Keresési meredekség', value: fmt(slopeUncued, 0, ' ms/elem'), hint: `réteg megadva: ${fmt(slopeCued, 0, ' ms/elem')}` },
      {
        label: 'Mélységi keresésvezérlés',
        value: fmt(depthGuidanceBenefit, 0, ' ms/elem'),
        hint: Number.isFinite(depthGuidanceBenefit) && depthGuidanceBenefit > 8 ? 'használja a mélységet' : 'alig segít neki',
      },
      { label: 'Keresési pontosság (d′)', value: fmt(stats.dPrime, 2) },
      { label: 'Követés takarással', value: pct(motAccuracy), hint: `takarási veszteség ${fmt(occlusionTrackingCost * 100, 0, ' pont')}` },
      { label: 'Mélységi változás', value: pct(depthChangeAcc), hint: `felszíni ${pct(surfaceChangeAcc)}` },
    ];
    headline.push(isVr
      ? { label: 'Hátsó cél megtalálása', value: fmt(rearSearchTime, 0, ' ms'), hint: `elöl ${fmt(frontSearchTime, 0, ' ms')}` }
      : { label: 'Körkörös keresés', value: 'VR szükséges', hint: 'sík nézetben nincs hátsó szektor' });

    return {
      opsScore: ops,
      headline,
      summary: {
        variant: 'B',
        depth: {
          slopeUncued: r(slopeUncued, 2), slopeCued: r(slopeCued, 2),
          guidanceBenefit: r(depthGuidanceBenefit, 2),
          usesDepth: Number.isFinite(depthGuidanceBenefit) && depthGuidanceBenefit > 8,
        },
        surround: isVr ? {
          rotationCostMsPerDeg: r(rotationCost, 3),
          rearSearchMs: r(rearSearchTime), frontSearchMs: r(frontSearchTime),
          scanCoverageDeg: r(scanCoverage, 1), scanEntropy: r(scanEntropy, 3),
        } : { available: false, reason: 'flat_platform' },
        detection: { dPrime: r(stats.dPrime, 3), criterion: r(stats.criterion, 3), medianSearchMs: r(medianSearch) },
        occlusionTracking: {
          accuracy: r(motAccuracy, 3), cost: r(occlusionTrackingCost, 3),
          meanOcclusionEvents: r(meanOcclusions, 1),
        },
        changeDetection: {
          depth: r(depthChangeAcc, 3), color: r(changeAcc('color'), 3),
          size: r(changeAcc('size'), 3), depthCost: r(depthChangeCost, 3),
        },
        platform: ctx.platform,
        spatialWeightsApplied: isVr,
        trialsScored: this.trials.length,
      },
      axisScores: {
        attention: (efficiency + accuracy + depthUse) / 3,
        working_memory: (tracking + occlusionResilience) / 2,
        spatial: depthUse,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchResolve?.();
    this.motResolve?.();
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.offPanel?.();
    this.abort();
    this.tumbler.clear();
    this.picker.dispose();
    this.clearAll();
    ctx.panels.remove(this.controlPanel);
    ctx.panels.remove(this.cuePanel);
    this.controlPanel.dispose();
    this.cuePanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}

void viewRelation;
