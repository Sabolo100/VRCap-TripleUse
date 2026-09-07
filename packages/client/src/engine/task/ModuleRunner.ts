import * as THREE from 'three';
import { Rng, randomSeed, SCORING_VERSION, variantOf } from '@vrcap/shared';
import type { DomainCode, RunMode, RunPayload, RunHeader, VariantId } from '@vrcap/shared';
import type { Engine } from '../core/Engine.js';
import { Panel } from '../ui/Panel.js';
import { FLAT_HUD } from '../ui/viewport.js';
import { resolveText } from './text.js';
import type { PanelManager, PanelClickEvent } from '../ui/PanelManager.js';
import { Recorder } from '../data/Recorder.js';
import { MobileControls } from '../ui/MobileControls.js';
import { SignalSystem } from '../world/SignalSystem.js';
import { MotionSystem } from '../world/MotionSystem.js';
import { audio } from '../audio/AudioSystem.js';
import { themeForDomain } from '../ui/UITheme.js';
import { withAlpha } from '../ui/UITheme.js';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from './Module.js';
import { deviceSync } from '../core/Device.js';

/**
 * STANDARD ASSESSMENT FLOW.
 *
 *   INTRO -> INSTRUCTIONS -> CALIBRATION -> PRACTICE -> READY
 *         -> ASSESSMENT -> (next block) -> PROCESSING -> RESULT -> SAVE
 *
 * Implemented once, here, so every module has the same shape and the same
 * separation between practice (feedback allowed, never scored) and assessment
 * (no help, this is the measurement).
 */

export type RunnerState =
  | 'intro'
  | 'instructions'
  | 'calibration'
  | 'practice'
  | 'ready'
  | 'assessment'
  | 'processing'
  | 'result';

export interface RunnerOptions {
  engine: Engine;
  panels: PanelManager;
  module: AssessmentModule;
  domain: DomainCode;
  mode: RunMode;
  seed?: number;
  motionHz?: number;
  /** Called with the finished payload. Returns whether it was persisted. */
  onSave: (payload: RunPayload) => Promise<{ saved: boolean; message: string }>;
  onExit: () => void;
  /** Identity for the header; null for an anonymous try-out. */
  subjectId: string | null;
  sessionId: string;
  configVersion?: string;
  /** Set for modules that have more than one runnable form. */
  variant?: VariantId;
}

/**
 * Where the runner's own two panels go.
 *
 * Exported so the panel-visibility audit can measure the instruction panel -
 * which carries the button that starts a block - and the HUD strip without
 * copying these numbers into a test, where they would quietly drift out of
 * step with the ones that actually run.
 */
export function runnerPanelLayout(flat: boolean) {
  return {
    info: {
      width: flat ? 1.5 : 2.02,
      height: flat ? 0.94 : 1.27,
      pxPerMeter: flat ? 820 : 608,
      position: [0, 1.58, flat ? -1.35 : -1.95] as [number, number, number],
    },
    hud: {
      width: flat ? 1.15 : 1.4,
      height: flat ? FLAT_HUD.heightM : 0.17,
      pxPerMeter: flat ? 900 : 740,
      // On a flat screen the strip's placement is shared with the module
      // panels, which have to stay above it: -29.5 in a headset is comfortable
      // but sits ON the bottom edge of a 65 degree viewport, where the block
      // line was being clipped.
      elDeg: flat ? FLAT_HUD.elDeg : -29.5,
      distanceM: flat ? FLAT_HUD.distanceM : 1.7,
      tiltRad: FLAT_HUD.tiltRad,
    },
  };
}

export class ModuleRunner {
  state: RunnerState = 'intro';
  private opts: RunnerOptions;
  private engine: Engine;
  private ctx: ModuleContext;
  private root = new THREE.Group();
  private infoPanel: Panel;
  private hudPanel: Panel;
  private blockIndex = 0;
  /**
   * Free-try mode: the participant picked one block off the intro screen to
   * see what it is. It runs with feedback, is never scored, never saved, and
   * returns to the intro afterwards - so exploring the task cannot
   * accidentally become a measured run.
   */
  private tryOut = false;
  private practicePhase = true;
  private result: ModuleResult | null = null;
  private saveMessage = '';
  private saving = false;
  private startedAt = new Date().toISOString();
  private offClick: () => void;
  private offFrame: () => void;
  private disposed = false;
  private aborted = false;
  private blockRunning = false;
  private mobileControls: MobileControls | null = null;

  constructor(opts: RunnerOptions) {
    this.opts = opts;
    this.engine = opts.engine;
    const theme = themeForDomain(opts.domain);
    const recorder = new Recorder(this.engine.clock, this.engine.input, {
      motionHz: opts.motionHz ?? 15,
    });

    // Phones get a DOM control layer; a headset and a laptop have real
    // buttons and a pointer, and do not.
    this.mobileControls = deviceSync()?.platform === 'mobile'
      ? new MobileControls(
          this.engine.input,
          () => this.engine.clock.frameTime,
          (px) => this.engine.setViewportBottomInset(px)
        )
      : null;

    this.ctx = {
      engine: this.engine,
      scene: this.engine.scene,
      root: this.root,
      panels: opts.panels,
      mobileControls: this.mobileControls,
      recorder,
      signals: new SignalSystem(),
      motion: new MotionSystem(),
      audio,
      rng: new Rng(opts.seed ?? randomSeed()),
      theme,
      domain: opts.domain,
      mode: opts.mode,
      manifest: opts.module.manifest,
      platform: this.engine.inXR ? 'vr' : (deviceSync()?.platform === 'mobile' ? 'mobile' : 'desktop'),
      configVersion: opts.configVersion ?? `${opts.module.manifest.code}_STANDARD_A`,
    };

    this.engine.scene.add(this.root);

    // Panel distances differ by platform. In VR, 1.9 m is a comfortable reading
    // distance that keeps the panel outside arm's reach. On a flat screen the
    // same panel would occupy a third of the viewport, so it is brought
    // forward - the angular size the participant sees ends up similar.
    const flat = this.ctx.platform !== 'vr';

    // The main information surface: intro, instructions, results.
    // Legibility in the headset is set by `fontPx / (pxPerMeter * distance)`,
    // and the physical width cancels out. Lowering pxPerMeter while raising
    // the metre size by the same factor therefore enlarges every glyph by 35%
    // without touching a single layout coordinate - the logical canvas is
    // still 1230 x 771. Body text goes from 0.85 to 1.11 degrees, which is
    // the difference between squinting and reading.
    const L = runnerPanelLayout(flat);
    this.infoPanel = new Panel({
      width: L.info.width, height: L.info.height,
      pxPerMeter: L.info.pxPerMeter, superSample: 2, theme, name: 'info',
    });
    this.infoPanel.group.position.set(...L.info.position);
    this.root.add(this.infoPanel.group);
    opts.panels.add(this.infoPanel);

    // A slim always-on HUD: block progress and abort.
    this.hudPanel = new Panel({
      width: L.hud.width, height: L.hud.height,
      pxPerMeter: L.hud.pxPerMeter, superSample: 2, theme, frame: false, name: 'hud',
    });
    const hudRad = (L.hud.elDeg * Math.PI) / 180;
    this.hudPanel.group.position.set(
      0, 1.6 + Math.sin(hudRad) * L.hud.distanceM, -Math.cos(hudRad) * L.hud.distanceM);
    this.hudPanel.group.rotation.x = L.hud.tiltRad;
    this.root.add(this.hudPanel.group);
    opts.panels.add(this.hudPanel);

    this.hudPanel.setDraw((ui) => this.drawHud(ui));
    this.infoPanel.setDraw((ui) => this.drawInfo(ui));

    this.offClick = opts.panels.onClick((e) => this.onClick(e));
    this.offFrame = this.engine.onFrame((dt, clock) => this.frame(dt, clock.frameTime));
  }

  get seed(): number {
    return this.opts.seed ?? 0;
  }

  /** Live snapshot for the console debug handle and smoke tests. */
  get debug() {
    return {
      state: this.state,
      block: this.currentBlock()?.id ?? null,
      blockIndex: this.blockIndex,
      practice: this.practicePhase,
      counts: this.ctx.recorder.counts,
      opsScore: this.result?.opsScore ?? null,
      platform: this.ctx.platform,
      frameIntervalMs: Math.round(this.engine.clock.frameInterval * 100) / 100,
    };
  }

  /** Test hook: advance the flow exactly as pressing the panel button would. */
  advanceForTest(): void {
    void this.advance();
  }

  async begin(): Promise<void> {
    this.engine.clock.reset();
    this.ctx.recorder.reset();
    this.ctx.recorder.event('run_start', {
      module: this.ctx.manifest.code,
      version: this.ctx.manifest.version,
      mode: this.ctx.mode,
      platform: this.ctx.platform,
      seed: this.opts.seed ?? null,
    });
    await this.opts.module.init(this.ctx);
    this.setState('intro');
  }

  /* --------------------------------------------------------- lifecycle */

  /**
   * On a phone the 3D HUD is not reachable.
   *
   * It sits 25 degrees below the horizon, and a phone's usable band is about
   * 30 degrees wide once the control bar has cropped it - a band the modules
   * already fill with stimuli. So the block name, the progress and the exit
   * button move into the DOM strip along the top, where they cost no world
   * space, and the 3D panel is hidden rather than left floating off-screen.
   */
  private syncTopBar(): void {
    const mc = this.mobileControls;
    if (!mc) return;
    this.hudPanel.group.visible = false;
    // Never over a running block. The strip would sit exactly where a phone's
    // stimuli reach - the modules use most of the 30 degree band that is left
    // once the control bar has cropped it - and covering a search array to
    // show a progress bar is a bad trade in a measurement task. During a block
    // the way out is the back gesture, which the shell already handles.
    if (this.state === 'practice' || this.state === 'assessment' || this.state === 'calibration') {
      mc.setTopBar(null);
      return;
    }
    const blocks = this.opts.module.blocks;
    const m = this.ctx.manifest;
    const current = blocks[this.blockIndex];
    mc.setTopBar({
      title: `${m.ordinal} ${m.code}`,
      subtitle: current ? `${this.blockIndex + 1}/${blocks.length}  ${current.title}` : undefined,
      progress: blocks.map((_, i) => (i < this.blockIndex ? 1 : i === this.blockIndex ? 0.5 : 0)),
      // No practice badge here: the strip is only up between blocks, and the
      // instruction panel already says whether practice comes next.
      onExit: () => this.abort(),
    });
  }

  private setState(s: RunnerState): void {
    this.state = s;
    this.ctx.recorder.event('flow_state', { state: s, block: this.currentBlock()?.id ?? null });
    this.infoPanel.invalidate();
    this.hudPanel.invalidate();
    // The info panel is in the way during a running block - and during
    // calibration too: this state is only ever entered when the module
    // implements calibrate(), and such a module draws its own content there.
    const hide = s === 'practice' || s === 'assessment' || s === 'calibration';
    this.infoPanel.group.visible = !hide;
    this.syncTopBar();

    // Touch controls belong to a running block and nothing else. Clearing them
    // in runBlock was too late: the instructions screen comes first, and the
    // previous block's buttons stayed on top of it - covering the very button
    // that starts the next one.
    if (!hide) this.mobileControls?.clear();
  }

  private currentBlock(): BlockDescriptor | undefined {
    return this.opts.module.blocks[this.blockIndex];
  }

  private frame(dt: number, now: number): void {
    if (this.disposed) return;
    this.ctx.signals.update(now);
    this.ctx.motion.update(dt);
    this.ctx.recorder.sampleMotion();
    audio.syncListener(this.engine.camera);
    if (this.state === 'practice' || this.state === 'assessment') {
      this.opts.module.update(dt, this.ctx);
      this.hudPanel.invalidate();
    }
  }

  private async advance(): Promise<void> {
    switch (this.state) {
      case 'intro':
        if (this.opts.module.calibrate) {
          this.setState('calibration');
          await this.opts.module.calibrate(this.ctx);
        }
        this.setState('instructions');
        break;

      case 'calibration':
        this.setState('instructions');
        break;

      case 'instructions': {
        const block = this.currentBlock();
        if (!block) return this.finish();
        if (this.tryOut) {
          // One block, with feedback, then straight back to the intro. Nothing
          // is scored and nothing is saved.
          this.practicePhase = true;
          this.setState('practice');
          await this.runBlock(block, true);
          this.tryOut = false;
          this.blockIndex = 0;
          this.setState('intro');
          break;
        }
        if (block.practiceTrials > 0) {
          this.practicePhase = true;
          this.setState('practice');
          await this.runBlock(block, true);
          this.setState('ready');
        } else {
          this.practicePhase = false;
          this.setState('assessment');
          await this.runBlock(block, false);
          this.nextBlock();
        }
        break;
      }

      case 'ready': {
        const block = this.currentBlock();
        if (!block) return this.finish();
        this.practicePhase = false;
        this.setState('assessment');
        await this.runBlock(block, false);
        this.nextBlock();
        break;
      }

      case 'result':
        this.opts.onExit();
        break;
    }
  }

  private nextBlock(): void {
    this.blockIndex++;
    if (this.blockIndex >= this.opts.module.blocks.length) {
      void this.finish();
    } else {
      this.setState('instructions');
    }
  }

  private async runBlock(block: BlockDescriptor, practice: boolean): Promise<void> {
    if (this.aborted) return;
    this.blockRunning = true;
    this.ctx.recorder.event('block_start', { block: block.id, practice });
    try {
      await this.opts.module.runBlock(this.ctx, block, practice);
    } catch (err) {
      console.error('[runner] block failed', err);
      this.ctx.recorder.event('block_error', { block: block.id, message: String(err) });
    }
    this.ctx.recorder.event('block_end', { block: block.id, practice });
    this.blockRunning = false;
  }

  private async finish(): Promise<void> {
    this.setState('processing');
    // One frame of breathing room so the panel actually paints "processing".
    await new Promise((r) => setTimeout(r, 260));
    this.result = this.opts.module.finish(this.ctx);
    this.ctx.recorder.score('OPS', this.result.opsScore, SCORING_VERSION);
    this.ctx.recorder.event('run_finish', { opsScore: this.result.opsScore });
    this.setState('result');
    void this.save();
  }

  private async save(): Promise<void> {
    if (!this.result) return;
    this.saving = true;
    this.infoPanel.invalidate();
    const device = deviceSync()!;
    const header: RunHeader = {
      id: crypto.randomUUID(),
      sessionId: this.opts.sessionId,
      subjectId: this.opts.subjectId,
      domain: this.opts.domain,
      moduleCode: this.ctx.manifest.code,
      moduleVersion: this.ctx.manifest.version,
      configVersion: this.ctx.configVersion,
      variant: this.opts.variant,
      mode: this.opts.mode,
      seed: this.opts.seed ?? 0,
      device,
      startedAt: this.startedAt,
    };
    const d = this.ctx.recorder.data;
    const payload: RunPayload = {
      header,
      finishedAt: new Date().toISOString(),
      status: this.aborted ? 'aborted' : 'completed',
      trials: d.trials,
      events: d.events,
      motion: d.motion,
      metrics: d.metrics,
      scores: d.scores,
      opsScore: this.result.opsScore,
      summary: this.result.summary,
    };
    try {
      const res = await this.opts.onSave(payload);
      this.saveMessage = res.message;
    } catch (err) {
      this.saveMessage = 'Mentés sikertelen, helyben eltárolva.';
      console.error('[runner] save failed', err);
    }
    this.saving = false;
    this.infoPanel.invalidate();
  }

  abort(): void {
    this.aborted = true;
    this.opts.module.abort?.(this.ctx);
    this.ctx.recorder.event('run_aborted', {});
    this.opts.onExit();
  }

  /* --------------------------------------------------------------- UI */

  private onClick(e: PanelClickEvent): void {
    if (e.panel === this.hudPanel) {
      if (e.widget.id === 'hud:abort') this.abort();
      return;
    }
    if (e.panel !== this.infoPanel) return;
    if (e.widget.id.startsWith('info:block:')) {
      const i = Number(e.widget.id.slice('info:block:'.length));
      if (Number.isFinite(i) && i >= 0 && i < this.opts.module.blocks.length) {
        this.tryOut = true;
        this.blockIndex = i;
        this.setState('instructions');
      }
      return;
    }
    if (e.widget.id === 'info:next') void this.advance();
    if (e.widget.id === 'info:exit') this.opts.onExit();
    if (e.widget.id === 'info:retry') this.opts.onExit();
  }

  private drawHud(ui: import('../ui/Panel.js').UI): void {
    const t = ui.t;
    ui.roundRect(0, 0, ui.w, ui.h, 16, withAlpha('#000000', 0.55), withAlpha(t.accent, 0.35), 2);
    const m = this.ctx.manifest;
    ui.label(`${m.ordinal} ${m.code}`, 22, ui.h / 2, t.accent, 18);

    // Progress reads as pips plus the name of the block actually running.
    // Printing every block title side by side collides as soon as a module has
    // more than three blocks, and the participant only needs to know where
    // they are, not the whole itinerary.
    const blocks = this.opts.module.blocks;
    const bx = 190;
    const bw = ui.w - bx - 210;
    const seg = bw / Math.max(1, blocks.length);
    blocks.forEach((b, i) => {
      const done = i < this.blockIndex;
      const active = i === this.blockIndex;
      const color = done ? t.ok : active ? t.accent : withAlpha(t.textMuted, 0.3);
      ui.roundRect(bx + i * seg + 3, 26, seg - 8, 9, 5, color);
      void b;
    });

    const current = blocks[this.blockIndex];
    if (current) {
      ui.text(`${this.blockIndex + 1}/${blocks.length}  ${current.title}`, bx, ui.h - 24, {
        size: 17, color: t.text, weight: '600', font: t.fontDisplay,
      });
    }

    if (this.state === 'practice') {
      ui.roundRect(ui.w - 350, 20, 110, 24, 12, withAlpha(t.warn, 0.9));
      ui.text('GYAKORLÁS', ui.w - 295, 32, { size: 13, color: '#0a0d12', align: 'center', weight: '700' });
    }

    ui.button('hud:abort', ui.w - 170, ui.h / 2 - 26, 150, 52, { label: 'KILÉPÉS', variant: 'quiet', fontSize: 20 });
  }

  private drawInfo(ui: import('../ui/Panel.js').UI): void {
    const t = ui.t;
    ui.background(t.surface, 24);
    ui.roundRect(0, 0, ui.w, ui.h, 24, undefined, withAlpha(t.accent, 0.45), 2);
    const m = this.ctx.manifest;
    const pad = 54;

    switch (this.state) {
      case 'intro': {
        // With two variants the intro must say which one is about to run, and
        // describe THAT one - otherwise the participant reads the A blurb
        // while the B task loads.
        const v = m.variants?.length ? variantOf(m, this.opts.variant) : undefined;
        ui.label(`MODUL ${m.ordinal}`, pad, 52, t.accent);
        if (v) {
          const badge = `${v.id} VÁLTOZAT · ${v.label.toUpperCase()}`;
          ui.label(badge, ui.w - pad, 52, v.spatial ? t.accent2 : t.textMuted, 17, 'right');
        }
        ui.title(m.title, pad, 104, 62);
        ui.text(v?.subtitle ?? m.subtitle, pad, 158, { size: 26, color: t.textMuted });
        let y = ui.paragraph(v?.summary ?? m.summary, pad, 200, ui.w - pad * 2, { size: 27, lineHeight: 40 });
        y += 18;
        ui.divider(y);
        y += 30;
        ui.label('MENET', pad, y, t.textMuted);
        y += 30;
        // Each row is a button: pressing it runs THAT block on its own, with
        // feedback, so a new participant can find out what a sub-task actually
        // is without committing to the whole measurement first.
        this.opts.module.blocks.forEach((b, i) => {
          ui.button(`info:block:${i}`, pad - 12, y, ui.w - pad * 2 + 24, 44, {
            label: '', variant: 'ghost',
          });
          ui.text(`${i + 1}.`, pad, y + 22, { size: 20, color: t.accent, weight: '700', font: t.fontMono });
          ui.text(b.title, pad + 42, y + 22, { size: 24, color: t.text, weight: '600' });
          ui.text(`${b.trials} ${b.unitLabel ?? 'próba'}`, ui.w - pad - 108, y + 22,
            { size: 22, color: t.textMuted, align: 'right' });
          ui.text('KIPRÓBÁLOM', ui.w - pad, y + 22,
            { size: 17, color: t.accent2, align: 'right', weight: '600', font: t.fontMono });
          y += 50;
        });
        y += 6;
        ui.text('Bármelyik sort megnyomhatod: az a rész önmagában lefut, visszajelzéssel, és nem számít bele az eredménybe.',
          pad, y + 10, { size: 19, color: t.textMuted });
        const label = this.ctx.mode === 'assessment' ? 'MÉRÉS INDÍTÁSA' : 'INDÍTÁS';
        ui.button('info:next', ui.w - pad - 340, ui.h - 104, 340, 66, { label, variant: 'primary' });
        ui.button('info:exit', pad, ui.h - 104, 200, 66, { label: 'VISSZA', variant: 'quiet' });
        break;
      }

      case 'instructions': {
        const b = this.currentBlock();
        if (!b) break;
        ui.label(
          this.tryOut
            ? `KIPRÓBÁLÁS · ${this.blockIndex + 1}. RÉSZ`
            : `${this.blockIndex + 1}. RÉSZ / ${this.opts.module.blocks.length}`,
          pad, 52, this.tryOut ? t.accent2 : t.accent
        );
        ui.title(b.title, pad, 108, 52);
        // The instruction has to fit above the control box, the practice note
        // and the button. A four-station briefing is three times the length of
        // "press when it flashes", so the size steps down until it fits rather
        // than running off the bottom of the panel under the button.
        const text = resolveText(b.instruction, this.ctx.platform);
        const budget = ui.h - 104 - 12 - 66 - 130 - 22 - 164;
        const steps: [number, number][] = [[29, 44], [26, 39], [24, 35], [22, 31], [20, 28]];
        let [size, lineHeight] = steps[steps.length - 1]!;
        for (const [sz, lh] of steps) {
          if (ui.measureParagraph(text, ui.w - pad * 2, sz) * lh <= budget) { size = sz; lineHeight = lh; break; }
        }
        let y = ui.paragraph(text, pad, 164, ui.w - pad * 2, { size, lineHeight, color: t.text });
        y += 22;
        ui.roundRect(pad, y, ui.w - pad * 2, 104, 12, withAlpha(t.accent, 0.1), withAlpha(t.accent, 0.4), 2);
        ui.label('IRÁNYÍTÁS', pad + 22, y + 26, t.accent, 17);
        const hintSize = ui.measureParagraph(b.controlHint, ui.w - pad * 2 - 44, 24) > 2 ? 21 : 24;
        ui.paragraph(b.controlHint, pad + 22, y + 44, ui.w - pad * 2 - 44,
          { size: hintSize, color: t.text, maxLines: 2 });
        y += 130;
        const practiceNote = this.tryOut
          ? 'Kipróbálás: ez a rész magában fut le, visszajelzéssel. Nem számít bele az eredménybe, ' +
            'és utána visszakerülsz a modul kezdőképernyőjére.'
          : b.practiceTrials > 0
          ? `${b.practiceTrials} gyakorló próba következik visszajelzéssel, utána ${b.trials} mért próba.`
          : `${b.trials} mért próba, visszajelzés nélkül.`;
        ui.paragraph(practiceNote, pad, y, ui.w - pad * 2, { size: 23, maxLines: 2 });
        ui.button('info:next', ui.w - pad - 340, ui.h - 104, 340, 66, {
          label: this.tryOut ? 'KIPRÓBÁLOM' : b.practiceTrials > 0 ? 'GYAKORLÁS' : 'INDÍTÁS',
          variant: 'primary',
        });
        break;
      }

      case 'ready': {
        const b = this.currentBlock();
        ui.label('GYAKORLÁS KÉSZ', pad, 56, t.ok);
        ui.title('MOST JÖN A MÉRÉS', pad, 118, 52);
        ui.paragraph(
          'Innentől nincs visszajelzés és nincs segítség. Csak ez a rész számít bele az eredménybe. ' +
            (b ? `${b.trials} próba következik.` : ''),
          pad, 178, ui.w - pad * 2, { size: 28, lineHeight: 42 }
        );
        ui.button('info:next', ui.w - pad - 340, ui.h - 104, 340, 66, { label: 'KEZDHETJÜK', variant: 'primary' });
        break;
      }

      case 'processing': {
        ui.title('FELDOLGOZÁS…', pad, ui.h / 2 - 20, 48);
        const p = (Math.sin(performance.now() / 220) * 0.5 + 0.5);
        ui.bar(pad, ui.h / 2 + 30, ui.w - pad * 2, 12, p);
        break;
      }

      case 'result':
        this.drawResult(ui);
        break;
    }
  }

  private drawResult(ui: import('../ui/Panel.js').UI): void {
    const t = ui.t;
    const pad = 54;
    const r = this.result;
    if (!r) return;
    const scoreName = SCORE_NAME[this.opts.domain];

    ui.label(`${this.ctx.manifest.code} KÉSZ`, pad, 50, t.ok);
    ui.title(String(r.opsScore), pad, 118, 84, t.accent);
    ui.text(`/ 1000  ${scoreName}`, pad + measure(ui, String(r.opsScore), 84) + 22, 132, {
      size: 24, color: t.textMuted, weight: '600',
    });

    const cols = 2;
    const cw = (ui.w - pad * 2) / cols;
    r.headline.slice(0, 6).forEach((h, i) => {
      const x = pad + (i % cols) * cw;
      const y = 196 + Math.floor(i / cols) * 76;
      ui.label(h.label, x, y, t.textMuted, 15);
      ui.text(h.value, x, y + 32, { size: 30, color: t.text, weight: '700', font: t.fontDisplay });
      if (h.hint) ui.text(h.hint, x + 200, y + 34, { size: 17, color: t.textMuted });
    });

    const noteY = ui.h - 176;
    ui.divider(noteY - 14);
    const msg = this.saving ? 'Mentés folyamatban…' : this.saveMessage || '';
    ui.text(msg, pad, noteY + 14, { size: 19, color: this.saving ? t.textMuted : t.ok });
    ui.paragraph(DISCLAIMER[this.opts.domain], pad, noteY + 40, ui.w - pad * 2 - 380, {
      size: 16, color: withAlpha(t.textMuted, 0.85), maxLines: 2,
    });

    ui.button('info:exit', ui.w - pad - 340, ui.h - 104, 340, 66, { label: 'VISSZA A KÖZPONTBA', variant: 'primary' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offClick();
    this.offFrame();
    this.mobileControls?.dispose();
    this.opts.module.dispose(this.ctx);
    this.opts.panels.remove(this.infoPanel);
    this.opts.panels.remove(this.hudPanel);
    this.infoPanel.dispose();
    this.hudPanel.dispose();
    this.root.removeFromParent();
    this.ctx.signals.clear();
    this.ctx.motion.clear();
  }
}

function measure(ui: import('../ui/Panel.js').UI, s: string, size: number): number {
  ui.ctx.save();
  ui.ctx.font = `700 ${size}px ${ui.t.fontDisplay}`;
  const w = ui.ctx.measureText(s).width;
  ui.ctx.restore();
  return w;
}

const SCORE_NAME: Record<DomainCode, string> = { A: 'OPS SCORE', B: 'READINESS SCORE', C: 'PERFORMANCE INDEX' };
const DISCLAIMER: Record<DomainCode, string> = {
  A: 'Teljesítménymutató, nem pszichológiai diagnózis.',
  B: 'Teljesítménymutató, nem munkaköri alkalmassági szakvélemény.',
  C: 'Teljesítménymutató, nem tehetségdiagnózis.',
};
