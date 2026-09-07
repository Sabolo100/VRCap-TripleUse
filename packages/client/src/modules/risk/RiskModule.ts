import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, median, clamp, normaliseSoft, opsScore, slope,
  type ModuleManifest, type TrialRecord, type Rng,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree, makeLabel } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { BodyAnchor } from '../shared/anchor.js';
import { ObjectPicker } from '../shared/picking.js';
import { MotionTrack } from '../hands/manipulation.js';

/**
 * MODULE 17 - RISK
 * Observed decision behaviour under repeated gain and loss.
 *
 * This module is honest about something the others are not: its construct is
 * NOT spatial. A balloon that inflates and four decks with hidden pay-offs
 * would measure exactly the same thing on a monitor, and the flattening test
 * in docs/03-SPATIAL-DESIGN.md says so plainly.
 *
 * What the headset adds is one manipulation that could not exist on a screen.
 * The stake inflates twice: once by growing in angular size at a fixed
 * distance, and once by APPROACHING with its angular size held constant, so
 * that the growth is carried by disparity and parallax alone. The probability
 * of bursting is identical in both. Anyone who stops earlier when the stake is
 * physically coming at them is pricing the display rather than the odds, and
 * that difference - cue independence - is a real, nameable difference in how
 * risk is assessed. It is the one spatial thing here that earns a place in the
 * score.
 *
 * Everything else the third dimension offers (the hand's path between the two
 * targets, its hesitations and reversals) is recorded and reported, but NOT
 * scored: it describes the conflict, it is not a competence.
 */

type BlockId = 'bart_size' | 'bart_approach' | 'cards';
type Deck = 'A' | 'B' | 'C' | 'D';

const MAX_PUMPS = 16;
const PUMP_VALUE = 5;
/** The stop that maximises expected value with these parameters: 5k(16-k)/16. */
export const EV_OPTIMAL_PUMPS = 8;
const BALLOONS = 12;
const PRACTICE_BALLOONS = 2;
const CARD_TRIALS = 60;
const CARD_BLOCK = 20;
const PRACTICE_CARDS = 6;
const FEEDBACK_MS = 900;
const CARD_ITI_MS = 500;
const BALLOON_ITI_MS = 1200;

const BALLOON_DISTANCE = 0.70;
const APPROACH_FAR = 1.60;
const APPROACH_NEAR = 0.42;
const APPROACH_ANGULAR_DEG = 12.0;
const BALLOON_MIN_D = 0.06;
const BALLOON_MAX_D = 0.26;
const TARGET_SEPARATION = 0.32;
const DECK_AZ = [-33, -11, 11, 33];
const DECK_RADIUS = 0.44;

const DECKS: Deck[] = ['A', 'B', 'C', 'D'];
const DECK_GAIN: Record<Deck, number> = { A: 100, B: 100, C: 50, D: 50 };
const DECK_LOSSES: Record<Deck, number[]> = {
  A: [150, 200, 250, 300, 350],
  B: [1250],
  C: [25, 50, 50, 50, 75],
  D: [250],
};

interface Balloon {
  blockId: BlockId;
  index: number;
  explodeAt: number;
  pumps: number;
  exploded: boolean;
  earned: number;
  firstRtMs: number;
  decisionRts: number[];
  hesitationMs: number[];
  reversals: number;
  pathMm: number;
}

interface Card {
  trial: number;
  deck: Deck;
  slot: number;
  gain: number;
  loss: number;
  rtMs: number;
  switched: boolean;
  afterLoss: boolean;
}

export class RiskModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.RISK!;

  blocks: BlockDescriptor[] = [

    {
      id: 'bart_size',
      title: 'LÉGGÖMB',
      instruction: {
        vr:
          'Előtted egy léggömb és két cél: PUMPA és BEVÁLTÁS. Minden pumpálás 5 pontot tesz a tétre, de a ' +
          'léggömb bármikor kidurranhat — akkor az addigi tét elvész. A pumpáláshoz mutass a PUMPA célra a ' +
          'sugárral, és húzd meg a ravaszt; a beváltáshoz ugyanígy a BEVÁLTÁS célra, és a tét a bankba kerül. ' +
          'Nem mondjuk meg, mikor durran ki, és nincs „helyes” megállási pont.',
        desktop:
          'Előtted egy léggömb és két cél: PUMPA és BEVÁLTÁS. Minden pumpálás 5 pontot tesz a tétre, de a ' +
          'léggömb bármikor kidurranhat — akkor az addigi tét elvész. Pumpáláshoz kattints a PUMPA célra, ' +
          'beváltáshoz a BEVÁLTÁS célra, és a tét a bankba kerül. Nem mondjuk meg, mikor durran ki, és nincs ' +
          '„helyes” megállási pont.',
        mobile:
          'Előtted egy léggömb. Minden pumpálás 5 pontot tesz a tétre, de a léggömb bármikor kidurranhat — ' +
          'akkor az addigi tét elvész. A képernyő alján a PUMPA gombbal pumpálsz, a BEVÁLTÁS gombbal a tét a ' +
          'bankba kerül. Nem mondjuk meg, mikor durran ki, és nincs „helyes” megállási pont.',
      },
      controlHint: '',
      trials: BALLOONS,
      practiceTrials: PRACTICE_BALLOONS,
      unitLabel: 'léggömb',
    },
    {
      id: 'bart_approach',
      title: 'KÖZELEDŐ LÉGGÖMB',
      instruction:
        'Ugyanaz a játék, ugyanazokkal az esélyekkel és ugyanazokkal a célokkal — de most a léggömb nem ' +
        'nő, hanem KÖZELEDIK. Akkora marad, amekkorának látod; csak egyre közelebb kerül hozzád.',
      controlHint: '',
      trials: BALLOONS,
      practiceTrials: PRACTICE_BALLOONS,
      unitLabel: 'léggömb',
    },
    {
      id: 'cards',
      title: 'PAKLIK',
      instruction: {
        vr:
          'Négy pakli van előtted. Minden húzás pontot ad, és néha el is vesz. A paklik különböznek, de nem ' +
          'áruljuk el, miben — ki kell tapasztalnod. Húzáshoz mutass a választott paklira a sugárral, és ' +
          'húzd meg a ravaszt. Válassz annyiszor, ahányszor kérjük.',
        desktop:
          'Négy pakli van előtted. Minden húzás pontot ad, és néha el is vesz. A paklik különböznek, de nem ' +
          'áruljuk el, miben — ki kell tapasztalnod. Húzáshoz kattints a választott paklira. Válassz ' +
          'annyiszor, ahányszor kérjük.',
        mobile:
          'Négy pakli van előtted, 1-től 4-ig számozva. Minden húzás pontot ad, és néha el is vesz. A paklik ' +
          'különböznek, de nem áruljuk el, miben — ki kell tapasztalnod. Húzáshoz nyomd meg a képernyő alján ' +
          'a pakli számát. Válassz annyiszor, ahányszor kérjük.',
      },
      controlHint: '',
      trials: CARD_TRIALS,
      practiceTrials: PRACTICE_CARDS,
      unitLabel: 'kártya',
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private anchor!: BodyAnchor;
  private picker!: ObjectPicker;

  private balloonMesh!: THREE.Mesh;
  private pumpTarget!: THREE.Mesh;
  private cashTarget!: THREE.Mesh;
  private deckMeshes: THREE.Mesh[] = [];
  private deckLabels: THREE.Sprite[] = [];
  private bankPanel!: Panel;

  private currentBlock: BlockId = 'bart_size';
  private practice = false;
  private aborted = false;
  private bank = 0;
  private stake = 0;
  private pumps = 0;
  private explodeAt = 0;
  private trialNumber = 0;
  private feedback = '';
  private feedbackTone: 'good' | 'bad' | 'neutral' = 'neutral';

  private balloons: Balloon[] = [];
  private cards: Card[] = [];
  private practiceCashOuts = 0;

  /** Deck identity per on-screen slot, shuffled once per run. */
  private deckBySlot: Deck[] = ['A', 'B', 'C', 'D'];
  private deckQueue = new Map<Deck, { gain: number; loss: number }[]>();
  private deckDrawn = new Map<Deck, number>();

  private decision: {
    resolve: (choice: string) => void;
    targets: THREE.Object3D[];
    startT: number;
    track: MotionTrack;
  } | null = null;
  private plane: THREE.Plane | null = null;
  private lastDeck: Deck | null = null;

  private offAction: (() => void) | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    ctx.recorder.setMotionHz(30);
    this.anchor = new BodyAnchor(ctx);
    this.anchor.capture();
    this.picker = new ObjectPicker(ctx, []);

    // The approach block is the module's only genuinely spatial measurement,
    // and it cannot be shown on a flat viewport: with angular size held
    // constant, nothing but disparity and parallax carries the approach.
    if (ctx.platform !== 'vr') {
      this.blocks = this.blocks.filter((b) => b.id !== 'bart_approach');
    }

    const t = ctx.theme;
    this.balloonMesh = makePrimitive({ kind: 'sphere', color: t.accent2, unlit: true, size: BALLOON_MIN_D });
    this.balloonMesh.visible = false;
    this.pumpTarget = makePrimitive({ kind: 'cylinder', color: t.accent, unlit: true, size: [0.10, 0.03, 0.10] });
    this.cashTarget = makePrimitive({ kind: 'box', color: t.ok, unlit: true, size: [0.12, 0.03, 0.08] });
    this.pumpTarget.userData.choice = 'pump';
    this.cashTarget.userData.choice = 'cash';
    this.pumpTarget.visible = false;
    this.cashTarget.visible = false;
    ctx.root.add(this.balloonMesh, this.pumpTarget, this.cashTarget);

    this.pumpTarget.add(this.labelFor('PUMPA', 0.05));
    this.cashTarget.add(this.labelFor('BEVÁLTÁS', 0.05));

    this.deckBySlot = ctx.rng.shuffle(DECKS);
    for (let i = 0; i < 4; i++) {
      const m = makePrimitive({
        kind: 'box', color: t.surfaceAlt, unlit: true, size: [0.11, 0.015, 0.15],
      });
      m.userData.choice = `slot${i}`;
      m.visible = false;
      ctx.root.add(m);
      this.deckMeshes.push(m);
      // Slots are labelled by position, not by which deck sits there: the
      // participant must learn the deck from its pay-offs, and a stable name
      // would let a repeat participant carry the answer over.
      const label = makeLabel(String(i + 1), { size: 52, color: '#ffffff' });
      label.position.set(0, 0.03, 0);
      m.add(label);
      this.deckLabels.push(label);
    }

    this.bankPanel = new Panel({
      width: 0.52, height: 0.16, pxPerMeter: 720, theme: t,
      frame: false, name: 'risk-bank', superSample: 2,
    });
    this.bankPanel.setDraw((ui) => this.drawBank(ui));
    this.bankPanel.group.visible = false;
    ctx.root.add(this.bankPanel.group);
    ctx.panels.add(this.bankPanel);

    this.place();
    this.offAction = ctx.engine.input.on((e: ActionEvent) => this.onAction(e));
    for (const b of this.blocks) b.controlHint = this.controlHint();

    ctx.recorder.event('risk_setup', {
      platform: ctx.platform,
      blocks: this.blocks.map((b) => b.id),
      maxPumps: MAX_PUMPS,
      pumpValue: PUMP_VALUE,
      evOptimalPumps: EV_OPTIMAL_PUMPS,
      balloons: BALLOONS,
      cardTrials: CARD_TRIALS,
      deckBySlot: this.deckBySlot,
      approachAngularSizeDeg: APPROACH_ANGULAR_DEG,
      approachRangeM: [APPROACH_FAR, APPROACH_NEAR],
      balloonDistanceM: BALLOON_DISTANCE,
      quantisationMs: +(ctx.engine.clock.frameInterval || 11.1).toFixed(1),
    });
  }

  private labelFor(text: string, y: number): THREE.Sprite {
    const s = makeLabel(text, { size: 46, color: '#ffffff' });
    s.position.set(0, y, 0);
    return s;
  }

  private place(): void {
    const a = this.anchor;
    a.offset(-TARGET_SEPARATION / 2, -0.26, 0.42, this.pumpTarget.position);
    a.offset(TARGET_SEPARATION / 2, -0.26, 0.42, this.cashTarget.position);
    a.offset(0, -0.02, BALLOON_DISTANCE, this.balloonMesh.position);
    for (let i = 0; i < 4; i++) {
      a.place(DECK_AZ[i]!, -24, DECK_RADIUS, this.deckMeshes[i]!.position);
      this.deckMeshes[i]!.lookAt(a.origin);
      this.deckMeshes[i]!.rotateX(Math.PI / 2);
    }
    a.offset(0, 0.22, 0.9, this.bankPanel.group.position);
    this.bankPanel.group.lookAt(a.origin);

    // The plane the two balloon targets sit in - the hand's path is tracked as
    // its intersection with this plane, which works identically for a
    // controller ray and a mouse ray.
    const normal = this.anchor.offset(0, 0, 1, new THREE.Vector3()).sub(a.origin).normalize();
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.pumpTarget.position);
  }


  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'Sugár a PUMPA vagy a BEVÁLTÁS célra + RAVASZ · a pakliknál sugár a paklira + RAVASZ';
      case 'desktop': return 'Kattints a PUMPA vagy a BEVÁLTÁS célra · a pakliknál a paklira';
      default: return 'PUMPA / BEVÁLTÁS gomb · a pakliknál az 1 · 2 · 3 · 4 gomb';
    }
  }

  async calibrate(ctx: ModuleContext): Promise<void> {
    this.anchor.capture();
    this.place();
    ctx.recorder.event('calibration_done', {
      anchorHeight: +this.anchor.eyeHeight.toFixed(3),
      anchorYawDeg: +((this.anchor.yaw * 180) / Math.PI).toFixed(1),
    });
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.currentBlock = block.id as BlockId;
    this.practice = practice;
    this.anchor.ensure();
    this.bankPanel.group.visible = true;
    if (!practice) this.bank = 0;

    if (this.currentBlock === 'cards') {
      this.resetDecks();
      await this.runCards(practice ? PRACTICE_CARDS : CARD_TRIALS);
    } else {
      this.practiceCashOuts = 0;
      const n = practice ? PRACTICE_BALLOONS : BALLOONS;
      for (let i = 0; i < n; i++) {
        if (this.aborted) return;
        await this.runBalloon(i);
      }
      // Understanding check: someone who never cashed out in practice has not
      // discovered half the task, and their measured stopping point would be
      // an artefact of that rather than a decision.
      if (practice && this.practiceCashOuts === 0 && !this.aborted) {
        this.setFeedback('Próbáld ki a beváltást is, hogy tudd, hogyan működik.', 'neutral');
        ctx.recorder.event('practice_repeat', { reason: 'no_cash_out' });
        await this.wait(2200);
        for (let i = 0; i < PRACTICE_BALLOONS; i++) {
          if (this.aborted) return;
          await this.runBalloon(n + i);
        }
      }
    }

    this.hideAll();
    this.ctx.mobileControls?.clear();
    this.bankPanel.group.visible = false;
  }

  /* ----------------------------------------------------------- balloon */

  private async runBalloon(index: number): Promise<void> {
    const ctx = this.ctx;
    // Uniform over 1..16: the classic BART construction on a shorter scale.
    this.explodeAt = ctx.rng.int(1, MAX_PUMPS);
    this.pumps = 0;
    this.stake = 0;
    const rec: Balloon = {
      blockId: this.currentBlock, index, explodeAt: this.explodeAt,
      pumps: 0, exploded: false, earned: 0, firstRtMs: NaN,
      decisionRts: [], hesitationMs: [], reversals: 0, pathMm: 0,
    };
    ctx.recorder.event('balloon_start', {
      blockId: this.currentBlock, index, explodeAt: this.explodeAt, practice: this.practice,
    });

    this.pumpTarget.visible = true;
    this.cashTarget.visible = true;
    this.balloonMesh.visible = true;
    this.updateBalloon();
    this.setBalloonControls();
    this.setFeedback('', 'neutral');

    for (;;) {
      if (this.aborted) return;
      const choice = await this.awaitChoice([this.pumpTarget, this.cashTarget]);
      if (this.aborted) return;
      const d = this.lastDecision;
      rec.decisionRts.push(d.rtMs);
      if (rec.decisionRts.length === 1) rec.firstRtMs = d.rtMs;
      if (Number.isFinite(d.hesitationMs)) rec.hesitationMs.push(d.hesitationMs);
      rec.reversals += d.reversals;
      rec.pathMm += d.pathMm;

      if (choice === 'cash') {
        rec.pumps = this.pumps;
        rec.earned = this.stake;
        this.bank += this.stake;
        if (this.practice) this.practiceCashOuts++;
        ctx.recorder.event('cash_out', {
          blockId: this.currentBlock, index, pumps: this.pumps,
          earned: this.stake, rtMs: +d.rtMs.toFixed(1),
        });
        this.setFeedback(`+${this.stake} pont a bankban`, 'good');
        ctx.audio.ok();
        break;
      }

      this.pumps++;
      this.stake += PUMP_VALUE;
      ctx.recorder.event('pump', {
        blockId: this.currentBlock, index, pumpNumber: this.pumps,
        rtMs: +d.rtMs.toFixed(1), stake: this.stake,
        angularSizeDeg: +this.angularSizeDeg().toFixed(2),
        distanceM: +this.balloonDistance().toFixed(3),
        reachPathMm: Math.round(d.pathMm), reachReversals: d.reversals,
        hesitationMs: Number.isFinite(d.hesitationMs) ? Math.round(d.hesitationMs) : null,
      });

      if (this.pumps >= this.explodeAt) {
        rec.pumps = this.pumps;
        rec.exploded = true;
        rec.earned = 0;
        ctx.recorder.event('explode', {
          blockId: this.currentBlock, index, pumps: this.pumps, lost: this.stake,
        });
        this.setFeedback('KIDURRANT — a tét elveszett', 'bad');
        ctx.audio.error();
        ctx.engine.input.pulse('both', 0.6, 90);
        this.balloonMesh.visible = false;
        this.stake = 0;
        break;
      }
      this.updateBalloon();
    }

    this.bankPanel.invalidate();
    if (!this.practice) this.balloons.push(rec);
    this.recordBalloonTrial(rec);
    this.pumpTarget.visible = false;
    this.cashTarget.visible = false;
    await this.wait(BALLOON_ITI_MS);
    this.balloonMesh.visible = false;
    this.setFeedback('', 'neutral');
  }

  private balloonDistance(): number {
    if (this.currentBlock !== 'bart_approach') return BALLOON_DISTANCE;
    const f = this.pumps / MAX_PUMPS;
    return APPROACH_FAR + (APPROACH_NEAR - APPROACH_FAR) * f;
  }

  private angularSizeDeg(): number {
    if (this.currentBlock === 'bart_approach') return APPROACH_ANGULAR_DEG;
    const d = BALLOON_MIN_D + (BALLOON_MAX_D - BALLOON_MIN_D) * (this.pumps / MAX_PUMPS);
    return (2 * Math.atan(d / 2 / BALLOON_DISTANCE) * 180) / Math.PI;
  }

  private updateBalloon(): void {
    const dist = this.balloonDistance();
    // In the approach block the physical diameter is recomputed at every
    // distance so the angular size stays exactly 12 degrees. Without this the
    // "approach" would collapse into a size manipulation and measure nothing
    // a flat screen could not.
    const diameter = this.currentBlock === 'bart_approach'
      ? 2 * dist * Math.tan((APPROACH_ANGULAR_DEG * Math.PI) / 360)
      : BALLOON_MIN_D + (BALLOON_MAX_D - BALLOON_MIN_D) * (this.pumps / MAX_PUMPS);
    this.balloonMesh.scale.setScalar(diameter);
    this.anchor.offset(0, -0.02, dist, this.balloonMesh.position);
    const t = this.ctx.theme;
    const mat = this.balloonMesh.material as THREE.MeshBasicMaterial;
    mat.color.set(t.accent2).lerp(new THREE.Color(t.bad), this.pumps / MAX_PUMPS * 0.6);
    this.bankPanel.invalidate();
  }

  private setBalloonControls(): void {
    this.ctx.mobileControls?.set({
      look: 'off',
      hint: 'Meddig mész el? A beváltott pont a tiéd.',
      buttons: [
        { id: 'pump', label: 'PUMPA', sub: `+${PUMP_VALUE} pont`, variant: 'primary', onTap: (t) => this.choose('pump', t) },
        { id: 'cash', label: 'BEVÁLTÁS', sub: 'a tét a bankba', variant: 'accent2', onTap: (t) => this.choose('cash', t) },
      ],
    });
  }

  /* ------------------------------------------------------------- cards */

  private resetDecks(): void {
    this.deckQueue.clear();
    this.deckDrawn.clear();
    for (const d of DECKS) {
      this.deckQueue.set(d, this.newCycle(d, this.ctx.rng));
      this.deckDrawn.set(d, 0);
    }
  }

  /**
   * One ten-card cycle. The order of the losses inside a cycle is shuffled,
   * but the net balance of the ten cards is fixed at -250 / -250 / +250 / +250,
   * which is what makes A and B bad decks and C and D good ones.
   */
  private newCycle(deck: Deck, rng: Rng): { gain: number; loss: number }[] {
    const gain = DECK_GAIN[deck];
    const losses = DECK_LOSSES[deck];
    const slots: number[] = new Array(10).fill(0);
    const positions = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, losses.length);
    positions.forEach((p, i) => { slots[p] = losses[i]!; });
    return slots.map((loss) => ({ gain, loss }));
  }

  private drawCard(deck: Deck): { gain: number; loss: number } {
    let q = this.deckQueue.get(deck);
    if (!q || q.length === 0) {
      q = this.newCycle(deck, this.ctx.rng);
      this.deckQueue.set(deck, q);
    }
    return q.shift()!;
  }

  private async runCards(count: number): Promise<void> {
    const ctx = this.ctx;
    this.balloonMesh.visible = false;
    for (const m of this.deckMeshes) m.visible = true;
    this.setCardControls();
    this.lastDeck = null;
    let afterLoss = false;

    for (let trial = 1; trial <= count; trial++) {
      if (this.aborted) return;
      this.setFeedback(`${trial}. / ${count}`, 'neutral');
      const choice = await this.awaitChoice(this.deckMeshes);
      if (this.aborted) return;
      const slot = Number(choice.replace('slot', ''));
      const deck = this.deckBySlot[slot]!;
      const card = this.drawCard(deck);
      const net = card.gain - card.loss;
      this.bank += net;
      const d = this.lastDecision;
      const rec: Card = {
        trial, deck, slot, gain: card.gain, loss: card.loss,
        rtMs: d.rtMs, switched: this.lastDeck !== null && this.lastDeck !== deck,
        afterLoss,
      };
      if (!this.practice) this.cards.push(rec);
      this.lastDeck = deck;
      afterLoss = card.loss > 0;

      ctx.recorder.event('card_choice', {
        trial, deck, slot, gain: card.gain, loss: card.loss, net,
        bank: this.bank, rtMs: +d.rtMs.toFixed(1), switched: rec.switched,
        practice: this.practice,
      });
      this.recordCardTrial(rec);

      this.setFeedback(
        card.loss > 0 ? `+${card.gain}  −${card.loss}` : `+${card.gain}`,
        card.loss > card.gain ? 'bad' : 'good'
      );
      if (card.loss > card.gain) ctx.audio.error(); else ctx.audio.ok();
      this.bankPanel.invalidate();
      await this.wait(FEEDBACK_MS);
      this.setFeedback('', 'neutral');
      await this.wait(CARD_ITI_MS);
    }
    for (const m of this.deckMeshes) m.visible = false;
  }

  private setCardControls(): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    mc.set({
      look: 'off',
      hint: 'Válassz paklit. Van, amelyik többet hoz, mint amennyit visz.',
      // Four equal choices, so four buttons with direct callbacks - there is
      // no natural set of four abstract actions, and a dial answers a
      // direction question, which this is not.
      buttons: [0, 1, 2, 3].map((i) => ({
        id: `slot${i}`, label: String(i + 1), variant: 'ghost' as const,
        onTap: (t: number) => this.choose(`slot${i}`, t),
      })),
    });
  }

  /* ------------------------------------------------------------ choice */

  private lastDecision = { rtMs: NaN, hesitationMs: NaN, reversals: 0, pathMm: 0 };

  private awaitChoice(targets: THREE.Object3D[]): Promise<string> {
    const startT = this.ctx.engine.clock.frameTime;
    this.picker.setHoverTargets(targets);
    return new Promise<string>((resolve) => {
      this.decision = { resolve, targets, startT, track: new MotionTrack() };
    });
  }

  private choose(choice: string, t: number): void {
    const d = this.decision;
    if (!d) return;
    this.decision = null;
    this.picker.setHoverTargets([]);
    this.lastDecision = {
      rtMs: t - d.startT,
      ...this.analyseReach(d.track),
    };
    d.resolve(choice);
  }

  /**
   * Hesitation and reversals from the pointer's path across the target plane.
   *
   * The same computation serves a controller ray and a mouse ray, because both
   * are rays: what is tracked is where the ray crosses the plane the two
   * targets sit in. On a phone there is no such path at all - the first
   * contact IS the answer - so the measure is absent there rather than zero.
   */
  private analyseReach(track: MotionTrack): { hesitationMs: number; reversals: number; pathMm: number } {
    if (this.ctx.platform === 'mobile' || track.samples < 6) {
      return { hesitationMs: NaN, reversals: 0, pathMm: 0 };
    }
    const axis = this.cashTarget.position.clone().sub(this.pumpTarget.position).normalize();
    const proj = track.project(axis);
    const times = track.times();
    let onset = NaN;
    const start = proj[0]!;
    for (let i = 1; i < proj.length; i++) {
      if (Math.abs(proj[i]! - start) > 0.03) { onset = times[i]!; break; }
    }
    // Zigzag counting: a reversal needs 10 cm of travel one way followed by
    // 10 cm back, which is a third of the target separation - enough that a
    // hand tremor or a ray jitter cannot produce one.
    const MIN_RUN = 0.10;
    let reversals = 0;
    let dir = 0;
    let extreme = proj[0]!;
    for (const v of proj) {
      if (dir === 0) {
        if (Math.abs(v - extreme) >= MIN_RUN) { dir = Math.sign(v - extreme); extreme = v; }
      } else if (Math.sign(v - extreme) === dir) {
        extreme = v;
      } else if (Math.abs(v - extreme) >= MIN_RUN) {
        reversals++;
        dir = -dir;
        extreme = v;
      }
    }
    const end = times[times.length - 1]!;
    return {
      hesitationMs: Number.isFinite(onset) ? end - onset : NaN,
      reversals,
      pathMm: track.pathLengthMm(),
    };
  }

  private onAction(e: ActionEvent): void {
    if (!e.down || e.action !== 'PRIMARY') return;
    const d = this.decision;
    if (!d) return;
    // On a phone the answer comes from the control bar, never from a stray tap
    // on the scene: the targets are small and a mis-tap would be a decision.
    if (this.ctx.mobileControls) return;
    const ray = this.ctx.engine.input.primaryRay();
    if (!ray) return;
    const hit = this.picker.pick(ray, d.targets, 6);
    if (!hit) return;
    const choice = hit.object.userData.choice as string | undefined;
    if (choice) this.choose(choice, e.t);
  }

  /* ------------------------------------------------------------- frame */

  update(_dt: number, ctx: ModuleContext): void {
    const d = this.decision;
    if (!d || !this.plane || ctx.platform === 'mobile') return;
    const ray = ctx.engine.input.primaryRay();
    if (!ray) return;
    const p = new THREE.Vector3();
    if (!ray.intersectPlane(this.plane, p)) return;
    d.track.push(ctx.engine.clock.frameTime, p);
  }

  /* ------------------------------------------------------------ trials */

  private recordBalloonTrial(b: Balloon): void {
    if (this.practice) return;
    this.trialNumber++;
    const rec: TrialRecord = {
      trialNumber: this.trialNumber,
      block: b.blockId,
      stimulus: {
        blockId: b.blockId, index: b.index, explodeAt: b.explodeAt,
        maxPumps: MAX_PUMPS, distanceM: +this.balloonDistance().toFixed(3),
        angularSizeDeg: +this.angularSizeDeg().toFixed(2),
      },
      response: {
        pumps: b.pumps, cashedOut: !b.exploded, earned: b.earned,
        rtMsFirst: r(b.firstRtMs), reachPathMm: Math.round(b.pathMm),
        reachReversals: b.reversals,
        hesitationMs: b.hesitationMs.length ? Math.round(median(b.hesitationMs)) : null,
      },
      // There is no correct answer in this module, and a `true` here would
      // imply the system has an opinion about how far to go. It does not.
      correct: null,
      outcome: b.exploded ? 'miss' : 'hit',
      reactionTimeMs: Number.isFinite(b.firstRtMs) ? b.firstRtMs : null,
      startedAt: 0,
      endedAt: 0,
    };
    this.ctx.recorder.trial(rec);
  }

  private recordCardTrial(c: Card): void {
    if (this.practice) return;
    this.trialNumber++;
    this.ctx.recorder.trial({
      trialNumber: this.trialNumber,
      block: 'cards',
      stimulus: { trial: c.trial, slot: c.slot, deck: c.deck, afterLoss: c.afterLoss },
      response: { deck: c.deck, gain: c.gain, loss: c.loss, net: c.gain - c.loss, switched: c.switched },
      correct: null,
      outcome: 'hit',
      reactionTimeMs: r(c.rtMs),
      startedAt: 0,
      endedAt: 0,
    });
  }

  /* ------------------------------------------------------------ status */

  private setFeedback(text: string, tone: 'good' | 'bad' | 'neutral'): void {
    this.feedback = text;
    this.feedbackTone = tone;
    this.bankPanel.invalidate();
  }

  private drawBank(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.9), 14);
    ui.text('BANK', 24, 32, {
      size: 18, color: t.textMuted, weight: '700', font: t.fontMono, letterSpacing: '0.16em',
    });
    ui.text(String(Math.round(this.bank)), 24, 74, {
      size: 44, color: t.text, weight: '700', font: t.fontDisplay,
    });
    if (this.currentBlock !== 'cards') {
      ui.text('TÉT', ui.w - 24, 32, {
        size: 18, color: t.textMuted, weight: '700', font: t.fontMono,
        align: 'right', letterSpacing: '0.16em',
      });
      ui.text(String(Math.round(this.stake)), ui.w - 24, 74, {
        size: 44, color: this.stake > 0 ? t.accent : t.textMuted,
        weight: '700', font: t.fontDisplay, align: 'right',
      });
    }
    if (this.feedback) {
      ui.text(this.feedback, ui.w / 2, ui.h - 20, {
        size: 24, align: 'center', weight: '600',
        color: this.feedbackTone === 'good' ? t.ok : this.feedbackTone === 'bad' ? t.bad : t.textMuted,
      });
    }
  }

  private hideAll(): void {
    this.balloonMesh.visible = false;
    this.pumpTarget.visible = false;
    this.cashTarget.visible = false;
    for (const m of this.deckMeshes) m.visible = false;
    this.picker.setHoverTargets([]);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ------------------------------------------------------------ finish */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    /** The BART standard: only balloons that did NOT burst, because a burst
     *  truncates the pump count by chance rather than by decision. */
    const adjusted = (blockId: BlockId): number => {
      const xs = this.balloons.filter((b) => b.blockId === blockId && !b.exploded).map((b) => b.pumps);
      return xs.length ? mean(xs) : NaN;
    };
    const sizeIndex = adjusted('bart_size');
    const approachIndex = isVr ? adjusted('bart_approach') : NaN;
    const allAdjusted = this.balloons.filter((b) => !b.exploded).map((b) => b.pumps);
    const adjustedIndex = allAdjusted.length ? mean(allAdjusted) : NaN;
    const calibrationError = Number.isFinite(adjustedIndex)
      ? Math.abs(adjustedIndex - EV_OPTIMAL_PUMPS) : NaN;
    const approachShift = Number.isFinite(sizeIndex) && Number.isFinite(approachIndex)
      ? approachIndex - sizeIndex : NaN;

    // Loss chasing: what the balloon AFTER a burst looked like, against the
    // balloon after a successful cash-out.
    const afterExplode: number[] = [];
    const afterCash: number[] = [];
    for (let i = 1; i < this.balloons.length; i++) {
      const prev = this.balloons[i - 1]!;
      const cur = this.balloons[i]!;
      if (prev.blockId !== cur.blockId) continue;
      (prev.exploded ? afterExplode : afterCash).push(cur.pumps);
    }
    const lossChasing = afterExplode.length && afterCash.length
      ? mean(afterExplode) - mean(afterCash) : NaN;

    const rtAfterLoss = this.cards.filter((c) => c.afterLoss).map((c) => c.rtMs);
    const rtAfterGain = this.cards.filter((c) => !c.afterLoss).map((c) => c.rtMs);
    const postLossSlowing = rtAfterLoss.length > 2 && rtAfterGain.length > 2
      ? median(rtAfterLoss) - median(rtAfterGain) : NaN;

    /* --------------------------------------------------- card learning */

    const netByBlock: number[] = [];
    for (let b = 0; b * CARD_BLOCK < this.cards.length; b++) {
      const slice = this.cards.slice(b * CARD_BLOCK, (b + 1) * CARD_BLOCK);
      if (slice.length < CARD_BLOCK / 2) break;
      const good = slice.filter((c) => c.deck === 'C' || c.deck === 'D').length;
      netByBlock.push(good - (slice.length - good));
    }
    const learningSlope = netByBlock.length >= 2
      ? slope(netByBlock.map((_, i) => i), netByBlock) : NaN;
    const netFinal = netByBlock.length ? netByBlock[netByBlock.length - 1]! : NaN;

    const last = this.cards.slice(-CARD_BLOCK);
    const switches = last.filter((c, i) => i > 0 && c.deck !== last[i - 1]!.deck).length;
    const consistency = last.length > 1 ? 1 - switches / (last.length - 1) : NaN;

    const countDeck = (d: Deck) => this.cards.filter((c) => c.deck === d).length;
    const frequencySensitivity = this.cards.length
      ? (countDeck('A') + countDeck('C')) - (countDeck('B') + countDeck('D')) : NaN;

    /* ---------------------------------------------------------- reach */

    const hes = this.balloons.flatMap((b) => b.hesitationMs).filter(Number.isFinite);
    const reversalDecisions = this.balloons.reduce((a, b) => a + b.decisionRts.length, 0);
    const reversals = this.balloons.reduce((a, b) => a + b.reversals, 0);
    const hesitation = hes.length >= 3 ? median(hes) - Math.min(...hes) : NaN;
    const reversalRate = reversalDecisions > 0 ? reversals / reversalDecisions : NaN;

    const explosions = this.balloons.filter((b) => b.exploded).length;

    const M: [string, number, string, string?][] = [
      ['adjusted_risk_index', adjustedIndex, 'pumps', 'overall'],
      ['risk_calibration_error', calibrationError, 'pumps', 'overall'],
      ['adjusted_risk_index_size', sizeIndex, 'pumps', 'bart_size'],
      ['explosions', explosions, 'count', 'overall'],
      ['total_earned', this.bank, 'points', 'overall'],
      ['loss_chasing_index', lossChasing, 'pumps', 'overall'],
      ['post_loss_slowing_ms', postLossSlowing, 'ms', 'cards'],
      ['learning_slope', learningSlope, 'net/block', 'cards'],
      ['net_score_final', netFinal, 'net', 'cards'],
      ['decision_consistency', consistency, 'ratio', 'cards'],
      ['deck_frequency_sensitivity', frequencySensitivity, 'count', 'cards'],
    ];
    if (isVr) {
      M.push(['adjusted_risk_index_approach', approachIndex, 'pumps', 'bart_approach']);
      M.push(['approach_risk_shift', approachShift, 'pumps', 'overall']);
      M.push(['reach_hesitation_ms', hesitation, 'ms', 'overall']);
      M.push(['reach_reversal_rate', reversalRate, 'ratio', 'overall']);
    } else if (ctx.platform === 'desktop') {
      // Same computation, deliberately different name: a mouse path and a
      // reach are not the same quantity and must not share a norm group.
      M.push(['pointer_hesitation_ms', hesitation, 'ms', 'overall']);
      M.push(['pointer_reversal_rate', reversalRate, 'ratio', 'overall']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* --------------------------------------------------------- scores */

    // Symmetric on purpose: stopping at 4 and stopping at 12 are equally far
    // from what the odds justify, and the module has no opinion about which
    // direction is better.
    const calibration = normaliseSoft(Number.isFinite(calibrationError) ? calibrationError : 8, 1.5, 6.0);
    const learning = normaliseSoft(Number.isFinite(learningSlope) ? learningSlope : 0, 9, 0);
    const consistencyScore = normaliseSoft(Number.isFinite(consistency) ? consistency : 0.3, 0.80, 0.30);
    const lossControl = normaliseSoft(
      Number.isFinite(lossChasing) ? Math.abs(lossChasing) : 4.0, 0.8, 4.0);
    const cueIndependence = normaliseSoft(
      Number.isFinite(approachShift) ? Math.abs(approachShift) : 3.5, 0.6, 3.5);

    const components = isVr
      ? [
          { key: 'risk_calibration', value: calibration, weight: 0.26 },
          { key: 'feedback_learning', value: learning, weight: 0.26 },
          { key: 'loss_control', value: lossControl, weight: 0.19 },
          { key: 'decision_consistency', value: consistencyScore, weight: 0.17 },
          { key: 'cue_independence', value: cueIndependence, weight: 0.12 },
        ]
      : [
          { key: 'risk_calibration', value: calibration, weight: 0.30 },
          { key: 'feedback_learning', value: learning, weight: 0.30 },
          { key: 'loss_control', value: lossControl, weight: 0.21 },
          { key: 'decision_consistency', value: consistencyScore, weight: 0.19 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const pumps = (v: number, signed = false) => {
      if (!Number.isFinite(v)) return '—';
      return signed
        ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pumpa`
        : `${v.toFixed(1)} pumpa`;
    };

    const headline: ModuleResult['headline'] = [
      {
        label: 'Megfigyelt megállási pont', value: pumps(adjustedIndex),
        hint: 'a fel nem robbant léggömbök átlaga',
      },
      {
        label: 'Illeszkedés a valószínűségekhez',
        value: Number.isFinite(adjustedIndex)
          ? `${Math.abs(adjustedIndex - EV_OPTIMAL_PUMPS).toFixed(1)} pumpával ${adjustedIndex < EV_OPTIMAL_PUMPS ? 'óvatosabb' : 'merészebb'}`
          : '—',
        hint: `a feladat szerinti optimum ${EV_OPTIMAL_PUMPS} pumpa`,
      },
      {
        label: 'Tanulás a visszajelzésből',
        value: Number.isFinite(learningSlope) ? `${learningSlope >= 0 ? '+' : '−'}${Math.abs(learningSlope).toFixed(1)} / blokk` : '—',
        hint: Number.isFinite(learningSlope)
          ? (learningSlope > 4 ? 'a mérés végére elkülönítetted a paklikat' : 'a paklik közti különbség nem állt össze')
          : undefined,
      },
      {
        label: 'Veszteség után', value: pumps(lossChasing, true),
        hint: !Number.isFinite(lossChasing) ? undefined
          : Math.abs(lossChasing) < 0.8 ? 'nagyjából ugyanúgy döntöttél'
          : lossChasing > 0 ? 'a veszteség után nagyobbat kockáztattál' : 'a veszteség után visszahúzódtál',
      },
      {
        label: 'Döntési állandóság',
        value: Number.isFinite(consistency) ? consistency.toFixed(2) : '—',
        hint: 'az utolsó húsz kártyán',
      },
    ];
    headline.push(
      isVr
        ? {
            label: 'Közeledő tét hatása', value: pumps(approachShift, true),
            hint: !Number.isFinite(approachShift) ? undefined
              : Math.abs(approachShift) < 0.6 ? 'ugyanazok az esélyek, ugyanaz a döntés'
              : 'ugyanaz a valószínűség, más döntés — a látvány számított',
          }
        : {
            label: 'Közeledő tét hatása', value: '—',
            hint: 'ehhez VR kell: sík képernyőn a közeledést semmi nem hordozza',
          }
    );

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        spatialWeightsApplied: isVr,
        behaviouralOnly: true,
        evOptimalPumps: EV_OPTIMAL_PUMPS,
        adjustedRiskIndex: r(adjustedIndex, 2),
        calibrationError: r(calibrationError, 2),
        bySize: r(sizeIndex, 2),
        byApproach: isVr ? r(approachIndex, 2) : null,
        approachRiskShift: isVr ? r(approachShift, 2) : null,
        explosions,
        balloons: this.balloons.length,
        totalEarned: Math.round(this.bank),
        lossChasingIndex: r(lossChasing, 2),
        postLossSlowingMs: r(postLossSlowing),
        cards: {
          n: this.cards.length,
          netByBlock,
          learningSlope: r(learningSlope, 2),
          netFinal: r(netFinal, 0),
          consistency: r(consistency, 3),
          frequencySensitivity: r(frequencySensitivity, 0),
          deckCounts: Object.fromEntries(DECKS.map((d) => [d, countDeck(d)])),
        },
        reach: ctx.platform === 'mobile' ? null : {
          name: isVr ? 'reach' : 'pointer',
          hesitationMs: r(hesitation),
          reversalRate: r(reversalRate, 3),
        },
        // A repeat participant already knows the deck structure, and the
        // learning slope stops meaning anything the second time round.
        learningSlopeInterpretable: this.cards.length >= CARD_BLOCK * 2,
      },
      axisScores: {
        executive: Math.round((learning + consistencyScore) / 2),
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.decision?.resolve('cash');
    this.decision = null;
  }

  dispose(ctx: ModuleContext): void {
    this.aborted = true;
    this.offAction?.();
    this.picker.dispose();
    ctx.panels.remove(this.bankPanel);
    this.bankPanel.dispose();
    disposeTree(ctx.root);
  }
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
