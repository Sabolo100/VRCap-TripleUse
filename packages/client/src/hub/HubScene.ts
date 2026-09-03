import * as THREE from 'three';
import {
  DOMAINS, modulesForDomain, axesForDomain, isRunnable, runnableVariants,
  type DomainCode, type ModuleManifest, type RunSummary, type VariantId,
} from '@vrcap/shared';
import type { Engine } from '../engine/core/Engine.js';
import { Panel, type UI } from '../engine/ui/Panel.js';
import { PanelManager, type PanelClickEvent } from '../engine/ui/PanelManager.js';
import { Keyboard3D } from '../engine/ui/Keyboard3D.js';
import { themeForDomain, withAlpha, type UITheme } from '../engine/ui/UITheme.js';
import { Room } from '../engine/world/Room.js';
import { makeLabel, makePrimitive, disposeTree } from '../engine/world/Primitives.js';
import { store } from '../app/state.js';
import { api } from '../app/api.js';

/**
 * THE ARRIVAL SPACE (VR version).
 *
 * Same content as the flat hub, arranged as three panels on an arc around the
 * user: what the system is (left), the module wall (centre), identity and
 * results (right). Entering VR once should be enough for a whole session, so
 * signing in, choosing a module, reading results and starting the next module
 * all happen in here - never by taking the headset off.
 */

export interface HubSceneCallbacks {
  onStartModule: (m: ModuleManifest, variant?: VariantId) => void;
  onSignIn: (externalId: string) => Promise<void>;
  onSignOut: () => void;
  onExitVR: () => void;
  onChangeDomain: () => void;
}

type RightTab = 'identity' | 'results' | 'profile';

const PAGE_SIZE = 6;

export class HubScene {
  readonly scene = new THREE.Scene();
  readonly panels: PanelManager;
  private engine: Engine;
  private domain: DomainCode;
  private theme: UITheme;
  private room: Room;
  private root = new THREE.Group();

  private infoPanel: Panel;
  private modulePanel: Panel;
  private sidePanel: Panel;
  private keyboard: Keyboard3D | null = null;

  private page = 0;
  private rightTab: RightTab = 'identity';
  private cb: HubSceneCallbacks;
  private offClick: () => void;
  private offFrame: () => void;
  private offState: () => void;
  private titleSprite: THREE.Sprite;
  private orbs: THREE.Mesh[] = [];
  private disposed = false;

  constructor(engine: Engine, domain: DomainCode, cb: HubSceneCallbacks) {
    this.engine = engine;
    this.domain = domain;
    this.cb = cb;
    this.theme = themeForDomain(domain);
    this.panels = new PanelManager(engine);

    this.room = new Room(this.scene, domain);
    this.scene.add(this.root);

    const d = DOMAINS[domain];

    // Title floating above the module wall.
    this.titleSprite = makeLabel(d.copy.productName, {
      size: 74,
      color: d.palette.text,
      font: d.fontDisplay,
      scale: 0.0018,
    });
    this.titleSprite.position.set(0, 2.42, -2.05);
    this.root.add(this.titleSprite);

    const sub = makeLabel(d.copy.tagline, {
      size: 40,
      color: d.palette.textMuted,
      font: d.fontBody,
      scale: 0.0018,
    });
    sub.position.set(0, 2.22, -2.05);
    this.root.add(sub);

    /* ------------------------------------------------ panels on an arc */

    this.infoPanel = new Panel({ width: 0.92, height: 1.12, pxPerMeter: 880, theme: this.theme, name: 'hub-info' });
    place(this.infoPanel.group, 44, 2.15, 1.42);
    this.root.add(this.infoPanel.group);

    this.modulePanel = new Panel({ width: 1.62, height: 1.16, pxPerMeter: 860, theme: this.theme, name: 'hub-modules' });
    this.modulePanel.group.position.set(0, 1.44, -2.0);
    this.root.add(this.modulePanel.group);

    this.sidePanel = new Panel({ width: 0.92, height: 1.12, pxPerMeter: 880, theme: this.theme, name: 'hub-side' });
    place(this.sidePanel.group, -44, 2.15, 1.42);
    this.root.add(this.sidePanel.group);

    this.panels.add(this.infoPanel);
    this.panels.add(this.modulePanel);
    this.panels.add(this.sidePanel);

    this.infoPanel.setDraw((ui) => this.drawInfo(ui));
    this.modulePanel.setDraw((ui) => this.drawModules(ui));
    this.sidePanel.setDraw((ui) => this.drawSide(ui));

    this.buildAmbientOrbs();

    this.offClick = this.panels.onClick((e) => this.onClick(e));
    this.offFrame = engine.onFrame((dt) => this.update(dt));
    this.offState = store.subscribe(() => {
      this.infoPanel.invalidate();
      this.modulePanel.invalidate();
      this.sidePanel.invalidate();
    });
  }

  /** Slowly drifting primitives - a sign of life without adding stimulus noise. */
  private buildAmbientOrbs(): void {
    const p = DOMAINS[this.domain].palette;
    const kinds = ['sphere', 'box', 'cone', 'torus'] as const;
    for (let i = 0; i < 7; i++) {
      const m = makePrimitive({
        kind: kinds[i % kinds.length]!,
        color: i % 2 ? p.accent : p.accent2,
        unlit: true,
        opacity: 0.22,
        size: 0.1 + Math.random() * 0.16,
      });
      const a = (i / 7) * Math.PI * 2;
      m.position.set(Math.cos(a) * (3.4 + Math.random()), 0.7 + Math.random() * 2.2, Math.sin(a) * (3.4 + Math.random()) - 1);
      m.userData.spin = 0.1 + Math.random() * 0.3;
      m.userData.baseY = m.position.y;
      m.userData.phase = Math.random() * Math.PI * 2;
      this.orbs.push(m);
      this.root.add(m);
    }
  }

  private t = 0;
  private update(dt: number): void {
    if (this.disposed) return;
    this.room.update(dt);
    this.t += dt;
    for (const o of this.orbs) {
      o.rotation.y += dt * (o.userData.spin as number);
      o.rotation.x += dt * 0.12;
      o.position.y = (o.userData.baseY as number) + Math.sin(this.t * 0.5 + (o.userData.phase as number)) * 0.14;
    }
    if (this.keyboard) this.keyboard.tick();
  }

  /* --------------------------------------------------------- drawing */

  private drawInfo(ui: UI): void {
    const t = ui.t;
    const d = DOMAINS[this.domain];
    const pad = 34;
    ui.background(t.surface, 20);
    ui.roundRect(0, 0, ui.w, ui.h, 20, undefined, withAlpha(t.accent, 0.4), 2);

    ui.label(`TERÜLET ${this.domain} · ${d.shortLabel}`, pad, 44, t.accent);
    ui.title('MIRŐL SZÓL', pad, 92, 36);
    let y = ui.paragraph(d.copy.intro, pad, 126, ui.w - pad * 2, { size: 19, lineHeight: 29, color: t.text });

    y += 22;
    ui.divider(y);
    y += 26;
    ui.label('HOGYAN MŰKÖDIK', pad, y, t.textMuted);
    y += 26;
    const steps = [
      'Válassz modult a középső falról.',
      'Rövid leírás, majd gyakorlás visszajelzéssel.',
      'Mért rész — itt már nincs segítség.',
      `Eredmény: ${d.copy.scoreName} és részletes mutatók.`,
    ];
    steps.forEach((s, i) => {
      ui.circle(pad + 11, y + 13, 11, withAlpha(t.accent, 0.9));
      ui.text(String(i + 1), pad + 11, y + 14, { size: 14, color: '#0a0d12', align: 'center', weight: '700' });
      ui.paragraph(s, pad + 32, y + 3, ui.w - pad * 2 - 32, { size: 17, lineHeight: 24, color: t.text, maxLines: 2 });
      y += 40;
    });

    y += 8;
    ui.divider(y);
    y += 24;
    ui.label('ADATKEZELÉS', pad, y, t.textMuted);
    y += 22;
    ui.paragraph(
      'Nevet nem tárolunk, csak pszeudonim azonosítót. Belépés nélkül is kipróbálhatsz mindent, ' +
        'de akkor az eredmény nem kerül profilhoz.',
      pad, y, ui.w - pad * 2, { size: 16, lineHeight: 23 }
    );

    ui.button('info:exit', pad, ui.h - 84, (ui.w - pad * 2 - 12) / 2, 60, { label: 'KILÉPÉS VR-BŐL', variant: 'ghost', fontSize: 19 });
    ui.button('info:domain', pad + (ui.w - pad * 2 + 12) / 2, ui.h - 84, (ui.w - pad * 2 - 12) / 2, 60, {
      label: 'TERÜLET', variant: 'quiet', fontSize: 19,
    });
  }

  private drawModules(ui: UI): void {
    const t = ui.t;
    const d = DOMAINS[this.domain];
    const mods = modulesForDomain(this.domain);
    const pages = Math.ceil(mods.length / PAGE_SIZE);
    const pad = 30;

    ui.background(t.surface, 22);
    ui.roundRect(0, 0, ui.w, ui.h, 22, undefined, withAlpha(t.accent, 0.45), 2);

    ui.label(`${d.copy.moduleNoun.toUpperCase()}OK`, pad, 40, t.accent);
    ui.title(`${mods.length} MODUL EBBEN A TERÜLETBEN`, pad, 78, 32);
    ui.text(
      `${mods.filter(isRunnable).length} indítható most · a többi specifikálva, fejlesztés alatt`,
      pad, 112, { size: 17, color: t.textMuted }
    );

    const startY = 142;
    const cols = 2;
    const cardW = (ui.w - pad * 2 - 16) / cols;
    const cardH = 226;
    const slice = mods.slice(this.page * PAGE_SIZE, this.page * PAGE_SIZE + PAGE_SIZE);

    slice.forEach((m, i) => {
      const x = pad + (i % cols) * (cardW + 16);
      const y = startY + Math.floor(i / cols) * (cardH + 12);
      this.drawModuleCard(ui, m, x, y, cardW, cardH);
    });

    // Pagination
    const py = ui.h - 62;
    ui.button('mod:prev', pad, py - 22, 120, 52, { label: '‹', variant: 'ghost', disabled: this.page === 0, fontSize: 26 });
    ui.text(`${this.page + 1} / ${pages}`, pad + 150, py + 4, { size: 20, color: t.textMuted, weight: '600', font: t.fontMono });
    ui.button('mod:next', pad + 232, py - 22, 120, 52, {
      label: '›', variant: 'ghost', disabled: this.page >= pages - 1, fontSize: 26,
    });

    const s = store.get();
    const who = s.subject ? s.subject.externalId : 'NÉVTELEN PRÓBA';
    ui.text(who, ui.w - pad, py + 4, { size: 19, color: s.subject ? t.ok : t.warn, align: 'right', weight: '600', font: t.fontMono });
  }

  private drawModuleCard(ui: UI, m: ModuleManifest, x: number, y: number, w: number, h: number): void {
    const t = ui.t;
    const prof = m.domains[this.domain];
    const runnable = isRunnable(m);
    const hasVariants = !!m.variants && m.variants.length > 1;
    const id = `mod:start:${m.code}`;
    // With two forms the whole card must not be a start button: the choice is
    // between two different tasks, so each gets its own explicit control.
    const hovered = runnable && !hasVariants ? ui.hit(id, x, y, w, h, { data: m }) : false;

    const fill = runnable
      ? hovered ? withAlpha(t.accent, 0.18) : 'rgba(255,255,255,0.035)'
      : 'rgba(255,255,255,0.015)';
    const border = runnable ? (hovered ? t.accent : withAlpha(t.textMuted, 0.3)) : withAlpha(t.textMuted, 0.16);
    ui.roundRect(x, y, w, h, 14, fill, border, hovered ? 3 : 2);

    const alpha = runnable ? 1 : 0.45;
    ui.roundRect(x + 16, y + 16, 46, 30, 7, withAlpha(t.accent, runnable ? 0.9 : 0.25));
    ui.text(m.ordinal, x + 39, y + 32, { size: 17, color: runnable ? '#0a0d12' : t.textMuted, align: 'center', weight: '700', font: t.fontMono });
    ui.text(m.title, x + 74, y + 32, {
      size: 26, color: withAlpha(t.text, alpha), weight: '700', font: t.fontDisplay,
    });

    ui.text(prof.headline ?? m.subtitle, x + 16, y + 66, {
      size: 16, color: withAlpha(t.textMuted, alpha), maxWidth: w - 32,
    });

    ui.paragraph(prof.rationale ?? m.summary, x + 16, y + 82, w - 32, {
      size: 15, lineHeight: 21, color: withAlpha(t.textMuted, alpha * 0.9), maxLines: hasVariants ? 2 : 3,
    });

    if (hasVariants && runnable) this.drawVariantRow(ui, m, x, y + h - 88, w);

    // Status strip
    const sy = y + h - 32;
    const statusText = m.status === 'active' ? 'INDÍTHATÓ' : m.status === 'external' ? 'KÜLSŐ MODUL' : 'HAMAROSAN';
    const statusColor = m.status === 'active' ? t.ok : m.status === 'external' ? t.accent2 : t.textMuted;
    ui.circle(x + 22, sy, 5, statusColor);
    ui.text(statusText, x + 34, sy, { size: 14, color: statusColor, weight: '700', font: t.fontMono, letterSpacing: '1px' });

    if (prof.relevance === 'primary') {
      ui.text('ELSŐDLEGES', x + w - 16, sy, {
        size: 13, color: withAlpha(t.accent, alpha), align: 'right', weight: '700', font: t.fontMono, letterSpacing: '1px',
      });
    }
    if (m.multiuser) {
      ui.text(`${m.multiuser.min}-${m.multiuser.max} FŐ`, x + w - 16, y + 32, {
        size: 14, color: withAlpha(t.accent2, alpha), align: 'right', weight: '700', font: t.fontMono,
      });
    }
  }

  /** Two explicit buttons: the established form and the spatial one. */
  private drawVariantRow(ui: UI, m: ModuleManifest, x: number, y: number, w: number): void {
    const t = ui.t;
    const usable = new Set(runnableVariants(m, this.ctxPlatform).map((v) => v.id));
    const list = m.variants ?? [];
    const bw = (w - 32 - 8 * (list.length - 1)) / list.length;

    list.forEach((v, i) => {
      const bx = x + 16 + i * (bw + 8);
      const ok = usable.has(v.id);
      const hovered = ui.hit(`mod:variant:${m.code}:${v.id}`, bx, y, bw, 44, {
        disabled: !ok, data: { module: m, variant: v.id },
      });
      const accent = v.spatial ? t.accent2 : t.accent;
      ui.roundRect(bx, y, bw, 44, 9,
        ok ? (hovered ? withAlpha(accent, 0.24) : 'rgba(255,255,255,0.05)') : 'rgba(255,255,255,0.02)',
        ok ? (hovered ? accent : withAlpha(t.textMuted, 0.3)) : withAlpha(t.textMuted, 0.14), 2);
      ui.text(v.id, bx + 14, y + 22, {
        size: 20, color: ok ? accent : withAlpha(t.textMuted, 0.45), weight: '700', font: t.fontDisplay,
      });
      ui.text(ok ? v.label : 'VR kell', bx + 34, y + 22, {
        size: 14, color: withAlpha(t.textMuted, ok ? 0.95 : 0.5), weight: '600', maxWidth: bw - 46,
      });
      if (v.spatial && ok) {
        ui.text('3D', bx + bw - 12, y + 22, {
          size: 12, color: withAlpha(accent, 0.9), align: 'right', weight: '700', font: t.fontMono,
        });
      }
    });
  }

  private get ctxPlatform(): 'vr' | 'desktop' | 'mobile' {
    return this.engine.inXR ? 'vr' : 'desktop';
  }

  private drawSide(ui: UI): void {
    const t = ui.t;
    const pad = 30;
    ui.background(t.surface, 20);
    ui.roundRect(0, 0, ui.w, ui.h, 20, undefined, withAlpha(t.accent, 0.4), 2);

    // Tabs
    const tabs: [RightTab, string][] = [['identity', 'AZONOSÍTÓ'], ['results', 'EREDMÉNY'], ['profile', 'PROFIL']];
    const tw = (ui.w - pad * 2 - 12) / 3;
    tabs.forEach(([id, label], i) => {
      ui.button(`side:tab:${id}`, pad + i * (tw + 6), 26, tw, 46, {
        label, variant: 'quiet', fontSize: 15, active: this.rightTab === id,
      });
    });
    ui.divider(88, pad, ui.w - pad * 2);

    if (this.rightTab === 'identity') this.drawIdentity(ui, pad);
    else if (this.rightTab === 'results') this.drawResults(ui, pad);
    else this.drawProfile(ui, pad);
  }

  private drawIdentity(ui: UI, pad: number): void {
    const t = ui.t;
    const d = DOMAINS[this.domain];
    const s = store.get();
    let y = 122;

    if (s.subject) {
      ui.label('AZONOSÍTVA', pad, y, t.ok);
      y += 44;
      ui.title(s.subject.externalId, pad, y, 40);
      y += 46;
      ui.paragraph(
        'Az eredményeid ehhez az azonosítóhoz kerülnek, így a fejlődés időben követhető.',
        pad, y, ui.w - pad * 2, { size: 17, lineHeight: 25 }
      );
      y += 76;
      const runs = this.runs();
      const best = runs.length ? Math.max(...runs.map((r) => r.opsScore)) : 0;
      const third = (ui.w - pad * 2) / 3;
      ui.stat(pad, y, third, String(runs.length), d.copy.runNoun, t.accent, 42);
      ui.stat(pad + third, y, third, best ? String(best) : '—', 'legjobb', t.accent, 42);
      ui.stat(pad + third * 2, y, third, String(new Set(runs.map((r) => r.moduleCode)).size), 'modul', t.accent, 42);
      ui.button('side:signout', pad, ui.h - 84, ui.w - pad * 2, 60, { label: 'KIJELENTKEZÉS', variant: 'quiet', fontSize: 18 });
      return;
    }

    ui.label(d.copy.idLabel.toUpperCase(), pad, y, t.accent);
    y += 40;
    ui.paragraph(
      'Add meg az azonosítót, ha menteni szeretnéd az eredményeidet. Enélkül is kipróbálhatsz mindent, ' +
        'de az eredmény nem kerül profilhoz.',
      pad, y, ui.w - pad * 2, { size: 18, lineHeight: 26, color: t.text }
    );
    y += 108;
    const typed = this.keyboard?.value ?? '';
    ui.roundRect(pad, y, ui.w - pad * 2, 66, 10, 'rgba(0,0,0,0.35)', withAlpha(t.accent, 0.6), 2);
    ui.text(typed || d.copy.idPlaceholder, pad + 18, y + 33, {
      size: 28, font: t.fontMono, color: typed ? t.text : withAlpha(t.textMuted, 0.6),
    });
    y += 82;
    ui.button('side:keyboard', pad, y, ui.w - pad * 2, 60, {
      label: this.keyboard ? 'BILLENTYŰZET ELREJTÉSE' : 'AZONOSÍTÓ BEÍRÁSA', variant: 'ghost', fontSize: 18,
    });
    y += 74;
    ui.paragraph(d.copy.idHint, pad, y, ui.w - pad * 2, { size: 15, lineHeight: 22 });

    ui.button('side:anon', pad, ui.h - 84, ui.w - pad * 2, 60, {
      label: 'FOLYTATÁS NÉVTELENÜL', variant: 'quiet', fontSize: 18,
    });
  }

  private drawResults(ui: UI, pad: number): void {
    const t = ui.t;
    const runs = this.runs().slice(0, 7);
    let y = 118;
    ui.label('UTOLSÓ FUTÁSOK', pad, y, t.accent);
    y += 34;
    if (runs.length === 0) {
      ui.paragraph(
        'Még nincs eredményed ebben a területben. A REACT modul a leggyorsabb belépő: kb. hét perc, ' +
          'és rögtön ad egy pszichomotoros alapvonalat.',
        pad, y, ui.w - pad * 2, { size: 18, lineHeight: 26 }
      );
      return;
    }
    for (const r of runs) {
      ui.roundRect(pad, y, ui.w - pad * 2, 54, 10, 'rgba(0,0,0,0.22)');
      ui.text(r.moduleCode, pad + 16, y + 27, { size: 21, weight: '700', font: t.fontDisplay, color: t.text });
      ui.text(new Date(r.finishedAt).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }), pad + 150, y + 27, {
        size: 16, color: t.textMuted,
      });
      ui.text(String(r.opsScore), ui.w - pad - 16, y + 27, {
        size: 26, color: t.accent, align: 'right', weight: '700', font: t.fontDisplay,
      });
      y += 60;
    }

    const byModule = new Map<string, number[]>();
    for (const r of this.runs()) {
      const arr = byModule.get(r.moduleCode) ?? [];
      arr.push(r.opsScore);
      byModule.set(r.moduleCode, arr);
    }
    const trend = [...byModule.entries()].find(([, v]) => v.length > 1);
    if (trend) {
      y += 12;
      ui.label(`${trend[0]} TREND`, pad, y, t.textMuted);
      ui.spark(pad, y + 18, ui.w - pad * 2, 54, [...trend[1]].reverse(), t.accent);
    }
  }

  private drawProfile(ui: UI, pad: number): void {
    const t = ui.t;
    const axes = axesForDomain(this.domain);
    const runs = this.runs();
    const bestByModule = new Map<string, number>();
    for (const r of runs) bestByModule.set(r.moduleCode, Math.max(bestByModule.get(r.moduleCode) ?? 0, r.opsScore));

    const values = axes.map((a) => {
      let num = 0;
      let den = 0;
      for (const [code, w] of Object.entries(a.sources)) {
        const b = bestByModule.get(code);
        if (b === undefined) continue;
        num += (b / 10) * w;
        den += w;
      }
      return { label: a.label, value: den > 0 ? num / den : null };
    });

    ui.label(DOMAINS[this.domain].copy.profileTitle.toUpperCase(), pad, 118, t.accent, 14);
    ui.radar(ui.w / 2, ui.h / 2 + 20, Math.min(ui.w, ui.h) / 2 - 110, values, t.accent);
    const measured = values.filter((v) => v.value !== null).length;
    ui.paragraph(
      measured === 0
        ? 'A profil akkor rajzolódik ki, ha legalább egy modult befejeztél.'
        : `${measured} / ${values.length} tengelyen van adat.`,
      pad, ui.h - 76, ui.w - pad * 2, { size: 16, lineHeight: 22 }
    );
  }

  private runs(): RunSummary[] {
    const s = store.get();
    const fromProfile = s.profile?.runs ?? [];
    const local = api.localRuns();
    const seen = new Set(fromProfile.map((r) => r.id));
    return [...fromProfile, ...local.filter((r) => !seen.has(r.id))]
      .filter((r) => r.domain === this.domain)
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }

  /* ---------------------------------------------------------- events */

  private onClick(e: PanelClickEvent): void {
    const id = e.widget.id;

    if (e.panel === this.infoPanel) {
      if (id === 'info:exit') this.cb.onExitVR();
      if (id === 'info:domain') this.cb.onChangeDomain();
      return;
    }

    if (e.panel === this.modulePanel) {
      if (id === 'mod:prev') { this.page = Math.max(0, this.page - 1); this.modulePanel.invalidate(); }
      if (id === 'mod:next') {
        const pages = Math.ceil(modulesForDomain(this.domain).length / PAGE_SIZE);
        this.page = Math.min(pages - 1, this.page + 1);
        this.modulePanel.invalidate();
      }
      if (id.startsWith('mod:variant:')) {
        const d = e.widget.data as { module: ModuleManifest; variant: VariantId } | undefined;
        if (d) this.cb.onStartModule(d.module, d.variant);
        return;
      }
      if (id.startsWith('mod:start:')) {
        const m = e.widget.data as ModuleManifest | undefined;
        if (m) this.cb.onStartModule(m);
      }
      return;
    }

    if (e.panel === this.sidePanel) {
      if (id.startsWith('side:tab:')) {
        this.rightTab = id.slice('side:tab:'.length) as RightTab;
        this.sidePanel.invalidate();
      }
      if (id === 'side:signout') { this.cb.onSignOut(); this.sidePanel.invalidate(); }
      if (id === 'side:anon') { this.rightTab = 'results'; this.sidePanel.invalidate(); }
      if (id === 'side:keyboard') this.toggleKeyboard();
    }
  }

  private toggleKeyboard(): void {
    if (this.keyboard) {
      this.keyboard.dispose();
      this.keyboard = null;
      this.sidePanel.invalidate();
      return;
    }
    this.keyboard = new Keyboard3D(this.panels, {
      theme: this.theme,
      title: DOMAINS[this.domain].copy.idLabel,
      forceUpper: true,
      maxLength: 20,
      onChange: () => this.sidePanel.invalidate(),
      onSubmit: async (value) => {
        if (value.length < 3) return;
        await this.cb.onSignIn(value);
        this.keyboard?.dispose();
        this.keyboard = null;
        this.sidePanel.invalidate();
      },
    });
    // Sit the keyboard low and close, where hands naturally rest.
    place(this.keyboard.panel.group, -30, 1.05, 0.72);
    this.keyboard.panel.group.rotation.x = -0.5;
    this.root.add(this.keyboard.panel.group);
    this.sidePanel.invalidate();
  }

  /** Hide the whole hub while a module owns the view. */
  setVisible(v: boolean): void {
    this.root.visible = v;
    this.infoPanel.mesh.visible = v;
    this.modulePanel.mesh.visible = v;
    this.sidePanel.mesh.visible = v;
    if (this.keyboard) this.keyboard.panel.mesh.visible = v;
  }

  dispose(): void {
    this.disposed = true;
    this.offClick();
    this.offFrame();
    this.offState();
    this.keyboard?.dispose();
    this.panels.remove(this.infoPanel);
    this.panels.remove(this.modulePanel);
    this.panels.remove(this.sidePanel);
    this.infoPanel.dispose();
    this.modulePanel.dispose();
    this.sidePanel.dispose();
    this.panels.dispose();
    this.room.dispose();
    disposeTree(this.root);
  }
}

/** Place a panel on an arc: `deg` degrees left of centre, at `dist` metres. */
function place(obj: THREE.Object3D, deg: number, height: number, dist: number): void {
  const a = THREE.MathUtils.degToRad(deg);
  obj.position.set(-Math.sin(a) * dist, height - 0.62, -Math.cos(a) * dist);
  obj.rotation.y = a;
}
