import * as THREE from 'three';
import {
  MODULE_BY_CODE, BLOCK_COLORS, BLOCK_COLOR_HEX, STRUCTURE_PHRASES, SEAT_COLORS, seatLabel, mean,
  type ModuleManifest, type BlockColor, type Inventory, type PlayerScore,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import { makePrimitive, makeLabel, disposeTree } from '../../engine/world/Primitives.js';
import { CommandClient } from './CommandClient.js';
import { VoiceMesh } from './VoiceMesh.js';
import type { PanelClickEvent } from '../../engine/ui/PanelManager.js';
import { store } from '../../app/state.js';

/**
 * MODULE 10 - COMMAND, variant B
 * What you can see from where you are standing.
 *
 * Variant A hands each participant a card with two corrections nobody else
 * has. It works, but the asymmetry is administrative: the system dealt it out.
 *
 * Here a cluster of coloured blocks floats between the participants, and
 * because the blocks occlude one another, each seat sees a different subset.
 * Nobody sees all of them. The team has to agree on the complete inventory -
 * how many blocks of each colour - and that is only possible by describing
 * what you can see from where you stand.
 *
 * Two failures become separable, and they have different causes:
 *
 *   UNDER-COUNTING means someone's view never made it into the tally - a
 *   failure to contribute, or to be listened to.
 *
 *   OVER-COUNTING means the same block was reported twice by two people who
 *   did not realise they were describing the same thing - a failure of shared
 *   spatial reference. Avoiding it requires the team to build a common frame
 *   ("the top of the structure") rather than each speaking from their own side
 *   ("on my left"), and the phrase set is split so that choice is recorded.
 */

type BlockId = 'roundA' | 'roundB';
type Tab = 'view' | 'comms' | 'team';

export class CommandSpatialModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.COMMAND!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'roundA',
      title: '1. KÖR — VEZETŐ NÉLKÜL',
      instruction:
        'Egy térbeli szerkezet lebeg köztetek. A blokkok TAKARJÁK EGYMÁST, ezért mindenki mást lát — ' +
        'és senki nem látja az összeset. Állapodjatok meg, hány darab van minden színből. ' +
        'Vigyázzatok: amit ketten láttok, azt csak egyszer szabad számolni.',
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
    },
    {
      id: 'roundB',
      title: '2. KÖR — KIJELÖLT PARANCSNOK',
      instruction:
        'Új szerkezet, és most kijelölt parancsnok vezeti a leltárt. A többiek jelentik, amit látnak. ' +
        'A nézőpontok is változtak — amit az előbb láttál, most lehet, hogy takarásban van.',
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  private structureGroup = new THREE.Group();
  private client = new CommandClient();
  private voice = new VoiceMesh(this.client);

  private tallyPanel!: Panel;
  private sidePanel!: Panel;
  private lobbyPanel!: Panel;
  private blockMeshes = new Map<number, THREE.Mesh>();
  private avatars = new Map<string, THREE.Group>();

  private tab: Tab = 'view';
  private lobbyMode: 'choose' | 'creating' | 'waiting' = 'choose';
  private botCount = 2;
  private offs: (() => void)[] = [];
  private resolveLobby: (() => void) | null = null;
  private resolveRound: Record<string, (() => void) | null> = { roundA: null, roundB: null };
  private statusMessage = '';
  private aborted = false;
  private repaintTimer = 0;

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);
    this.root.add(this.structureGroup);

    this.tallyPanel = new Panel({ width: 1.15, height: 0.46, pxPerMeter: 900, theme: ctx.theme, name: 'cmdb-tally' });
    this.tallyPanel.setDraw((ui) => this.drawTally(ui));
    this.tallyPanel.group.visible = false;
    this.root.add(this.tallyPanel.group);
    ctx.panels.add(this.tallyPanel);

    this.sidePanel = new Panel({ width: 0.78, height: 0.9, pxPerMeter: 900, theme: ctx.theme, name: 'cmdb-side' });
    this.sidePanel.setDraw((ui) => this.drawSide(ui));
    this.sidePanel.group.visible = false;
    this.root.add(this.sidePanel.group);
    ctx.panels.add(this.sidePanel);

    this.lobbyPanel = new Panel({ width: 1.3, height: 0.84, pxPerMeter: 880, theme: ctx.theme, name: 'cmdb-lobby' });
    this.lobbyPanel.group.position.set(0, 1.5, -1.55);
    this.lobbyPanel.setDraw((ui) => this.drawLobby(ui));
    this.root.add(this.lobbyPanel.group);
    ctx.panels.add(this.lobbyPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint();

    this.offs.push(ctx.panels.onClick((e) => this.onPanelClick(e)));
    this.offs.push(this.client.onChange(() => {
      this.tallyPanel.invalidate();
      this.sidePanel.invalidate();
      this.lobbyPanel.invalidate();
      this.rebuildStructure();
      this.syncAvatars();
      this.voice.syncPeers();
    }));
    this.offs.push(this.client.onPhase((p) => {
      ctx.recorder.event('command_phase', { phase: p, variant: 'B', room: this.client.state.room });
      if (p === 'briefing' || p === 'roundA') {
        this.lobbyPanel.group.visible = false;
        this.tallyPanel.group.visible = true;
        this.sidePanel.group.visible = true;
        this.moveToSeat();
        this.resolveLobby?.();
        this.resolveLobby = null;
      }
      if (p === 'debrief') { this.resolveRound.roundA?.(); this.resolveRound.roundB?.(); }
    }));
    this.offs.push(this.client.onRoundResult((r) => {
      this.resolveRound[r.round === 'A' ? 'roundA' : 'roundB']?.();
    }));
  }

  private controlHint(): string {
    return this.ctx.platform === 'vr'
      ? 'Fordulj körbe és nézd meg a szerkezetet minden irányból, amit elérsz. A számokat a táblán állítod.'
      : 'Nézd meg a szerkezetet. A számokat a táblán állítod. A nézőpontod rögzített — ez a lényeg.';
  }

  /* ---------------------------------------------------------- lobby */

  async calibrate(): Promise<void> {
    this.lobbyPanel.group.visible = true;
    return new Promise<void>((resolve) => { this.resolveLobby = resolve; });
  }

  async runBlock(_ctx: ModuleContext, block: BlockDescriptor): Promise<void> {
    const key = block.id;
    if (this.client.state.results.find((r) => (r.round === 'A') === (key === 'roundA'))) return;
    await new Promise<void>((resolve) => {
      const guard = setInterval(() => {
        if (!this.client.state.connected && this.client.state.error) { clearInterval(guard); resolve(); }
      }, 2000);
      this.resolveRound[key] = () => { clearInterval(guard); resolve(); };
    });
    this.resolveRound[key] = null;
  }

  /* ------------------------------------------------------- structure */

  private rebuildStructure(): void {
    const sc = this.client.state.structure;
    if (!sc) return;
    // Rebuild only when the structure actually changed (round B re-seats).
    if (this.builtSeed === sc.seed && this.blockMeshes.size === sc.blocks.length) return;
    this.builtSeed = sc.seed;

    for (const m of this.blockMeshes.values()) disposeTree(m);
    this.blockMeshes.clear();

    for (const b of sc.blocks) {
      const mesh = makePrimitive({
        kind: 'box',
        color: BLOCK_COLOR_HEX[b.color as BlockColor],
        unlit: true,
        size: b.size * 2,
      });
      mesh.position.set(b.x, b.y, b.z);
      mesh.rotation.set(0, 0, 0);
      this.structureGroup.add(mesh);
      this.blockMeshes.set(b.id, mesh);
    }
  }

  private builtSeed = -1;

  /** Put the participant at their seat, facing the structure. */
  private moveToSeat(): void {
    const sc = this.client.state.structure;
    const seat = this.client.state.seat;
    const rig = this.ctx.engine.rig;
    const sp = sc?.seatPositions.find((s) => s.seat === seat);
    if (sp) {
      rig.position.set(sp.x, 0, sp.z);
      rig.rotation.y = sp.yaw;
    }
    // Panels anchor to the seat so they stay put while the participant looks
    // around the structure - which is the actual task here.
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.tallyPanel.group.position.set(
      sp ? sp.x * 0.42 : 0, 0.95, sp ? sp.z * 0.42 : -1.1
    );
    this.tallyPanel.group.lookAt(rig.position.x, 1.35, rig.position.z);
    const side = sp ? new THREE.Vector3(sp.x, 0, sp.z).normalize() : new THREE.Vector3(0, 0, -1);
    const perp = new THREE.Vector3(-side.z, 0, side.x);
    this.sidePanel.group.position.copy(
      new THREE.Vector3(sp?.x ?? 0, 1.35, sp?.z ?? 0)
        .addScaledVector(side, -0.75).addScaledVector(perp, 0.95)
    );
    this.sidePanel.group.lookAt(rig.position.x, 1.4, rig.position.z);
    this.ctx.recorder.event('seat_assigned', { seat, variant: 'B' });
  }

  private syncAvatars(): void {
    const s = this.client.state;
    const sc = s.structure;
    if (!sc) return;
    for (const m of s.members) {
      if (m.playerId === s.playerId) continue;
      let g = this.avatars.get(m.playerId);
      if (!g) {
        g = this.makeAvatar(m.seat, m.isBot);
        this.avatars.set(m.playerId, g);
        this.root.add(g);
      }
      const sp = sc.seatPositions.find((x) => x.seat === m.seat);
      if (sp) { g.position.set(sp.x, 0, sp.z); g.rotation.y = sp.yaw; }
      const pose = s.poses.get(m.playerId);
      const head = g.getObjectByName('head');
      if (head && pose && pose.head.length >= 7) {
        head.position.set(pose.head[0]!, pose.head[1]!, pose.head[2]!);
        head.quaternion.set(pose.head[3]!, pose.head[4]!, pose.head[5]!, pose.head[6]!);
      }
      g.visible = m.connected;
    }
    for (const [id, g] of this.avatars) {
      if (!s.members.some((m) => m.playerId === id)) { disposeTree(g); this.avatars.delete(id); }
    }
  }

  private makeAvatar(seat: number, isBot: boolean): THREE.Group {
    const g = new THREE.Group();
    const color = SEAT_COLORS[seat % SEAT_COLORS.length]!;
    const head = makePrimitive({ kind: 'sphere', color, unlit: true, size: 0.2, opacity: isBot ? 0.5 : 0.85 });
    head.name = 'head';
    head.position.set(0, 1.6, 0);
    const body = makePrimitive({ kind: 'capsule', color, unlit: true, opacity: 0.2, size: 0.4 });
    body.position.set(0, 1.15, 0);
    const label = makeLabel(`${seatLabel(seat)}${isBot ? ' · AI' : ''}`, { size: 40, color: '#e8eef5', scale: 0.0013 });
    label.position.set(0, 1.94, 0);
    g.add(head, body, label);
    return g;
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    if (this.client.state.connected && this.client.state.phase !== 'lobby') {
      this.client.sendPose(dt, ctx.engine.input.pose());
    }
    this.voice.update();
    this.repaintTimer += dt;
    if (this.repaintTimer > 0.5) { this.repaintTimer = 0; this.tallyPanel.invalidate(); }
  }

  /* --------------------------------------------------------------- UI */

  private adjust(colour: BlockColor, delta: number): void {
    const next: Inventory = { ...this.client.state.inventory };
    next[colour] = Math.max(0, (next[colour] ?? 0) + delta);
    this.client.setInventory(next);
    this.ctx.recorder.event('inventory_edit', { colour, delta, value: next[colour] });
  }

  private onPanelClick(e: PanelClickEvent): void {
    if (e.panel === this.lobbyPanel) { this.onLobbyClick(e.widget.id); return; }

    if (e.panel === this.tallyPanel) {
      const id = e.widget.id;
      if (id.startsWith('inv:')) {
        const [, colour, dir] = id.split(':');
        this.adjust(colour as BlockColor, dir === 'up' ? 1 : -1);
        this.ctx.audio.click();
      }
      if (id === 'inv:commit') { this.client.commit(); this.ctx.recorder.event('commit_pressed', { variant: 'B' }); }
      if (id === 'inv:ready') { const me = this.client.me(); this.client.ready(!me?.ready); }
      if (id === 'inv:mine') {
        // Fill in what this seat alone can see. Useful, and revealing: a team
        // where everyone does this and nobody reconciles will over-count badly.
        const sc = this.client.state.structure;
        if (!sc) return;
        const mine: Inventory = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 };
        for (const b of sc.blocks) {
          if (this.client.state.visibleBlockIds.includes(b.id)) mine[b.color as BlockColor]++;
        }
        this.client.setInventory(mine);
        this.statusMessage = 'A saját nézeted beírva — de a többiek mást látnak.';
        this.ctx.recorder.event('inventory_own_view_filled', mine);
      }
      return;
    }

    if (e.panel === this.sidePanel) {
      const id = e.widget.id;
      if (id.startsWith('side:tab:')) { this.tab = id.slice(9) as Tab; this.sidePanel.invalidate(); }
      if (id.startsWith('side:phrase:')) {
        const key = id.slice('side:phrase:'.length);
        const phrase = STRUCTURE_PHRASES.find((p) => p.key === key);
        if (phrase) {
          this.client.chat(phrase.text);
          this.ctx.recorder.event('spatial_phrase', { key, frame: phrase.frame });
        }
      }
      if (id === 'side:voice') void this.toggleVoice();
    }
  }

  private async toggleVoice(): Promise<void> {
    if (this.voice.enabled) this.voice.disable();
    else if (!(await this.voice.enable())) this.statusMessage = this.voice.error ?? 'A hang nem elérhető.';
    this.sidePanel.invalidate();
  }

  private onLobbyClick(id: string): void {
    const externalId = store.get().subject?.externalId ?? `VENDÉG-${Math.floor(Math.random() * 900 + 100)}`;
    switch (id) {
      case 'lobby:create': this.lobbyMode = 'creating'; this.lobbyPanel.invalidate(); break;
      case 'lobby:bots-': this.botCount = Math.max(0, this.botCount - 1); this.lobbyPanel.invalidate(); break;
      case 'lobby:bots+': this.botCount = Math.min(4, this.botCount + 1); this.lobbyPanel.invalidate(); break;
      case 'lobby:confirm-create':
        this.lobbyMode = 'waiting';
        void this.client.create(externalId, this.ctx.domain, { botCount: this.botCount, variant: 'B' });
        this.lobbyPanel.invalidate();
        break;
      case 'lobby:ready': { const me = this.client.me(); this.client.ready(!me?.ready); break; }
      case 'lobby:start': this.client.start(); break;
      case 'lobby:back': this.lobbyMode = 'choose'; this.lobbyPanel.invalidate(); break;
    }
  }

  private drawLobby(ui: UI): void {
    const t = ui.t;
    const s = this.client.state;
    const pad = 44;
    ui.background(t.surface, 22);
    ui.roundRect(0, 0, ui.w, ui.h, 22, undefined, withAlpha(t.accent2, 0.5), 2);
    ui.label('MODUL 10 · COMMAND — TÉRBELI VÁLTOZAT', pad, 46, t.accent2);
    ui.title('AMIT ONNAN LÁTSZ', pad, 96, 44);

    if (s.error) {
      ui.roundRect(pad, ui.h - 150, ui.w - pad * 2, 46, 10, withAlpha(t.bad, 0.2), t.bad, 2);
      ui.text(s.error, pad + 16, ui.h - 127, { size: 18, color: t.bad });
    }

    if (this.lobbyMode === 'choose') {
      ui.paragraph(
        'Egy térbeli szerkezet lebeg köztetek, és a blokkok takarják egymást. Mindenki más részletet lát, ' +
          'és senki nem látja az összeset. A feladat: megállapodni, hány darab van minden színből. ' +
          'Egyedül is kipróbálható AI társakkal — ők is csak a saját nézetüket ismerik.',
        pad, 150, ui.w - pad * 2, { size: 21, lineHeight: 31, color: t.text }
      );
      ui.button('lobby:create', pad, 290, ui.w - pad * 2, 82, { label: 'ÚJ SZOBA', sub: 'te leszel a házigazda', variant: 'primary' });
      ui.divider(400);
      ui.label('MIT MÉRÜNK', pad, 430, t.textMuted);
      const items = [
        'bekerül-e a leltárba, amit csak te látsz',
        'sikerül-e elkerülni a kétszer számolást',
        'közös térbeli nyelvet használtok-e, vagy mindenki a saját oldaláról beszél',
      ];
      items.forEach((x, i) => {
        ui.circle(pad + 6, 464 + i * 30, 4, t.accent2);
        ui.text(x, pad + 22, 464 + i * 30, { size: 18, color: t.textMuted });
      });
      return;
    }

    if (this.lobbyMode === 'creating') {
      ui.paragraph('Hány AI csapattárs legyen? Ők is csak a saját ülőhelyükről látnak.',
        pad, 150, ui.w - pad * 2, { size: 20, lineHeight: 29 });
      ui.button('lobby:bots-', pad, 236, 78, 78, { label: '−', variant: 'ghost', fontSize: 34 });
      ui.text(String(this.botCount), pad + 130, 275, { size: 62, color: t.accent2, weight: '700', font: t.fontDisplay, align: 'center' });
      ui.button('lobby:bots+', pad + 190, 236, 78, 78, { label: '+', variant: 'ghost', fontSize: 34 });
      ui.button('lobby:confirm-create', ui.w - pad - 320, 250, 320, 76, { label: 'SZOBA LÉTREHOZÁSA', variant: 'primary', fontSize: 22 });
      ui.button('lobby:back', pad, ui.h - 96, 180, 62, { label: 'VISSZA', variant: 'quiet' });
      return;
    }

    ui.label('SZOBAKÓD', pad, 152, t.textMuted);
    ui.title(s.room ?? '····', pad, 210, 76, t.accent2);
    ui.text(s.connected ? 'Csatlakozva.' : 'Kapcsolódás…', pad, 268, { size: 20, color: s.connected ? t.ok : t.warn });
    s.members.forEach((m, i) => {
      const y = 320 + i * 50;
      ui.roundRect(pad, y, ui.w - pad * 2, 42, 9, 'rgba(0,0,0,0.22)');
      ui.circle(pad + 22, y + 21, 9, SEAT_COLORS[m.seat % SEAT_COLORS.length]!);
      ui.text(`${seatLabel(m.seat)} · ${m.externalId}`, pad + 42, y + 21, { size: 18, color: t.text, weight: '600' });
      ui.text(m.ready ? 'KÉSZ' : 'VÁR', ui.w - pad - 16, y + 21, {
        size: 15, color: m.ready ? t.ok : t.textMuted, align: 'right', weight: '700', font: t.fontMono,
      });
    });
    const me = this.client.me();
    ui.button('lobby:ready', pad, ui.h - 100, 280, 68, { label: me?.ready ? 'MÉGSEM' : 'KÉSZ VAGYOK', variant: me?.ready ? 'ghost' : 'primary' });
    if (this.client.isHost()) {
      const canStart = s.members.length >= 2 && s.members.every((m) => m.ready || m.isBot);
      ui.button('lobby:start', ui.w - pad - 280, ui.h - 100, 280, 68, { label: 'INDÍTÁS', variant: 'primary', disabled: !canStart });
    }
  }

  private drawTally(ui: UI): void {
    const t = ui.t;
    const s = this.client.state;
    const pad = 26;
    ui.background(withAlpha('#000000', 0.62), 18);
    ui.roundRect(0, 0, ui.w, ui.h, 18, undefined, withAlpha(t.accent2, 0.45), 2);

    ui.label(s.round === 'B' ? '2. KÖR · PARANCSNOK' : '1. KÖR · VEZETŐ NÉLKÜL', pad, 30, s.round === 'B' ? t.accent2 : t.accent);
    const left = s.phaseEndsAt ? Math.max(0, s.phaseEndsAt - Date.now()) : 0;
    ui.text(`${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`,
      ui.w - pad, 34, { size: 34, color: left < 45000 && left > 0 ? t.bad : t.text, align: 'right', weight: '700', font: t.fontMono });

    const canEdit = s.round !== 'B' || s.role === 'commander';
    const colW = (ui.w - pad * 2) / BLOCK_COLORS.length;
    BLOCK_COLORS.forEach((c, i) => {
      const x = pad + i * colW;
      const hex = `#${BLOCK_COLOR_HEX[c].toString(16).padStart(6, '0')}`;
      ui.circle(x + 26, 84, 12, hex);
      ui.text(c, x + 46, 84, { size: 17, color: t.textMuted, weight: '600' });
      ui.text(String(s.inventory[c] ?? 0), x + colW / 2, 132, {
        size: 46, color: t.text, align: 'center', weight: '700', font: t.fontDisplay,
      });
      ui.button(`inv:${c}:down`, x + 8, 158, colW / 2 - 12, 44, { label: '−', variant: 'ghost', fontSize: 26, disabled: !canEdit });
      ui.button(`inv:${c}:up`, x + colW / 2 + 4, 158, colW / 2 - 12, 44, { label: '+', variant: 'ghost', fontSize: 26, disabled: !canEdit });
    });

    ui.text(this.statusMessage || (canEdit ? 'Állítsd a számokat, majd zárd le.' : 'A parancsnok vezeti a leltárt.'),
      pad, 232, { size: 17, color: t.textMuted });

    ui.button('inv:mine', pad, ui.h - 74, 280, 54, { label: 'A SAJÁT NÉZETEM', variant: 'quiet', fontSize: 17, disabled: !canEdit });
    if (canEdit) {
      ui.button('inv:commit', ui.w - pad - 300, ui.h - 74, 300, 54, {
        label: s.round === 'B' ? 'LELTÁR LEZÁRÁSA' : 'KÉSZ — LEZÁRÁS', variant: 'primary', fontSize: 19,
      });
    } else {
      const me = this.client.me();
      ui.button('inv:ready', ui.w - pad - 300, ui.h - 74, 300, 54, {
        label: me?.ready ? 'KÉSZ ✓' : 'KÉSZ VAGYOK', variant: me?.ready ? 'ghost' : 'primary', fontSize: 19,
      });
    }
    s.members.forEach((m, i) => ui.circle(pad + 12 + i * 24, ui.h - 96, 7, m.ready ? t.ok : withAlpha(t.textMuted, 0.35)));
  }

  private drawSide(ui: UI): void {
    const t = ui.t;
    const s = this.client.state;
    const pad = 24;
    ui.background(t.surface, 18);
    ui.roundRect(0, 0, ui.w, ui.h, 18, undefined, withAlpha(t.accent2, 0.35), 2);

    const tabs: [Tab, string][] = [['view', 'NÉZETEM'], ['comms', 'RÁDIÓ'], ['team', 'CSAPAT']];
    const tw = (ui.w - pad * 2 - 12) / 3;
    tabs.forEach(([id, label], i) => {
      ui.button(`side:tab:${id}`, pad + i * (tw + 6), 20, tw, 44, {
        label, variant: 'quiet', fontSize: 15, active: this.tab === id,
      });
    });
    ui.divider(78, pad, ui.w - pad * 2);

    if (this.tab === 'view') {
      const sc = s.structure;
      let y = 108;
      ui.label('AMIT INNEN LÁTSZ', pad, y, t.accent2);
      y += 32;
      if (!sc) { ui.text('Várakozás a szerkezetre…', pad, y, { size: 17, color: t.textMuted }); return; }

      const mine: Record<string, number> = {};
      for (const b of sc.blocks) {
        if (s.visibleBlockIds.includes(b.id)) mine[b.color] = (mine[b.color] ?? 0) + 1;
      }
      BLOCK_COLORS.forEach((c) => {
        const hex = `#${BLOCK_COLOR_HEX[c].toString(16).padStart(6, '0')}`;
        ui.circle(pad + 12, y + 12, 10, hex);
        ui.text(c, pad + 32, y + 12, { size: 17, color: t.text, weight: '600' });
        ui.text(String(mine[c] ?? 0), ui.w - pad - 12, y + 12, {
          size: 24, color: t.text, align: 'right', weight: '700', font: t.fontDisplay,
        });
        y += 38;
      });
      y += 14;
      ui.divider(y);
      y += 24;
      ui.paragraph(
        `${s.visibleBlockIds.length} blokkot látsz a ${sc.blocks.length}-ból. ` +
          `Ebből ${s.privilegedCount} olyan, amit a többség NEM lát — ezeket rajtad kívül más aligha jelenti.`,
        pad, y, ui.w - pad * 2, { size: 16, lineHeight: 23, color: t.textMuted }
      );
      y += 96;
      ui.paragraph(
        'Fordulj körbe és nézd meg a szerkezetet minden szögből, amit elérsz — a takarás a helyzeteddel változik.',
        pad, y, ui.w - pad * 2, { size: 15, lineHeight: 21, color: withAlpha(t.textMuted, 0.8) }
      );
      return;
    }

    if (this.tab === 'comms') {
      const logTop = 96;
      const logH = ui.h - logTop - 230;
      ui.roundRect(pad, logTop, ui.w - pad * 2, logH, 10, 'rgba(0,0,0,0.28)');
      let y = logTop + 12;
      for (const e of s.chat.slice(-8)) {
        const color = e.kind === 'system' ? t.warn : SEAT_COLORS[e.seat % SEAT_COLORS.length]!;
        ui.text(e.kind === 'system' ? '⚑' : seatLabel(e.seat), pad + 12, y + 9, {
          size: 14, color, weight: '700', font: t.fontMono,
        });
        y = ui.paragraph(e.text, pad + 40, y, ui.w - pad * 2 - 54, {
          size: 15, lineHeight: 20, color: e.kind === 'system' ? color : t.text, maxLines: 3,
        }) + 8;
        if (y > logTop + logH - 22) break;
      }

      let by = ui.h - 218;
      ui.label('TÉRBELI KÖZLÉS', pad, by, t.textMuted);
      by += 20;
      const bw = (ui.w - pad * 2 - 8) / 2;
      STRUCTURE_PHRASES.slice(0, 6).forEach((p, i) => {
        // Egocentric and allocentric phrasings are visually distinguished,
        // because which frame the team converges on is part of the measurement.
        ui.button(`side:phrase:${p.key}`, pad + (i % 2) * (bw + 8), by + Math.floor(i / 2) * 42, bw, 36, {
          label: p.text.length > 24 ? p.text.slice(0, 23) + '…' : p.text,
          variant: p.frame === 'allocentric' ? 'primary' : 'ghost',
          fontSize: 12,
        });
      });
      by += 3 * 42 + 10;
      ui.button('side:voice', pad, by, ui.w - pad * 2, 42, {
        label: this.voice.enabled ? '🎤 ÉLŐ' : '🎤 HANG BE',
        variant: this.voice.enabled ? 'primary' : 'ghost', fontSize: 15,
      });
      return;
    }

    let y = 108;
    ui.label(`SZOBA ${s.room ?? ''}`, pad, y, t.accent2);
    y += 30;
    for (const m of s.members) {
      ui.roundRect(pad, y, ui.w - pad * 2, 52, 9, 'rgba(0,0,0,0.22)');
      ui.circle(pad + 20, y + 26, 9, SEAT_COLORS[m.seat % SEAT_COLORS.length]!);
      ui.text(`${seatLabel(m.seat)} · ${m.externalId}`, pad + 40, y + 20, { size: 16, color: t.text, weight: '600' });
      ui.text(m.role === 'commander' ? 'parancsnok' : m.isBot ? 'AI társ' : 'tag', pad + 40, y + 38, { size: 13, color: t.textMuted });
      ui.text(m.connected ? '●' : '○', ui.w - pad - 16, y + 26, { size: 18, color: m.connected ? t.ok : t.bad, align: 'right' });
      y += 58;
    }
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const s = this.client.state;
    const rec = ctx.recorder;
    const mine = s.results
      .map((r) => r.players.find((p) => p.playerId === s.playerId))
      .filter((p): p is PlayerScore => !!p);

    const avg = (key: string) => {
      const v = mine.map((p) => p.metrics[key]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      return v.length ? mean(v) : NaN;
    };
    const errOf = (round: 'A' | 'B') => s.results.find((r) => r.round === round)?.structureOutcome?.totalAbsError ?? NaN;
    const overOf = (round: 'A' | 'B') => s.results.find((r) => r.round === round)?.structureOutcome?.overCount ?? NaN;
    const underOf = (round: 'A' | 'B') => s.results.find((r) => r.round === round)?.structureOutcome?.underCount ?? NaN;

    const totalErr = mean([errOf('A'), errOf('B')].filter(Number.isFinite));
    const overCount = mean([overOf('A'), overOf('B')].filter(Number.isFinite));
    const underCount = mean([underOf('A'), underOf('B')].filter(Number.isFinite));
    const aloneErr = mean(s.results.map((r) => r.bestSingleSeatError ?? NaN).filter(Number.isFinite));
    const optimality = mean(s.results.map((r) => r.outcome.optimality).filter(Number.isFinite));
    const infoCoverage = mean(s.results.map((r) => r.infoCoverage).filter(Number.isFinite));
    // The measurement that justifies the variant: did the team beat what the
    // single best-placed person could have done without talking to anyone?
    const poolingGain = Number.isFinite(aloneErr) && Number.isFinite(totalErr) ? aloneErr - totalErr : NaN;

    const M: [string, number, string][] = [
      ['inventory_error', totalErr, 'blocks'],
      ['over_count', overCount, 'blocks'],
      ['under_count', underCount, 'blocks'],
      ['best_single_seat_error', aloneErr, 'blocks'],
      ['pooling_gain', poolingGain, 'blocks'],
      ['plan_optimality', optimality, 'ratio'],
      ['information_coverage', infoCoverage, 'ratio'],
      ['privileged_blocks', avg('privileged_blocks'), 'count'],
      ['privilege_weight', avg('privilege_weight'), 'index'],
      ['view_share', avg('view_share'), 'ratio'],
      ['inventory_edits', avg('inventory_edits'), 'count'],
      ['allocentric_ratio', avg('allocentric_ratio'), 'ratio'],
      ['spatial_phrases', avg('spatial_phrases'), 'count'],
      ['leadership_index', avg('leadership_index'), 'index'],
      ['talk_share', avg('talk_share'), 'ratio'],
    ];
    for (const [n, v, u] of M) rec.metric(n, v, u);

    const ops = mine.length ? Math.round(mean(mine.map((p) => p.opsScore))) : 0;
    const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');

    return {
      opsScore: ops,
      headline: [
        { label: 'Leltár eltérése', value: num(totalErr, 1), hint: `egyedül ${num(aloneErr, 1)} lett volna` },
        {
          label: 'Nyereség a megosztásból',
          value: num(poolingGain, 1),
          hint: Number.isFinite(poolingGain) && poolingGain > 0 ? 'a beszélgetés segített' : 'nem hozott többet',
        },
        { label: 'Kétszer számolt', value: num(overCount, 1), hint: 'közös hivatkozás hiánya' },
        { label: 'Kimaradt', value: num(underCount, 1), hint: 'be nem jelentett nézet' },
        { label: 'Csak te láttad', value: num(avg('privileged_blocks'), 1), hint: `a nézeted ${pct(avg('view_share'))}` },
        {
          label: 'Közös térbeli nyelv',
          value: pct(avg('allocentric_ratio')),
          hint: 'a szerkezethez kötött megfogalmazás aránya',
        },
      ],
      summary: {
        variant: 'B',
        room: s.room,
        seat: s.seat,
        role: s.role,
        rounds: s.results.map((r) => ({
          round: r.round,
          error: r.structureOutcome?.totalAbsError ?? null,
          over: r.structureOutcome?.overCount ?? null,
          under: r.structureOutcome?.underCount ?? null,
          perColour: r.structureOutcome?.perColour ?? null,
          submitted: r.submittedInventory ?? null,
          truth: r.trueInventory ?? null,
          bestSingleSeatError: r.bestSingleSeatError ?? null,
          optimality: +(r.outcome.optimality ?? 0).toFixed(3),
        })),
        myMetrics: mine.map((p) => p.metrics),
        members: s.members.map((m) => ({ seat: m.seat, id: m.externalId, bot: m.isBot, role: m.role })),
        voiceUsed: this.voice.enabled,
        platform: ctx.platform,
      },
      axisScores: {
        team: Number.isFinite(avg('leadership_index')) ? Math.min(100, avg('leadership_index') * 100) : 0,
        spatial: Number.isFinite(avg('allocentric_ratio')) ? avg('allocentric_ratio') * 100 : 0,
        decision_style: (optimality || 0) * 100,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.resolveLobby?.();
    this.resolveRound.roundA?.();
    this.resolveRound.roundB?.();
    this.client.close();
  }

  dispose(ctx: ModuleContext): void {
    for (const off of this.offs) off();
    this.voice.disable();
    this.client.close();
    ctx.panels.remove(this.tallyPanel);
    ctx.panels.remove(this.sidePanel);
    ctx.panels.remove(this.lobbyPanel);
    this.tallyPanel.dispose();
    this.sidePanel.dispose();
    this.lobbyPanel.dispose();
    for (const g of this.avatars.values()) disposeTree(g);
    this.avatars.clear();
    for (const m of this.blockMeshes.values()) disposeTree(m);
    this.blockMeshes.clear();
    ctx.engine.rig.position.set(0, 0, 0);
    ctx.engine.rig.rotation.set(0, 0, 0);
    disposeTree(this.root);
    void this.aborted;
  }
}
