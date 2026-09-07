import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, stdev, normaliseSoft, opsScore, clamp, tappingMetrics,
  type ModuleManifest, type TrialRecord,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { volumePosition } from '../shared/volume.js';

/**
 * MODULE 14 - RHYTHM
 * Sensorimotor synchronisation and timing.
 *
 * This module needs an honest justification, because the paradigm it comes
 * from is not spatial at all: a metronome and a button, no space involved.
 * The tone, tempo and polyrhythm blocks would measure exactly the same thing
 * flattened onto a screen.
 *
 * The `visual` block is why it belongs in a headset. People synchronise far
 * worse to a flashing light than to a tone - unless the visual pacing signal
 * moves continuously through space, at which point they get most of the
 * auditory advantage back. The reason is that a trajectory is predictable: you
 * stop reacting to an event and start estimating an arrival. A flash carries
 * no such information.
 *
 * That gives one measurement a flat display can also make (continuity gain,
 * which keeps the module comparable with the literature) and two it cannot:
 *
 *   DEPTH BEAT COST       a sphere arriving along the line of sight is harder
 *                         to time than one crossing laterally, because
 *                         approach speed is estimated from expansion.
 *   PERIPHERAL BEAT COST  a trajectory sixty degrees off axis does not exist
 *                         on a thirty-degree display.
 *
 * The response stays a button press throughout. Making the participant reach
 * to a physical target would add movement-time variance an order of magnitude
 * larger than the asynchrony being measured - the spatiality belongs in the
 * stimulus, which is exactly where the published effect lives.
 */

type BlockId = 'tone' | 'visual' | 'tempo' | 'poly';
type SourceKind = 'tone' | 'flash' | 'moving' | 'approach' | 'peripheral' | 'poly';

const TARGET_RADIUS_M = 1.8;
const POLY_NEAR_M = 0.9;
const POLY_FAR_M = 1.8;
/** Half the inter-onset interval: the window a tap may be assigned within. */
const MATCH_FRACTION = 0.5;

interface Beat {
  index: number;
  time: number;
  ioiMs: number;
  paced: boolean;
  sourceKind: SourceKind;
  subBlock: string;
  hand: 'left' | 'right' | 'any';
  matchedTapT: number | null;
}

interface Tap {
  t: number;
  hand: 'left' | 'right' | 'any';
  quantisationMs: number | null;
  subBlock: string;
  beatIndex: number | null;
  asynchronyMs: number | null;
}

export class RhythmModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.RHYTHM!;

  readonly blocks: BlockDescriptor[] = [

    {
      id: 'tone',
      title: 'HANGRA',
      instruction: {
        vr:
          'Egyenletes ütemet fogsz hallani. Húzd meg a ravaszt MINDEN ütemre, pontosan akkor, amikor ' +
          'megszólal. Egy idő után a hang elhallgat — te viszont ugyanabban a tempóban húzd tovább, amíg ' +
          'meg nem állítalak.',
        desktop:
          'Egyenletes ütemet fogsz hallani. Nyomd meg a SZÓKÖZT MINDEN ütemre, pontosan akkor, amikor ' +
          'megszólal. Egy idő után a hang elhallgat — te viszont ugyanabban a tempóban nyomd tovább, amíg ' +
          'meg nem állítalak.',
        mobile:
          'Egyenletes ütemet fogsz hallani. Koppints a képernyőre MINDEN ütemre, pontosan akkor, amikor ' +
          'megszólal. Egy idő után a hang elhallgat — te viszont ugyanabban a tempóban koppints tovább, amíg ' +
          'meg nem állítalak.',
      },
      controlHint: '',
      trials: 3,
      practiceTrials: 1,
      unitLabel: 'tempó',
    },
    {
      id: 'visual',
      title: 'LÁTVÁNYRA',
      instruction: {
        vr:
          'Most nincs hang: az ütemet LÁTNI fogod. Egy gömb érkezik a gyűrűhöz — húzd meg a ravaszt akkor, ' +
          'amikor a gömb pontosan a gyűrűben van. Hol csak felvillan, hol áthalad, hol feléd jön, hol oldalt.',
        desktop:
          'Most nincs hang: az ütemet LÁTNI fogod. Egy gömb érkezik a gyűrűhöz — nyomd meg a SZÓKÖZT akkor, ' +
          'amikor a gömb pontosan a gyűrűben van. Hol csak felvillan, hol áthalad.',
        mobile:
          'Most nincs hang: az ütemet LÁTNI fogod. Egy gömb érkezik a gyűrűhöz — koppints akkor, amikor a ' +
          'gömb pontosan a gyűrűben van. Hol csak felvillan, hol áthalad.',
      },
      controlHint: '',
      trials: 4,
      practiceTrials: 1,
      unitLabel: 'alblokk',
    },
    {
      id: 'tempo',
      title: 'TEMPÓVÁLTÁS',
      instruction:
        'Ugyanaz, hanggal — de a tempó menet közben, bejelentés nélkül megváltozik. Amint észreveszed, ' +
        'igazodj az új tempóhoz.',
      controlHint: '',
      trials: 1,
      practiceTrials: 1,
      unitLabel: 'sorozat',
    },
    {
      id: 'poly',
      title: 'KÉT KÉZ',
      instruction: {
        vr:
          'Két gömb kering, különböző sebességgel. A BAL kezed a KÖZELEBBI gömbhöz tartozik, a JOBB a ' +
          'TÁVOLABBIHOZ. Húzd meg a megfelelő ravaszt, amikor a gömb a saját gyűrűjébe ér — mindkét kézzel, ' +
          'ki-ki a sajátjára. Ez nehéz; nem baj, ha nem tökéletes.',
        desktop:
          'Két gömb kering, különböző sebességgel. A BAL gömbhöz az F billentyű tartozik, a JOBBHOZ a J. ' +
          'Nyomd meg a megfelelőt, amikor a gömb a saját gyűrűjébe ér — mindkét kézzel, ki-ki a sajátjára. ' +
          'Ez nehéz; nem baj, ha nem tökéletes.',
        mobile:
          'Két gömb kering, különböző sebességgel. A BAL gömbhöz a képernyő bal fele tartozik, a JOBBHOZ a ' +
          'jobb fele. Koppints a megfelelő oldalon, amikor a gömb a saját gyűrűjébe ér — mindkét hüvelykkel, ' +
          'ki-ki a sajátjára. Ez nehéz; nem baj, ha nem tökéletes.',
      },
      controlHint: '',
      trials: 2,
      practiceTrials: 1,
      unitLabel: 'kézbeosztás',
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private root!: THREE.Group;
  private ring!: THREE.Mesh;
  private beatBall!: THREE.Mesh;
  private polyNearRing!: THREE.Mesh;
  private polyFarRing!: THREE.Mesh;
  private polyNearBall!: THREE.Mesh;
  private polyFarBall!: THREE.Mesh;
  private feedbackPanel!: Panel;

  private beats: Beat[] = [];
  private taps: Tap[] = [];
  private records: TrialRecord[] = [];

  private currentBlock: BlockId = 'tone';
  private currentSub = '';
  private practice = false;
  private aborted = false;
  /** Open beats a tap may still be assigned to. */
  private pending: Beat[] = [];
  private beatCounter = 0;
  /** Difference between the tone's real onset and the grid slot, per beat. */
  private audioLatencies: number[] = [];

  private offAction: (() => void) | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.root = ctx.root;
    const t = ctx.theme;
    ctx.recorder.setMotionHz(10);

    const ang = (deg: number, dist: number) => 2 * dist * Math.tan((deg * Math.PI) / 360);

    this.ring = makePrimitive({ kind: 'torus', color: t.accent, unlit: true, size: 0.14, opacity: 0.5 });
    this.ring.position.copy(volumePosition(0, 0, TARGET_RADIUS_M, 1.6));
    this.ring.lookAt(0, 1.6, 0);

    // One ball for all four sub-blocks. Flash and moving use the SAME sphere at
    // the SAME place with the same brightness - only the presence of a
    // trajectory differs, so the continuity gain cannot be explained by
    // luminance or size.
    this.beatBall = makePrimitive({ kind: 'sphere', color: t.accent2, unlit: true, size: 0.09 });
    this.beatBall.visible = false;

    this.polyNearRing = makePrimitive({ kind: 'torus', color: t.accent, unlit: true, size: 0.07, opacity: 0.5 });
    this.polyFarRing = makePrimitive({ kind: 'torus', color: t.accent2, unlit: true, size: 0.14, opacity: 0.5 });
    // Angular size held equal: 0.045 m at 0.9 m and 0.09 m at 1.8 m both
    // subtend 2.9 degrees, so the two orbits are separated by depth alone.
    this.polyNearBall = makePrimitive({ kind: 'sphere', color: t.accent, unlit: true, size: 0.045 });
    this.polyFarBall = makePrimitive({ kind: 'sphere', color: t.accent2, unlit: true, size: 0.09 });
    for (const o of [this.polyNearRing, this.polyFarRing, this.polyNearBall, this.polyFarBall]) o.visible = false;
    this.polyNearRing.position.copy(volumePosition(-14, -6, POLY_NEAR_M, 1.6));
    this.polyFarRing.position.copy(volumePosition(14, -6, POLY_FAR_M, 1.6));
    this.polyNearRing.lookAt(0, 1.6, 0);
    this.polyFarRing.lookAt(0, 1.6, 0);

    this.root.add(this.ring, this.beatBall, this.polyNearRing, this.polyFarRing,
                  this.polyNearBall, this.polyFarBall);

    this.feedbackPanel = new Panel({
      width: 0.8, height: 0.2, pxPerMeter: 950, theme: t, frame: false, name: 'rhythm-feedback',
    });
    this.feedbackPanel.group.position.set(0, 1.18, -1.7);
    this.feedbackPanel.setDraw((ui) => this.drawFeedback(ui));
    this.feedbackPanel.group.visible = false;
    this.root.add(this.feedbackPanel.group);
    ctx.panels.add(this.feedbackPanel);

    this.offAction = ctx.engine.input.on((e: ActionEvent) => this.onAction(e));
    for (const b of this.blocks) b.controlHint = this.controlHint();

    ctx.recorder.event('rhythm_setup', {
      platform: ctx.platform,
      iois: [400, 600, 800],
      subBlocks: ['flash', 'moving', 'approach', 'peripheral'],
      quantisationMs: +(ctx.engine.clock.frameInterval || 11.1).toFixed(1),
      targetDistanceM: TARGET_RADIUS_M,
      polyDepthsM: [POLY_NEAR_M, POLY_FAR_M],
      angularSizeDeg: +((2 * Math.atan(0.045 / (2 * POLY_NEAR_M)) * 180) / Math.PI).toFixed(2),
    });
    void ang;
  }


  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'RAVASZ minden ütemre · két kéznél: BAL ravasz → közelebbi, JOBB ravasz → távolabbi';
      case 'desktop': return 'SZÓKÖZ minden ütemre · két kéznél: F → bal gömb, J → jobb gömb';
      default: return 'Koppints minden ütemre · két kéznél: bal képernyőfél → bal gömb, jobb fél → jobb gömb';
    }
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.currentBlock = block.id as BlockId;
    this.practice = practice;
    this.ring.visible = this.currentBlock !== 'poly';

    switch (this.currentBlock) {
      case 'tone': {
        const iois = practice ? [600] : ctx.rng.shuffle([400, 600, 800]);
        for (const ioi of iois) {
          await this.runPacedContinuation(ioi, practice ? 12 : 24, practice ? 0 : 24);
          if (this.aborted) return;
          await this.wait(3000);
        }
        break;
      }

      case 'visual': {
        const subs: SourceKind[] = practice
          ? ['moving']
          : ctx.rng.shuffle(['flash', 'moving', 'approach', 'peripheral'] as SourceKind[]);
        for (const sub of subs) {
          // A flat display has no sixty-degree periphery and no approach along
          // the line of sight, so those sub-blocks simply do not run there.
          if (ctx.platform !== 'vr' && (sub === 'approach' || sub === 'peripheral')) continue;
          // Trial counts are set by the size of the effect each sub-block has
          // to resolve, not by symmetry. The standard error of an sd is
          // sd/sqrt(2(n-1)): at 24 trials the continuity gain carries about
          // 7 ms of noise against an 18 ms effect, and the peripheral cost
          // (~7 ms) is not resolvable at all. 40 and 32 bring those to roughly
          // 5 and 4 ms, which is the most this block can afford in time.
          const n = practice ? 12 : (sub === 'flash' || sub === 'moving') ? 40 : 32;
          await this.runVisual(sub, n);
          if (this.aborted) return;
          await this.wait(2500);
        }
        break;
      }

      case 'tempo':
        await this.runTempo(practice);
        break;

      case 'poly':
        for (const nearHand of (practice ? ['left'] : ['left', 'right']) as ('left' | 'right')[]) {
          await this.runPoly(nearHand, practice ? 12 : 36);
          if (this.aborted) return;
          await this.wait(2500);
        }
        break;
    }

    this.ring.visible = false;
    this.beatBall.visible = false;
  }

  /**
   * Beats are scheduled from a fixed grid computed at block start, never from
   * the previous tap. Anchoring the metronome to responses would make the beat
   * follow the participant, and the asynchrony would collapse to noise around
   * zero regardless of how well they actually timed.
   */
  private async runPacedContinuation(ioiMs: number, paced: number, continuation: number): Promise<void> {
    const ctx = this.ctx;
    this.currentSub = `tone${ioiMs}`;
    const t0 = ctx.engine.clock.frameTime + 1200;

    // Four lead-in beats that are sounded but not scored.
    for (let i = -4; i < paced + continuation; i++) {
      if (this.aborted) return;
      const when = t0 + (i + 4) * ioiMs;
      const isPaced = i < paced;
      const lead = i < 0;
      await this.waitUntil(when);
      if (this.aborted) return;
      // The tone's real onset, not the grid slot it was aimed at. Audio is
      // scheduled ahead on its own clock, and using the intended time would
      // bias every asynchrony in this module by the scheduling latency - which
      // is the one error a timing module cannot afford.
      const soundedAt = isPaced
        ? ctx.audio.tone({ freq: 1000, durationMs: 40, gain: 0.22, shape: 'sine' })
        : when;
      if (lead) continue;
      if (i === paced) {
        ctx.recorder.event('phase_change', {
          blockId: 'tone', phase: 'continuation', beatIndex: i,
        });
      }
      this.emitBeat({
        ioiMs, paced: isPaced, sourceKind: 'tone', subBlock: this.currentSub,
        hand: 'any', time: isPaced ? soundedAt : when, scheduledTime: when,
      });
    }
    await this.wait(ioiMs);
    this.closePending();
  }

  private async runVisual(sub: SourceKind, count: number): Promise<void> {
    const ctx = this.ctx;
    const ioiMs = 600;
    this.currentSub = sub;
    const t0 = ctx.engine.clock.frameTime + 1200;
    // The peripheral trajectory sits sixty degrees off the initial facing -
    // beyond any flat display, which is the point of the sub-block.
    const azDeg = sub === 'peripheral' ? 60 : 0;
    const ringPos = volumePosition(azDeg, 0, TARGET_RADIUS_M, 1.6);
    this.ring.position.copy(ringPos);
    this.ring.lookAt(0, 1.6, 0);
    this.ring.visible = true;

    for (let i = -2; i < count; i++) {
      if (this.aborted) return;
      const when = t0 + (i + 2) * ioiMs;
      await this.animateBeat(sub, when, ioiMs, azDeg, ringPos);
      if (this.aborted) return;
      if (i < 0) continue;
      this.emitBeat({ ioiMs, paced: true, sourceKind: sub, subBlock: sub, hand: 'any', time: when, azDeg });
    }
    await this.wait(ioiMs);
    this.closePending();
    this.beatBall.visible = false;
  }

  /**
   * Drive the pacing object so that it is AT the ring exactly at `when`.
   * The flash appears there; the others travel through, so the arrival can be
   * anticipated from the trajectory rather than reacted to.
   */
  private animateBeat(
    sub: SourceKind, when: number, ioiMs: number, azDeg: number, ringPos: THREE.Vector3
  ): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.ctx;
      const travel = ioiMs * 0.8;
      const step = () => {
        if (this.aborted) { resolve(); return; }
        const now = ctx.engine.clock.frameTime;
        const dt = now - when;

        if (sub === 'flash') {
          this.beatBall.position.copy(ringPos);
          this.beatBall.scale.setScalar(1);
          this.beatBall.visible = dt >= 0 && dt < 60;
        } else if (sub === 'approach') {
          // Along the line of sight, from 6.0 m to 1.2 m, arriving at `when`.
          const f = clamp((dt + travel / 2) / travel, 0, 1);
          const dist = 6.0 - (6.0 - 1.2) * f;
          this.beatBall.position.copy(volumePosition(azDeg, 0, dist, 1.6));
          // Physical size stays constant; the angular expansion IS the timing
          // cue for this sub-block.
          this.beatBall.scale.setScalar(1);
          this.beatBall.visible = dt > -travel / 2 - 40 && dt < travel / 2;
        } else {
          // Lateral pass: constant speed through the ring.
          const f = clamp((dt + travel / 2) / travel, 0, 1);
          const spread = 34;
          const az = azDeg - spread + 2 * spread * f;
          this.beatBall.position.copy(volumePosition(az, 0, TARGET_RADIUS_M, 1.6));
          this.beatBall.scale.setScalar(1);
          this.beatBall.visible = dt > -travel / 2 - 40 && dt < travel / 2;
        }

        if (dt >= 60) { resolve(); return; }
        setTimeout(step, 12);
      };
      step();
    });
  }

  private async runTempo(practice: boolean): Promise<void> {
    const ctx = this.ctx;
    this.currentSub = 'tempo';
    const plan = practice
      ? [{ ioi: 600, beats: 8 }]
      : [{ ioi: 600, beats: 20 }, { ioi: 450, beats: 20 }, { ioi: 750, beats: 20 }];

    let when = ctx.engine.clock.frameTime + 1200;
    let idx = 0;
    for (const seg of plan) {
      if (idx > 0) {
        ctx.recorder.event('tempo_change', {
          fromIoiMs: plan[plan.indexOf(seg) - 1]!.ioi, toIoiMs: seg.ioi, atBeat: idx,
        });
      }
      for (let i = 0; i < seg.beats; i++) {
        if (this.aborted) return;
        await this.waitUntil(when);
        if (this.aborted) return;
        const soundedAt = ctx.audio.tone({ freq: 1000, durationMs: 40, gain: 0.22, shape: 'sine' });
        this.emitBeat({
          ioiMs: seg.ioi, paced: true, sourceKind: 'tone', subBlock: 'tempo',
          hand: 'any', time: soundedAt, scheduledTime: when,
        });
        when += seg.ioi;
        idx++;
      }
    }
    await this.wait(800);
    this.closePending();
  }

  private async runPoly(nearHand: 'left' | 'right', beats: number): Promise<void> {
    const ctx = this.ctx;
    this.currentSub = `poly_${nearHand}near`;
    const cycleMs = 1800;
    // Two against three in one cycle: the near hand takes the slower part.
    const nearIoi = cycleMs / 2;
    const farIoi = cycleMs / 3;
    const farHand: 'left' | 'right' = nearHand === 'left' ? 'right' : 'left';

    for (const o of [this.polyNearRing, this.polyFarRing, this.polyNearBall, this.polyFarBall]) o.visible = true;
    this.ring.visible = false;

    const t0 = ctx.engine.clock.frameTime + 1500;
    const schedule: { time: number; hand: 'left' | 'right'; ioi: number }[] = [];
    const cycles = Math.ceil(beats / 5);
    for (let c = 0; c < cycles; c++) {
      for (let k = 0; k < 2; k++) schedule.push({ time: t0 + c * cycleMs + k * nearIoi, hand: nearHand, ioi: nearIoi });
      for (let k = 0; k < 3; k++) schedule.push({ time: t0 + c * cycleMs + k * farIoi, hand: farHand, ioi: farIoi });
    }
    schedule.sort((a, b) => a.time - b.time);

    ctx.recorder.event('poly_cycle', {
      cycleIndex: 0, leftBeats: nearHand === 'left' ? 2 : 3,
      rightBeats: nearHand === 'left' ? 3 : 2, nearHand, cycleMs,
    });

    const endT = t0 + cycles * cycleMs;
    const anim = () => {
      if (this.aborted) return;
      const now = ctx.engine.clock.frameTime;
      if (now > endT + 400) return;
      const orbit = (ball: THREE.Mesh, ring: THREE.Mesh, period: number, radius: number) => {
        const phase = ((now - t0) % period) / period;
        // The ball travels an arc that passes through its ring at phase 0.
        const az = (radius === POLY_NEAR_M ? -14 : 14) - 26 + 52 * ((phase + 0.5) % 1);
        ball.position.copy(volumePosition(az, -6, radius, 1.6));
        void ring;
      };
      orbit(this.polyNearBall, this.polyNearRing, nearIoi, POLY_NEAR_M);
      orbit(this.polyFarBall, this.polyFarRing, farIoi, POLY_FAR_M);
      setTimeout(anim, 12);
    };
    anim();

    for (const s of schedule.slice(0, beats)) {
      if (this.aborted) return;
      await this.waitUntil(s.time);
      if (this.aborted) return;
      this.emitBeat({
        ioiMs: s.ioi, paced: true, sourceKind: 'poly', subBlock: this.currentSub,
        hand: s.hand, time: s.time,
        depthM: s.hand === nearHand ? POLY_NEAR_M : POLY_FAR_M,
      });
    }
    await this.wait(700);
    this.closePending();
    for (const o of [this.polyNearRing, this.polyFarRing, this.polyNearBall, this.polyFarBall]) o.visible = false;
  }

  /* -------------------------------------------------------- beat / tap */

  private emitBeat(o: {
    ioiMs: number; paced: boolean; sourceKind: SourceKind; subBlock: string;
    hand: 'left' | 'right' | 'any'; time: number; azDeg?: number; depthM?: number;
    /** The grid slot the beat was aimed at, when it differs from the real onset. */
    scheduledTime?: number;
  }): void {
    const beat: Beat = {
      index: this.beatCounter++, time: o.time, ioiMs: o.ioiMs, paced: o.paced,
      sourceKind: o.sourceKind, subBlock: o.subBlock, hand: o.hand, matchedTapT: null,
    };
    if (!this.practice) this.beats.push(beat);
    if (o.scheduledTime !== undefined) this.audioLatencies.push(o.time - o.scheduledTime);
    this.pending.push(beat);
    // Only beats still inside their matching window can claim a tap.
    const cutoff = o.time - o.ioiMs * MATCH_FRACTION * 2;
    this.pending = this.pending.filter((b) => b.time >= cutoff);

    this.ctx.recorder.event('beat', {
      blockId: this.currentBlock, subBlock: o.subBlock, beatIndex: beat.index,
      ioiMs: o.ioiMs, paced: o.paced, sourceKind: o.sourceKind,
      azDeg: o.azDeg ?? 0, radiusM: o.depthM ?? TARGET_RADIUS_M,
      // Both are logged: the grid keeps the tempo honest, the real onset is
      // what the asynchrony is measured against.
      scheduledTime: o.scheduledTime !== undefined ? Math.round(o.scheduledTime) : undefined,
      onsetLatencyMs: o.scheduledTime !== undefined ? +(o.time - o.scheduledTime).toFixed(2) : undefined,
    }, o.time);
  }

  private onAction(e: ActionEvent): void {
    if (!e.down) return;
    let hand: 'left' | 'right' | 'any' = 'any';
    if (this.currentBlock === 'poly') {
      if (e.action === 'LEFT') hand = 'left';
      else if (e.action === 'RIGHT') hand = 'right';
      else if (e.action === 'PRIMARY') hand = e.hand === 'left' ? 'left' : 'right';
      else return;
    } else if (e.action !== 'PRIMARY' && e.action !== 'LEFT' && e.action !== 'RIGHT' && e.action !== 'CONFIRM') {
      return;
    }

    // Assign to the nearest unclaimed beat within half an IOI. A beat can take
    // only one tap: a double press is a false alarm, not a second chance.
    let best: Beat | null = null;
    let bestAbs = Infinity;
    for (const b of this.pending) {
      if (b.matchedTapT !== null) continue;
      if (this.currentBlock === 'poly' && b.hand !== hand) continue;
      const d = e.t - b.time;
      const window = b.ioiMs * MATCH_FRACTION;
      if (Math.abs(d) <= window && Math.abs(d) < bestAbs) { best = b; bestAbs = Math.abs(d); }
    }

    const prev = this.taps[this.taps.length - 1];
    const tap: Tap = {
      t: e.t, hand, quantisationMs: e.quantisationMs, subBlock: this.currentSub,
      beatIndex: best ? best.index : null,
      asynchronyMs: best ? e.t - best.time : null,
    };
    if (best) best.matchedTapT = e.t;
    if (!this.practice) this.taps.push(tap);

    this.ctx.recorder.event('tap', {
      blockId: this.currentBlock, subBlock: this.currentSub, hand,
      asynchronyMs: tap.asynchronyMs === null ? null : +tap.asynchronyMs.toFixed(1),
      matchedBeatIndex: tap.beatIndex,
      itiMs: prev ? +(e.t - prev.t).toFixed(1) : null,
      quantisationMs: e.quantisationMs,
    }, e.t);

    this.ctx.audio.click();
    if (this.practice && best) {
      this.showFeedback(
        `${tap.asynchronyMs! > 0 ? '+' : '−'}${Math.abs(Math.round(tap.asynchronyMs!))} ms`,
        Math.abs(tap.asynchronyMs!) < 60
      );
    }
  }

  /** Beats that never got a tap are recorded as misses, once, at block end. */
  private closePending(): void {
    for (const b of this.pending) {
      if (b.matchedTapT === null && !this.practice) {
        this.ctx.recorder.event('beat_missed', { beatIndex: b.index, subBlock: b.subBlock });
      }
    }
    this.pending = [];
  }

  /* ------------------------------------------------------------ update */

  update(): void { /* animation is driven by its own timers */ }

  private waitUntil(t: number): Promise<void> {
    return new Promise((resolve) => {
      const step = () => {
        if (this.aborted) { resolve(); return; }
        const left = t - this.ctx.engine.clock.frameTime;
        if (left <= 0) { resolve(); return; }
        setTimeout(step, left > 40 ? 20 : 3);
      };
      step();
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r0) => setTimeout(r0, ms));
  }

  private feedbackText = '';
  private feedbackOk = true;

  private showFeedback(text: string, ok: boolean): void {
    this.feedbackText = text;
    this.feedbackOk = ok;
    this.feedbackPanel.group.visible = true;
    this.feedbackPanel.invalidate();
    setTimeout(() => { this.feedbackPanel.group.visible = false; }, 400);
  }

  private drawFeedback(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.85), 16);
    ui.text(this.feedbackText, ui.w / 2, ui.h / 2 + 12, {
      size: 34, color: this.feedbackOk ? t.ok : t.bad, align: 'center', weight: '700', font: t.fontMono,
    });
  }

  /* ------------------------------------------------------------ finish */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    const asyncOf = (pred: (b: Beat) => boolean): number[] =>
      this.beats.filter((b) => pred(b) && b.matchedTapT !== null)
        .map((b) => b.matchedTapT! - b.time);

    const sdOf = (xs: number[]) => (xs.length > 2 ? stdev(xs) : NaN);
    /** Standard error of a sample sd: sd / sqrt(2(n-1)). */
    const seOfSd = (xs: number[]) => (xs.length > 2 ? stdev(xs) / Math.sqrt(2 * (xs.length - 1)) : NaN);
    /** Standard error of a difference of two independent sds. */
    const seOfDiff = (a: number[], b: number[]) => {
      const sa = seOfSd(a); const sb = seOfSd(b);
      return Number.isFinite(sa) && Number.isFinite(sb) ? Math.hypot(sa, sb) : NaN;
    };

    /* ---------------------------------------------- paced tone */

    const pacedTone = asyncOf((b) => b.sourceKind === 'tone' && b.paced && b.subBlock.startsWith('tone'));
    const asyncMean = pacedTone.length ? mean(pacedTone) : NaN;
    const asyncSd = sdOf(pacedTone);
    const sdAt = (ioi: number) => sdOf(asyncOf((b) => b.subBlock === `tone${ioi}` && b.paced));

    /* -------------------------------------------- continuation */

    // No beat to compare against once the tone stops, so the internal clock is
    // read from the intervals between taps, not from asynchronies.
    const contTaps = this.taps
      .filter((t) => t.subBlock.startsWith('tone'))
      .filter((t) => {
        const b = this.beats.find((x) => x.index === t.beatIndex);
        return b ? !b.paced : false;
      })
      .map((t) => t.t)
      .sort((a, b) => a - b);
    const contIntervals: number[] = [];
    for (let i = 1; i < contTaps.length; i++) {
      const d = contTaps[i]! - contTaps[i - 1]!;
      // Guard against a double press being read as a very fast tempo.
      if (d > 120 && d < 2000) contIntervals.push(d);
    }
    const cont = tappingMetrics([], contIntervals);

    /* -------------------------------------------------- visual */

    const subAsync = (sub: string) => asyncOf((b) => b.subBlock === sub);
    const flashA = subAsync('flash');
    const movingA = subAsync('moving');
    const approachA = subAsync('approach');
    const peripheralA = subAsync('peripheral');
    const flashSd = sdOf(flashA);
    const movingSd = sdOf(movingA);
    const approachSd = sdOf(approachA);
    const peripheralSd = sdOf(peripheralA);

    // Every sd difference carries its own noise. Reporting the estimate
    // without it invites reading a 6 ms "effect" that is indistinguishable
    // from zero at this trial count.
    const continuityGainSe = seOfDiff(flashA, movingA);
    const depthCostSe = seOfDiff(approachA, movingA);
    const peripheralCostSe = seOfDiff(peripheralA, movingA);

    const continuityGain = Number.isFinite(flashSd) && Number.isFinite(movingSd)
      ? flashSd - movingSd : NaN;
    const depthBeatCost = isVr && Number.isFinite(approachSd) && Number.isFinite(movingSd)
      ? approachSd - movingSd : NaN;
    const peripheralBeatCost = isVr && Number.isFinite(peripheralSd) && Number.isFinite(movingSd)
      ? peripheralSd - movingSd : NaN;
    const avGap = Number.isFinite(flashSd) && Number.isFinite(sdAt(600))
      ? flashSd - sdAt(600) : NaN;

    /* --------------------------------------------------- tempo */

    const tempoBeats = this.beats.filter((b) => b.subBlock === 'tempo');
    let adaptationBeats = NaN;
    if (tempoBeats.length > 30) {
      // Count from the first tempo change to the first run of three beats
      // whose asynchrony is inside 40 ms of the new tempo.
      const changeAt = tempoBeats.findIndex((b, i) => i > 0 && b.ioiMs !== tempoBeats[i - 1]!.ioiMs);
      if (changeAt > 0) {
        let run = 0;
        for (let i = changeAt; i < tempoBeats.length; i++) {
          const b = tempoBeats[i]!;
          if (b.matchedTapT === null) { run = 0; continue; }
          if (Math.abs(b.matchedTapT - b.time) <= 40) {
            run++;
            if (run >= 3) { adaptationBeats = i - changeAt - 2; break; }
          } else run = 0;
        }
      }
    }

    /* ---------------------------------------------------- poly */

    const polyBeats = this.beats.filter((b) => b.sourceKind === 'poly');
    const polyMatched = polyBeats.filter((b) => b.matchedTapT !== null);
    const polyAsync = polyMatched.map((b) => b.matchedTapT! - b.time);
    const polyAccuracy = polyBeats.length
      ? polyMatched.filter((b) => Math.abs(b.matchedTapT! - b.time) <= b.ioiMs / 4).length / polyBeats.length
      : NaN;
    const polySd = sdOf(polyAsync);
    const nearSd = sdOf(polyMatched.filter((b) => b.subBlock.includes('near') && b.hand === 'left')
      .map((b) => b.matchedTapT! - b.time));
    const farSd = sdOf(polyMatched.filter((b) => b.subBlock.includes('near') && b.hand === 'right')
      .map((b) => b.matchedTapT! - b.time));
    const polyDepthSep = isVr && Number.isFinite(nearSd) && Number.isFinite(farSd)
      ? Math.abs(farSd - nearSd) : NaN;

    const missed = this.beats.length
      ? this.beats.filter((b) => b.matchedTapT === null).length / this.beats.length : NaN;
    const audioLatency = this.audioLatencies.length ? mean(this.audioLatencies) : NaN;
    const quantisation = mean(this.taps.map((t) => t.quantisationMs ?? 0).filter((v) => v > 0));

    const M: [string, number, string, string?][] = [
      ['async_mean_ms', asyncMean, 'ms', 'tone'],
      ['async_sd_ms', asyncSd, 'ms', 'tone'],
      ['async_sd_400', sdAt(400), 'ms', 'tone'],
      ['async_sd_600', sdAt(600), 'ms', 'tone'],
      ['async_sd_800', sdAt(800), 'ms', 'tone'],
      ['continuation_sd_ms', cont.sdIntervalMs, 'ms', 'tone'],
      ['continuation_drift_ms_per_beat', cont.driftMsPerBeat, 'ms/beat', 'tone'],
      ['async_sd_flash', flashSd, 'ms', 'visual'],
      ['async_sd_moving', movingSd, 'ms', 'visual'],
      ['visual_continuity_gain', continuityGain, 'ms', 'visual'],
      ['visual_continuity_gain_se', continuityGainSe, 'ms', 'visual'],
      ['auditory_visual_gap', avGap, 'ms'],
      ['tempo_adaptation_beats', adaptationBeats, 'beats', 'tempo'],
      ['poly_accuracy', polyAccuracy, 'ratio', 'poly'],
      ['poly_async_sd', polySd, 'ms', 'poly'],
      ['missed_beat_rate', missed, 'ratio'],
      ['response_quantisation_ms', Number.isFinite(quantisation) ? quantisation : 0, 'ms'],
      ['audio_onset_latency_ms', audioLatency, 'ms'],
    ];
    if (isVr) {
      M.push(['async_sd_approach', approachSd, 'ms', 'visual']);
      M.push(['async_sd_peripheral', peripheralSd, 'ms', 'visual']);
      M.push(['depth_beat_cost', depthBeatCost, 'ms', 'visual']);
      M.push(['depth_beat_cost_se', depthCostSe, 'ms', 'visual']);
      M.push(['peripheral_beat_cost', peripheralBeatCost, 'ms', 'visual']);
      M.push(['peripheral_beat_cost_se', peripheralCostSe, 'ms', 'visual']);
      M.push(['poly_depth_separation', polyDepthSep, 'ms', 'poly']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* -------------------------------------------------- scores */

    const precision = normaliseSoft(Number.isFinite(asyncSd) ? asyncSd : 60, 16, 60);
    const clockScore = normaliseSoft(Number.isFinite(cont.sdIntervalMs) ? cont.sdIntervalMs : 80, 22, 80);
    const continuity = normaliseSoft(Number.isFinite(continuityGain) ? continuityGain : 0, 22, 0);
    const poly = normaliseSoft(Number.isFinite(polyAccuracy) ? polyAccuracy : 0.42, 0.88, 0.42);
    const tempoScore = normaliseSoft(Number.isFinite(adaptationBeats) ? adaptationBeats : 14, 3, 14);
    // A cost smaller than its own standard error is not evidence of anything,
    // so it enters the score as zero rather than as a small measured value.
    const resolved = (v: number, se: number) =>
      Number.isFinite(v) && Number.isFinite(se) ? (Math.abs(v) > se ? v : 0) : NaN;
    const spatialCosts = [
      resolved(depthBeatCost, depthCostSe),
      resolved(peripheralBeatCost, peripheralCostSe),
    ].filter(Number.isFinite);
    const robustness = normaliseSoft(spatialCosts.length ? mean(spatialCosts) : 30, 4, 30);

    const components = isVr
      ? [
          { key: 'timing_precision', value: precision, weight: 0.26 },
          { key: 'internal_clock', value: clockScore, weight: 0.22 },
          { key: 'visual_continuity_use', value: continuity, weight: 0.16 },
          { key: 'bimanual_polyrhythm', value: poly, weight: 0.14 },
          { key: 'tempo_adaptation', value: tempoScore, weight: 0.12 },
          { key: 'spatial_beat_robustness', value: robustness, weight: 0.10 },
        ]
      : [
          { key: 'timing_precision', value: precision, weight: 0.30 },
          { key: 'internal_clock', value: clockScore, weight: 0.26 },
          { key: 'visual_continuity_use', value: continuity, weight: 0.19 },
          { key: 'bimanual_polyrhythm', value: poly, weight: 0.16 },
          { key: 'tempo_adaptation', value: tempoScore, weight: 0.09 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const ms = (v: number, signed = false) => {
      if (!Number.isFinite(v)) return '—';
      const n = Math.round(v);
      return signed ? `${n >= 0 ? '+' : '−'}${Math.abs(n)} ms` : `${Math.abs(n)} ms`;
    };
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

    const headline = [
      { label: 'Időzítési pontosság', value: ms(asyncSd), hint: 'szórás — a fő mutató' },
      {
        label: 'Előretartás', value: ms(asyncMean, true),
        hint: Number.isFinite(asyncMean) && asyncMean < 0 ? 'megelőzöd az ütemet — ez a szokásos' : undefined,
      },
      { label: 'Belső óra', value: ms(cont.sdIntervalMs), hint: 'hang nélkül ennyit ingadozol' },
      {
        label: 'Tempódrift',
        value: Number.isFinite(cont.driftMsPerBeat)
          ? `${cont.driftMsPerBeat >= 0 ? '+' : '−'}${Math.abs(cont.driftMsPerBeat).toFixed(1)} ms/ütem` : '—',
        hint: Number.isFinite(cont.driftMsPerBeat)
          ? (cont.driftMsPerBeat > 0 ? 'lassulsz, amikor elhallgat a hang' : 'gyorsulsz') : undefined,
      },
      {
        label: 'Mozgó ütem előnye',
        value: Number.isFinite(continuityGain)
          ? `${continuityGain >= 0 ? '+' : '−'}${Math.abs(Math.round(continuityGain))} ± ${Math.round(continuityGainSe)} ms`
          : '—',
        hint: !Number.isFinite(continuityGain) ? undefined
          : Math.abs(continuityGain) <= continuityGainSe ? 'a mérési bizonytalanságon belül — nem értelmezhető'
          : continuityGain > 8 ? 'a pályát követed, nem a villanásra reagálsz'
          : 'a villanásra reagálsz',
      },
      { label: 'Keresztritmus', value: pct(polyAccuracy) },
    ];

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        spatialWeightsApplied: isVr,
        quantisationMs: r(Number.isFinite(quantisation) ? quantisation : 0, 1),
        audioOnsetLatencyMs: r(audioLatency, 2),
        paced: { meanMs: r(asyncMean), sdMs: r(asyncSd), n: pacedTone.length,
                 byIoi: { '400': r(sdAt(400)), '600': r(sdAt(600)), '800': r(sdAt(800)) } },
        continuation: { sdMs: r(cont.sdIntervalMs), driftMsPerBeat: r(cont.driftMsPerBeat, 2), n: contIntervals.length },
        visual: {
          flashSd: r(flashSd), movingSd: r(movingSd),
          continuityGainMs: r(continuityGain), continuityGainSeMs: r(continuityGainSe, 2),
          approachSd: isVr ? r(approachSd) : null,
          peripheralSd: isVr ? r(peripheralSd) : null,
          depthBeatCostMs: isVr ? r(depthBeatCost) : null,
          depthBeatCostSeMs: isVr ? r(depthCostSe, 2) : null,
          peripheralBeatCostMs: isVr ? r(peripheralBeatCost) : null,
          peripheralBeatCostSeMs: isVr ? r(peripheralCostSe, 2) : null,
        },
        tempo: { adaptationBeats: r(adaptationBeats, 0) },
        poly: { accuracy: r(polyAccuracy, 3), sdMs: r(polySd), depthSeparationMs: isVr ? r(polyDepthSep) : null },
        missedBeatRate: r(missed, 3),
        totalBeats: this.beats.length,
      },
      axisScores: {
        motor: Math.round((precision + poly) / 2),
        speed: Math.round(clockScore),
      },
    };
  }

  abort(): void { this.aborted = true; }

  dispose(ctx: ModuleContext): void {
    this.offAction?.();
    ctx.panels.remove(this.feedbackPanel);
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
