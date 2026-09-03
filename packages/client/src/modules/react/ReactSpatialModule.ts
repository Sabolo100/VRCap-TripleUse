import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, stdev, slope, normaliseSoft, opsScore, clamp,
  type ModuleManifest, type TrialRecord, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { volumePosition, Tumbler } from '../shared/volume.js';

/**
 * MODULE 04 - REACT, variant B
 * Reaching and interception in the space you can actually touch.
 *
 * Variant A puts every stimulus on one plane 2.2 m away and answers with a
 * pointing ray. That is a cursor task: the arm never leaves its resting
 * posture, and depth plays no part.
 *
 * Here the targets are within arm's reach and the answer is a real reach - the
 * controller has to arrive at the target's position in three dimensions. Three
 * things become measurable that a ray cannot produce:
 *
 *   FITTS IN THREE DIMENSIONS. Movement amplitude includes a depth component,
 *   so the index of difficulty is computed over a real 3D distance. The slope
 *   against that index is the classic speed-accuracy law, measured on an
 *   unconstrained arm rather than a wrist.
 *
 *   INTERCEPTION. Catching an approaching object requires the hand to be in
 *   the right place at the right time - spatial and temporal error at once,
 *   and they can be separated.
 *
 *   DEPTH IN TRACKING. A pursuit path that moves toward and away demands
 *   vergence changes, not just direction changes.
 *
 * This variant is VR-only, and honestly so: on a mouse there is no reach.
 */

type BlockId = 'reach' | 'intercept' | 'track3d' | 'bimanual';

const EYE = 1.6;

interface ReachSpec {
  azDeg: number;
  elDeg: number;
  /** Distance from the shoulder, metres - inside arm's reach. */
  radius: number;
  /** Target radius, metres. */
  width: number;
}

export class ReactSpatialModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.REACT!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'reach',
      title: 'NYÚLÁS',
      instruction:
        'A célgömb karnyújtásnyira jelenik meg — néha közel, néha messzebb, néha oldalt. ' +
        'Nyúlj oda a kontrollerrel és ÉRINTSD MEG. Nem sugárral kell mutatni: tényleg oda kell nyúlni. ' +
        'Gyorsan, de pontosan.',
      controlHint: '',
      trials: 27,
      practiceTrials: 6,
    },
    {
      id: 'intercept',
      title: 'ELFOGÁS',
      instruction:
        'Gömbök repülnek feléd. Fogd el őket a kontrollerrel, mielőtt elérnék a fejedet. ' +
        'Nem elég a jó helyen lenni — a jó pillanatban is ott kell lenned.',
      controlHint: '',
      trials: 24,
      practiceTrials: 5,
    },
    {
      id: 'track3d',
      title: 'TÉRBELI KÖVETÉS',
      instruction:
        'A gömb most nem csak jobbra-balra mozog, hanem KÖZELEDIK és TÁVOLODIK is. ' +
        'Tartsd rajta a kontroller hegyét, ameddig csak tudod.',
      controlHint: '',
      trials: 3,
      practiceTrials: 1,
    },
    {
      id: 'bimanual',
      title: 'KÉT KÉZ, KÉT TÁVOLSÁG',
      instruction:
        'Két cél jelenik meg egyszerre — az egyik közel, a másik messzebb. A bal kéz a bal célt, ' +
        'a jobb a jobbat érinti meg. A nehéz rész, hogy a két kéz különböző távolságra nyúl.',
      controlHint: '',
      trials: 18,
      practiceTrials: 4,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private target!: THREE.Mesh;
  private targetL!: THREE.Mesh;
  private targetR!: THREE.Mesh;
  private flyer!: THREE.Mesh;
  private tracker!: THREE.Mesh;
  private homeMarker!: THREE.Mesh;
  private feedbackPanel!: Panel;
  private tumbler = new Tumbler();

  private currentBlock: BlockId = 'reach';
  private practice = false;
  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;
  private feedbackText = '';
  private feedbackGood = true;

  private reachResults: { id: number; mtMs: number; initMs: number; errorM: number; pathRatio: number; radius: number; order: number }[] = [];
  private interceptResults: { hit: boolean; timingErrorMs: number; spatialErrorM: number; travelMs: number }[] = [];
  private trackResults: { rms: number; onTarget: number; depthRms: number; lateralRms: number }[] = [];
  private bimanualResults: { correct: boolean; asyncMs: number; nearHand: 'left' | 'right'; depthGapM: number }[] = [];

  /* Live state for the frame loop. */
  private live: {
    kind: BlockId;
    startT: number;
    resolve: (v: unknown) => void;
    handStart?: THREE.Vector3;
    moveStartT?: number;
    pathLength?: number;
    lastHand?: THREE.Vector3;
    arrivalT?: number;
    from?: THREE.Vector3;
    to?: THREE.Vector3;
    done?: boolean;
  } | null = null;

  private trackSamples: { total: number; err: number[]; depthErr: number[]; latErr: number[]; on: number } = {
    total: 0, err: [], depthErr: [], latErr: [], on: 0,
  };

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);

    this.target = makePrimitive({ kind: 'sphere', color: ctx.theme.accent, unlit: true, size: 0.09 });
    this.target.visible = false;
    this.targetL = makePrimitive({ kind: 'sphere', color: 0x4fc3f7, unlit: true, size: 0.09 });
    this.targetL.visible = false;
    this.targetR = makePrimitive({ kind: 'sphere', color: 0xff9e1b, unlit: true, size: 0.09 });
    this.targetR.visible = false;
    this.flyer = makePrimitive({ kind: 'sphere', color: ctx.theme.accent, unlit: true, size: 0.13 });
    this.flyer.visible = false;
    this.tracker = makePrimitive({ kind: 'sphere', color: ctx.theme.accent, unlit: true, size: 0.11 });
    this.tracker.visible = false;
    // A home position to return to between reaches, so every movement starts
    // from the same posture and movement time means the same thing each trial.
    this.homeMarker = makePrimitive({ kind: 'torus', color: ctx.theme.textMuted, unlit: true, opacity: 0.35, size: 0.16 });
    this.homeMarker.visible = false;
    this.root.add(this.target, this.targetL, this.targetR, this.flyer, this.tracker, this.homeMarker);

    this.feedbackPanel = new Panel({
      width: 0.7, height: 0.16, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'react-b-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.15, -1.5);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);
    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
  }

  private controlHint(block: BlockId): string {
    switch (block) {
      case 'reach': return 'Nyúlj oda a kontrollerrel és érintsd meg a gömböt. Utána térj vissza a gyűrűhöz.';
      case 'intercept': return 'Üsd el a közeledő gömböt a kontrollerrel, mielőtt elérné a fejedet.';
      case 'track3d': return 'Tartsd a kontroller hegyét a mozgó gömbön. Nem kell gombot nyomni.';
      case 'bimanual': return 'Bal kéz a bal célt, jobb kéz a jobbat — egyszerre, két különböző távolságra.';
    }
  }

  /** The dominant hand's controller tip in world space. */
  private handPos(hand: 'left' | 'right' | 'any' = 'any'): THREE.Vector3 | null {
    const pointers = this.ctx.engine.input.pointers.filter((p) => p.active && (p.id === 'left' || p.id === 'right'));
    const chosen = hand === 'any'
      ? pointers[0]
      : pointers.find((p) => p.hand === hand);
    if (!chosen?.object3D) return null;
    return chosen.object3D.getWorldPosition(new THREE.Vector3());
  }

  /* ------------------------------------------------------- block driver */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    switch (this.currentBlock) {
      case 'reach': await this.runReach(count); break;
      case 'intercept': await this.runIntercept(count); break;
      case 'track3d': await this.runTrack(count); break;
      case 'bimanual': await this.runBimanual(count); break;
    }
    this.hideAll();
  }

  /* ------------------------------------------------------- 1: 3D reach */

  private homePosition(): THREE.Vector3 {
    return new THREE.Vector3(0, EYE - 0.42, -0.32);
  }

  private async runReach(count: number): Promise<void> {
    const rng = this.ctx.rng;
    // Three amplitudes x three widths: the classic Fitts grid, extended into
    // depth so the index of difficulty is computed over a real 3D distance.
    const specs: ReachSpec[] = [];
    const radii = [0.42, 0.62, 0.82];
    const widths = [0.055, 0.085, 0.12];
    for (let i = 0; i < count; i++) {
      specs.push({
        azDeg: rng.range(-42, 42),
        elDeg: rng.range(-24, 26),
        radius: radii[i % 3]!,
        width: widths[Math.floor(i / 3) % 3]!,
      });
    }
    const queue = rng.shuffle(specs);

    this.homeMarker.position.copy(this.homePosition());
    this.homeMarker.visible = true;

    for (let i = 0; i < queue.length && !this.aborted; i++) {
      this.ctx.recorder.trialNumber = i + 1;
      const spec = queue[i]!;
      await this.waitForHome();
      if (this.aborted) return;
      await this.wait(rng.range(400, 900));
      if (this.aborted) return;

      const pos = volumePosition(spec.azDeg, spec.elDeg, spec.radius, EYE - 0.25);
      this.target.position.copy(pos);
      this.target.scale.setScalar(spec.width / 0.045);
      this.target.visible = true;
      this.tumbler.clear();
      this.tumbler.add(this.target, rng, 0.2, 0.5);

      const home = this.homePosition();
      const amplitude = pos.distanceTo(home);
      // Fitts' index of difficulty over the full 3D movement amplitude.
      const id = Math.log2((2 * amplitude) / (spec.width * 2));
      const startT = this.ctx.engine.clock.frameTime;

      this.ctx.recorder.event('reach_target', {
        azDeg: +spec.azDeg.toFixed(1), elDeg: +spec.elDeg.toFixed(1),
        radius: +spec.radius.toFixed(2), widthM: spec.width,
        amplitudeM: +amplitude.toFixed(3), indexOfDifficulty: +id.toFixed(2),
        quantisationMs: +this.ctx.engine.clock.frameInterval.toFixed(1),
      }, startT);

      const res = await this.awaitTouch(this.target, spec.width + 0.05, 5000, startT, home);
      this.target.visible = false;
      this.tumbler.remove(this.target);
      if (this.aborted) return;

      if (res) {
        if (!this.practice) {
          this.reachResults.push({
            id, mtMs: res.mtMs, initMs: res.initMs, errorM: res.errorM,
            pathRatio: res.pathRatio, radius: spec.radius, order: i,
          });
          this.trials.push({
            trialNumber: i + 1, block: 'reach',
            stimulus: {
              kind: 'reach3d', azDeg: +spec.azDeg.toFixed(1), elDeg: +spec.elDeg.toFixed(1),
              radiusM: spec.radius, widthM: spec.width, amplitudeM: +amplitude.toFixed(3),
              indexOfDifficulty: +id.toFixed(2), variant: 'B', platform: 'vr', practice: false,
            },
            response: {
              movementTimeMs: +res.mtMs.toFixed(1), initiationMs: +res.initMs.toFixed(1),
              endpointErrorM: +res.errorM.toFixed(4), pathRatio: +res.pathRatio.toFixed(3),
            },
            correct: true, outcome: 'hit',
            reactionTimeMs: +(res.initMs + res.mtMs).toFixed(1),
            startedAt: +startT.toFixed(1), endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
          });
        }
        if (this.practice) this.showFeedback(`${Math.round(res.mtMs)} ms`, true);
      } else {
        if (this.practice) this.showFeedback('KIMARADT', false);
        if (!this.practice) {
          this.trials.push({
            trialNumber: i + 1, block: 'reach',
            stimulus: { kind: 'reach3d', indexOfDifficulty: +id.toFixed(2), variant: 'B', practice: false },
            response: null, correct: false, outcome: 'timeout', reactionTimeMs: null,
            startedAt: +startT.toFixed(1), endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
          });
        }
      }
      await this.wait(300);
    }
    this.homeMarker.visible = false;
  }

  /** Wait until the hand returns to the home ring, so every reach starts alike. */
  private async waitForHome(): Promise<void> {
    const home = this.homePosition();
    const deadline = this.ctx.engine.clock.frameTime + 4000;
    for (;;) {
      if (this.aborted) return;
      const h = this.handPos();
      if (!h || h.distanceTo(home) < 0.14) return;
      if (this.ctx.engine.clock.frameTime > deadline) return;
      await this.wait(60);
    }
  }

  /**
   * Wait for the hand to arrive inside the target. Movement initiation is the
   * moment the hand actually leaves home, so initiation and execution can be
   * separated - which a ray-based pointing task cannot do.
   */
  private awaitTouch(
    mesh: THREE.Mesh, tolerance: number, timeoutMs: number, startT: number, home: THREE.Vector3
  ): Promise<{ mtMs: number; initMs: number; errorM: number; pathRatio: number } | null> {
    return new Promise((resolve) => {
      let moveStart: number | null = null;
      let path = 0;
      let last: THREE.Vector3 | null = null;
      const straight = mesh.position.distanceTo(home);
      const tick = () => {
        if (this.aborted) { resolve(null); return; }
        const now = this.ctx.engine.clock.frameTime;
        const h = this.handPos();
        if (h) {
          if (last) path += h.distanceTo(last);
          last = h.clone();
          if (moveStart === null && h.distanceTo(home) > 0.10) moveStart = now;
          const d = h.distanceTo(mesh.position);
          if (d <= tolerance && moveStart !== null) {
            this.ctx.audio.ok();
            this.ctx.engine.input.pulse('both', 0.35, 30);
            resolve({
              mtMs: now - moveStart, initMs: moveStart - startT,
              errorM: d, pathRatio: straight > 0 ? path / straight : 1,
            });
            return;
          }
        }
        if (now - startT > timeoutMs) { resolve(null); return; }
        setTimeout(tick, 16);
      };
      tick();
    });
  }

  /* ------------------------------------------------------ 2: intercept */

  private async runIntercept(count: number): Promise<void> {
    const rng = this.ctx.rng;
    for (let i = 0; i < count && !this.aborted; i++) {
      this.ctx.recorder.trialNumber = i + 1;
      await this.wait(rng.range(700, 1400));
      if (this.aborted) return;

      const az = rng.range(-40, 40);
      const el = rng.range(-14, 20);
      const from = volumePosition(az, el, rng.range(5.5, 8.5), EYE);
      const to = new THREE.Vector3(0, EYE, 0);
      const travelMs = rng.range(1100, 1900);
      this.flyer.position.copy(from);
      this.flyer.visible = true;
      this.tumbler.clear();
      this.tumbler.add(this.flyer, rng, 0.5, 1.2);

      const startT = this.ctx.engine.clock.frameTime;
      this.ctx.recorder.event('flyer_launched', {
        travelMs: Math.round(travelMs), azDeg: +az.toFixed(1), elDeg: +el.toFixed(1),
        quantisationMs: +this.ctx.engine.clock.frameInterval.toFixed(1),
      }, startT);

      const res = await this.awaitIntercept(from, to, travelMs, startT);
      this.flyer.visible = false;
      this.tumbler.remove(this.flyer);
      if (this.aborted) return;

      if (!this.practice) {
        this.interceptResults.push({
          hit: res.hit, timingErrorMs: res.timingErrorMs, spatialErrorM: res.spatialErrorM, travelMs,
        });
        this.trials.push({
          trialNumber: i + 1, block: 'intercept',
          stimulus: {
            kind: 'intercept', travelMs: Math.round(travelMs),
            azDeg: +az.toFixed(1), elDeg: +el.toFixed(1), variant: 'B', practice: false,
          },
          response: res.hit
            ? { timingErrorMs: +res.timingErrorMs.toFixed(1), spatialErrorM: +res.spatialErrorM.toFixed(3) }
            : null,
          correct: res.hit, outcome: res.hit ? 'hit' : 'miss',
          reactionTimeMs: res.hit ? +Math.abs(res.timingErrorMs).toFixed(1) : null,
          startedAt: +startT.toFixed(1), endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
        });
      }
      if (this.practice) {
        this.showFeedback(res.hit ? `ELFOGVA · ${Math.round(res.spatialErrorM * 100)} cm` : 'ELMENT', res.hit);
      }
      await this.wait(400);
    }
  }

  private awaitIntercept(
    from: THREE.Vector3, to: THREE.Vector3, travelMs: number, startT: number
  ): Promise<{ hit: boolean; timingErrorMs: number; spatialErrorM: number }> {
    return new Promise((resolve) => {
      let best = Infinity;
      let bestT = 0;
      const tick = () => {
        if (this.aborted) { resolve({ hit: false, timingErrorMs: NaN, spatialErrorM: NaN }); return; }
        const now = this.ctx.engine.clock.frameTime;
        const t = clamp((now - startT) / travelMs, 0, 1);
        this.flyer.position.lerpVectors(from, to, t);
        const h = this.handPos();
        if (h) {
          const d = h.distanceTo(this.flyer.position);
          if (d < best) { best = d; bestT = now; }
          if (d <= 0.16) {
            this.ctx.audio.ok();
            this.ctx.engine.input.pulse('both', 0.5, 40);
            // The interception plane is 0.55 m out; timing error is measured
            // against when the object would have crossed it.
            const idealT = startT + travelMs * (1 - 0.55 / from.distanceTo(to));
            resolve({ hit: true, timingErrorMs: now - idealT, spatialErrorM: d });
            return;
          }
        }
        if (t >= 1) {
          resolve({ hit: false, timingErrorMs: bestT ? bestT - (startT + travelMs) : NaN, spatialErrorM: best });
          return;
        }
        setTimeout(tick, 16);
      };
      tick();
    });
  }

  /* -------------------------------------------------- 3: 3D tracking */

  private async runTrack(count: number): Promise<void> {
    for (let i = 0; i < count && !this.aborted; i++) {
      this.ctx.recorder.trialNumber = i + 1;
      this.trackSamples = { total: 0, err: [], depthErr: [], latErr: [], on: 0 };
      this.tracker.visible = true;
      this.trackPhase = this.ctx.rng.range(0, Math.PI * 2);
      this.trackSpeed = 0.42 + i * 0.14;
      this.trackingActive = true;
      this.ctx.recorder.event('track3d_start', { trial: i + 1, speed: this.trackSpeed });
      await this.wait(20000);
      this.trackingActive = false;
      this.tracker.visible = false;
      if (this.aborted) return;

      const rms = Math.sqrt(mean(this.trackSamples.err.map((e) => e * e)) || 0);
      const depthRms = Math.sqrt(mean(this.trackSamples.depthErr.map((e) => e * e)) || 0);
      const latRms = Math.sqrt(mean(this.trackSamples.latErr.map((e) => e * e)) || 0);
      const onTarget = this.trackSamples.total > 0 ? this.trackSamples.on / this.trackSamples.total : NaN;
      this.ctx.recorder.event('track3d_end', {
        rmsM: +rms.toFixed(4), depthRmsM: +depthRms.toFixed(4),
        lateralRmsM: +latRms.toFixed(4), onTarget: +(onTarget || 0).toFixed(3),
      });
      if (!this.practice) this.trackResults.push({ rms, onTarget, depthRms, lateralRms: latRms });
      if (this.practice) this.showFeedback(`CÉLON: ${Math.round((onTarget || 0) * 100)}%`, true);
      await this.wait(800);
    }
  }

  private trackingActive = false;
  private trackPhase = 0;
  private trackSpeed = 0.42;

  /* -------------------------------------------------- 4: bimanual depth */

  private async runBimanual(count: number): Promise<void> {
    const rng = this.ctx.rng;
    for (let i = 0; i < count && !this.aborted; i++) {
      this.ctx.recorder.trialNumber = i + 1;
      await this.wait(rng.range(700, 1300));
      if (this.aborted) return;

      // One hand reaches near, the other far. The asymmetry is the point:
      // the two arms must run different movement plans simultaneously.
      const nearHand: 'left' | 'right' = rng.bool() ? 'left' : 'right';
      const nearR = 0.42;
      const farR = 0.82;
      const lRadius = nearHand === 'left' ? nearR : farR;
      const rRadius = nearHand === 'right' ? nearR : farR;
      const lPos = volumePosition(rng.range(-46, -18), rng.range(-16, 18), lRadius, EYE - 0.25);
      const rPos = volumePosition(rng.range(18, 46), rng.range(-16, 18), rRadius, EYE - 0.25);
      this.targetL.position.copy(lPos);
      this.targetR.position.copy(rPos);
      this.targetL.visible = true;
      this.targetR.visible = true;

      const startT = this.ctx.engine.clock.frameTime;
      this.ctx.recorder.event('bimanual_targets', {
        nearHand, leftRadius: lRadius, rightRadius: rRadius,
        depthGapM: +Math.abs(lRadius - rRadius).toFixed(2),
      }, startT);

      const res = await this.awaitBothTouched(startT);
      this.targetL.visible = false;
      this.targetR.visible = false;
      if (this.aborted) return;

      if (!this.practice) {
        this.bimanualResults.push({
          correct: res.both, asyncMs: res.asyncMs, nearHand, depthGapM: Math.abs(lRadius - rRadius),
        });
        this.trials.push({
          trialNumber: i + 1, block: 'bimanual',
          stimulus: {
            kind: 'bimanual_depth', nearHand, leftRadius: lRadius, rightRadius: rRadius,
            variant: 'B', practice: false,
          },
          response: res.both ? { asynchronyMs: +res.asyncMs.toFixed(1), totalMs: +res.totalMs.toFixed(1) } : null,
          correct: res.both, outcome: res.both ? 'hit' : 'miss',
          reactionTimeMs: res.both ? +res.totalMs.toFixed(1) : null,
          startedAt: +startT.toFixed(1), endedAt: +this.ctx.engine.clock.frameTime.toFixed(1),
        });
      }
      if (this.practice) this.showFeedback(res.both ? `${Math.round(res.asyncMs)} ms eltérés` : 'NEM SIKERÜLT', res.both);
      await this.wait(400);
    }
  }

  private awaitBothTouched(startT: number): Promise<{ both: boolean; asyncMs: number; totalMs: number }> {
    return new Promise((resolve) => {
      let lT: number | null = null;
      let rT: number | null = null;
      const tick = () => {
        if (this.aborted) { resolve({ both: false, asyncMs: NaN, totalMs: NaN }); return; }
        const now = this.ctx.engine.clock.frameTime;
        const lh = this.handPos('left');
        const rh = this.handPos('right');
        if (lT === null && lh && lh.distanceTo(this.targetL.position) < 0.14) {
          lT = now;
          (this.targetL.material as THREE.MeshBasicMaterial).color.setHex(0x4ade80);
          this.ctx.engine.input.pulse('left', 0.35, 25);
        }
        if (rT === null && rh && rh.distanceTo(this.targetR.position) < 0.14) {
          rT = now;
          (this.targetR.material as THREE.MeshBasicMaterial).color.setHex(0x4ade80);
          this.ctx.engine.input.pulse('right', 0.35, 25);
        }
        if (lT !== null && rT !== null) {
          this.ctx.audio.ok();
          (this.targetL.material as THREE.MeshBasicMaterial).color.setHex(0x4fc3f7);
          (this.targetR.material as THREE.MeshBasicMaterial).color.setHex(0xff9e1b);
          resolve({ both: true, asyncMs: Math.abs(lT - rT), totalMs: Math.max(lT, rT) - startT });
          return;
        }
        if (now - startT > 6000) {
          (this.targetL.material as THREE.MeshBasicMaterial).color.setHex(0x4fc3f7);
          (this.targetR.material as THREE.MeshBasicMaterial).color.setHex(0xff9e1b);
          resolve({ both: false, asyncMs: NaN, totalMs: NaN });
          return;
        }
        setTimeout(tick, 16);
      };
      tick();
    });
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.tumbler.update(dt);
    if (!this.trackingActive) return;

    // A path that moves in depth as well as laterally: following it needs
    // vergence changes, not just direction changes.
    this.trackPhase += dt * this.trackSpeed;
    const az = Math.sin(this.trackPhase) * 34;
    const el = Math.sin(this.trackPhase * 1.43) * 16;
    const radius = 0.62 + Math.sin(this.trackPhase * 0.87) * 0.24;
    const pos = volumePosition(az, el, radius, EYE - 0.2);
    this.tracker.position.copy(pos);

    const h = this.handPos();
    if (!h) return;
    const eye = new THREE.Vector3();
    ctx.engine.camera.getWorldPosition(eye);
    const err = h.distanceTo(pos);
    // Split the error into a depth component (along the line of sight) and a
    // lateral one, so it is visible whether depth is the harder axis.
    const los = pos.clone().sub(eye).normalize();
    const rel = h.clone().sub(pos);
    const depthErr = Math.abs(rel.dot(los));
    const latErr = Math.sqrt(Math.max(0, rel.lengthSq() - depthErr * depthErr));

    this.trackSamples.total++;
    this.trackSamples.err.push(err);
    this.trackSamples.depthErr.push(depthErr);
    this.trackSamples.latErr.push(latErr);
    const on = err <= 0.13;
    if (on) this.trackSamples.on++;
    (this.tracker.material as THREE.MeshBasicMaterial).color.set(on ? ctx.theme.ok : ctx.theme.accent);
  }

  /* --------------------------------------------------------------- UI */

  private onAction(_e: ActionEvent): void {
    // Reaching is the response here: no button is needed, and pressing one
    // must not stand in for arriving at the target.
  }

  private showFeedback(text: string, good: boolean): void {
    this.feedbackText = text;
    this.feedbackGood = good;
    this.feedbackPanel.group.visible = true;
    this.feedbackPanel.invalidate();
    setTimeout(() => { this.feedbackPanel.group.visible = false; }, 700);
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.55));
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2, {
      size: 32, color: this.feedbackGood ? t.ok : t.bad, align: 'center', weight: '700', font: t.fontDisplay,
    });
  }

  private hideAll(): void {
    for (const m of [this.target, this.targetL, this.targetR, this.flyer, this.tracker, this.homeMarker]) m.visible = false;
    this.feedbackPanel.group.visible = false;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;

    /* --- 3D Fitts ------------------------------------------------------ */
    const ids = this.reachResults.map((r0) => r0.id);
    const mts = this.reachResults.map((r0) => r0.mtMs);
    const fittsSlope = this.reachResults.length >= 5 ? slope(ids, mts) : NaN;
    const fittsIntercept = this.reachResults.length >= 5 && Number.isFinite(fittsSlope)
      ? mean(mts) - fittsSlope * mean(ids) : NaN;
    // Throughput in bits/s is the standard Fitts summary and lets this be
    // compared with any other pointing device in the literature.
    const throughput = this.reachResults.length
      ? mean(this.reachResults.map((r0) => r0.id / (r0.mtMs / 1000)))
      : NaN;
    // Fatigue check. Reaching at arm's length 27 times tires an untrained arm,
    // and a Fitts slope that drifts across the block is an artefact of that,
    // not of pointing ability. Splitting it is the only way to see the
    // difference, so the two halves are reported separately.
    const half = this.reachResults.length ? Math.floor(this.reachResults.length / 2) : 0;
    const firstHalf = this.reachResults.filter((r0) => r0.order < half);
    const secondHalf = this.reachResults.filter((r0) => r0.order >= half);
    const halfSlope = (rows: typeof this.reachResults) => (rows.length >= 5
      ? slope(rows.map((r0) => r0.id), rows.map((r0) => r0.mtMs)) : NaN);
    const slopeFirst = halfSlope(firstHalf);
    const slopeSecond = halfSlope(secondHalf);
    const fatigueDrift = Number.isFinite(slopeFirst) && Number.isFinite(slopeSecond)
      ? slopeSecond - slopeFirst : NaN;

    const endpointError = median(this.reachResults.map((r0) => r0.errorM));
    const pathRatio = median(this.reachResults.map((r0) => r0.pathRatio));
    const initiation = median(this.reachResults.map((r0) => r0.initMs));
    // Does reaching further cost disproportionately more?
    const depthReachCost = this.reachResults.length >= 6
      ? slope(this.reachResults.map((r0) => r0.radius), this.reachResults.map((r0) => r0.mtMs))
      : NaN;

    /* --- interception --------------------------------------------------- */
    const hitRate = this.interceptResults.length
      ? this.interceptResults.filter((i) => i.hit).length / this.interceptResults.length : NaN;
    const hits = this.interceptResults.filter((i) => i.hit);
    const timingCE = hits.length ? mean(hits.map((i) => i.timingErrorMs)) : NaN;
    const timingVE = hits.length > 1 ? stdev(hits.map((i) => i.timingErrorMs)) : NaN;
    const spatialError = median(hits.map((i) => i.spatialErrorM));

    /* --- 3D tracking ----------------------------------------------------- */
    const trackRms = this.trackResults.length ? mean(this.trackResults.map((t) => t.rms)) : NaN;
    const trackOn = this.trackResults.length ? mean(this.trackResults.map((t) => t.onTarget)) : NaN;
    const depthRms = this.trackResults.length ? mean(this.trackResults.map((t) => t.depthRms)) : NaN;
    const latRms = this.trackResults.length ? mean(this.trackResults.map((t) => t.lateralRms)) : NaN;
    // Is depth the harder axis? A ratio above 1 says yes, which is the usual
    // finding and is invisible in a lateral-only tracking task.
    const depthDominance = Number.isFinite(depthRms) && Number.isFinite(latRms) && latRms > 0
      ? depthRms / latRms : NaN;

    /* --- bimanual ---------------------------------------------------------- */
    const biAccuracy = this.bimanualResults.length
      ? this.bimanualResults.filter((b) => b.correct).length / this.bimanualResults.length : NaN;
    const biAsync = median(this.bimanualResults.filter((b) => b.correct).map((b) => b.asyncMs));

    const M: [string, number, string, string?][] = [
      ['fitts_slope_3d', fittsSlope, 'ms/bit', 'reach'],
      ['fitts_intercept_3d', fittsIntercept, 'ms', 'reach'],
      ['fitts_slope_first_half', slopeFirst, 'ms/bit', 'reach'],
      ['fitts_slope_second_half', slopeSecond, 'ms/bit', 'reach'],
      ['reach_fatigue_drift', fatigueDrift, 'ms/bit', 'reach'],
      ['fitts_throughput', throughput, 'bits/s', 'reach'],
      ['reach_endpoint_error', endpointError, 'm', 'reach'],
      ['reach_path_ratio', pathRatio, 'ratio', 'reach'],
      ['reach_initiation', initiation, 'ms', 'reach'],
      ['depth_reach_cost', depthReachCost, 'ms/m', 'reach'],
      ['interception_hit_rate', hitRate, 'ratio', 'intercept'],
      ['interception_timing_ce', timingCE, 'ms', 'intercept'],
      ['interception_timing_ve', timingVE, 'ms', 'intercept'],
      ['interception_spatial_error', spatialError, 'm', 'intercept'],
      ['tracking_rms_3d', trackRms, 'm', 'track3d'],
      ['time_on_target_3d', trackOn, 'ratio', 'track3d'],
      ['tracking_depth_rms', depthRms, 'm', 'track3d'],
      ['tracking_lateral_rms', latRms, 'm', 'track3d'],
      ['tracking_depth_dominance', depthDominance, 'ratio', 'track3d'],
      ['bimanual_depth_accuracy', biAccuracy, 'ratio', 'bimanual'],
      ['bimanual_depth_asynchrony', biAsync, 'ms', 'bimanual'],
    ];
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* -------------------------------------------------------- scores */

    // Fitts throughput for unconstrained 3D reaching in VR runs lower than for
    // a mouse; these anchors are set for reaching, and are provisional.
    const pointing = normaliseSoft(throughput, 4.2, 1.2);
    const precision = normaliseSoft(endpointError, 0.02, 0.10);
    const interception = normaliseSoft(hitRate, 0.92, 0.30);
    const interceptTiming = normaliseSoft(Number.isFinite(timingVE) ? timingVE : 200, 45, 200);
    const tracking = normaliseSoft(trackOn, 0.85, 0.20);
    const bimanual = Number.isFinite(biAsync)
      ? (normaliseSoft(biAccuracy, 0.95, 0.35) * 0.6 + normaliseSoft(biAsync, 40, 400) * 0.4)
      : normaliseSoft(biAccuracy, 0.95, 0.35);

    const ops = opsScore([
      { key: 'reach_pointing', value: pointing, weight: 0.24 },
      { key: 'interception', value: (interception + interceptTiming) / 2, weight: 0.24 },
      { key: 'tracking_3d', value: tracking, weight: 0.20 },
      { key: 'reach_precision', value: precision, weight: 0.16 },
      { key: 'bimanual_depth', value: bimanual, weight: 0.16 },
    ]);

    rec.score('reach_pointing', pointing, '1.0.0');
    rec.score('interception', (interception + interceptTiming) / 2, '1.0.0');
    rec.score('tracking_3d', tracking, '1.0.0');
    rec.score('reach_precision', precision, '1.0.0');
    rec.score('bimanual_depth', bimanual, '1.0.0');

    const fmt = (v: number, d = 0, s = '') => (Number.isFinite(v) ? `${v.toFixed(d)}${s}` : '—');
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

    return {
      opsScore: ops,
      headline: [
        { label: 'Nyúlási átvitel (Fitts)', value: fmt(throughput, 2, ' bit/s'), hint: `meredekség ${fmt(fittsSlope, 0, ' ms/bit')}` },
        { label: 'Végponthiba', value: fmt(endpointError * 100, 1, ' cm'), hint: `útarány ${fmt(pathRatio, 2)}` },
        { label: 'Elfogás', value: pct(hitRate), hint: `időzítési szórás ${fmt(timingVE, 0, ' ms')}` },
        { label: 'Térbeli követés', value: pct(trackOn), hint: `hiba ${fmt(trackRms * 100, 1, ' cm')}` },
        { label: 'Mélység vs. oldalirány', value: fmt(depthDominance, 2), hint: depthDominance > 1.15 ? 'a mélység a nehezebb' : 'kiegyensúlyozott' },
        { label: 'Kétkezes eltérés', value: fmt(biAsync, 0, ' ms'), hint: pct(biAccuracy) },
      ],
      summary: {
        variant: 'B',
        reach: {
          fittsSlope: r(fittsSlope, 1), fittsIntercept: r(fittsIntercept), throughput: r(throughput, 3),
        slopeFirstHalf: r(slopeFirst, 1), slopeSecondHalf: r(slopeSecond, 1),
        fatigueDriftMsPerBit: r(fatigueDrift, 1),
          endpointErrorM: r(endpointError, 4), pathRatio: r(pathRatio, 3),
          initiationMs: r(initiation), depthReachCostMsPerM: r(depthReachCost, 1), n: this.reachResults.length,
        },
        intercept: {
          hitRate: r(hitRate, 3), timingCeMs: r(timingCE), timingVeMs: r(timingVE),
          spatialErrorM: r(spatialError, 4), n: this.interceptResults.length,
        },
        track3d: {
          rmsM: r(trackRms, 4), onTarget: r(trackOn, 3),
          depthRmsM: r(depthRms, 4), lateralRmsM: r(latRms, 4), depthDominance: r(depthDominance, 3),
        },
        bimanual: { accuracy: r(biAccuracy, 3), asynchronyMs: r(biAsync), n: this.bimanualResults.length },
        platform: ctx.platform,
        trialsScored: this.trials.length,
      },
      axisScores: {
        psychomotor: (pointing + precision + tracking) / 3,
        timing: interceptTiming,
        reaction: interception,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.trackingActive = false;
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.abort();
    this.tumbler.clear();
    ctx.panels.remove(this.feedbackPanel);
    this.feedbackPanel.dispose();
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
