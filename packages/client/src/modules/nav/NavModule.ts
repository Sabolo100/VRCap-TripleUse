import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, stdev, slope, normaliseSoft, opsScore, clamp,
  circularMeanDeg, angleDiffDeg,
  type ModuleManifest, type TrialRecord,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, makeLabel, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { fitAngles } from '../../engine/ui/viewport.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import type { PanelClickEvent } from '../../engine/ui/PanelManager.js';
import {
  buildNavWorld, bearingDeg, distanceBetween, shortestPath, pickJrdTrials,
  type NavWorld, type NavLandmark,
} from './navWorld.js';

/**
 * MODULE 03 - NAV
 * Navigation and spatial memory.
 *
 * The module is built around one distinction that matters operationally:
 * route knowledge versus survey knowledge.
 *
 *   ROUTE knowledge is a chain of viewpoint-bound decisions ("left at the red
 *   tower"). It forms quickly, but it is rigid: it works in the direction it
 *   was learned and nowhere else.
 *
 *   SURVEY knowledge is a model of how places sit relative to one another. It
 *   forms slowly, but it supports pointing at somewhere you cannot see,
 *   shortcutting, and recovering after getting lost.
 *
 * Two people with identical retrace scores (block 2) can differ enormously in
 * blocks 3 and 5. That gap is the point of the module.
 *
 * Locomotion is node-to-node gliding at constant velocity with a vignette. Free
 * steering is the main cause of VR sickness, and a participant who feels unwell
 * also performs worse - which would be recorded as poor spatial ability.
 */

type BlockId = 'tour' | 'retrace' | 'jrd' | 'triangle' | 'map';

const EYE = 1.6;
const GLIDE_MS = 1600;
/**
 * How long the tour pauses at each node.
 *
 * This is the study period for the whole module: everything later - retracing,
 * pointing, the map - is recall of what was learned here. Two seconds, of
 * which the landmark name got 1.2, was not enough to learn anything, so the
 * later blocks were measuring the tour's pacing rather than spatial memory.
 */
const DWELL_MS = 4200;
/** How long a landmark's name stays up when the tour reaches it. */
const LANDMARK_NAME_MS = 2600;
const FOG_NORMAL = 0.05;
const FOG_BLIND = 0.28;

interface JrdTrialSpec {
  standNode: number;
  facing: number;
  target: number;
  trueBearingDeg: number;
}

interface TriangleSpec {
  leg1: number;
  turnDeg: number;
  leg2: number;
}

export class NavModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.NAV!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'tour',
      title: 'BEJÁRÁS',
      instruction:
        'A rendszer végigvisz egy útvonalon, megállókkal. Nem kell irányítanod semmit, és nem kell ' +
        'gombot nyomnod: a dolgod annyi, hogy MINDEN MEGÁLLÓNÁL NÉZZ KÖRBE, és jegyezd meg, melyik ' +
        'tereptárgy merre van. A nevüket ki is írom. Ezt az útvonalat kell majd egyedül megtenned, ' +
        'utána pedig irányokat megbecsülnöd — szóval most a körülnézés a feladat.',
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
    },
    {
      id: 'retrace',
      title: 'ÚJRAJÁRÁS',
      instruction:
        'Most magadnak kell végigmenned ugyanazon az útvonalon. Minden állomáson nyilak mutatják, ' +
        'merre lehet továbbmenni — válaszd azt, amerre az útvonal vezetett. Másodszor visszafelé is meg kell tenned.',
      controlHint: '',
      trials: 2,
      practiceTrials: 0,
    },
    {
      id: 'jrd',
      title: 'IRÁNYBECSLÉS',
      instruction:
        'Sűrű köd ereszkedik le: nem látsz semmit. A rendszer megmondja, hol állsz és merre nézel, ' +
        'neked pedig meg kell mutatnod, merre van egy harmadik tereptárgy. Csak a fejedben lévő térképre támaszkodhatsz.',
      controlHint: '',
      trials: 12,
      practiceTrials: 2,
    },
    {
      id: 'triangle',
      title: 'ÚTVONAL-INTEGRÁCIÓ',
      instruction:
        'Üres, jellegtelen terep, tereptárgyak nélkül. A rendszer végigvisz két szakaszon, ' +
        'te pedig megmutatod, merre van a kiindulópont, és megbecsülöd, milyen messze.',
      controlHint: '',
      trials: 8,
      practiceTrials: 1,
    },
    {
      id: 'map',
      title: 'TÉRKÉP',
      instruction:
        'Kapsz egy felülnézeti térképet, amelyen az állomások látszanak. Hol vagy rajta, és merre nézel? ' +
        'A térkép mindig északra van tájolva — te nem feltétlenül.',
      controlHint: '',
      trials: 8,
      practiceTrials: 1,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private world!: NavWorld;
  private landmarkMeshes = new Map<number, THREE.Group>();
  private edgeArrows: THREE.Mesh[] = [];
  private ground!: THREE.Mesh;
  private dots!: THREE.Points;
  private boundary!: THREE.Mesh;
  private vignette!: THREE.Mesh;
  private facingArrow!: THREE.Group;

  private promptPanel!: Panel;
  private mapPanel!: Panel;
  private promptText = '';
  private promptSub = '';
  private promptMode: 'none' | 'point' | 'distance' | 'comfort' = 'none';
  private distanceValue = 12;

  private currentNode = 0;
  private currentBlock: BlockId = 'tour';
  private practice = false;
  private trials: TrialRecord[] = [];
  private aborted = false;
  private offInput: (() => void) | null = null;
  private offPanel: (() => void) | null = null;

  /**
   * Snap movement, on by default.
   *
   * The route used to be travelled with a smooth automatic glide, which is
   * passive vection - the single most reliable way to make someone ill in a
   * headset, and something this platform's own module rules forbid. Gliding is
   * still available for participants who prefer it, but it is now the opt-in.
   */
  private teleportMode = true;
  private discomfortReported = false;

  private gliding: {
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromYaw: number; toYaw: number;
    start: number; duration: number; resolve: () => void;
  } | null = null;

  private pointResolve: ((bearingDeg: number) => void) | null = null;
  private edgeResolve: ((node: number) => void) | null = null;
  private panelResolve: (() => void) | null = null;

  private savedFog: THREE.Scene['fog'] = null;

  /** Accumulators. */
  private retraceResults: { direction: 'forward' | 'reverse'; correct: number; total: number; wrongTurns: number; ms: number; recoveries: number }[] = [];
  private jrdResults: { absErr: number; signedErr: number; rtMs: number }[] = [];
  private triangleResults: { bearingErr: number; distRatio: number; trueDist: number; estDist: number; rtMs: number }[] = [];
  private mapResults: { mode: 'position' | 'heading'; error: number; headingOffset: number; rtMs: number }[] = [];
  private bodyTurnCount = 0;
  private lastYawSample = 0;
  private yawAccum = 0;
  private sampleTimer = 0;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);
    this.world = buildNavWorld(ctx.rng.int(1, 2 ** 30), ctx.rng);

    ctx.recorder.event('nav_graph_built', {
      nodes: this.world.nodes.length,
      edges: this.world.edges.length,
      landmarkNodes: this.world.landmarks.map((l) => l.node),
      route: this.world.route,
    });

    this.savedFog = ctx.scene.fog;
    ctx.scene.fog = new THREE.FogExp2(new THREE.Color(0x070b10).getHex(), FOG_NORMAL);
    ctx.scene.background = new THREE.Color(0x070b10);

    this.buildGround();
    this.buildLandmarks();
    this.buildVignette();

    this.facingArrow = new THREE.Group();
    const shaft = makePrimitive({ kind: 'box', color: 0x9fb3c8, unlit: true, opacity: 0.6, size: [0.12, 0.02, 2.2] });
    shaft.position.z = -1.2;
    const head = makePrimitive({ kind: 'cone', color: 0x9fb3c8, unlit: true, opacity: 0.7, size: [0.36, 0.5, 0.36] });
    head.rotation.x = -Math.PI / 2;
    head.position.z = -2.4;
    this.facingArrow.add(shaft, head);
    this.facingArrow.position.y = 0.03;
    this.facingArrow.visible = false;
    this.root.add(this.facingArrow);

    this.promptPanel = new Panel({ width: 1.15, height: 0.44, pxPerMeter: 900, theme: ctx.theme, name: 'nav-prompt' });
    this.promptPanel.setDraw((ui) => this.drawPrompt(ui));
    this.promptPanel.group.visible = false;
    ctx.root.add(this.promptPanel.group);
    ctx.panels.add(this.promptPanel);

    this.mapPanel = new Panel({ width: 1.0, height: 0.86, pxPerMeter: 900, theme: ctx.theme, name: 'nav-map' });
    this.mapPanel.setDraw((ui) => this.drawMap(ui));
    this.mapPanel.group.visible = false;
    ctx.root.add(this.mapPanel.group);
    ctx.panels.add(this.mapPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint(b.id as BlockId);

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));
    this.offPanel = ctx.panels.onClick((e) => this.onPanelClick(e));
  }

  private controlHint(block: BlockId): string {
    const vr = this.ctx.platform === 'vr';
    switch (block) {
      case 'tour':
        return vr ? 'Nézz körül szabadon. A haladás automatikus.'
          : this.ctx.platform === 'mobile'
            ? 'Húzd az ujjad a képernyőn, hogy körülnézz. A haladás automatikus.'
            : 'Nézz körül az egeret húzva. A haladás automatikus.';
      case 'retrace':
        return vr ? 'Mutass a ravasszal arra a nyílra, amerre menni akarsz.'
          : this.ctx.platform === 'mobile'
            ? 'Húzással nézz körül, majd koppints arra a nyílra, amerre menni akarsz.'
            : 'Kattints arra a nyílra, amerre menni akarsz.';
      case 'jrd':
        return vr ? 'Fordulj a becsült irányba, és húzd meg a ravaszt.'
          : this.ctx.platform === 'mobile'
            ? 'Húzással fordulj a becsült irány felé, majd nyomd meg az ERRE VAN gombot.'
            : 'Fordítsd a kurzort a becsült irányba és kattints.';
      case 'triangle':
        return vr ? 'Mutass a kiindulópont felé és húzd meg a ravaszt, majd állítsd be a távolságot.'
          : this.ctx.platform === 'mobile'
            ? 'Fordulj a kiindulópont felé, nyomd meg az ERRE VAN gombot, majd állítsd be a távolságot a csúszkán.'
            : 'Kattints a becsült irányba, majd állítsd be a távolságot.';
      case 'map':
        return vr ? 'Mutass a térképen a helyes pontra és húzd meg a ravaszt.'
          : 'Kattints a térképen a helyes pontra.';
    }
  }

  /* ------------------------------------------------------------ world */

  private buildGround(): void {
    const rng = this.ctx.rng;
    // A random dot field rather than a grid. A grid gives an absolute
    // reference frame, which would make survey knowledge and path integration
    // trivially easy - you could just count lines. Random dots provide optic
    // flow and texture with no directional structure at all.
    const count = 5200;
    const positions = new Float32Array(count * 3);
    const radius = 62;
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * radius;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.015;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dots = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x415569, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: true,
    }));
    this.root.add(this.dots);

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(70, 64),
      new THREE.MeshBasicMaterial({ color: 0x0b1118, fog: true })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.root.add(this.ground);

    this.boundary = new THREE.Mesh(
      new THREE.CylinderGeometry(64, 64, 14, 64, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x16202c, side: THREE.BackSide, fog: true })
    );
    this.boundary.position.y = 7;
    this.root.add(this.boundary);
  }

  private buildLandmarks(): void {
    for (const lm of this.world.landmarks) {
      const g = new THREE.Group();
      const c = lm.color;
      switch (lm.kind) {
        case 'pillar': {
          const m = makePrimitive({ kind: 'cylinder', color: c, unlit: true, size: [1.1, 6.5, 1.1] });
          m.position.y = 3.25;
          g.add(m);
          break;
        }
        case 'gate': {
          const l = makePrimitive({ kind: 'cylinder', color: c, unlit: true, size: [0.7, 5, 0.7] });
          l.position.set(-1.8, 2.5, 0);
          const r = l.clone();
          r.position.x = 1.8;
          const top = makePrimitive({ kind: 'box', color: c, unlit: true, size: [4.6, 0.8, 0.8] });
          top.position.y = 5.2;
          g.add(l, r, top);
          break;
        }
        case 'cone': {
          const m = makePrimitive({ kind: 'cone', color: c, unlit: true, size: [4.4, 5.4, 4.4] });
          m.position.y = 2.7;
          g.add(m);
          break;
        }
        case 'tower': {
          for (let i = 0; i < 3; i++) {
            const s = 3.2 - i * 0.9;
            const m = makePrimitive({ kind: 'box', color: c, unlit: true, size: [s, 1.8, s] });
            m.position.y = 0.9 + i * 1.8;
            g.add(m);
          }
          break;
        }
        case 'ring': {
          const post = makePrimitive({ kind: 'cylinder', color: c, unlit: true, size: [0.5, 3, 0.5] });
          post.position.y = 1.5;
          const ring = makePrimitive({ kind: 'torus', color: c, unlit: true, size: 4.2 });
          ring.position.y = 4.4;
          g.add(post, ring);
          break;
        }
        case 'slab': {
          const m = makePrimitive({ kind: 'box', color: c, unlit: true, size: [3.6, 5.6, 1.0] });
          m.position.y = 2.8;
          m.rotation.z = 0.28;
          g.add(m);
          break;
        }
      }
      g.position.set(lm.x, 0, lm.z);
      this.root.add(g);
      this.landmarkMeshes.set(lm.id, g);
    }
  }

  private buildVignette(): void {
    // A radial alpha mask parented to the camera. Narrowing the visible field
    // during translation is the single most effective mitigation for the
    // visual-vestibular conflict that causes VR sickness.
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d')!;
    const grad = c.createRadialGradient(size / 2, size / 2, size * 0.20, size / 2, size / 2, size * 0.52);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = grad;
    c.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    this.vignette = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0, fog: false })
    );
    this.vignette.renderOrder = 998;
    this.vignette.position.z = -0.5;
    this.vignette.visible = false;
    this.ctx.engine.camera.add(this.vignette);
  }

  private setLandmarksVisible(v: boolean, exceptId?: number): void {
    for (const [id, g] of this.landmarkMeshes) g.visible = v || id === exceptId;
  }

  private setFog(density: number): void {
    const fog = this.ctx.scene.fog;
    if (fog instanceof THREE.FogExp2) fog.density = density;
  }

  /* ------------------------------------------------------- locomotion */

  private nodePos(id: number): THREE.Vector3 {
    const n = this.world.nodes[id]!;
    return new THREE.Vector3(n.x, 0, n.z);
  }

  private placeAt(node: number, yawRad: number): void {
    const rig = this.ctx.engine.rig;
    rig.position.copy(this.nodePos(node));
    rig.rotation.y = yawRad;
    this.currentNode = node;
  }

  /** Constant-velocity glide with a vignette; no acceleration anywhere. */
  private glide(toPos: THREE.Vector3, toYaw: number, durationMs = GLIDE_MS): Promise<void> {
    if (this.teleportMode) {
      return this.teleport(toPos, toYaw);
    }
    return new Promise<void>((resolve) => {
      const rig = this.ctx.engine.rig;
      this.gliding = {
        fromPos: rig.position.clone(),
        toPos: toPos.clone(),
        fromYaw: rig.rotation.y,
        toYaw,
        start: this.ctx.engine.clock.frameTime,
        duration: durationMs,
        resolve,
      };
    });
  }

  private async teleport(toPos: THREE.Vector3, toYaw: number): Promise<void> {
    const mat = this.vignette.material as THREE.MeshBasicMaterial;
    this.vignette.visible = true;
    mat.opacity = 1;
    await this.wait(120);
    this.ctx.engine.rig.position.copy(toPos);
    this.ctx.engine.rig.rotation.y = toYaw;
    await this.wait(60);
    mat.opacity = 0;
    this.vignette.visible = false;
  }

  private async moveToNode(node: number, durationMs = GLIDE_MS): Promise<void> {
    const target = this.nodePos(node);
    const yaw = (bearingDeg(this.ctx.engine.rig.position, this.world.nodes[node]!) * Math.PI) / 180;
    await this.glide(target, yaw, durationMs);
    this.currentNode = node;
    this.ctx.audio.tone({ freq: 660, durationMs: 60, gain: 0.12 });
  }

  private updateGlide(): void {
    const g = this.gliding;
    if (!g) return;
    const t = clamp((this.ctx.engine.clock.frameTime - g.start) / g.duration, 0, 1);
    const rig = this.ctx.engine.rig;
    // Yaw resolves in the first third so the participant is facing the way
    // they travel before translation begins; turning while translating is the
    // most nauseogenic combination there is.
    const yawT = clamp(t / 0.33, 0, 1);
    const dYaw = angleDiffDeg((g.toYaw * 180) / Math.PI, (g.fromYaw * 180) / Math.PI);
    rig.rotation.y = g.fromYaw + ((dYaw * Math.PI) / 180) * yawT;
    const moveT = clamp((t - 0.15) / 0.85, 0, 1);
    rig.position.lerpVectors(g.fromPos, g.toPos, moveT);

    const mat = this.vignette.material as THREE.MeshBasicMaterial;
    this.vignette.visible = true;
    const strength = this.ctx.platform === 'vr' ? 0.85 : 0.5;
    mat.opacity = Math.sin(t * Math.PI) * strength;

    if (t >= 1) {
      rig.position.copy(g.toPos);
      rig.rotation.y = g.toYaw;
      mat.opacity = 0;
      this.vignette.visible = false;
      this.gliding = null;
      g.resolve();
    }
  }

  /* ----------------------------------------------------- block driver */

  async calibrate(ctx: ModuleContext): Promise<void> {
    // Landmark familiarisation. Without it, the tour would be spent learning
    // which shape is which rather than where things are, and the module would
    // measure object memory instead of spatial memory.
    this.promptPanel.group.visible = true;
    this.promptMode = 'comfort';
    for (const lm of this.world.landmarks) {
      if (this.aborted) return;
      this.placeAt(lm.node, (bearingDeg(this.world.nodes[lm.node]!, lm) * Math.PI) / 180);
      this.promptText = lm.name;
      this.promptSub = 'Jegyezd meg. Ez lesz az egyik tájékozódási pontod.';
      this.positionPrompt();
      this.promptPanel.invalidate();
      ctx.recorder.event('tour_landmark_shown', { landmark: lm.name, node: lm.node });
      await this.wait(1600);
    }
    this.promptMode = 'none';
    this.promptPanel.group.visible = false;
  }

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    this.setupTouchControls(this.currentBlock);
    const count = practice ? block.practiceTrials : block.trials;
    if (count === 0) return;

    switch (this.currentBlock) {
      case 'tour': await this.runTour(); break;
      case 'retrace': await this.runRetrace(practice); break;
      case 'jrd': await this.runJrd(count); break;
      case 'triangle': await this.runTriangle(count); break;
      case 'map': await this.runMap(count); break;
    }
  }

  /* ---------------------------------------------------------- 1: tour */

  private async runTour(): Promise<void> {
    const route = this.world.route;
    this.setLandmarksVisible(true);
    this.setFog(FOG_NORMAL);
    this.placeAt(route[0]!, 0);
    this.ctx.recorder.trialNumber = 1;

    const startT = this.ctx.engine.clock.frameTime;
    for (let i = 1; i < route.length; i++) {
      if (this.aborted) return;
      const from = route[i - 1]!;
      const to = route[i]!;
      this.ctx.recorder.event('tour_leg', { from, to, legIndex: i - 1, durationMs: GLIDE_MS });
      await this.moveToNode(to);
      // Name any landmark standing at this node, once, during the tour only.
      const lm = this.world.landmarks.find((l) => l.node === to);
      if (lm) {
        this.promptText = lm.name;
        this.promptSub = '';
        this.promptMode = 'comfort';
        this.positionPrompt();
        this.promptPanel.group.visible = true;
        this.promptPanel.invalidate();
        this.ctx.recorder.event('tour_landmark_shown', { landmark: lm.name, node: to });
        await this.wait(LANDMARK_NAME_MS);
        this.promptPanel.group.visible = false;
      }
      await this.wait(Math.max(800, DWELL_MS - (lm ? LANDMARK_NAME_MS : 0)));
    }

    const endT = this.ctx.engine.clock.frameTime;
    this.trials.push({
      trialNumber: 1,
      block: 'tour',
      stimulus: {
        kind: 'tour', route, seed: this.world.seed,
        landmarks: Object.fromEntries(this.world.landmarks.map((l) => [l.node, l.name])),
        graph: {
          nodes: this.world.nodes.map((n) => [+n.x.toFixed(2), +n.z.toFixed(2)]),
          edges: this.world.edges,
        },
      },
      response: null,
      correct: null,
      outcome: 'hit',
      reactionTimeMs: null,
      startedAt: +startT.toFixed(1),
      endedAt: +endT.toFixed(1),
    });
  }

  /* ------------------------------------------------------- 2: retrace */

  private async runRetrace(practice: boolean): Promise<void> {
    const routes: { dir: 'forward' | 'reverse'; nodes: number[] }[] = practice
      ? [{ dir: 'forward', nodes: this.world.route.slice(0, 3) }]
      : [
          { dir: 'forward', nodes: this.world.route },
          { dir: 'reverse', nodes: [...this.world.route].reverse() },
        ];

    for (let ri = 0; ri < routes.length; ri++) {
      if (this.aborted) return;
      const route = routes[ri]!;
      this.ctx.recorder.trialNumber = ri + 1;
      this.setLandmarksVisible(true);
      this.setFog(FOG_NORMAL);
      this.placeAt(route.nodes[0]!, 0);

      this.ctx.recorder.event('retrace_start', {
        routeIndex: ri, direction: route.dir, expectedNodes: route.nodes,
      });

      const startT = this.ctx.engine.clock.frameTime;
      const deadline = startT + 150000;
      let step = 1;
      let correct = 0;
      let wrongTurns = 0;
      let recoveries = 0;
      let consecutiveWrong = 0;
      let lastGoodNode = route.nodes[0]!;

      while (step < route.nodes.length && this.ctx.engine.clock.frameTime < deadline && !this.aborted) {
        const expected = route.nodes[step]!;
        const options = this.world.nodes[this.currentNode]!.neighbours;
        this.showEdgeArrows(options);
        this.promptText = route.dir === 'forward' ? 'MERRE TOVÁBB?' : 'VISSZAFELÉ — MERRE?';
        this.promptSub = `${step} / ${route.nodes.length - 1}`;
        this.promptMode = 'comfort';
        this.positionPrompt();
        this.promptPanel.group.visible = true;
        this.promptPanel.invalidate();

        const chosenAt = this.ctx.engine.clock.frameTime;
        const chosen = await new Promise<number>((resolve) => { this.edgeResolve = resolve; });
        this.edgeResolve = null;
        this.hideEdgeArrows();
        this.promptPanel.group.visible = false;
        if (this.aborted) return;

        const isCorrect = chosen === expected;
        this.ctx.recorder.event('edge_chosen', {
          from: this.currentNode, to: chosen, correct: isCorrect,
          elapsedMs: +(this.ctx.engine.clock.frameTime - chosenAt).toFixed(1),
          optionsCount: options.length, step,
        });
        await this.moveToNode(chosen);

        if (isCorrect) {
          correct++;
          step++;
          consecutiveWrong = 0;
          lastGoodNode = chosen;
        } else {
          wrongTurns++;
          consecutiveWrong++;
          this.ctx.recorder.event('wrong_turn', {
            node: this.currentNode, chosen, expected, count: wrongTurns,
          });
          // After three consecutive wrong turns the participant is put back on
          // the route. Without this a lost participant would burn the whole
          // time limit, and every later decision point would go unmeasured.
          if (consecutiveWrong >= 3) {
            await this.moveToNode(lastGoodNode, 900);
            recoveries++;
            consecutiveWrong = 0;
            this.ctx.recorder.event('retrace_recovery', {
              returnedToNode: lastGoodNode, wrongTurnsBefore: wrongTurns,
            });
          }
        }
      }

      const endT = this.ctx.engine.clock.frameTime;
      const total = route.nodes.length - 1;
      const success = total > 0 ? correct / total : 0;
      this.ctx.recorder.event('retrace_end', {
        routeIndex: ri, direction: route.dir, success, wrongTurns,
        durationMs: +(endT - startT).toFixed(1),
      });

      if (!practice) {
        this.retraceResults.push({
          direction: route.dir, correct, total, wrongTurns, ms: endT - startT, recoveries,
        });
        this.trials.push({
          trialNumber: ri + 1,
          block: 'retrace',
          stimulus: { kind: 'retrace', routeIndex: ri, direction: route.dir, expected: route.nodes },
          response: { correct, total, wrongTurns, recoveries, rtMs: endT - startT },
          correct: correct === total,
          outcome: correct === total ? 'hit' : 'miss',
          reactionTimeMs: +(endT - startT).toFixed(1),
          startedAt: +startT.toFixed(1),
          endedAt: +endT.toFixed(1),
        });
      }
    }
  }

  private showEdgeArrows(options: number[]): void {
    this.hideEdgeArrows();
    const here = this.nodePos(this.currentNode);
    for (const n of options) {
      const to = this.nodePos(n);
      const dir = to.clone().sub(here).normalize();
      const arrow = makePrimitive({
        kind: 'cone', color: this.ctx.theme.accent, unlit: true, size: [0.7, 1.3, 0.7], opacity: 0.85,
      });
      arrow.position.copy(here).addScaledVector(dir, 3.0);
      arrow.position.y = 0.75;
      arrow.rotation.x = Math.PI / 2;
      arrow.rotation.z = -Math.atan2(dir.x, -dir.z);
      arrow.userData.edgeTarget = n;
      this.root.add(arrow);
      this.edgeArrows.push(arrow);
    }
  }

  private hideEdgeArrows(): void {
    for (const a of this.edgeArrows) disposeTree(a);
    this.edgeArrows = [];
  }

  /* ----------------------------------------------------------- 3: JRD */

  private async runJrd(count: number): Promise<void> {
    const specs: JrdTrialSpec[] = pickJrdTrials(this.world, count, this.ctx.rng);

    for (let i = 0; i < specs.length; i++) {
      if (this.aborted) return;
      const spec = specs[i]!;
      this.ctx.recorder.trialNumber = i + 1;
      const node = this.world.nodes[spec.standNode]!;
      const facing = this.world.landmarks[spec.facing]!;
      const target = this.world.landmarks[spec.target]!;

      // Heavy fog and no landmarks: the answer has to come from memory. The
      // dot field goes too, because even an unstructured texture would drift
      // past during head movement and hint at absolute orientation.
      this.setLandmarksVisible(false);
      this.dots.visible = false;
      this.setFog(FOG_BLIND);

      const facingYaw = (bearingDeg(node, facing) * Math.PI) / 180;
      this.placeAt(spec.standNode, facingYaw);
      this.facingArrow.position.set(node.x, 0.03, node.z);
      this.facingArrow.rotation.y = facingYaw;
      this.facingArrow.visible = true;

      const standLandmark = this.world.landmarks.find((l) => l.node === spec.standNode);
      this.promptText = `Mutasd meg: ${target.name}`;
      this.promptSub = standLandmark
        ? `${standLandmark.name} mellett állsz, a ${facing.name} felé nézel.`
        : `A ${facing.name} felé nézel.`;
      this.promptMode = 'point';
      this.positionPrompt();
      this.promptPanel.group.visible = true;
      this.promptPanel.invalidate();

      this.ctx.recorder.event('jrd_prompt', {
        standNode: spec.standNode, facing: facing.name, target: target.name,
        trueBearingDeg: +spec.trueBearingDeg.toFixed(1),
      });

      const startT = this.ctx.engine.clock.frameTime;
      const pointed = await new Promise<number>((resolve) => { this.pointResolve = resolve; });
      this.pointResolve = null;
      if (this.aborted) return;
      const endT = this.ctx.engine.clock.frameTime;

      const signed = angleDiffDeg(pointed, spec.trueBearingDeg);
      const abs = Math.abs(signed);
      this.promptPanel.group.visible = false;
      this.facingArrow.visible = false;

      this.ctx.recorder.event('jrd_response', {
        pointedDeg: +pointed.toFixed(1), trueDeg: +spec.trueBearingDeg.toFixed(1),
        absErrorDeg: +abs.toFixed(1), rtMs: +(endT - startT).toFixed(1),
      });

      if (!this.practice) {
        this.jrdResults.push({ absErr: abs, signedErr: signed, rtMs: endT - startT });
        this.trials.push({
          trialNumber: i + 1,
          block: 'jrd',
          stimulus: {
            kind: 'jrd', standNode: spec.standNode, facing: facing.name, target: target.name,
            trueBearingDeg: +spec.trueBearingDeg.toFixed(1),
          },
          response: { pointedDeg: +pointed.toFixed(1), absErrorDeg: +abs.toFixed(1), signedErrorDeg: +signed.toFixed(1), rtMs: endT - startT },
          correct: abs <= 45,
          outcome: abs <= 45 ? 'hit' : 'miss',
          reactionTimeMs: +(endT - startT).toFixed(1),
          startedAt: +startT.toFixed(1),
          endedAt: +endT.toFixed(1),
        });
      } else {
        this.promptText = `Hiba: ${Math.round(abs)}°`;
        this.promptSub = abs <= 45 ? 'Jó irány.' : 'Nézd meg újra a tereptárgyakat.';
        this.promptMode = 'comfort';
        this.promptPanel.group.visible = true;
        this.promptPanel.invalidate();
        await this.wait(1600);
        this.promptPanel.group.visible = false;
      }
      await this.wait(400);
    }

    this.setLandmarksVisible(true);
    this.dots.visible = true;
    this.setFog(FOG_NORMAL);
  }

  /* ----------------------------------------------- 4: path integration */

  private async runTriangle(count: number): Promise<void> {
    if (this.teleportMode) {
      // Optic flow IS the input here; with teleport locomotion there is
      // nothing to integrate, so the block is skipped rather than producing
      // a number that means nothing.
      this.ctx.recorder.event('triangle_skipped', { reason: 'teleport_mode' });
      return;
    }
    const rng = this.ctx.rng;
    const turnAngles = [60, 90, 120, 135];

    for (let i = 0; i < count; i++) {
      if (this.aborted) return;
      this.ctx.recorder.trialNumber = i + 1;
      const spec: TriangleSpec = {
        leg1: rng.range(6, 14),
        turnDeg: rng.pick(turnAngles) * (rng.bool() ? 1 : -1),
        leg2: rng.range(6, 14),
      };

      this.setLandmarksVisible(false);
      this.dots.visible = true;
      this.setFog(0.075);

      // Start somewhere empty, away from the graph, so no remembered structure
      // can help. A fresh random heading each trial prevents carry-over.
      const startYaw = rng.range(-Math.PI, Math.PI);
      const start = new THREE.Vector3(rng.range(-8, 8), 0, rng.range(-8, 8));
      this.ctx.engine.rig.position.copy(start);
      this.ctx.engine.rig.rotation.y = startYaw;
      await this.wait(900);

      this.ctx.recorder.event('triangle_start', {
        leg1: +spec.leg1.toFixed(2), turnDeg: spec.turnDeg, leg2: +spec.leg2.toFixed(2),
      });

      const dir1 = new THREE.Vector3(Math.sin(startYaw), 0, -Math.cos(startYaw));
      const corner = start.clone().addScaledVector(dir1, spec.leg1);
      await this.glide(corner, startYaw, Math.round(spec.leg1 * 190));
      await this.wait(500);

      const yaw2 = startYaw + (spec.turnDeg * Math.PI) / 180;
      const dir2 = new THREE.Vector3(Math.sin(yaw2), 0, -Math.cos(yaw2));
      const end = corner.clone().addScaledVector(dir2, spec.leg2);
      await this.glide(end, yaw2, Math.round(spec.leg2 * 190));
      await this.wait(600);
      if (this.aborted) return;

      const trueBearing = bearingDeg({ x: end.x, z: end.z }, { x: start.x, z: start.z });
      const trueDistance = Math.hypot(end.x - start.x, end.z - start.z);

      this.promptText = 'Merre van a kiindulópont?';
      this.promptSub = 'Fordulj a becsült irányba és erősítsd meg.';
      this.promptMode = 'point';
      this.positionPrompt();
      this.promptPanel.group.visible = true;
      this.promptPanel.invalidate();

      const startT = this.ctx.engine.clock.frameTime;
      const pointed = await new Promise<number>((resolve) => { this.pointResolve = resolve; });
      this.pointResolve = null;
      if (this.aborted) return;

      this.promptText = 'Milyen messze van?';
      this.promptSub = 'Állítsd be a csúszkán, majd erősítsd meg.';
      this.promptMode = 'distance';
      this.distanceValue = 12;
      this.positionPrompt();
      this.promptPanel.invalidate();
      // A slider drawn on a 3D panel needs a steady aim at a thin track; on a
      // phone it is a native range input under the thumb.
      this.ctx.mobileControls?.set({
        hint: 'Milyen messze van a kiindulópont?',
        slider: {
          label: 'Becsült távolság', min: 2, max: 30, step: 0.5,
          value: this.distanceValue, unit: 'm',
          onInput: (v) => { this.distanceValue = v; this.promptPanel.invalidate(); },
        },
        buttons: [{
          id: 'confirm', label: 'MEHET', variant: 'primary', wide: true,
          onTap: () => { this.ctx.audio.ok(); this.panelResolve?.(); this.panelResolve = null; },
        }],
      });
      await new Promise<void>((resolve) => { this.panelResolve = resolve; });
      this.panelResolve = null;
      this.setupTouchControls('triangle');
      if (this.aborted) return;

      const endT = this.ctx.engine.clock.frameTime;
      this.promptPanel.group.visible = false;
      this.promptMode = 'none';

      const bearingErr = Math.abs(angleDiffDeg(pointed, trueBearing));
      const distRatio = this.distanceValue / trueDistance;

      this.ctx.recorder.event('triangle_response', {
        bearingErrorDeg: +bearingErr.toFixed(1),
        distanceRatio: +distRatio.toFixed(3),
        trueDistance: +trueDistance.toFixed(2),
        estimatedDistance: +this.distanceValue.toFixed(2),
        rtMs: +(endT - startT).toFixed(1),
      });

      if (!this.practice) {
        this.triangleResults.push({
          bearingErr, distRatio, trueDist: trueDistance, estDist: this.distanceValue, rtMs: endT - startT,
        });
        this.trials.push({
          trialNumber: i + 1,
          block: 'triangle',
          stimulus: {
            kind: 'triangle', leg1: +spec.leg1.toFixed(2), turnDeg: spec.turnDeg, leg2: +spec.leg2.toFixed(2),
            trueBearingDeg: +trueBearing.toFixed(1), trueDistance: +trueDistance.toFixed(2),
          },
          response: {
            pointedDeg: +pointed.toFixed(1), bearingErrorDeg: +bearingErr.toFixed(1),
            estimatedDistance: +this.distanceValue.toFixed(2), distanceRatio: +distRatio.toFixed(3),
            rtMs: endT - startT,
          },
          correct: bearingErr <= 45,
          outcome: bearingErr <= 45 ? 'hit' : 'miss',
          reactionTimeMs: +(endT - startT).toFixed(1),
          startedAt: +startT.toFixed(1),
          endedAt: +endT.toFixed(1),
        });
      } else {
        this.promptText = `Hiba: ${Math.round(bearingErr)}°`;
        this.promptSub = `Valós távolság: ${trueDistance.toFixed(1)} m, te ${this.distanceValue.toFixed(1)} m-t becsültél.`;
        this.promptMode = 'comfort';
        this.promptPanel.group.visible = true;
        this.promptPanel.invalidate();
        await this.wait(2200);
        this.promptPanel.group.visible = false;
      }
      await this.wait(300);
    }

    this.setLandmarksVisible(true);
    this.setFog(FOG_NORMAL);
  }

  /* ----------------------------------------------------------- 5: map */

  private async runMap(count: number): Promise<void> {
    const rng = this.ctx.rng;
    this.setLandmarksVisible(true);
    this.dots.visible = true;
    this.setFog(FOG_NORMAL);

    for (let i = 0; i < count; i++) {
      if (this.aborted) return;
      this.ctx.recorder.trialNumber = i + 1;
      const mode: 'position' | 'heading' = i % 2 === 0 ? 'position' : 'heading';
      const node = rng.int(0, this.world.nodes.length - 1);
      // A random heading forces genuine mental rotation: the map is always
      // north-up, the participant usually is not.
      const yaw = rng.range(-Math.PI, Math.PI);
      this.placeAt(node, yaw);
      const headingDeg = (yaw * 180) / Math.PI;
      await this.wait(1200);

      this.mapMode = mode;
      this.mapAnswer = null;
      this.mapPanel.group.visible = true;
      this.positionMap();
      this.mapPanel.invalidate();

      this.ctx.recorder.event('map_prompt', {
        mode, node, headingOffsetDeg: +Math.abs(angleDiffDeg(headingDeg, 0)).toFixed(1),
      });

      const startT = this.ctx.engine.clock.frameTime;
      await new Promise<void>((resolve) => { this.panelResolve = resolve; });
      this.panelResolve = null;
      if (this.aborted) return;
      const endT = this.ctx.engine.clock.frameTime;
      this.mapPanel.group.visible = false;

      const answer = this.takeMapAnswer();
      let error = NaN;
      if (mode === 'position' && answer) {
        error = Math.hypot(answer.x - this.world.nodes[node]!.x, answer.z - this.world.nodes[node]!.z);
      } else if (mode === 'heading' && answer) {
        error = Math.abs(angleDiffDeg(answer.headingDeg ?? 0, headingDeg));
      }

      this.ctx.recorder.event('map_response', {
        mode, error: +(error || 0).toFixed(2), rtMs: +(endT - startT).toFixed(1),
      });

      if (!this.practice && Number.isFinite(error)) {
        this.mapResults.push({
          mode, error, headingOffset: Math.abs(angleDiffDeg(headingDeg, 0)), rtMs: endT - startT,
        });
        this.trials.push({
          trialNumber: i + 1,
          block: 'map',
          stimulus: { kind: 'map', mode, node, headingOffsetDeg: +Math.abs(angleDiffDeg(headingDeg, 0)).toFixed(1) },
          response: { error: +error.toFixed(2), rtMs: endT - startT },
          correct: mode === 'position' ? error <= 6 : error <= 30,
          outcome: (mode === 'position' ? error <= 6 : error <= 30) ? 'hit' : 'miss',
          reactionTimeMs: +(endT - startT).toFixed(1),
          startedAt: +startT.toFixed(1),
          endedAt: +endT.toFixed(1),
        });
      } else if (this.practice && Number.isFinite(error)) {
        this.promptText = mode === 'position' ? `Hiba: ${error.toFixed(1)} m` : `Hiba: ${Math.round(error)}°`;
        this.promptSub = '';
        this.promptMode = 'comfort';
        this.positionPrompt();
        this.promptPanel.group.visible = true;
        this.promptPanel.invalidate();
        await this.wait(1500);
        this.promptPanel.group.visible = false;
      }
      await this.wait(300);
    }
  }

  private mapMode: 'position' | 'heading' = 'position';
  private mapAnswer: { x: number; z: number; headingDeg?: number } | null = null;

  /** Read through a call: the panel handler writes this while the block awaits,
   *  so a null-check earlier in the flow must not narrow it. */
  private takeMapAnswer(): { x: number; z: number; headingDeg?: number } | null {
    return this.mapAnswer;
  }

  /* ------------------------------------------------------------ input */

  /**
   * Touch controls for this module.
   *
   * NAV is the module a phone served worst. Its control hint told the
   * participant to look around by holding the right mouse button - a control
   * that does not exist on a touch screen, and there was no camera look on
   * flat platforms at all. So the tour could not be studied, and the two
   * pointing blocks could only indicate a direction inside the field of view:
   * "it is behind me" was unanswerable.
   *
   * Dragging now turns the view, and the estimate is taken from where the
   * participant is facing - the same gesture as in the headset, and the one a
   * phone user tries first.
   */
  private setupTouchControls(block: BlockId): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    switch (block) {
      case 'tour':
        mc.set({
          look: 'yaw',
          hint: 'Húzd az ujjad a képernyőn, hogy körülnézz. A haladás automatikus.',
        });
        break;
      case 'retrace':
        mc.set({
          look: 'yaw',
          hint: 'Húzd az ujjad a körülnézéshez, majd koppints arra a nyílra, amerre menni akarsz.',
        });
        break;
      case 'jrd':
      case 'triangle':
        mc.set({
          look: 'yaw',
          reticle: true,
          hint: 'Fordulj a becsült irány felé, hogy a célkereszt arra mutasson, majd erősítsd meg.',
          buttons: [{
            id: 'point', label: 'ERRE VAN', variant: 'primary', wide: true,
            onTap: () => this.resolvePointFromFacing(),
          }],
        });
        break;
      case 'map':
        mc.set({ hint: 'Koppints a térképen arra a pontra, ahol szerinted vagy.' });
        break;
    }
  }

  /**
   * Answer a pointing question with the direction the participant is facing.
   *
   * The ray from a tap can only express a direction inside the field of view,
   * so on a phone "behind me" had no expressible answer. Turning to face the
   * estimate and confirming does, and it matches how the same question is
   * answered in the headset.
   */
  private resolvePointFromFacing(): void {
    if (!this.pointResolve) return;
    const q = new THREE.Quaternion();
    this.ctx.engine.camera.getWorldQuaternion(q);
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const bearing = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
    this.ctx.audio.ok();
    const resolve = this.pointResolve;
    this.pointResolve = null;
    resolve(bearing);
  }

  private onAction(e: ActionEvent): void {
    if (!e.down || e.action !== 'PRIMARY') return;

    // Pointing responses: take the horizontal component of the pointer ray.
    // On a phone the answer comes from the facing direction instead, via the
    // confirm button - see resolvePointFromFacing.
    if (this.pointResolve && this.ctx.mobileControls) return;
    if (this.pointResolve) {
      const ray = e.ray ?? this.ctx.engine.input.primaryRay();
      if (!ray) return;
      const d = ray.direction;
      const bearing = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
      this.ctx.audio.ok();
      const resolve = this.pointResolve;
      this.pointResolve = null;
      resolve(bearing);
      return;
    }

    // Edge selection during retrace.
    if (this.edgeResolve && this.edgeArrows.length) {
      const ray = e.ray ?? this.ctx.engine.input.primaryRay();
      if (!ray) return;
      const rc = new THREE.Raycaster();
      rc.set(ray.origin, ray.direction);
      rc.far = 30;
      const hit = rc.intersectObjects(this.edgeArrows, false)[0];
      if (!hit) return;
      const target = hit.object.userData.edgeTarget as number;
      this.ctx.audio.click();
      const resolve = this.edgeResolve;
      this.edgeResolve = null;
      resolve(target);
    }
  }

  private onPanelClick(e: PanelClickEvent): void {
    if (e.panel === this.promptPanel) {
      if (e.widget.id === 'nav:teleport') {
        this.teleportMode = !this.teleportMode;
        this.discomfortReported = true;
        this.ctx.recorder.event('locomotion_mode_changed', {
          mode: this.teleportMode ? 'teleport' : 'glide', atNode: this.currentNode,
        });
        this.promptPanel.invalidate();
        return;
      }
      if (e.widget.id === 'nav:slider') {
        const frac = clamp((e.px - 40) / (this.promptPanel.pxW - 80), 0, 1);
        this.distanceValue = 2 + frac * 28;
        this.promptPanel.invalidate();
        return;
      }
      if (e.widget.id === 'nav:confirm') {
        this.ctx.audio.ok();
        this.panelResolve?.();
        this.panelResolve = null;
      }
      return;
    }

    if (e.panel === this.mapPanel) {
      if (e.widget.id === 'map:surface') {
        const world = this.mapPxToWorld(e.px, e.py);
        if (this.mapMode === 'position') {
          this.mapAnswer = world;
        } else {
          const cx = this.mapPanel.pxW / 2;
          const cy = this.mapPanel.pxH / 2 + 30;
          const headingDeg = (Math.atan2(e.px - cx, -(e.py - cy)) * 180) / Math.PI;
          this.mapAnswer = { x: 0, z: 0, headingDeg };
        }
        this.ctx.audio.click();
        this.mapPanel.invalidate();
        return;
      }
      if (e.widget.id === 'map:confirm' && this.mapAnswer) {
        this.ctx.audio.ok();
        this.panelResolve?.();
        this.panelResolve = null;
      }
    }
  }

  /* ------------------------------------------------------------ frame */

  update(dt: number, ctx: ModuleContext): void {
    this.updateGlide();

    // Panels follow the participant so they are always readable, but only when
    // they are not being pointed at - a panel that moves under the cursor is
    // impossible to click.
    if (this.promptPanel.group.visible && this.promptMode !== 'point') this.positionPrompt();
    if (this.mapPanel.group.visible) this.positionMap();

    this.sampleTimer += dt;
    if (this.sampleTimer >= 0.1) {
      this.sampleTimer = 0;
      const q = new THREE.Quaternion();
      ctx.engine.camera.getWorldQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const yaw = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
      if (this.lastYawSample !== 0) {
        this.yawAccum += Math.abs(angleDiffDeg(yaw, this.lastYawSample));
        if (this.yawAccum >= 180) { this.bodyTurnCount++; this.yawAccum = 0; }
      }
      this.lastYawSample = yaw;
    }
  }

  private positionPrompt(): void {
    const cam = this.ctx.engine.camera;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    cam.getWorldPosition(p);
    cam.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    fwd.normalize();
    // A panel you only read can sit further away; a panel you have to press
    // has to be close enough that aiming at a button is not a marksmanship
    // task. 'comfort' is the read-only landmark caption.
    const interactive = this.promptMode !== 'comfort';
    const dist = this.ctx.platform === 'vr' ? (interactive ? 1.15 : 1.7) : 1.5;
    const drop = interactive ? 0.30 : 0.42;
    const fit = fitAngles(this.ctx, {
      elDeg: (Math.atan2(-drop, dist) * 180) / Math.PI, distanceM: dist,
      widthM: this.promptPanel.width, heightM: this.promptPanel.height,
    });
    const rad = (fit.elDeg * Math.PI) / 180;
    this.promptPanel.group.position.copy(p)
      .addScaledVector(fwd, fit.distanceM * Math.cos(rad));
    this.promptPanel.group.position.y = p.y + fit.distanceM * Math.sin(rad);
    this.promptPanel.group.lookAt(p);
  }

  private positionMap(): void {
    const cam = this.ctx.engine.camera;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    cam.getWorldPosition(p);
    cam.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    fwd.normalize();
    // The map is the largest panel in the platform, and on a phone it is
    // wider and taller than the viewport at the reading distance the headset
    // uses. fitAngles pushes it back rather than shrinking the drawing, so the
    // layout is unchanged and the whole map is on screen.
    const fit = fitAngles(this.ctx, {
      elDeg: -6.6, distanceM: this.ctx.platform === 'vr' ? 1.5 : 1.3,
      widthM: this.mapPanel.width, heightM: this.mapPanel.height,
      maxDistanceFactor: 2.2,
    });
    const rad = (fit.elDeg * Math.PI) / 180;
    this.mapPanel.group.position.copy(p)
      .addScaledVector(fwd, fit.distanceM * Math.cos(rad));
    this.mapPanel.group.position.y = p.y + fit.distanceM * Math.sin(rad);
    this.mapPanel.group.lookAt(p);
  }

  /* --------------------------------------------------------------- UI */

  private drawPrompt(ui: UI): void {
    const t = ui.t;
    ui.background(t.surface, 18);
    ui.roundRect(0, 0, ui.w, ui.h, 18, undefined, withAlpha(t.accent, 0.45), 2);
    const pad = 34;

    ui.title(this.promptText, pad, 62, 38);
    if (this.promptSub) ui.paragraph(this.promptSub, pad, 96, ui.w - pad * 2, { size: 21, lineHeight: 29 });

    if (this.promptMode === 'distance') {
      const trackY = ui.h - 132;
      const trackW = ui.w - 80;
      ui.hit('nav:slider', 40, trackY - 26, trackW, 60, {});
      ui.bar(40, trackY, trackW, 12, (this.distanceValue - 2) / 28);
      const knobX = 40 + ((this.distanceValue - 2) / 28) * trackW;
      ui.circle(knobX, trackY + 6, 16, t.accent);
      ui.text('2 m', 40, trackY + 40, { size: 16, color: t.textMuted });
      ui.text('30 m', 40 + trackW, trackY + 40, { size: 16, color: t.textMuted, align: 'right' });
      ui.text(`${this.distanceValue.toFixed(1)} m`, ui.w / 2, trackY - 44, {
        size: 34, color: t.accent, align: 'center', weight: '700', font: t.fontDisplay,
      });
      ui.button('nav:confirm', ui.w - 240, ui.h - 66, 200, 52, { label: 'MEHET', variant: 'primary', fontSize: 20 });
    }

    if (this.promptMode !== 'distance') {
      ui.button('nav:teleport', pad, ui.h - 66, 300, 52, {
        label: this.teleportMode ? 'MOZGÁS: UGRÁS' : 'MOZGÁS: FOLYAMATOS',
        variant: 'quiet',
        fontSize: 18,
      });
    }
  }

  private mapPxToWorld(px: number, py: number): { x: number; z: number } {
    const s = this.mapScale();
    return {
      x: (px - this.mapPanel.pxW / 2) / s,
      z: (py - (this.mapPanel.pxH / 2 + 30)) / s,
    };
  }

  private mapScale(): number {
    const margin = 90;
    const usableW = this.mapPanel.pxW - margin * 2;
    const usableH = this.mapPanel.pxH - margin * 2 - 60;
    return Math.min(usableW / (this.world.extent.x * 2), usableH / (this.world.extent.z * 2));
  }

  private drawMap(ui: UI): void {
    const t = ui.t;
    ui.background(t.surface, 18);
    ui.roundRect(0, 0, ui.w, ui.h, 18, undefined, withAlpha(t.accent, 0.45), 2);
    const cx = ui.w / 2;
    const cy = ui.h / 2 + 30;
    const s = this.mapScale();

    ui.label(this.mapMode === 'position' ? 'HOL ÁLLSZ A TÉRKÉPEN?' : 'MERRE NÉZEL?', 30, 40, t.accent);
    ui.text('É', cx, 78, { size: 24, color: t.textMuted, align: 'center', weight: '700' });
    ui.line(cx, 88, cx, 104, withAlpha(t.textMuted, 0.6), 2);

    ui.hit('map:surface', 30, 110, ui.w - 60, ui.h - 190, {});

    // Edges then nodes, so nodes sit on top.
    for (const [a, b] of this.world.edges) {
      const na = this.world.nodes[a]!;
      const nb = this.world.nodes[b]!;
      ui.line(cx + na.x * s, cy + na.z * s, cx + nb.x * s, cy + nb.z * s, withAlpha(t.textMuted, 0.32), 2);
    }
    for (const n of this.world.nodes) {
      ui.circle(cx + n.x * s, cy + n.z * s, 7, withAlpha(t.textMuted, 0.75));
    }
    for (const lm of this.world.landmarks) {
      const x = cx + lm.x * s;
      const y = cy + lm.z * s;
      ui.circle(x, y, 10, `#${lm.color.toString(16).padStart(6, '0')}`);
      ui.text(lm.name.split(' ')[1] ?? lm.name, x, y - 20, {
        size: 13, color: t.textMuted, align: 'center', weight: '600',
      });
    }

    if (this.mapMode === 'position' && this.mapAnswer) {
      const x = cx + this.mapAnswer.x * s;
      const y = cy + this.mapAnswer.z * s;
      ui.circle(x, y, 14, undefined, t.accent, 4);
      ui.line(x - 20, y, x + 20, y, t.accent, 2);
      ui.line(x, y - 20, x, y + 20, t.accent, 2);
    }
    if (this.mapMode === 'heading') {
      const r = Math.min(ui.w, ui.h) * 0.28;
      ui.circle(cx, cy, r, undefined, withAlpha(t.textMuted, 0.4), 2);
      if (this.mapAnswer?.headingDeg !== undefined) {
        const a = ((this.mapAnswer.headingDeg - 90) * Math.PI) / 180;
        ui.line(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, t.accent, 5);
        ui.circle(cx, cy, 9, t.accent);
      }
    }

    ui.button('map:confirm', ui.w - 230, ui.h - 68, 200, 54, {
      label: 'MEHET', variant: 'primary', disabled: !this.mapAnswer, fontSize: 20,
    });
  }

  /* ------------------------------------------------------- housekeeping */

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;

    /* --- retrace --------------------------------------------------- */
    const fwd = this.retraceResults.find((r) => r.direction === 'forward');
    const rev = this.retraceResults.find((r) => r.direction === 'reverse');
    const fwdSuccess = fwd && fwd.total > 0 ? fwd.correct / fwd.total : NaN;
    const revSuccess = rev && rev.total > 0 ? rev.correct / rev.total : NaN;
    const reverseCost = Number.isFinite(fwdSuccess) && Number.isFinite(revSuccess) ? fwdSuccess - revSuccess : NaN;
    const wrongTurns = this.retraceResults.reduce((a, r) => a + r.wrongTurns, 0);
    const optimalSteps = this.retraceResults.reduce((a, r) => a + r.total, 0);
    const takenSteps = this.retraceResults.reduce((a, r) => a + r.total + r.wrongTurns, 0);
    const optimalRatio = optimalSteps > 0 ? takenSteps / optimalSteps : NaN;
    const recoveryTime = this.retraceResults.length
      ? mean(this.retraceResults.filter((r) => r.wrongTurns > 0).map((r) => r.ms / 1000 / Math.max(1, r.wrongTurns)))
      : NaN;

    /* --- JRD -------------------------------------------------------- */
    const jrdAbs = this.jrdResults.map((r) => r.absErr);
    const jrdError = median(jrdAbs);
    const jrdSd = stdev(jrdAbs);
    const jrdWithin45 = jrdAbs.length ? jrdAbs.filter((e) => e <= 45).length / jrdAbs.length : NaN;
    const jrdBias = circularMeanDeg(this.jrdResults.map((r) => r.signedErr));
    const jrdRt = median(this.jrdResults.map((r) => r.rtMs));

    /* --- path integration ------------------------------------------- */
    const triBearing = median(this.triangleResults.map((r) => r.bearingErr));
    const triRatios = this.triangleResults.map((r) => r.distRatio);
    const distCompression = median(triRatios);
    const triDistErr = median(this.triangleResults.map((r) => Math.abs(r.estDist - r.trueDist) / r.trueDist));

    /* --- map --------------------------------------------------------- */
    const mapPos = this.mapResults.filter((r) => r.mode === 'position');
    const mapHead = this.mapResults.filter((r) => r.mode === 'heading');
    const mapPosErr = median(mapPos.map((r) => r.error));
    const mapHeadErr = median(mapHead.map((r) => r.error));
    // Does the error grow with how far the participant's heading is from north?
    const alignmentCost = mapPos.length >= 3
      ? slope(mapPos.map((r) => r.headingOffset), mapPos.map((r) => r.error))
      : NaN;

    const M: [string, number, string, string?][] = [
      ['retrace_success_forward', fwdSuccess, 'ratio', 'retrace'],
      ['retrace_success_reverse', revSuccess, 'ratio', 'retrace'],
      ['reverse_route_cost', reverseCost, 'ratio', 'retrace'],
      ['wrong_turns', wrongTurns, 'count', 'retrace'],
      ['optimal_route_ratio', optimalRatio, 'ratio', 'retrace'],
      ['recovery_time', recoveryTime, 's', 'retrace'],
      ['jrd_absolute_error', jrdError, 'deg', 'jrd'],
      ['jrd_error_sd', jrdSd, 'deg', 'jrd'],
      ['jrd_within_45', jrdWithin45, 'ratio', 'jrd'],
      ['jrd_signed_bias', jrdBias, 'deg', 'jrd'],
      ['jrd_response_time', jrdRt, 'ms', 'jrd'],
      ['heading_error', jrdError, 'deg'],
      ['visual_path_integration_bearing_error', triBearing, 'deg', 'triangle'],
      ['visual_path_integration_distance_error', triDistErr, 'ratio', 'triangle'],
      ['distance_compression', distCompression, 'ratio', 'triangle'],
      ['map_position_error', mapPosErr, 'm', 'map'],
      ['map_heading_error', mapHeadErr, 'deg', 'map'],
      ['map_alignment_cost', alignmentCost, 'm/deg', 'map'],
      ['recall_accuracy', jrdWithin45, 'ratio'],
      ['body_turn_count', ctx.platform === 'vr' ? this.bodyTurnCount : NaN, 'count'],
      ['discomfort_reported', this.discomfortReported ? 1 : 0, 'flag'],
    ];
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    // 90 degrees is chance on the pointing task, so it anchors the bottom of
    // the survey-knowledge scale; 20 degrees is the good-performance band.
    // Provisional until this platform has its own normative sample.
    const survey = normaliseSoft(jrdError, 20, 90);
    const route = normaliseSoft(Number.isFinite(fwdSuccess) ? fwdSuccess : 0, 1.0, 0.45);
    const pathInt = this.triangleResults.length
      ? normaliseSoft(triBearing, 15, 75)
      : 0;
    const mapSkill = normaliseSoft(mapPosErr, 2, 14);
    const flexibility = normaliseSoft(Number.isFinite(reverseCost) ? reverseCost : 0.5, 0, 0.5);

    const components = [
      { key: 'survey_knowledge', value: survey, weight: 0.30 },
      { key: 'route_knowledge', value: route, weight: 0.22 },
      { key: 'path_integration', value: pathInt, weight: this.triangleResults.length ? 0.18 : 0 },
      { key: 'map_skill', value: mapSkill, weight: 0.16 },
      { key: 'route_flexibility', value: flexibility, weight: 0.14 },
    ];
    const ops = opsScore(components);

    rec.score('survey_knowledge', survey, '1.0.0');
    rec.score('route_knowledge', route, '1.0.0');
    if (this.triangleResults.length) rec.score('path_integration', pathInt, '1.0.0');
    rec.score('map_skill', mapSkill, '1.0.0');
    rec.score('route_flexibility', flexibility, '1.0.0');

    const fmt = (v: number, d = 0, s = '') => (Number.isFinite(v) ? `${v.toFixed(d)}${s}` : '—');
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

    return {
      opsScore: ops,
      headline: [
        { label: 'Iránybecslési hiba', value: fmt(jrdError, 0, '°'), hint: `45° alatt: ${pct(jrdWithin45)}` },
        { label: 'Útvonal-újrajárás', value: pct(fwdSuccess), hint: `fordítva ${pct(revSuccess)}` },
        { label: 'Útvonal-rugalmasság', value: fmt(reverseCost, 2) },
        {
          label: 'Útvonal-integráció',
          value: this.triangleResults.length ? fmt(triBearing, 0, '°') : 'kihagyva',
          hint: this.triangleResults.length ? `távolságarány ${fmt(distCompression, 2)}` : 'ugrásos mód',
        },
        { label: 'Térképpozíció', value: fmt(mapPosErr, 1, ' m'), hint: `irány ${fmt(mapHeadErr, 0, '°')}` },
        { label: 'Rossz kanyarok', value: `${wrongTurns}` },
      ],
      summary: {
        retrace: { forward: r(fwdSuccess, 3), reverse: r(revSuccess, 3), reverseCost: r(reverseCost, 3), wrongTurns, optimalRatio: r(optimalRatio, 3) },
        jrd: { medianAbsErrorDeg: r(jrdError, 1), sdDeg: r(jrdSd, 1), within45: r(jrdWithin45, 3), biasDeg: r(jrdBias, 1), rtMs: r(jrdRt) },
        pathIntegration: this.triangleResults.length
          ? { bearingErrorDeg: r(triBearing, 1), distanceError: r(triDistErr, 3), compression: r(distCompression, 3), n: this.triangleResults.length }
          : { skipped: true, reason: 'teleport_mode' },
        map: { positionErrorM: r(mapPosErr, 2), headingErrorDeg: r(mapHeadErr, 1), alignmentCost: r(alignmentCost, 4) },
        locomotionMode: this.teleportMode ? 'teleport' : 'glide',
        discomfortReported: this.discomfortReported,
        bodyTurns: ctx.platform === 'vr' ? this.bodyTurnCount : null,
        worldSeed: this.world?.seed ?? null,
        platform: ctx.platform,
        trialsScored: this.trials.length,
      },
      axisScores: {
        spatial: (survey + mapSkill) / 2,
        working_memory: route,
        attention: (survey + route) / 2,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.pointResolve?.(0);
    this.edgeResolve?.(this.currentNode);
    this.panelResolve?.();
    this.gliding?.resolve();
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.offPanel?.();
    this.hideEdgeArrows();
    this.vignette.removeFromParent();
    (this.vignette.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.vignette.material as THREE.Material).dispose();
    ctx.panels.remove(this.promptPanel);
    ctx.panels.remove(this.mapPanel);
    this.promptPanel.dispose();
    this.mapPanel.dispose();
    // Restore whatever atmosphere the Room established, or the next module
    // inherits this module's fog.
    ctx.scene.fog = this.savedFog;
    ctx.engine.rig.position.set(0, 0, 0);
    ctx.engine.rig.rotation.set(0, 0, 0);
    disposeTree(this.root);
  }
}

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}

void makeLabel;
void distanceBetween;
void shortestPath;
void ((_: NavLandmark) => _);
