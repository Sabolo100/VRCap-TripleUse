import * as THREE from 'three';
import {
  MODULE_BY_CODE, QUICK_PHRASES, SEAT_COLORS, seatLabel, opsScore, mean,
  type ModuleManifest, type RoundResult, type CommandPhase, type PlayerScore,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { placeInView } from '../../engine/ui/viewport.js';
import { Keyboard3D } from '../../engine/ui/Keyboard3D.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import { makePrimitive, makeLabel, disposeTree } from '../../engine/world/Primitives.js';
import { CommandBoard, TABLE_Y, unitById, taskById } from './CommandBoard.js';
import { CommandClient } from './CommandClient.js';
import { VoiceMesh } from './VoiceMesh.js';
import type { PanelClickEvent } from '../../engine/ui/PanelManager.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { store } from '../../app/state.js';

/**
 * MODULE 10 - COMMAND
 * Team problem solving, communication and leadership.
 *
 * Two to five participants stand around one abstract logistics board. The board
 * everyone can see is partly wrong, and each participant privately holds a
 * couple of corrections nobody else has. The optimal plan is unreachable unless
 * the team pools what it knows - so information sharing shows up in the score,
 * not only in the transcript.
 *
 *   ROUND A - LEADERLESS   anyone may move units; committing needs everyone ready.
 *   ROUND B - COMMAND      one participant is commander; only they commit, the
 *                          rest propose. A mid-round information update tests
 *                          how the team adapts once a plan already exists.
 *
 * Bots let a single person run the whole exercise: they hold real facts, share
 * them on a delay, and make proposals, so the module is demonstrable and
 * testable without assembling five people in headsets.
 */

type Tab = 'brief' | 'comms' | 'team';

export class CommandModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.COMMAND!;

  readonly blocks: BlockDescriptor[] = [

    {
      id: 'roundA',
      title: '1. KÖR — VEZETŐ NÉLKÜL',
      instruction: {
        vr:
          'Egy közös tábla körül álltok. A táblán látható adatok egy része hibás, és a javításokat a csapat ' +
          'tagjai külön-külön tudják — beszéljétek meg. Rendeljetek minden egységet egy feladathoz: mutass ' +
          'az egységre a sugárral, húzd meg a ravaszt, majd ugyanígy a feladat gyűrűjére. A markolatgombbal ' +
          'jelölhetsz a táblán. Nincs kijelölt vezető. A kiértékelés akkor indul, ha mindenki készre jelentkezett.',
        desktop:
          'Egy közös tábla körül ültök. A táblán látható adatok egy része hibás, és a javításokat a csapat ' +
          'tagjai külön-külön tudják — beszéljétek meg. Rendeljetek minden egységet egy feladathoz: kattints ' +
          'az egységre, majd a feladat gyűrűjére. Jobb kattintással jelölhetsz a táblán. Nincs kijelölt ' +
          'vezető. A kiértékelés akkor indul, ha mindenki készre jelentkezett.',
        mobile:
          'Egy közös tábla körül ültök. A táblán látható adatok egy része hibás, és a javításokat a csapat ' +
          'tagjai külön-külön tudják — beszéljétek meg. Rendeljetek minden egységet egy feladathoz: koppints ' +
          'az egységre, majd a feladat gyűrűjére. A JELÖLÉS gombbal jelölhetsz a táblán. Nincs kijelölt ' +
          'vezető. A kiértékelés akkor indul, ha mindenki készre jelentkezett.',
      },
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
    },
    {
      id: 'roundB',
      title: '2. KÖR — KIJELÖLT PARANCSNOK',
      instruction:
        'Ebben a körben egy kijelölt parancsnok dönt. A többiek javaslatot tehetnek és információt ' +
        'oszthatnak meg, de a tervet és a lezárást a parancsnok kezeli. A kör közben új információ érkezik — ' +
        'figyeljétek. A kezelés ugyanaz, mint az előbb.',
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
    },
  ];

  /* ---------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private board!: CommandBoard;
  private client = new CommandClient();
  private voice = new VoiceMesh(this.client);

  private planPanel!: Panel;
  private sidePanel!: Panel;
  private lobbyPanel!: Panel;
  private keyboard: Keyboard3D | null = null;
  private keyboardMode: 'join' | 'chat' | null = null;

  private avatars = new Map<string, THREE.Group>();
  private tab: Tab = 'brief';
  private lobbyMode: 'choose' | 'creating' | 'joining' | 'waiting' = 'choose';
  private botCount = 2;
  private joinCode = '';
  private offs: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private resolveLobby: (() => void) | null = null;
  private resolveRound: Record<string, (() => void) | null> = { roundA: null, roundB: null };
  private myScores: PlayerScore[] = [];
  private statusMessage = '';
  private seatRoot = new THREE.Group();

  /* ----------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);
    this.root.add(this.seatRoot);

    this.board = new CommandBoard(ctx.theme);
    this.seatRoot.add(this.board.group);

    // The plan surface floats just above and beyond the table, angled down so
    // it does not block the board from a standing viewpoint.
    this.planPanel = new Panel({ width: 1.25, height: 0.52, pxPerMeter: 900, theme: ctx.theme, name: 'cmd-plan' });
    this.planPanel.group.position.set(0, 1.44, -1.02);
    this.planPanel.group.rotation.x = -0.18;
    this.planPanel.setDraw((ui) => this.drawPlan(ui));
    this.root.add(this.planPanel.group);
    ctx.panels.add(this.planPanel);

    this.sidePanel = new Panel({ width: 0.78, height: 0.92, pxPerMeter: 900, theme: ctx.theme, name: 'cmd-side' });
    placeArc(this.sidePanel.group, 52, 1.32, 1.0);
    this.placeFlatPanels();
    this.sidePanel.setDraw((ui) => this.drawSide(ui));
    this.root.add(this.sidePanel.group);
    ctx.panels.add(this.sidePanel);

    this.lobbyPanel = new Panel({ width: 1.3, height: 0.86, pxPerMeter: 880, theme: ctx.theme, name: 'cmd-lobby' });
    this.lobbyPanel.group.position.set(0, 1.5, -1.55);
    this.lobbyPanel.setDraw((ui) => this.drawLobby(ui));
    this.root.add(this.lobbyPanel.group);
    ctx.panels.add(this.lobbyPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint();

    this.offs.push(ctx.panels.onClick((e) => this.onPanelClick(e)));
    this.offs.push(ctx.engine.input.on((e) => this.onAction(e)));
    this.offs.push(
      this.client.onChange(() => {
        this.planPanel.invalidate();
        this.sidePanel.invalidate();
        this.lobbyPanel.invalidate();
        this.board.setAssignment(this.client.state.assignment);
        this.syncAvatars();
        this.voice.syncPeers();
      })
    );
    this.offs.push(
      this.client.onPhase((p) => this.onPhase(p))
    );
    this.offs.push(
      this.client.onRoundResult((r) => {
        this.resolveRound[r.round === 'A' ? 'roundA' : 'roundB']?.();
      })
    );

    this.setBoardVisible(false);
  }

  /**
   * Touch controls.
   *
   * Assignment is two taps - a unit, then a target - which touch already does.
   * Marking the board was a grip press in the headset and a right click on a
   * laptop; a phone has neither, and "long press" is a gesture people discover
   * by accident if at all. It becomes a mode button instead.
   */
  private setupTouchControls(): void {
    this.ctx.mobileControls?.set({
      hint: 'Koppints egy egységre, majd a cél gyűrűjére.',
      buttons: [{
        id: 'mark', label: 'JELÖLÉS', sub: 'a következő koppintás jelöl a táblán',
        variant: 'ghost', wide: true, action: 'SECONDARY',
      }],
    });
  }

  /**
   * Where the two briefing panels go on a screen.
   *
   * In the headset they ring the table: the plan just above it, the side board
   * 52 degrees round, both a turn of the head away. A flat viewport has no
   * head to turn - the side board at -52 degrees is simply not on the screen,
   * and neither is the bottom of the plan on a phone. So on flat platforms
   * they are brought in front, above and beside the board, and fitted to the
   * viewport that actually exists.
   */
  private placeFlatPanels(): void {
    if (this.ctx.platform === 'vr') return;
    const eye = new THREE.Vector3(0, 1.6, 0);
    placeInView(this.ctx, this.planPanel.group, {
      eye, azDeg: 0, elDeg: 12, distanceM: 1.7,
      widthM: this.planPanel.width, heightM: this.planPanel.height,
    });
    this.planPanel.group.rotation.x = 0;
    placeInView(this.ctx, this.sidePanel.group, {
      eye, azDeg: -34, elDeg: -2, distanceM: 1.8,
      widthM: this.sidePanel.width, heightM: this.sidePanel.height,
    });
  }


  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'Sugár az egységre + RAVASZ, majd a feladat gyűrűjére + RAVASZ · MARKOLATGOMB: jelölés a táblán';
      case 'mobile': return 'Koppints az egységre, majd a feladat gyűrűjére · JELÖLÉS gomb: jelölés a táblán';
      default: return 'Kattints az egységre, majd a feladat gyűrűjére · jobb kattintás: jelölés a táblán';
    }
  }

  /* ---------------------------------------------------------- lobby */

  async calibrate(): Promise<void> {
    this.lobbyPanel.group.visible = true;
    this.planPanel.group.visible = false;
    this.sidePanel.group.visible = false;
    return new Promise<void>((resolve) => {
      this.resolveLobby = resolve;
    });
  }

  private onPhase(p: CommandPhase): void {
    this.ctx.recorder.event('command_phase', { phase: p, room: this.client.state.room });
    if (p === 'briefing' || p === 'roundA') {
      this.lobbyPanel.group.visible = false;
      this.planPanel.group.visible = true;
      this.sidePanel.group.visible = true;
      this.setBoardVisible(true);
      this.moveToSeat();
      this.resolveLobby?.();
      this.resolveLobby = null;
    }
    if (p === 'debrief') {
      this.resolveRound.roundA?.();
      this.resolveRound.roundB?.();
    }
  }

  private setBoardVisible(v: boolean): void {
    this.board.group.visible = v;
  }

  /** Put the player at their seat around the table and face them inwards. */
  private moveToSeat(): void {
    const s = this.client.state;
    const total = Math.max(2, s.members.length);
    const angle = (s.seat / total) * Math.PI * 2;
    const radius = 1.15;
    const rig = this.ctx.engine.rig;
    rig.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    rig.rotation.y = angle + Math.PI;
    // Panels are children of root (world space), so re-anchor them to the seat.
    this.root.position.copy(rig.position);
    this.root.rotation.y = rig.rotation.y;
    this.seatRoot.position.copy(rig.position).negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.rotation.y);
    this.seatRoot.rotation.y = -rig.rotation.y;
    this.ctx.recorder.event('seat_assigned', { seat: s.seat, angle: +angle.toFixed(3) });
  }

  /* --------------------------------------------------------- rounds */

  async runBlock(_ctx: ModuleContext, block: BlockDescriptor): Promise<void> {
    this.setupTouchControls();
    const key = block.id;
    const already = this.client.state.results.find((r) => (r.round === 'A') === (key === 'roundA'));
    if (already) return;
    await new Promise<void>((resolve) => {
      this.resolveRound[key] = resolve;
      // Safety valve: if the socket dies the module still has to end.
      const guard = setInterval(() => {
        if (!this.client.state.connected && this.client.state.error) {
          clearInterval(guard);
          resolve();
        }
      }, 2000);
      const orig = resolve;
      this.resolveRound[key] = () => { clearInterval(guard); orig(); };
    });
    this.resolveRound[key] = null;
  }

  /* ------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    this.board.update(dt);
    this.voice.update();

    // Avatar presence at ~12 Hz.
    if (this.client.state.connected && this.client.state.phase !== 'lobby') {
      this.client.sendPose(dt, this.localPose());
    }

    // Pings raised by other players.
    for (const p of this.client.state.pings) {
      if (!p.at || Date.now() - p.at > 200) continue;
      if (!this.seenPings.has(`${p.from}:${p.at}`)) {
        this.seenPings.add(`${p.from}:${p.at}`);
        this.board.addPing(p.x, p.z, p.seat);
      }
    }

    // Countdown needs a repaint roughly twice a second, not every frame.
    this.repaintTimer += dt;
    if (this.repaintTimer > 0.5) {
      this.repaintTimer = 0;
      this.planPanel.invalidate();
      if (this.keyboard) this.keyboard.tick();
    }

    for (const [id, g] of this.avatars) {
      const level = this.voice.levels.get(id) ?? 0;
      const halo = g.getObjectByName('halo') as THREE.Mesh | undefined;
      if (halo) (halo.material as THREE.MeshBasicMaterial).opacity = 0.15 + level * 0.7;
    }
    void ctx;
  }

  private repaintTimer = 0;
  private seenPings = new Set<string>();

  private localPose(): { head: number[]; left: number[]; right: number[] } {
    // Poses travel in seat-local space so a receiver can place them by applying
    // the sender's seat transform - no shared world origin needed.
    const world = this.ctx.engine.input.pose();
    const rig = this.ctx.engine.rig;
    const inv = new THREE.Matrix4().copy(rig.matrixWorld).invert();
    const conv = (a: number[]) => {
      if (a.length < 7) return [] as number[];
      const p = new THREE.Vector3(a[0]!, a[1]!, a[2]!).applyMatrix4(inv);
      const q = new THREE.Quaternion(a[3]!, a[4]!, a[5]!, a[6]!);
      const rq = new THREE.Quaternion().setFromRotationMatrix(inv).multiply(q);
      return [r3(p.x), r3(p.y), r3(p.z), r3(rq.x), r3(rq.y), r3(rq.z), r3(rq.w)];
    };
    return { head: conv(world.head), left: conv(world.left), right: conv(world.right) };
  }

  private syncAvatars(): void {
    const s = this.client.state;
    const total = Math.max(2, s.members.length);
    for (const m of s.members) {
      if (m.playerId === s.playerId) continue;
      let g = this.avatars.get(m.playerId);
      if (!g) {
        g = this.makeAvatar(m.seat, m.isBot);
        this.avatars.set(m.playerId, g);
        this.seatRoot.add(g);
      }
      const angle = (m.seat / total) * Math.PI * 2;
      const radius = 1.15;
      g.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
      g.rotation.y = angle + Math.PI;

      const pose = s.poses.get(m.playerId);
      const head = g.getObjectByName('head');
      if (head && pose && pose.head.length >= 7) {
        head.position.set(pose.head[0]!, pose.head[1]!, pose.head[2]!);
        head.quaternion.set(pose.head[3]!, pose.head[4]!, pose.head[5]!, pose.head[6]!);
      }
      for (const [name, arr] of [['handL', pose?.left], ['handR', pose?.right]] as const) {
        const hand = g.getObjectByName(name);
        if (!hand) continue;
        if (arr && arr.length >= 7) {
          hand.visible = true;
          hand.position.set(arr[0]!, arr[1]!, arr[2]!);
        } else {
          hand.visible = false;
        }
      }
      g.visible = m.connected;
    }
    for (const [id, g] of this.avatars) {
      if (!s.members.some((m) => m.playerId === id)) {
        disposeTree(g);
        this.avatars.delete(id);
      }
    }
  }

  private makeAvatar(seat: number, isBot: boolean): THREE.Group {
    const g = new THREE.Group();
    const color = SEAT_COLORS[seat % SEAT_COLORS.length]!;
    const head = makePrimitive({ kind: 'sphere', color, unlit: true, size: 0.2, opacity: isBot ? 0.55 : 0.9 });
    head.name = 'head';
    head.position.set(0, 1.6, 0);
    const halo = makePrimitive({ kind: 'torus', color, unlit: true, size: 0.3, opacity: 0.2 });
    halo.name = 'halo';
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 1.72, 0);
    const body = makePrimitive({ kind: 'capsule', color, unlit: true, opacity: 0.22, size: 0.4 });
    body.position.set(0, 1.15, 0);
    const handL = makePrimitive({ kind: 'sphere', color, unlit: true, size: 0.07, opacity: 0.8 });
    handL.name = 'handL';
    const handR = handL.clone();
    handR.name = 'handR';
    const label = makeLabel(`${seatLabel(seat)}${isBot ? ' · AI' : ''}`, { size: 40, color: '#e8eef5', scale: 0.0013 });
    label.position.set(0, 1.94, 0);
    g.add(head, halo, body, handL, handR, label);
    return g;
  }

  /* -------------------------------------------------------- input */

  private onAction(e: ActionEvent): void {
    if (!e.down) return;
    if (this.client.state.phase === 'lobby' || this.client.state.phase === 'briefing') return;

    const ray = e.ray ?? this.ctx.engine.input.primaryRay();
    if (!ray) return;
    this.raycaster.set(ray.origin, ray.direction);
    this.raycaster.far = 8;

    // The panels own the click when they are closer than the board.
    const panelHit = this.raycaster.intersectObjects(
      [this.planPanel.mesh, this.sidePanel.mesh, this.lobbyPanel.mesh, ...(this.keyboard ? [this.keyboard.panel.mesh] : [])],
      false
    )[0];
    const pick = this.board.raycast(this.raycaster);
    if (!pick) return;
    if (panelHit && panelHit.distance < pick.point.distanceTo(ray.origin)) return;

    if (e.action === 'SECONDARY') {
      this.client.ping(+pick.point.x.toFixed(3), +pick.point.z.toFixed(3));
      this.board.addPing(pick.point.x, pick.point.z, this.client.state.seat);
      this.ctx.recorder.event('board_ping', { x: pick.point.x, z: pick.point.z });
      return;
    }
    if (e.action !== 'PRIMARY') return;

    if (pick.kind === 'unit') {
      const next = this.board.selection === pick.id ? null : pick.id;
      this.board.setSelectedUnit(next);
      this.ctx.audio.click();
      this.ctx.recorder.event('unit_selected', { unitId: next });
      this.planPanel.invalidate();
      return;
    }

    if (pick.kind === 'task' && this.board.selection) {
      this.applyAssignment(this.board.selection, pick.id);
      this.board.setSelectedUnit(null);
      return;
    }

    if (pick.kind === 'table' || pick.kind === 'site') {
      this.board.setSelectedUnit(null);
      this.planPanel.invalidate();
    }
  }

  /** In round B only the commander edits the plan; everyone else proposes. */
  private applyAssignment(unitId: string, taskId: string | null): void {
    const s = this.client.state;
    const commanding = s.round === 'B' && s.role !== 'commander';
    if (commanding) {
      this.client.propose(unitId, taskId);
      this.statusMessage = 'Javaslat elküldve a parancsnoknak.';
      this.ctx.recorder.event('proposal_sent', { unitId, taskId });
    } else {
      this.client.assign(unitId, taskId);
      this.ctx.recorder.event('assignment_made', { unitId, taskId });
    }
    this.ctx.audio.ok();
    this.planPanel.invalidate();
  }

  private onPanelClick(e: PanelClickEvent): void {
    const id = e.widget.id;

    if (e.panel === this.lobbyPanel) return this.onLobbyClick(id);

    if (e.panel === this.planPanel) {
      if (id === 'plan:commit') {
        this.client.commit();
        this.ctx.recorder.event('commit_pressed', {});
      }
      if (id === 'plan:ready') {
        const me = this.client.me();
        this.client.ready(!me?.ready);
      }
      if (id.startsWith('plan:clear:')) {
        this.applyAssignment(id.slice('plan:clear:'.length), null);
      }
      if (id.startsWith('plan:unit:')) {
        const unitId = id.slice('plan:unit:'.length);
        this.board.setSelectedUnit(this.board.selection === unitId ? null : unitId);
        this.planPanel.invalidate();
      }
      return;
    }

    if (e.panel === this.sidePanel) {
      if (id.startsWith('side:tab:')) {
        this.tab = id.slice('side:tab:'.length) as Tab;
        this.sidePanel.invalidate();
      }
      if (id.startsWith('side:share:')) {
        const factId = id.slice('side:share:'.length);
        this.client.shareFact(factId);
        this.ctx.recorder.event('fact_shared', { factId });
        this.ctx.audio.ok();
      }
      if (id.startsWith('side:phrase:')) {
        const key = id.slice('side:phrase:'.length);
        const phrase = QUICK_PHRASES.find((p) => p.key === key);
        if (phrase) {
          this.client.chat(phrase.text);
          this.ctx.recorder.event('quick_phrase', { key });
        }
      }
      if (id === 'side:type') this.openKeyboard('chat');
      if (id === 'side:voice') void this.toggleVoice();
      if (id === 'side:mute') {
        this.voice.setMuted(!this.voice.muted);
        this.sidePanel.invalidate();
      }
      return;
    }
  }

  private async toggleVoice(): Promise<void> {
    if (this.voice.enabled) {
      this.voice.disable();
    } else {
      const ok = await this.voice.enable();
      if (!ok) this.statusMessage = this.voice.error ?? 'A hang nem elérhető.';
    }
    this.sidePanel.invalidate();
  }

  private onLobbyClick(id: string): void {
    const externalId = store.get().subject?.externalId ?? `VENDÉG-${Math.floor(Math.random() * 900 + 100)}`;
    const domain = this.ctx.domain;

    switch (id) {
      case 'lobby:create':
        this.lobbyMode = 'creating';
        this.lobbyPanel.invalidate();
        break;
      case 'lobby:join':
        this.lobbyMode = 'joining';
        this.openKeyboard('join');
        this.lobbyPanel.invalidate();
        break;
      case 'lobby:bots-':
        this.botCount = Math.max(0, this.botCount - 1);
        this.lobbyPanel.invalidate();
        break;
      case 'lobby:bots+':
        this.botCount = Math.min(4, this.botCount + 1);
        this.lobbyPanel.invalidate();
        break;
      case 'lobby:confirm-create':
        this.lobbyMode = 'waiting';
        void this.client.create(externalId, domain, { botCount: this.botCount });
        this.lobbyPanel.invalidate();
        break;
      case 'lobby:confirm-join':
        if (this.joinCode.length >= 4) {
          this.lobbyMode = 'waiting';
          void this.client.join(this.joinCode, externalId, domain);
          this.closeKeyboard();
          this.lobbyPanel.invalidate();
        }
        break;
      case 'lobby:ready': {
        const me = this.client.me();
        this.client.ready(!me?.ready);
        break;
      }
      case 'lobby:start':
        this.client.start();
        break;
      case 'lobby:back':
        this.lobbyMode = 'choose';
        this.closeKeyboard();
        this.lobbyPanel.invalidate();
        break;
    }
  }

  private openKeyboard(mode: 'join' | 'chat'): void {
    this.closeKeyboard();
    this.keyboardMode = mode;
    this.keyboard = new Keyboard3D(this.ctx.panels, {
      theme: this.ctx.theme,
      title: mode === 'join' ? 'SZOBAKÓD' : 'ÜZENET',
      forceUpper: mode === 'join',
      maxLength: mode === 'join' ? 6 : 140,
      onChange: (v) => {
        if (mode === 'join') { this.joinCode = v; this.lobbyPanel.invalidate(); }
      },
      onSubmit: (v) => {
        if (mode === 'join') {
          this.joinCode = v;
          this.onLobbyClick('lobby:confirm-join');
        } else {
          this.client.chat(v);
          this.ctx.recorder.event('chat_sent', { chars: v.length });
          this.closeKeyboard();
        }
      },
    });
    this.keyboard.panel.group.position.set(0, 1.02, -0.72);
    this.keyboard.panel.group.rotation.x = -0.55;
    this.root.add(this.keyboard.panel.group);
  }

  private closeKeyboard(): void {
    this.keyboard?.dispose();
    this.keyboard = null;
    this.keyboardMode = null;
  }

  /* --------------------------------------------------------- drawing */

  private drawLobby(ui: UI): void {
    const t = ui.t;
    const s = this.client.state;
    const pad = 44;
    ui.background(t.surface, 22);
    ui.roundRect(0, 0, ui.w, ui.h, 22, undefined, withAlpha(t.accent, 0.45), 2);

    ui.label('MODUL 10 · COMMAND', pad, 46, t.accent);
    ui.title('CSAPATFELADAT', pad, 96, 46);

    if (s.error) {
      ui.roundRect(pad, ui.h - 150, ui.w - pad * 2, 46, 10, withAlpha(t.bad, 0.2), t.bad, 2);
      ui.text(s.error, pad + 16, ui.h - 127, { size: 18, color: t.bad });
    }

    if (this.lobbyMode === 'choose') {
      ui.paragraph(
        '2-5 fő egy közös táblát lát. A táblán szereplő adatok egy része hibás, és a javításokat ' +
          'a résztvevők külön-külön ismerik. Egyedül is kipróbálható: az AI csapattársak valódi ' +
          'információt tartanak, és menet közben megosztják.',
        pad, 148, ui.w - pad * 2, { size: 21, lineHeight: 31, color: t.text }
      );
      const bw = (ui.w - pad * 2 - 20) / 2;
      ui.button('lobby:create', pad, 270, bw, 82, { label: 'ÚJ SZOBA', sub: 'te leszel a házigazda', variant: 'primary' });
      ui.button('lobby:join', pad + bw + 20, 270, bw, 82, { label: 'CSATLAKOZÁS', sub: 'szobakóddal', variant: 'ghost' });
      ui.divider(388);
      ui.label('MIT MÉRÜNK', pad, 418, t.textMuted);
      const items = [
        'ki oszt meg információt, és mikor',
        'kinek a javaslatát fogadja el a csapat',
        'mennyire optimális a végső terv',
        'hogyan reagál a csapat a menet közbeni változásra',
      ];
      items.forEach((s2, i) => {
        ui.circle(pad + 6, 452 + i * 30, 4, t.accent);
        ui.text(s2, pad + 22, 452 + i * 30, { size: 18, color: t.textMuted });
      });
      return;
    }

    if (this.lobbyMode === 'creating') {
      ui.paragraph(
        'Hány AI csapattárs legyen? Nullát választva meg kell várni az élő résztvevőket. ' +
          'Az AI társak ugyanúgy titkos információt tartanak, mint egy ember.',
        pad, 150, ui.w - pad * 2, { size: 20, lineHeight: 29 }
      );
      ui.button('lobby:bots-', pad, 236, 78, 78, { label: '−', variant: 'ghost', fontSize: 34 });
      ui.text(String(this.botCount), pad + 130, 275, { size: 62, color: t.accent, weight: '700', font: t.fontDisplay, align: 'center' });
      ui.label('AI TÁRS', pad + 130, 322, t.textMuted, 14, 'center');
      ui.button('lobby:bots+', pad + 190, 236, 78, 78, { label: '+', variant: 'ghost', fontSize: 34 });
      ui.button('lobby:confirm-create', ui.w - pad - 320, 250, 320, 76, { label: 'SZOBA LÉTREHOZÁSA', variant: 'primary', fontSize: 22 });
      ui.button('lobby:back', pad, ui.h - 96, 180, 62, { label: 'VISSZA', variant: 'quiet' });
      return;
    }

    if (this.lobbyMode === 'joining') {
      ui.paragraph('Írd be a házigazdától kapott négybetűs szobakódot.', pad, 150, ui.w - pad * 2, { size: 21 });
      ui.roundRect(pad, 208, 430, 90, 12, 'rgba(0,0,0,0.35)', withAlpha(t.accent, 0.6), 2);
      ui.text(this.joinCode || '– – – –', pad + 24, 253, { size: 54, font: t.fontMono, color: this.joinCode ? t.text : withAlpha(t.textMuted, 0.5) });
      ui.button('lobby:confirm-join', pad + 458, 208, 300, 90, {
        label: 'CSATLAKOZÁS', variant: 'primary', disabled: this.joinCode.length < 4,
      });
      ui.button('lobby:back', pad, ui.h - 96, 180, 62, { label: 'VISSZA', variant: 'quiet' });
      return;
    }

    // waiting
    ui.label('SZOBAKÓD', pad, 152, t.textMuted);
    ui.title(s.room ?? '····', pad, 210, 76, t.accent);
    ui.text(
      s.connected ? 'Csatlakozva. Oszd meg a kódot a többiekkel.' : 'Kapcsolódás…',
      pad, 268, { size: 20, color: s.connected ? t.ok : t.warn }
    );

    ui.label('RÉSZTVEVŐK', pad, 316, t.textMuted);
    s.members.forEach((m, i) => {
      const y = 348 + i * 52;
      ui.roundRect(pad, y, ui.w - pad * 2, 44, 9, 'rgba(0,0,0,0.22)');
      ui.circle(pad + 22, y + 22, 9, SEAT_COLORS[m.seat % SEAT_COLORS.length]!);
      ui.text(`${seatLabel(m.seat)} · ${m.externalId}`, pad + 42, y + 22, { size: 19, color: t.text, weight: '600' });
      if (m.isBot) ui.text('AI', pad + 300, y + 22, { size: 15, color: t.accent2, weight: '700', font: t.fontMono });
      ui.text(m.ready ? 'KÉSZ' : 'VÁR', ui.w - pad - 16, y + 22, {
        size: 16, color: m.ready ? t.ok : t.textMuted, align: 'right', weight: '700', font: t.fontMono,
      });
    });

    const me = this.client.me();
    ui.button('lobby:ready', pad, ui.h - 100, 280, 68, {
      label: me?.ready ? 'MÉGSEM' : 'KÉSZ VAGYOK', variant: me?.ready ? 'ghost' : 'primary',
    });
    if (this.client.isHost()) {
      const canStart = s.members.length >= 2 && s.members.every((m) => m.ready || m.isBot);
      ui.button('lobby:start', ui.w - pad - 280, ui.h - 100, 280, 68, {
        label: 'INDÍTÁS', variant: 'primary', disabled: !canStart,
      });
      if (!canStart) {
        ui.text('Legalább 2 résztvevő és mindenki készre jelentkezve.', pad + 300, ui.h - 66, { size: 16, color: t.textMuted });
      }
    }
  }

  private drawPlan(ui: UI): void {
    const t = ui.t;
    const s = this.client.state;
    const pad = 26;
    ui.background(withAlpha('#000000', 0.6), 18);
    ui.roundRect(0, 0, ui.w, ui.h, 18, undefined, withAlpha(t.accent, 0.4), 2);

    const roundLabel = s.round === 'B' ? '2. KÖR · PARANCSNOK' : '1. KÖR · VEZETŐ NÉLKÜL';
    ui.label(roundLabel, pad, 30, s.round === 'B' ? t.accent2 : t.accent);

    // Timer
    const left = s.phaseEndsAt ? Math.max(0, s.phaseEndsAt - Date.now()) : 0;
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    const urgent = left < 45000 && left > 0;
    ui.text(`${mm}:${String(ss).padStart(2, '0')}`, ui.w - pad, 34, {
      size: 38, color: urgent ? t.bad : t.text, align: 'right', weight: '700', font: t.fontMono,
    });

    if (s.role === 'commander') {
      ui.roundRect(pad + 250, 16, 150, 28, 14, withAlpha(t.accent, 0.9));
      ui.text('PARANCSNOK', pad + 325, 30, { size: 15, color: '#0a0d12', align: 'center', weight: '700' });
    }

    // Assignment row per unit
    const units = s.scenario?.units ?? [];
    const colW = (ui.w - pad * 2) / Math.max(1, units.length);
    units.forEach((u, i) => {
      const x = pad + i * colW;
      const y = 62;
      const assigned = s.assignment[u.id] ?? null;
      const selected = this.board.selection === u.id;
      const hovered = ui.hit(`plan:unit:${u.id}`, x, y, colW - 8, 92, {});
      ui.roundRect(x, y, colW - 8, 92, 10,
        selected ? withAlpha(t.accent, 0.24) : hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)',
        selected ? t.accent : withAlpha(t.textMuted, 0.25), 2);
      ui.text(u.id, x + 12, y + 24, { size: 22, color: t.text, weight: '700', font: t.fontDisplay });
      ui.text(`${u.resource} ·${u.capacity}`, x + 12, y + 48, { size: 15, color: t.textMuted, font: t.fontMono });
      ui.text(assigned ?? '—', x + colW - 24, y + 34, {
        size: 26, color: assigned ? t.accent : withAlpha(t.textMuted, 0.5), align: 'right', weight: '700', font: t.fontDisplay,
      });
      if (assigned) {
        ui.button(`plan:clear:${u.id}`, x + colW - 44, y + 58, 30, 26, { label: '×', variant: 'quiet', fontSize: 18 });
      }
    });

    // Status + actions
    const y2 = 168;
    const assignedCount = Object.values(s.assignment).filter(Boolean).length;
    ui.text(
      this.statusMessage || `${assignedCount} / ${units.length} egység kiosztva`,
      pad, y2 + 22, { size: 18, color: t.textMuted }
    );

    if (s.infoUpdate) {
      ui.roundRect(pad, y2 + 42, ui.w - pad * 2 - 320, 52, 9, withAlpha(t.warn, 0.18), t.warn, 2);
      ui.text('ÚJ INFORMÁCIÓ', pad + 14, y2 + 60, { size: 13, color: t.warn, weight: '700', font: t.fontMono });
      ui.text(s.infoUpdate, pad + 14, y2 + 80, { size: 16, color: t.text, maxWidth: ui.w - pad * 2 - 350 });
    }

    const me = this.client.me();
    const canCommit = s.round === 'B' ? s.role === 'commander' : true;
    if (canCommit) {
      ui.button('plan:commit', ui.w - pad - 300, y2 + 30, 300, 66, {
        label: s.round === 'B' ? 'TERV LEZÁRÁSA' : 'KÉSZ — LEZÁRÁS',
        variant: 'primary',
        disabled: assignedCount === 0,
      });
    } else {
      ui.button('plan:ready', ui.w - pad - 300, y2 + 30, 300, 66, {
        label: me?.ready ? 'KÉSZ ✓' : 'KÉSZ VAGYOK', variant: me?.ready ? 'ghost' : 'primary',
      });
    }

    // Ready pips
    s.members.forEach((m, i) => {
      const cx = pad + 12 + i * 26;
      ui.circle(cx, ui.h - 22, 8, m.ready ? t.ok : withAlpha(t.textMuted, 0.35));
    });
  }

  private drawSide(ui: UI): void {
    const t = ui.t;
    const pad = 24;
    ui.background(t.surface, 18);
    ui.roundRect(0, 0, ui.w, ui.h, 18, undefined, withAlpha(t.accent, 0.35), 2);

    const tabs: [Tab, string][] = [['brief', 'BRIEF'], ['comms', 'RÁDIÓ'], ['team', 'CSAPAT']];
    const tw = (ui.w - pad * 2 - 12) / 3;
    tabs.forEach(([id, label], i) => {
      ui.button(`side:tab:${id}`, pad + i * (tw + 6), 20, tw, 44, {
        label, variant: 'quiet', fontSize: 15, active: this.tab === id,
      });
    });
    ui.divider(78, pad, ui.w - pad * 2);

    if (this.tab === 'brief') this.drawBrief(ui, pad);
    else if (this.tab === 'comms') this.drawComms(ui, pad);
    else this.drawTeam(ui, pad);
  }

  private drawBrief(ui: UI, pad: number): void {
    const t = ui.t;
    const s = this.client.state;
    let y = 104;
    ui.label('CSAK TE TUDOD', pad, y, t.accent);
    y += 26;
    ui.paragraph(
      'Ezek a javítások nem szerepelnek a táblán, és a többiek nem látják őket. ' +
        'Megosztani a gomb megnyomásával lehet — a rendszer rögzíti, mit és mikor osztottál meg.',
      pad, y, ui.w - pad * 2, { size: 15, lineHeight: 21 }
    );
    y += 66;

    if (s.facts.length === 0) {
      ui.text('Nincs privát információd ebben a körben.', pad, y + 20, { size: 17, color: t.textMuted });
      return;
    }

    for (const f of s.facts) {
      const shared = s.sharedFactIds.includes(f.id);
      const h = 118;
      ui.roundRect(pad, y, ui.w - pad * 2, h, 11,
        shared ? withAlpha(t.ok, 0.1) : 'rgba(0,0,0,0.24)',
        shared ? withAlpha(t.ok, 0.5) : withAlpha(t.textMuted, 0.22), 2);
      ui.paragraph(f.text, pad + 14, y + 12, ui.w - pad * 2 - 28, { size: 16, lineHeight: 22, color: t.text, maxLines: 3 });
      ui.button(`side:share:${f.id}`, pad + 14, y + h - 46, ui.w - pad * 2 - 28, 36, {
        label: shared ? 'MEGOSZTVA ✓' : 'MEGOSZTOM A CSAPATTAL',
        variant: shared ? 'quiet' : 'primary',
        disabled: shared,
        fontSize: 15,
      });
      y += h + 10;
    }
  }

  private drawComms(ui: UI, pad: number): void {
    const t = ui.t;
    const s = this.client.state;
    const logTop = 96;
    const logH = ui.h - logTop - 210;
    ui.roundRect(pad, logTop, ui.w - pad * 2, logH, 10, 'rgba(0,0,0,0.28)');

    const entries = s.chat.slice(-9);
    let y = logTop + 14;
    for (const e of entries) {
      const color =
        e.kind === 'fact' ? t.accent
        : e.kind === 'system' ? t.warn
        : e.kind === 'proposal' ? t.accent2
        : SEAT_COLORS[e.seat % SEAT_COLORS.length]!;
      ui.text(e.kind === 'system' ? '⚑' : seatLabel(e.seat), pad + 12, y + 9, {
        size: 14, color, weight: '700', font: t.fontMono,
      });
      const endY = ui.paragraph(e.text, pad + 40, y, ui.w - pad * 2 - 54, {
        size: 15, lineHeight: 20, color: e.kind === 'chat' ? t.text : color, maxLines: 3,
      });
      y = endY + 8;
      if (y > logTop + logH - 24) break;
    }

    let by = ui.h - 198;
    ui.label('GYORSÜZENET', pad, by, t.textMuted);
    by += 20;
    const bw = (ui.w - pad * 2 - 8) / 2;
    QUICK_PHRASES.slice(0, 6).forEach((p, i) => {
      ui.button(`side:phrase:${p.key}`, pad + (i % 2) * (bw + 8), by + Math.floor(i / 2) * 42, bw, 36, {
        label: p.text.length > 22 ? p.text.slice(0, 21) + '…' : p.text,
        variant: 'ghost',
        fontSize: 13,
      });
    });
    by += 3 * 42 + 8;
    const half = (ui.w - pad * 2 - 8) / 2;
    ui.button('side:type', pad, by, half, 42, { label: 'ÍRÁS', variant: 'ghost', fontSize: 16 });
    ui.button(this.voice.enabled ? 'side:mute' : 'side:voice', pad + half + 8, by, half, 42, {
      label: this.voice.enabled ? (this.voice.muted ? '🎤 NÉMÍTVA' : '🎤 ÉLŐ') : '🎤 HANG BE',
      variant: this.voice.enabled && !this.voice.muted ? 'primary' : 'ghost',
      fontSize: 15,
    });
  }

  private drawTeam(ui: UI, pad: number): void {
    const t = ui.t;
    const s = this.client.state;
    let y = 104;
    ui.label(`SZOBA ${s.room ?? ''}`, pad, y, t.accent);
    y += 30;
    for (const m of s.members) {
      ui.roundRect(pad, y, ui.w - pad * 2, 52, 9, 'rgba(0,0,0,0.22)');
      ui.circle(pad + 20, y + 26, 9, SEAT_COLORS[m.seat % SEAT_COLORS.length]!);
      ui.text(`${seatLabel(m.seat)} · ${m.externalId}`, pad + 40, y + 20, { size: 16, color: t.text, weight: '600' });
      const role = m.role === 'commander' ? 'parancsnok' : m.isBot ? 'AI társ' : 'tag';
      ui.text(role, pad + 40, y + 38, { size: 13, color: t.textMuted });
      ui.text(m.connected ? '●' : '○', ui.w - pad - 16, y + 26, {
        size: 18, color: m.connected ? t.ok : t.bad, align: 'right',
      });
      y += 58;
    }

    y += 12;
    ui.label('JAVASLATOK', pad, y, t.textMuted);
    y += 24;
    const recent = s.proposals.slice(-5);
    if (recent.length === 0) {
      ui.text('Még nincs javaslat.', pad, y + 12, { size: 15, color: t.textMuted });
    }
    for (const p of recent) {
      ui.text(
        `${seatLabel(p.seat)}: ${p.unitId} → ${p.taskId ?? 'nincs'}`,
        pad, y + 12,
        { size: 15, color: p.adopted ? t.ok : t.textMuted, font: t.fontMono }
      );
      y += 26;
    }
  }

  /* --------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const s = this.client.state;
    const rec = ctx.recorder;
    const mine = s.results
      .map((r) => r.players.find((p) => p.playerId === s.playerId))
      .filter((p): p is PlayerScore => !!p);
    this.myScores = mine;

    const roundA = s.results.find((r) => r.round === 'A');
    const roundB = s.results.find((r) => r.round === 'B');

    const teamOptimality = mean(s.results.map((r) => r.outcome.optimality).filter(Number.isFinite));
    const infoCoverage = mean(s.results.map((r) => r.infoCoverage).filter(Number.isFinite));
    const timeToCommit = mean(s.results.map((r) => r.timeToCommitMs).filter(Number.isFinite));
    const revisions = mean(s.results.map((r) => r.revisions).filter(Number.isFinite));

    const metricAvg = (key: string) => {
      const vals = mine.map((p) => p.metrics[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return vals.length ? mean(vals) : NaN;
    };

    const shareRate = metricAvg('information_sharing_rate');
    const firstShare = metricAvg('time_to_first_share_ms');
    const adoption = metricAvg('adoption_rate');
    const leadership = metricAvg('leadership_index');
    const talkShare = metricAvg('talk_share');
    const questions = metricAvg('questions_asked');
    const responsiveness = metricAvg('responsiveness');
    const adaptation = roundB?.players.find((p) => p.playerId === s.playerId)?.metrics.adaptation_after_update ?? NaN;

    const M: [string, number, string][] = [
      ['plan_optimality', teamOptimality, 'ratio'],
      ['information_coverage', infoCoverage, 'ratio'],
      ['information_sharing_rate', shareRate, 'ratio'],
      ['time_to_first_share', firstShare, 'ms'],
      ['time_to_commit', timeToCommit, 'ms'],
      ['plan_revisions', revisions, 'count'],
      ['proposal_adoption_rate', adoption, 'ratio'],
      ['leadership_index', leadership, 'index'],
      ['talk_share', talkShare, 'ratio'],
      ['questions_asked', questions, 'count'],
      ['responsiveness', responsiveness, 'ratio'],
      ['adaptation_after_update', adaptation, 'ratio'],
      ['round_a_optimality', roundA?.outcome.optimality ?? NaN, 'ratio'],
      ['round_b_optimality', roundB?.outcome.optimality ?? NaN, 'ratio'],
    ];
    for (const [n, v, u] of M) rec.metric(n, v, u);

    const ops = mine.length
      ? Math.round(mean(mine.map((p) => p.opsScore)))
      : opsScore([
          { key: 'team', value: (teamOptimality || 0) * 100, weight: 1 },
        ]);

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const sec = (v: number) => (Number.isFinite(v) ? `${Math.round(v / 1000)} s` : '—');

    return {
      opsScore: ops,
      headline: [
        { label: 'Terv optimalitása', value: pct(teamOptimality), hint: 'csapatszintű' },
        { label: 'Megosztott információ', value: pct(infoCoverage), hint: 'csapat összesen' },
        { label: 'Saját megosztási arány', value: pct(shareRate) },
        { label: 'Javaslat-elfogadás', value: pct(adoption) },
        { label: 'Vezetői index', value: Number.isFinite(leadership) ? leadership.toFixed(2) : '—' },
        { label: 'Lezárásig eltelt idő', value: sec(timeToCommit) },
      ],
      summary: {
        room: s.room,
        seat: s.seat,
        role: s.role,
        members: s.members.map((m) => ({ seat: m.seat, id: m.externalId, bot: m.isBot, role: m.role })),
        rounds: s.results.map((r) => ({
          round: r.round,
          achieved: r.outcome.achievedValue,
          optimal: r.outcome.optimalValue,
          optimality: +r.outcome.optimality.toFixed(3),
          timeToCommitMs: r.timeToCommitMs,
          infoCoverage: +r.infoCoverage.toFixed(3),
          revisions: r.revisions,
        })),
        myMetrics: mine.map((p) => p.metrics),
        voiceUsed: this.voice.enabled,
        platform: ctx.platform,
      },
      axisScores: {
        team: Number.isFinite(leadership) ? Math.min(100, leadership * 100) : (teamOptimality || 0) * 100,
        decision_style: (teamOptimality || 0) * 100,
        working_memory: Number.isFinite(shareRate) ? shareRate * 100 : 0,
      },
    };
  }

  abort(): void {
    this.resolveLobby?.();
    this.resolveRound.roundA?.();
    this.resolveRound.roundB?.();
    this.client.close();
  }

  dispose(ctx: ModuleContext): void {
    for (const off of this.offs) off();
    this.closeKeyboard();
    this.voice.disable();
    this.client.close();
    ctx.panels.remove(this.planPanel);
    ctx.panels.remove(this.sidePanel);
    ctx.panels.remove(this.lobbyPanel);
    this.planPanel.dispose();
    this.sidePanel.dispose();
    this.lobbyPanel.dispose();
    for (const g of this.avatars.values()) disposeTree(g);
    this.avatars.clear();
    this.board.dispose();
    // Put the rig back where the hub expects it.
    ctx.engine.rig.position.set(0, 0, 0);
    ctx.engine.rig.rotation.set(0, 0, 0);
    disposeTree(this.root);
  }
}

function placeArc(obj: THREE.Object3D, deg: number, height: number, dist: number): void {
  const a = THREE.MathUtils.degToRad(deg);
  obj.position.set(-Math.sin(a) * dist, height - 0.5, -Math.cos(a) * dist);
  obj.rotation.y = a;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

void TABLE_Y;
void unitById;
void taskById;
