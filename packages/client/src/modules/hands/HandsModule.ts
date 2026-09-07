import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, median, clamp, normaliseSoft, opsScore,
  type ModuleManifest, type TrialRecord,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { BodyAnchor } from '../shared/anchor.js';
import {
  GrabSystem, MotionTrack, buildWirePath, wireProbe,
  type Grabbable, type Socket, type WirePath,
} from './manipulation.js';

/**
 * MODULE 16 - HANDS
 * Fine manual dexterity. VR only, and honestly so.
 *
 * Every measure here comes out of where the hand actually was, in three
 * dimensions, over time: how far off the hole a peg was let go, how smooth the
 * transport was, how much the hand shook while it held still over the target,
 * whether two hands could work at once. A mouse has none of that. A finger on
 * glass has none of that. So the module does not ship a flat version at all -
 * a badly mapped measurement is worse than a missing one, because it still
 * looks like a number.
 *
 * The board sits in the peripersonal space, anchored to where the participant
 * actually stands, tilted like a table so that near and far holes differ in
 * distance by 11 cm. That difference is carried by disparity and parallax
 * alone, which is what makes placement a depth judgement rather than a
 * pointing task.
 */

type BlockId = 'pegs' | 'grooved' | 'wire' | 'assembly';
type Hand = 'left' | 'right';

const PEG_SECONDS = 30_000;
const GROOVED_SECONDS = 60_000;
const ASSEMBLY_SECONDS = 60_000;
const PRACTICE_PEG_MS = 10_000;
const PRACTICE_MS = 15_000;

const BOARD_FORWARD = 0.46;
const BOARD_DOWN = 0.34;
const BOARD_TILT_DEG = 45;
const HOLE_SPACING = 0.030;
const HOLES_PER_COLUMN = 10;
const COLUMN_U = 0.075;
const TRAY_U = 0.175;
const HOLE_TOLERANCE = 0.009;
const PEG_DIAMETER = 0.010;
const PEG_LENGTH = 0.046;
const GRAB_RADIUS = 0.050;
const GROOVED_ANGLE_TOL = (12 * Math.PI) / 180;
const ASSEMBLY_ANGLE_TOL = (15 * Math.PI) / 180;

const RING_INNER = 0.022;
const WIRE_RADIUS = 0.006;
const CONTACT_THRESHOLD = 0.016;
const WIRE_ARC = 0.16;
const WIRE_AMPLITUDE = 0.09;
const WIRE_PATHS = 3;
const WIRE_TIMEOUT_MS = 40_000;

/** The analytic value of the smoothness measure for a minimum-jerk reach. */
export const MIN_JERK_REFERENCE = Math.sqrt(360);

interface Placement {
  block: string;
  hand: Hand;
  socketIndex: number;
  ok: boolean;
  errorMm: number;
  angleErrorDeg: number | null;
  reachMs: number;
  graspMs: number;
  transportMs: number;
  placeMs: number;
  pathMm: number;
  straightMm: number;
  jerk: number;
  tremorMm: number;
  holeDistanceM: number;
}

interface WireRun {
  index: number;
  completed: boolean;
  durationMs: number;
  contacts: number;
  contactMs: number;
  lateralMs: number;
  depthMs: number;
  lateralContactMs: number;
  depthContactMs: number;
  lateralContacts: number;
  depthContacts: number;
  pathLengthM: number;
}

interface InFlight {
  hand: Hand;
  g: Grabbable;
  grabT: number;
  reachMs: number;
  grabPos: THREE.Vector3;
  movedT: number | null;
  nearT: number | null;
  transport: MotionTrack;
  place: MotionTrack;
}

export class HandsModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.HANDS!;

  readonly blocks: BlockDescriptor[] = [

    {
      id: 'pegs',
      title: 'PÁLCIKÁK',
      instruction:
        'Előtted egy döntött tábla: két oldalán tálcák pálcikákkal, középen furatok. Vedd fel a pálcikát a ' +
        'tálcáról — nyúlj oda a kontrollerrel, és tartsd lenyomva a ravaszt —, vidd a kivilágított furat fölé, ' +
        'és ott engedd el a ravaszt. Előbb az egyik kezeddel, aztán a másikkal, végül mindkettővel egyszerre. ' +
        'Ne siess jobban, mint amennyire pontos tudsz maradni.',
      controlHint: '',
      trials: 3,
      practiceTrials: 3,
      unitLabel: 'kézbeosztás',
    },
    {
      id: 'grooved',
      title: 'KULCSOS PÁLCIKÁK',
      instruction:
        'Ugyanez, de a pálcika oldalán bordázat van, a furatban pedig horony. Forgasd el a csuklóddal úgy, ' +
        'hogy a bordázat a horonyba illeszkedjen — másképp nem fér be.',
      controlHint: '',
      trials: 1,
      practiceTrials: 1,
      unitLabel: 'menet',
    },
    {
      id: 'wire',
      title: 'PÁLYA',
      instruction:
        'Egy hajlított drót lebeg előtted, a bal végén egy gyűrűvel. Fogd meg a gyűrűt (ravasz lenyomva), és ' +
        'vidd végig a dróton a jobb végéig úgy, hogy a gyűrű ne érjen a dróthoz. Ha hozzáér, hangot ad — nem ' +
        'kell újrakezdened, csak menj tovább.',
      controlHint: '',
      trials: WIRE_PATHS,
      practiceTrials: 1,
      unitLabel: 'pálya',
    },
    {
      id: 'assembly',
      title: 'ÖSSZESZERELÉS',
      instruction:
        'Négy alkatrészt kell egymásra tenned a középső tengelyen: tengely, alátét, gallér, alátét — ebben ' +
        'a sorrendben, mindig váltott kézzel (tengely jobb, alátét bal, gallér jobb, alátét bal). A két kezed ' +
        'párhuzamosan dolgozhat: amíg az egyik letesz, a másik már veheti a következőt.',
      controlHint: '',
      trials: 1,
      practiceTrials: 1,
      unitLabel: 'menet',
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private anchor!: BodyAnchor;
  private grab!: GrabSystem;
  private statusPanel!: Panel;
  private statusText = '';

  private board!: THREE.Mesh;
  private pegs: Grabbable[] = [];
  private sockets: Socket[] = [];
  private ring!: Grabbable;
  private wireMesh: THREE.Mesh | null = null;
  private wirePath: WirePath | null = null;
  private assemblyParts: Grabbable[] = [];
  private assemblySocket: Socket | null = null;
  private assemblyPost!: THREE.Mesh;

  private bRight = new THREE.Vector3(1, 0, 0);
  private bUp = new THREE.Vector3(0, 1, 0);
  private bNormal = new THREE.Vector3(0, 1, 0);
  private boardCentre = new THREE.Vector3();

  private currentBlock: BlockId = 'pegs';
  private subBlock = '';
  private practice = false;
  private aborted = false;
  private dominant: Hand = 'right';

  private placements: Placement[] = [];
  private wireRuns: WireRun[] = [];
  private assemblyPartsPlaced: { part: string; hand: Hand; expected: Hand; rtMs: number }[] = [];
  private assemblies = 0;
  private drops = 0;
  private trialNumber = 0;

  private inFlight = new Map<Hand, InFlight>();
  private lastReleaseT = new Map<Hand, number>();
  private phase: { end: number; resolve: () => void } | null = null;
  private phaseStart = 0;
  private assemblyStep = 0;

  private wire: {
    run: WireRun; startT: number; started: boolean; touching: boolean;
    touchStart: number; lastS: number; resolve: () => void;
  } | null = null;

  private offAction: (() => void) | null = null;
  private offClick: (() => void) | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    ctx.recorder.setMotionHz(60);
    this.anchor = new BodyAnchor(ctx);
    this.anchor.capture();

    const input = ctx.engine.input;
    this.grab = new GrabSystem(
      (h) => input.gripSpace(h),
      (h) => input.isPressed(h),
      GRAB_RADIUS,
      {
        onGrab: (h, g, t, d) => this.onGrab(h, g, t, d),
        onRelease: (h, g, t, r0) => this.onRelease(h, g, t, r0),
      }
    );

    this.buildBoard();
    this.buildWire();
    this.buildAssembly();

    this.statusPanel = new Panel({
      width: 0.9, height: 0.15, pxPerMeter: 660, theme: ctx.theme,
      frame: false, name: 'hands-status', superSample: 2,
    });
    this.statusPanel.setDraw((ui) => this.drawStatus(ui));
    this.statusPanel.group.visible = false;
    ctx.root.add(this.statusPanel.group);
    ctx.panels.add(this.statusPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint();

    ctx.recorder.event('hands_setup', {
      platform: ctx.platform,
      inputMode: 'controller',
      boardForwardM: BOARD_FORWARD,
      boardDownM: BOARD_DOWN,
      boardTiltDeg: BOARD_TILT_DEG,
      pegDiameterMm: PEG_DIAMETER * 1000,
      holeToleranceMm: HOLE_TOLERANCE * 1000,
      holeSpacingMm: HOLE_SPACING * 1000,
      holesPerColumn: HOLES_PER_COLUMN,
      grabRadiusMm: GRAB_RADIUS * 1000,
      groovedAngleToleranceDeg: 12,
      ringInnerMm: RING_INNER * 1000,
      wireRadiusMm: WIRE_RADIUS * 1000,
      contactThresholdMm: CONTACT_THRESHOLD * 1000,
      wireArcM: WIRE_ARC,
      minJerkReference: +MIN_JERK_REFERENCE.toFixed(2),
      quantisationMs: +(ctx.engine.clock.frameInterval || 11.1).toFixed(1),
    });
  }


  private controlHint(): string {
    return 'RAVASZ lenyomva: fogás · engedd el a furat (vagy a tengely) fölött';
  }

  /** A direction in the participant's own frame, in world space. */
  private dir(right: number, up: number, forward: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.anchor.offset(right, up, forward, target);
    return target.sub(this.anchor.origin);
  }

  /** A point on the tilted board plane, in board coordinates. */
  private boardPoint(u: number, v: number, lift = 0, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.boardCentre)
      .addScaledVector(this.bRight, u)
      .addScaledVector(this.bUp, v)
      .addScaledVector(this.bNormal, lift);
  }

  private buildBoard(): void {
    const ctx = this.ctx;
    const t = ctx.theme;
    const tilt = (BOARD_TILT_DEG * Math.PI) / 180;

    this.anchor.offset(0, -BOARD_DOWN, BOARD_FORWARD, this.boardCentre);
    this.dir(1, 0, 0, this.bRight).normalize();
    // The board is a table tilted towards the participant: its normal leans
    // back out of the horizontal, and "up the board" leans away from them.
    this.dir(0, Math.cos(tilt), -Math.sin(tilt), this.bNormal).normalize();
    this.dir(0, Math.sin(tilt), Math.cos(tilt), this.bUp).normalize();

    this.board = makePrimitive({
      kind: 'box', color: t.surfaceAlt, size: [0.42, 0.012, 0.34], unlit: true, opacity: 0.95,
    });
    this.board.position.copy(this.boardCentre);
    this.board.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.bNormal);
    ctx.root.add(this.board);

    const v0 = -((HOLES_PER_COLUMN - 1) / 2) * HOLE_SPACING;
    let index = 0;
    for (const [side, u] of [['left', -COLUMN_U], ['right', COLUMN_U]] as [string, number][]) {
      for (let i = 0; i < HOLES_PER_COLUMN; i++) {
        const marker = makePrimitive({
          kind: 'torus', color: t.textMuted, unlit: true, size: 0.020, opacity: 0.45,
        });
        marker.position.copy(this.boardPoint(u, v0 + i * HOLE_SPACING, 0.002));
        marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.bNormal);
        ctx.root.add(marker);
        this.sockets.push({
          id: `${side}-${i}`,
          index: index++,
          position: this.boardPoint(u, v0 + i * HOLE_SPACING, PEG_LENGTH * 0.4),
          axis: this.bNormal.clone(),
          toleranceM: HOLE_TOLERANCE,
          keyAngleRad: null,
          angleToleranceRad: GROOVED_ANGLE_TOL,
          filled: false,
          accepts: 'peg',
          marker,
        });
      }
    }

    // One tray per side, so each hand has its own supply and the bimanual
    // sub-block does not turn into a contest for the same pegs.
    for (const [side, u] of [['left', -TRAY_U], ['right', TRAY_U]] as [string, number][]) {
      for (let i = 0; i < HOLES_PER_COLUMN; i++) {
        const peg = new THREE.Group();
        const body = makePrimitive({
          kind: 'cylinder', color: t.accent2, unlit: true,
          size: [PEG_DIAMETER, PEG_LENGTH, PEG_DIAMETER],
        });
        const key = makePrimitive({
          kind: 'box', color: t.accent2, unlit: true, size: [0.003, 0.020, 0.003],
        });
        key.position.set(PEG_DIAMETER * 0.6, 0, 0);
        key.visible = false;
        key.name = 'key';
        peg.add(body, key);
        const home = this.boardPoint(u, v0 + i * HOLE_SPACING, PEG_LENGTH * 0.4);
        peg.position.copy(home);
        const homeQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.bNormal);
        peg.quaternion.copy(homeQuat);
        ctx.root.add(peg);
        this.pegs.push({
          id: `peg-${side}-${i}`, object: peg, home: home.clone(),
          homeQuat: homeQuat.clone(), keyed: false, kind: 'peg',
        });
      }
    }
  }

  private buildWire(): void {
    const ctx = this.ctx;
    const t = ctx.theme;
    const origin = this.anchor.offset(0, -0.20, 0.50, new THREE.Vector3());
    this.wirePath = buildWirePath(
      origin,
      this.dir(1, 0, 0).normalize(),
      this.dir(0, 1, 0).normalize(),
      this.dir(0, 0, 1).normalize(),
      WIRE_ARC, WIRE_AMPLITUDE, 0
    );
    // A tube through the sampled polyline rather than a chain of cylinders:
    // still procedural, no asset, and it does not read as segmented at the
    // 6 mm radius the contact rule is defined against.
    const curve = new THREE.CatmullRomCurve3(this.wirePath.points);
    const geo = new THREE.TubeGeometry(curve, 160, WIRE_RADIUS, 10, false);
    this.wireMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: t.textMuted }));
    this.wireMesh.visible = false;
    ctx.root.add(this.wireMesh);

    const ringObj = makePrimitive({ kind: 'torus', color: t.accent, unlit: true, size: (RING_INNER + 0.005) * 2 });
    const home = this.wirePath.points[0]!.clone();
    ringObj.position.copy(home);
    ringObj.visible = false;
    ctx.root.add(ringObj);
    this.ring = {
      id: 'ring', object: ringObj, home, homeQuat: ringObj.quaternion.clone(),
      keyed: false, kind: 'ring',
    };
  }

  private buildAssembly(): void {
    const ctx = this.ctx;
    const t = ctx.theme;
    this.assemblyPost = makePrimitive({
      kind: 'cylinder', color: t.textMuted, unlit: true, size: [0.014, 0.006, 0.014], opacity: 0.6,
    });
    this.assemblyPost.position.copy(this.boardPoint(0, 0, 0.004));
    this.assemblyPost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.bNormal);
    this.assemblyPost.visible = false;
    ctx.root.add(this.assemblyPost);

    const spec: [string, Hand, number][] = [
      ['pin', 'right', 0], ['washer', 'left', 1], ['collar', 'right', 2], ['washer', 'left', 3],
    ];
    for (const [kind, hand, i] of spec) {
      const obj = kind === 'pin'
        ? makePrimitive({ kind: 'cylinder', color: t.accent2, unlit: true, size: [0.008, 0.060, 0.008] })
        : kind === 'washer'
          ? makePrimitive({ kind: 'torus', color: t.text, unlit: true, size: 0.020 })
          : makePrimitive({ kind: 'cylinder', color: t.accent, unlit: true, size: [0.026, 0.014, 0.026] });
      const u = hand === 'right' ? TRAY_U : -TRAY_U;
      const home = this.boardPoint(u, -0.06 + (i % 2) * 0.07, 0.03);
      obj.position.copy(home);
      obj.visible = false;
      ctx.root.add(obj);
      this.assemblyParts.push({
        id: `asm-${i}`, object: obj, home: home.clone(),
        homeQuat: obj.quaternion.clone(), keyed: kind === 'collar', kind,
      });
    }
    this.assemblySocket = {
      id: 'post', index: 0, position: this.boardPoint(0, 0, 0.02),
      axis: this.bNormal.clone(), toleranceM: 0.010,
      keyAngleRad: null, angleToleranceRad: ASSEMBLY_ANGLE_TOL,
      filled: false, accepts: 'pin', marker: null,
    };
  }

  /* ------------------------------------------------------- calibration */

  async calibrate(ctx: ModuleContext): Promise<void> {
    this.anchor.capture();
    this.rebuildGeometry();
    this.statusPanel.group.visible = true;
    this.placeStatus();

    this.setStatus('Melyik a domináns kezed? Emeld fel azt a kezed, és húzd meg a ravaszt.');
    const hand = await new Promise<Hand>((resolve) => {
      const off = ctx.engine.input.on((e: ActionEvent) => {
        if (!e.down || e.action !== 'PRIMARY') return;
        if (e.hand !== 'left' && e.hand !== 'right') return;
        off();
        resolve(e.hand);
      });
      this.offAction = off;
    });
    this.offAction = null;
    this.dominant = hand;
    ctx.recorder.event('dominant_hand', { hand, method: 'self_report_trigger' });

    this.setStatus(
      `${hand === 'right' ? 'Jobb' : 'Bal'} kéz. Most próbáld ki: fogd meg az egyik pálcikát, és tedd egy furatba.`
    );
    this.showPegs(true, ['left', 'right']);
    this.grab.setGrabbables(this.pegs);
    this.grab.setSockets(this.sockets);
    this.grab.setHands(['left', 'right']);
    this.practice = true;

    await new Promise<void>((resolve) => {
      const started = ctx.engine.clock.frameTime;
      const check = () => {
        if (this.aborted || this.placements.length > 0
          || ctx.engine.clock.frameTime - started > 30_000) { resolve(); return; }
        setTimeout(check, 120);
      };
      check();
    });
    this.placements = [];
    this.practice = false;
    this.resetBoard();
    this.showPegs(false, []);
    this.statusPanel.group.visible = false;
  }

  private rebuildGeometry(): void {
    const tilt = (BOARD_TILT_DEG * Math.PI) / 180;
    this.anchor.offset(0, -BOARD_DOWN, BOARD_FORWARD, this.boardCentre);
    this.dir(1, 0, 0, this.bRight).normalize();
    this.dir(0, Math.cos(tilt), -Math.sin(tilt), this.bNormal).normalize();
    this.dir(0, Math.sin(tilt), Math.cos(tilt), this.bUp).normalize();

    this.board.position.copy(this.boardCentre);
    this.board.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.bNormal);

    const v0 = -((HOLES_PER_COLUMN - 1) / 2) * HOLE_SPACING;
    const flat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.bNormal);
    this.sockets.forEach((s, i) => {
      const side = i < HOLES_PER_COLUMN ? -COLUMN_U : COLUMN_U;
      const row = i % HOLES_PER_COLUMN;
      s.position.copy(this.boardPoint(side, v0 + row * HOLE_SPACING, PEG_LENGTH * 0.4));
      s.axis.copy(this.bNormal);
      if (s.marker) {
        s.marker.position.copy(this.boardPoint(side, v0 + row * HOLE_SPACING, 0.002));
        s.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.bNormal);
      }
    });
    this.pegs.forEach((p, i) => {
      const side = i < HOLES_PER_COLUMN ? -TRAY_U : TRAY_U;
      const row = i % HOLES_PER_COLUMN;
      p.home.copy(this.boardPoint(side, v0 + row * HOLE_SPACING, PEG_LENGTH * 0.4));
      p.homeQuat.copy(flat);
      p.object.position.copy(p.home);
      p.object.quaternion.copy(flat);
    });
    this.assemblyPost.position.copy(this.boardPoint(0, 0, 0.004));
    this.assemblyPost.quaternion.copy(flat);
    if (this.assemblySocket) {
      this.assemblySocket.position.copy(this.boardPoint(0, 0, 0.02));
      this.assemblySocket.axis.copy(this.bNormal);
    }
    this.assemblyParts.forEach((g, i) => {
      const u = i % 2 === 0 ? TRAY_U : -TRAY_U;
      g.home.copy(this.boardPoint(u, -0.06 + (i % 2) * 0.07, 0.03));
      g.object.position.copy(g.home);
    });

    const origin = this.anchor.offset(0, -0.20, 0.50, new THREE.Vector3());
    this.wirePath = buildWirePath(
      origin, this.dir(1, 0, 0).normalize(), this.dir(0, 1, 0).normalize(),
      this.dir(0, 0, 1).normalize(), WIRE_ARC, WIRE_AMPLITUDE, 0
    );
    if (this.wireMesh) {
      this.wireMesh.geometry.dispose();
      this.wireMesh.geometry = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(this.wirePath.points), 160, WIRE_RADIUS, 10, false);
    }
    this.ring.home.copy(this.wirePath.points[0]!);
    this.ring.object.position.copy(this.ring.home);
    this.placeStatus();
  }

  private placeStatus(): void {
    this.anchor.offset(0, 0.16, 0.85, this.statusPanel.group.position);
    this.statusPanel.group.lookAt(this.anchor.origin);
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.currentBlock = block.id as BlockId;
    this.practice = practice;
    this.anchor.ensure();
    this.statusPanel.group.visible = true;

    switch (this.currentBlock) {
      case 'pegs': {
        const other: Hand = this.dominant === 'right' ? 'left' : 'right';
        const runs: [string, Hand[]][] = [
          [this.dominant, [this.dominant]],
          [other, [other]],
          ['bimanual', ['left', 'right']],
        ];
        for (const [name, hands] of runs) {
          if (this.aborted) return;
          await this.runPegs(name, hands, false, practice ? PRACTICE_PEG_MS : PEG_SECONDS);
        }
        break;
      }
      case 'grooved':
        await this.runPegs('grooved', ['left', 'right'], true, practice ? PRACTICE_MS : GROOVED_SECONDS);
        break;
      case 'wire':
        for (let i = 0; i < (practice ? 1 : WIRE_PATHS); i++) {
          if (this.aborted) return;
          await this.runWire(i);
        }
        break;
      case 'assembly':
        await this.runAssembly(practice ? PRACTICE_MS : ASSEMBLY_SECONDS);
        break;
    }

    this.grab.releaseAll();
    this.grab.setGrabbables([]);
    this.grab.setSockets([]);
    this.showPegs(false, []);
    this.showWire(false);
    this.showAssembly(false);
    this.statusPanel.group.visible = false;
  }

  private async runPegs(sub: string, hands: Hand[], keyed: boolean, durationMs: number): Promise<void> {
    this.subBlock = sub;
    this.resetBoard();
    this.showPegs(true, hands);
    this.setKeyed(keyed);
    this.grab.setGrabbables(this.pegsFor(hands));
    this.grab.setSockets(this.socketsFor(hands));
    this.grab.setHands(hands);
    this.setStatus(
      keyed ? 'Forgasd el a pálcikát, hogy beférjen a horonyba.'
        : hands.length === 2 ? 'Most mindkét kézzel, egyszerre.'
          : `Most a ${hands[0] === 'right' ? 'JOBB' : 'BAL'} kezeddel.`
    );
    this.highlightNext(hands);
    await this.runPhase(durationMs, `${this.currentBlock}:${sub}`);
    this.showPegs(false, []);
  }

  private async runWire(index: number): Promise<void> {
    this.subBlock = `path${index}`;
    this.showWire(true);
    this.ring.object.position.copy(this.ring.home);
    this.grab.setGrabbables([this.ring]);
    this.grab.setSockets([]);
    this.grab.setHands(['left', 'right']);
    this.setStatus(`Pálya ${index + 1}/${WIRE_PATHS} — fogd meg a gyűrűt a bal végén, és vidd végig.`);

    const run: WireRun = {
      index, completed: false, durationMs: 0, contacts: 0, contactMs: 0,
      lateralMs: 0, depthMs: 0, lateralContactMs: 0, depthContactMs: 0,
      lateralContacts: 0, depthContacts: 0,
      pathLengthM: this.wirePath?.totalLengthM ?? 0,
    };
    await new Promise<void>((resolve) => {
      this.wire = {
        run, startT: this.ctx.engine.clock.frameTime, started: false,
        touching: false, touchStart: 0, lastS: 0, resolve,
      };
    });
    this.wire = null;
    if (!this.practice) this.wireRuns.push(run);
    this.ctx.recorder.event('wire_run', {
      pathIndex: index, completed: run.completed, durationMs: Math.round(run.durationMs),
      contacts: run.contacts, contactMs: Math.round(run.contactMs),
      meanSpeedMmS: run.durationMs > 0 ? +((run.pathLengthM * 1000) / (run.durationMs / 1000)).toFixed(1) : null,
      bySegment: {
        lateral: { ms: Math.round(run.lateralMs), contactMs: Math.round(run.lateralContactMs), contacts: run.lateralContacts },
        depth: { ms: Math.round(run.depthMs), contactMs: Math.round(run.depthContactMs), contacts: run.depthContacts },
      },
    });
    if (!this.practice) this.recordWireTrial(run);
    this.showWire(false);
  }

  private async runAssembly(durationMs: number): Promise<void> {
    this.subBlock = 'assembly';
    this.assemblyStep = 0;
    this.showAssembly(true);
    this.resetAssembly();
    this.grab.setGrabbables([this.assemblyParts[0]!]);
    this.grab.setSockets(this.assemblySocket ? [this.assemblySocket] : []);
    this.grab.setHands(['left', 'right']);
    this.setStatus('Tengely JOBB kézzel · alátét BAL · gallér JOBB · alátét BAL');
    await this.runPhase(durationMs, 'assembly');
    this.showAssembly(false);
  }

  private runPhase(durationMs: number, condition: string): Promise<void> {
    const t0 = this.ctx.engine.clock.frameTime;
    this.phaseStart = t0;
    this.lastReleaseT.clear();
    this.ctx.recorder.event('phase_start', {
      blockId: this.currentBlock, subBlock: this.subBlock, condition,
      practice: this.practice, durationMs,
    });
    return new Promise<void>((resolve) => {
      this.phase = { end: t0 + durationMs, resolve };
    });
  }

  /* ------------------------------------------------------- board state */

  private pegsFor(hands: Hand[]): Grabbable[] {
    if (hands.length === 2) return this.pegs;
    // A single-hand run uses that hand's own tray only, so reaching across the
    // body - a different movement entirely - does not enter the measurement.
    const left = hands[0] === 'left';
    return this.pegs.filter((_, i) => (i < HOLES_PER_COLUMN) === left);
  }

  private socketsFor(hands: Hand[]): Socket[] {
    if (hands.length === 2) return this.sockets;
    const left = hands[0] === 'left';
    return this.sockets.filter((_, i) => (i < HOLES_PER_COLUMN) === left);
  }

  private showPegs(on: boolean, hands: Hand[]): void {
    this.board.visible = on;
    const usable = new Set(this.pegsFor(hands).map((p) => p.id));
    for (const p of this.pegs) p.object.visible = on && usable.has(p.id);
    const active = new Set(this.socketsFor(hands).map((s) => s.id));
    for (const s of this.sockets) if (s.marker) s.marker.visible = on && active.has(s.id);
  }

  private setKeyed(keyed: boolean): void {
    for (const p of this.pegs) {
      p.keyed = keyed;
      const key = p.object.getObjectByName('key');
      if (key) key.visible = keyed;
    }
    for (const s of this.sockets) {
      s.keyAngleRad = keyed ? this.ctx.rng.range(-Math.PI, Math.PI) : null;
    }
  }

  private resetBoard(): void {
    for (const s of this.sockets) s.filled = false;
    for (const p of this.pegs) {
      p.object.position.copy(p.home);
      p.object.quaternion.copy(p.homeQuat);
    }
  }

  private resetAssembly(): void {
    if (this.assemblySocket) {
      this.assemblySocket.filled = false;
      this.assemblySocket.accepts = 'pin';
      this.assemblySocket.position.copy(this.boardPoint(0, 0, 0.02));
      this.assemblySocket.keyAngleRad = null;
    }
    for (const g of this.assemblyParts) {
      g.object.position.copy(g.home);
      g.object.quaternion.copy(g.homeQuat);
    }
  }

  private showWire(on: boolean): void {
    if (this.wireMesh) this.wireMesh.visible = on;
    this.ring.object.visible = on;
  }

  private showAssembly(on: boolean): void {
    this.board.visible = on || this.board.visible;
    this.assemblyPost.visible = on;
    for (const g of this.assemblyParts) g.object.visible = false;
    if (on && this.assemblyParts[this.assemblyStep]) {
      this.assemblyParts[this.assemblyStep]!.object.visible = true;
    }
    if (!on) this.board.visible = false;
  }

  /** Highlight the next free hole for each active hand. */
  private highlightNext(hands: Hand[]): void {
    const t = this.ctx.theme;
    for (const s of this.sockets) {
      const m = s.marker as THREE.Mesh | null;
      if (!m) continue;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(t.textMuted);
      mat.opacity = 0.35;
    }
    const groups: Socket[][] = hands.length === 2
      ? [this.sockets.slice(0, HOLES_PER_COLUMN), this.sockets.slice(HOLES_PER_COLUMN)]
      : [this.socketsFor(hands)];
    for (const g of groups) {
      const next = g.find((s) => !s.filled);
      if (!next?.marker) continue;
      const mat = (next.marker as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.color.set(t.accent);
      mat.opacity = 0.95;
    }
  }

  /* ------------------------------------------------------------- frame */

  update(_dt: number, ctx: ModuleContext): void {
    const t = ctx.engine.clock.frameTime;
    this.grab.update(t);

    // Full float precision, straight from the scene graph. `input.pose()`
    // rounds to a millimetre and tremor is a few tenths of one - the same
    // trap STEADY hit.
    const p = new THREE.Vector3();
    for (const [hand, f] of this.inFlight) {
      const pos = this.grab.handPosition(hand, p);
      if (!pos) continue;
      const movedMm = pos.distanceTo(f.grabPos) * 1000;
      if (f.movedT === null && movedMm > 15) f.movedT = t;
      if (f.movedT !== null && f.nearT === null) {
        f.transport.push(t, pos);
        const near = this.nearestSocketDistance(f.g.object.getWorldPosition(new THREE.Vector3()), f.g.kind);
        if (near < 0.030) f.nearT = t;
      } else if (f.nearT !== null) {
        f.place.push(t, pos);
      }
    }

    if (this.wire) this.updateWire(t);

    const ph = this.phase;
    if (ph && (this.aborted || t >= ph.end)) {
      this.phase = null;
      this.ctx.recorder.event('phase_end', {
        blockId: this.currentBlock, subBlock: this.subBlock,
        durationMs: Math.round(t - this.phaseStart),
        placements: this.placements.filter((x) => x.block === `${this.currentBlock}:${this.subBlock}`).length,
      });
      this.grab.releaseAll();
      this.inFlight.clear();
      ph.resolve();
    }
  }

  private nearestSocketDistance(p: THREE.Vector3, kind: string): number {
    let d = Infinity;
    const list = kind === 'peg' ? this.sockets : this.assemblySocket ? [this.assemblySocket] : [];
    for (const s of list) {
      if (s.filled || s.accepts !== kind) continue;
      d = Math.min(d, p.distanceTo(s.position));
    }
    return d;
  }

  private updateWire(t: number): void {
    const w = this.wire!;
    const path = this.wirePath;
    if (!path) return;
    const held = this.grab.heldBy('left') === this.ring || this.grab.heldBy('right') === this.ring;
    const pos = this.ring.object.getWorldPosition(new THREE.Vector3());
    const probe = wireProbe(path, pos);

    if (!w.started) {
      if (held && probe.sNorm < 0.08 && probe.distanceM < CONTACT_THRESHOLD) {
        w.started = true;
        w.startT = t;
        w.lastS = probe.sNorm;
      }
      if (t - w.startT > WIRE_TIMEOUT_MS) this.finishWire(t);
      return;
    }

    const dt = this.ctx.engine.clock.frameInterval || 11.1;
    if (probe.segment === 'lateral') w.run.lateralMs += dt; else w.run.depthMs += dt;

    const touching = probe.distanceM > CONTACT_THRESHOLD;
    if (touching && !w.touching) {
      w.touching = true;
      w.touchStart = t;
      w.run.contacts++;
      if (probe.segment === 'lateral') w.run.lateralContacts++; else w.run.depthContacts++;
      this.ctx.audio.error();
      this.ctx.engine.input.pulse('both', 0.5, 60);
      this.ctx.recorder.event('wire_contact', {
        pathIndex: w.run.index, segment: probe.segment,
        axialDistanceMm: +(probe.distanceM * 1000).toFixed(1), sNorm: +probe.sNorm.toFixed(3),
      });
    } else if (!touching && w.touching) {
      w.touching = false;
      const ms = t - w.touchStart;
      w.run.contactMs += ms;
      if (probe.segment === 'lateral') w.run.lateralContactMs += ms; else w.run.depthContactMs += ms;
    }
    if (w.touching) {
      if (probe.segment === 'lateral') w.run.lateralContactMs += dt; else w.run.depthContactMs += dt;
    }

    w.lastS = Math.max(w.lastS, probe.sNorm);
    if (probe.sNorm > 0.97 || t - w.startT > WIRE_TIMEOUT_MS || this.aborted) {
      w.run.completed = probe.sNorm > 0.97;
      this.finishWire(t);
    }
  }

  private finishWire(t: number): void {
    const w = this.wire;
    if (!w) return;
    if (w.touching) w.run.contactMs += t - w.touchStart;
    w.run.durationMs = t - w.startT;
    this.grab.releaseAll();
    w.resolve();
  }

  /* ------------------------------------------------------ grab / place */

  private onGrab(hand: Hand, g: Grabbable, t: number, distanceM: number): void {
    const last = this.lastReleaseT.get(hand) ?? this.phaseStart;
    this.inFlight.set(hand, {
      hand, g, grabT: t, reachMs: t - last,
      grabPos: this.grab.handPosition(hand, new THREE.Vector3()) ?? new THREE.Vector3(),
      movedT: null, nearT: null,
      transport: new MotionTrack(), place: new MotionTrack(),
    });
    this.ctx.recorder.event('grab', {
      hand, object: g.id, kind: g.kind,
      distanceFromObjectMm: +(distanceM * 1000).toFixed(1),
      block: this.currentBlock, subBlock: this.subBlock,
    });
  }

  private onRelease(
    hand: Hand, g: Grabbable, t: number,
    r0: { socket: Socket | null; errorM: number; angleErrorRad: number | null }
  ): void {
    const f = this.inFlight.get(hand);
    this.inFlight.delete(hand);
    this.lastReleaseT.set(hand, t);
    if (g.kind === 'ring') return;

    const ok = !!r0.socket;
    const angleDeg = r0.angleErrorRad === null ? null : +((r0.angleErrorRad * 180) / Math.PI).toFixed(1);
    this.ctx.recorder.event('release', {
      hand, object: g.id, inSocket: ok, socket: r0.socket?.id ?? null,
      errorMm: Number.isFinite(r0.errorM) ? +(r0.errorM * 1000).toFixed(1) : null,
      orientationErrorDeg: angleDeg,
    });

    if (!ok) {
      this.drops++;
      this.ctx.recorder.event('drop', {
        hand, object: g.id,
        nearestSocketMm: Number.isFinite(r0.errorM) ? +(r0.errorM * 1000).toFixed(1) : null,
        orientationErrorDeg: angleDeg,
      });
      if (this.practice) this.ctx.audio.error();
      return;
    }

    const graspMs = f?.movedT !== null && f?.movedT !== undefined ? f.movedT - f.grabT : NaN;
    const transportMs = f?.movedT !== null && f?.nearT !== null && f?.movedT !== undefined && f?.nearT !== undefined
      ? f.nearT - f.movedT : NaN;
    const placeMs = f?.nearT !== null && f?.nearT !== undefined ? t - f.nearT : NaN;
    const rec: Placement = {
      block: `${this.currentBlock}:${this.subBlock}`,
      hand,
      socketIndex: r0.socket!.index,
      ok: true,
      errorMm: r0.errorM * 1000,
      angleErrorDeg: angleDeg,
      reachMs: f?.reachMs ?? NaN,
      graspMs,
      transportMs,
      placeMs,
      pathMm: f?.transport.pathLengthMm() ?? NaN,
      straightMm: f?.transport.straightLineMm() ?? NaN,
      jerk: f?.transport.normalisedJerk() ?? NaN,
      tremorMm: f?.place.tremorMm() ?? NaN,
      holeDistanceM: r0.socket!.position.distanceTo(this.anchor.origin),
    };
    if (!this.practice) this.placements.push(rec);
    this.recordPlacementTrial(rec, t);

    if (this.currentBlock === 'assembly') this.advanceAssembly(hand, t);
    else this.afterPegPlacement();

    if (this.practice) this.ctx.audio.ok();
  }

  private afterPegPlacement(): void {
    const hands: Hand[] = this.subBlock === 'bimanual' || this.subBlock === 'grooved'
      ? ['left', 'right'] : [this.subBlock as Hand];
    const active = this.socketsFor(hands);
    if (active.every((s) => s.filled)) {
      // The board is finite; refilling it keeps the block time-limited rather
      // than hole-limited, which is what the Purdue 30 s scoring assumes.
      this.ctx.recorder.event('board_reset', { subBlock: this.subBlock });
      this.resetBoard();
      if (this.currentBlock === 'grooved') this.setKeyed(true);
    }
    this.highlightNext(hands);
  }

  private advanceAssembly(hand: Hand, t: number): void {
    const step = this.assemblyStep;
    const expected: Hand = step % 2 === 0 ? 'right' : 'left';
    const part = this.assemblyParts[step]!;
    if (!this.practice) {
      this.assemblyPartsPlaced.push({
        part: part.kind, hand, expected, rtMs: t - (this.lastReleaseT.get(hand) ?? t),
      });
    }
    this.ctx.recorder.event('assembly_part', {
      part: part.kind, hand, expectedHand: expected, correctHand: hand === expected, step,
    });

    this.assemblyStep = step + 1;
    if (this.assemblyStep >= this.assemblyParts.length) {
      if (!this.practice) this.assemblies++;
      this.assemblyStep = 0;
      this.resetAssembly();
    } else if (this.assemblySocket) {
      // The stack grows: each part sits on top of the previous one.
      this.assemblySocket.filled = false;
      this.assemblySocket.accepts = this.assemblyParts[this.assemblyStep]!.kind;
      this.assemblySocket.position.addScaledVector(this.bNormal, 0.012);
    }
    this.showAssembly(true);
    this.grab.setGrabbables([this.assemblyParts[this.assemblyStep]!]);
  }

  /* ------------------------------------------------------------ trials */

  private recordPlacementTrial(p: Placement, t: number): void {
    if (this.practice) return;
    this.trialNumber++;
    const rec: TrialRecord = {
      trialNumber: this.trialNumber,
      block: p.block,
      stimulus: {
        block: this.currentBlock, subBlock: this.subBlock, hand: p.hand,
        socketIndex: p.socketIndex, holeDistanceM: +p.holeDistanceM.toFixed(3),
        toleranceMm: HOLE_TOLERANCE * 1000,
        angleToleranceDeg: this.currentBlock === 'grooved' ? 12 : null,
      },
      response: {
        errorMm: +p.errorMm.toFixed(2),
        orientationErrorDeg: p.angleErrorDeg,
        reachMs: r(p.reachMs), graspMs: r(p.graspMs),
        transportMs: r(p.transportMs), placeMs: r(p.placeMs),
        pathLengthMm: r(p.pathMm), straightLineMm: r(p.straightMm),
        normalisedJerk: r(p.jerk, 2), holdTremorMm: r(p.tremorMm, 3),
      },
      correct: true,
      outcome: 'hit',
      reactionTimeMs: Number.isFinite(p.reachMs) ? p.reachMs : null,
      startedAt: t - (p.reachMs || 0),
      endedAt: t,
    };
    this.ctx.recorder.trial(rec);
  }

  private recordWireTrial(run: WireRun): void {
    this.trialNumber++;
    this.ctx.recorder.trial({
      trialNumber: this.trialNumber,
      block: 'wire',
      stimulus: {
        pathIndex: run.index, pathLengthM: +run.pathLengthM.toFixed(3),
        ringInnerMm: RING_INNER * 1000, contactThresholdMm: CONTACT_THRESHOLD * 1000,
      },
      response: {
        contacts: run.contacts, contactMs: Math.round(run.contactMs),
        lateralContacts: run.lateralContacts, depthContacts: run.depthContacts,
      },
      correct: run.completed,
      outcome: run.completed ? 'hit' : 'miss',
      reactionTimeMs: Math.round(run.durationMs),
      startedAt: 0,
      endedAt: Math.round(run.durationMs),
    });
  }

  /* ------------------------------------------------------------ status */

  private setStatus(text: string): void {
    this.statusText = text;
    this.statusPanel.invalidate();
  }

  private drawStatus(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.88), 14);
    ui.text(this.statusText, ui.w / 2, ui.h / 2, {
      size: 27, color: t.text, align: 'center', weight: '600',
      font: t.fontDisplay, maxWidth: ui.w - 36,
    });
  }

  /* ------------------------------------------------------------ finish */

  private rate(block: string, seconds: number, hand?: Hand): number {
    const n = this.placements.filter((p) => p.block === block && (!hand || p.hand === hand)).length;
    return seconds > 0 ? (n * 60) / seconds : NaN;
  }

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const secs = PEG_SECONDS / 1000;
    const other: Hand = this.dominant === 'right' ? 'left' : 'right';

    const rateDom = this.rate(`pegs:${this.dominant}`, secs);
    const rateOther = this.rate(`pegs:${other}`, secs);
    const rateRight = this.dominant === 'right' ? rateDom : rateOther;
    const rateLeft = this.dominant === 'left' ? rateDom : rateOther;
    const plainRate = mean([rateDom, rateOther].filter(Number.isFinite));

    const biLeft = this.placements.filter((p) => p.block === 'pegs:bimanual' && p.hand === 'left').length;
    const biRight = this.placements.filter((p) => p.block === 'pegs:bimanual' && p.hand === 'right').length;
    // Purdue counts PAIRS in the both-hands subtest: a hand that races ahead
    // while the other idles is not bimanual coordination.
    const pairsPerMin = (Math.min(biLeft, biRight) * 60) / secs;
    const bimanualEfficiency = Number.isFinite(rateLeft) && Number.isFinite(rateRight)
      && Math.min(rateLeft, rateRight) > 0
      ? pairsPerMin / Math.min(rateLeft, rateRight) : NaN;
    const asymmetry = Number.isFinite(rateLeft) && Number.isFinite(rateRight) && rateLeft + rateRight > 0
      ? Math.abs(rateRight - rateLeft) / ((rateRight + rateLeft) / 2) : NaN;

    const groovedRate = this.rate('grooved:grooved', GROOVED_SECONDS / 1000);
    const groovedPenalty = Number.isFinite(groovedRate) && Number.isFinite(plainRate) && plainRate > 0
      ? clamp(1 - groovedRate / plainRate, 0, 1) : NaN;

    const pegPlacements = this.placements.filter((p) => p.block.startsWith('pegs:'));
    const errs = pegPlacements.map((p) => p.errorMm).filter(Number.isFinite);
    const jerks = this.placements.map((p) => p.jerk).filter(Number.isFinite);
    const tremors = this.placements.map((p) => p.tremorMm).filter(Number.isFinite);
    const groovedAngles = this.placements
      .filter((p) => p.block.startsWith('grooved') && p.angleErrorDeg !== null)
      .map((p) => Math.abs(p.angleErrorDeg!));
    const effs = this.placements
      .filter((p) => Number.isFinite(p.pathMm) && p.pathMm > 0)
      .map((p) => p.straightMm / p.pathMm);

    const totalPlacements = this.placements.length;
    const dropRate = totalPlacements + this.drops > 0
      ? this.drops / (totalPlacements + this.drops) : NaN;

    const contacts = this.wireRuns.reduce((a, w) => a + w.contacts, 0);
    const contactMs = this.wireRuns.reduce((a, w) => a + w.contactMs, 0);
    const wireMs = this.wireRuns.reduce((a, w) => a + w.durationMs, 0);
    const wireLen = this.wireRuns.reduce((a, w) => a + (w.completed ? w.pathLengthM : 0), 0);
    const wireSpeed = wireMs > 0 ? (wireLen * 1000) / (wireMs / 1000) : NaN;
    const latMs = this.wireRuns.reduce((a, w) => a + w.lateralMs, 0);
    const depMs = this.wireRuns.reduce((a, w) => a + w.depthMs, 0);
    const latContactRate = latMs > 0
      ? this.wireRuns.reduce((a, w) => a + w.lateralContactMs, 0) / latMs : NaN;
    const depContactRate = depMs > 0
      ? this.wireRuns.reduce((a, w) => a + w.depthContactMs, 0) / depMs : NaN;
    const depthCost = Number.isFinite(latContactRate) && Number.isFinite(depContactRate)
      ? depContactRate - latContactRate : NaN;

    const asmParts = this.assemblyPartsPlaced.length;
    const asmCorrectHand = asmParts
      ? this.assemblyPartsPlaced.filter((p) => p.hand === p.expected).length / asmParts : NaN;

    const M: [string, number, string, string?][] = [
      ['placements_per_min', plainRate, '1/min', 'pegs'],
      ['placements_dominant', rateDom, '1/min', 'pegs'],
      ['placements_nondominant', rateOther, '1/min', 'pegs'],
      ['bimanual_pairs_per_min', pairsPerMin, '1/min', 'pegs'],
      ['bimanual_efficiency', bimanualEfficiency, 'ratio', 'pegs'],
      ['bimanual_asymmetry', asymmetry, 'ratio', 'pegs'],
      ['insertion_precision_mm', errs.length ? median(errs) : NaN, 'mm', 'pegs'],
      ['path_jerk', jerks.length ? median(jerks) : NaN, 'dimensionless', 'overall'],
      ['path_efficiency', effs.length ? median(effs) : NaN, 'ratio', 'overall'],
      ['hold_tremor_mm', tremors.length ? median(tremors) : NaN, 'mm', 'overall'],
      ['drop_rate', dropRate, 'ratio', 'overall'],
      ['grooved_placements_per_min', groovedRate, '1/min', 'grooved'],
      ['grooved_penalty', groovedPenalty, 'ratio', 'grooved'],
      ['orientation_error_deg', groovedAngles.length ? median(groovedAngles) : NaN, 'deg', 'grooved'],
      ['wall_contacts', contacts, 'count', 'wire'],
      ['wire_contact_time_ms', contactMs, 'ms', 'wire'],
      ['wire_speed_mm_s', wireSpeed, 'mm/s', 'wire'],
      ['wire_depth_segment_cost', depthCost, 'ratio', 'wire'],
      ['assembly_parts_per_min', asmParts * 60 / (ASSEMBLY_SECONDS / 1000), '1/min', 'assembly'],
      ['assembly_hand_accuracy', asmCorrectHand, 'ratio', 'assembly'],
    ];
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* ------------------------------------------------------- scores */

    const dexterity = normaliseSoft(Number.isFinite(plainRate) ? plainRate : 8, 34, 12);
    const precision = normaliseSoft(errs.length ? median(errs) : 9, 2.2, 7.5);
    const smoothness = normaliseSoft(jerks.length ? median(jerks) : 100, 24, 80);
    const control = normaliseSoft(contacts || 0, 2, 18);
    const bimanual = normaliseSoft(Number.isFinite(bimanualEfficiency) ? bimanualEfficiency : 0.4, 1.05, 0.55);
    const rotation = normaliseSoft(Number.isFinite(groovedPenalty) ? groovedPenalty : 0.85, 0.35, 0.75);

    const components = [
      { key: 'dexterity_rate', value: dexterity, weight: 0.26 },
      { key: 'placement_precision', value: precision, weight: 0.20 },
      { key: 'movement_smoothness', value: smoothness, weight: 0.16 },
      { key: 'path_control', value: control, weight: 0.16 },
      { key: 'bimanual_coordination', value: bimanual, weight: 0.14 },
      { key: 'rotation_handling', value: rotation, weight: 0.08 },
    ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    const num = (v: number, d = 1, unit = '') =>
      Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : '—';

    const headline: ModuleResult['headline'] = [
      {
        label: 'Elhelyezés', value: Number.isFinite(plainRate) ? `${Math.round(plainRate)} / perc` : '—',
        hint: Number.isFinite(rateDom) && Number.isFinite(rateOther)
          ? `domináns ${Math.round(rateDom)}, másik ${Math.round(rateOther)}` : undefined,
      },
      {
        label: 'Pontosság', value: num(errs.length ? median(errs) : NaN, 1, ' mm'),
        hint: 'a furat közepétől, medián',
      },
      {
        label: 'Mozgássimaság', value: num(jerks.length ? median(jerks) : NaN, 0),
        hint: `a tökéletesen sima nyúlás ${MIN_JERK_REFERENCE.toFixed(1)} — alacsonyabb a simább`,
      },
      {
        label: 'Pályaérintés', value: `${contacts}`,
        hint: `${this.wireRuns.filter((w) => w.completed).length}/${this.wireRuns.length} pálya végigérve`,
      },
      {
        label: 'Kétkezes hatékonyság', value: num(bimanualEfficiency, 2),
        hint: Number.isFinite(bimanualEfficiency)
          ? (bimanualEfficiency > 0.95 ? 'a két kezed valóban párhuzamosan dolgozott' : 'a két kéz inkább felváltva dolgozott')
          : undefined,
      },
      {
        label: 'Forgatási költség', value: num(groovedPenalty, 2),
        hint: 'ennyivel lassabb a kulcsos pálcika',
      },
    ];

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        inputMode: 'controller',
        // The module has no flat form at all, so the spatial weighting is
        // never rescaled - there is nothing to rescale it against.
        spatialWeightsApplied: true,
        touchAbsent: true,
        dominantHand: this.dominant,
        minJerkReference: +MIN_JERK_REFERENCE.toFixed(2),
        pegs: {
          dominantPerMin: r(rateDom), nonDominantPerMin: r(rateOther),
          bimanualPairsPerMin: r(pairsPerMin), efficiency: r(bimanualEfficiency, 3),
          asymmetry: r(asymmetry, 3),
          precisionMm: r(errs.length ? median(errs) : NaN, 2),
        },
        grooved: {
          perMin: r(groovedRate), penalty: r(groovedPenalty, 3),
          orientationErrorDeg: r(groovedAngles.length ? median(groovedAngles) : NaN),
        },
        wire: {
          runs: this.wireRuns.length,
          completed: this.wireRuns.filter((w) => w.completed).length,
          contacts, contactMs: Math.round(contactMs),
          speedMmS: r(wireSpeed), depthSegmentCost: r(depthCost, 4),
          lateralContactRate: r(latContactRate, 4), depthContactRate: r(depContactRate, 4),
        },
        assembly: {
          parts: asmParts, assemblies: this.assemblies, handAccuracy: r(asmCorrectHand, 3),
        },
        movement: {
          jerkMedian: r(jerks.length ? median(jerks) : NaN, 2),
          pathEfficiency: r(effs.length ? median(effs) : NaN, 3),
          tremorMm: r(tremors.length ? median(tremors) : NaN, 3),
        },
        drops: this.drops,
        dropRate: r(dropRate, 3),
        totalPlacements,
      },
      axisScores: {
        motor: Math.round((dexterity + precision + smoothness) / 3),
        spatial: Math.round((rotation + control) / 2),
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.grab.releaseAll();
    this.wire?.resolve();
    this.wire = null;
    const ph = this.phase;
    if (ph) { this.phase = null; ph.resolve(); }
  }

  dispose(ctx: ModuleContext): void {
    this.aborted = true;
    this.grab?.releaseAll();
    this.offAction?.();
    this.offClick?.();
    ctx.panels.remove(this.statusPanel);
    this.statusPanel.dispose();
    this.wireMesh?.geometry.dispose();
    disposeTree(ctx.root);
  }
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
