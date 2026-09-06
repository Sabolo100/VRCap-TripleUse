import * as THREE from 'three';
import type { Rng } from '@vrcap/shared';
import type { ModuleContext } from '../../engine/task/Module.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import { makePrimitive } from '../../engine/world/Primitives.js';

/**
 * THE FOUR MATB-II STATIONS.
 *
 * Each station is self-contained: it owns its geometry, its state, its
 * scheduled events and its own metric accumulators. The module only ever says
 * "you are active now" and "this element was pressed at time t" - which is why
 * the difference between the baseline, dual and quad blocks is a single set of
 * active stations rather than three different code paths.
 *
 * All four are built from the primitive library and canvas panels; nothing
 * here needs an asset.
 */

export type StationId = 'track' | 'monitor' | 'resource' | 'comm';

/** Logical canvas size shared by all three panel stations, so the draw code
 *  never has to know how physically large the panel is on this platform. */
const PX_W = 540;
const PX_H = 366;

export interface StationHost {
  ctx: ModuleContext;
  rng: Rng;
  /** Frame clock - the same one every stimulus onset is stamped with. */
  now(): number;
  log(type: string, payload?: Record<string, unknown>): void;
  isPractice(): boolean;
}

export interface StationEvent {
  station: StationId;
  kind: string;
  element: string;
  /** Scheduled onset, ms on the frame clock. */
  t: number;
  /** Filled in by the station when it actually fires. */
  firedAt?: number;
  /** COMM only. */
  own?: boolean;
  channel?: number;
}

export interface Station {
  readonly id: StationId;
  readonly group: THREE.Group;
  place(pos: THREE.Vector3, lookAt: THREE.Vector3): void;
  worldPosition(target?: THREE.Vector3): THREE.Vector3;
  setActive(active: boolean, condition: string): void;
  update(dt: number, t: number): void;
  /** Fire a scheduled event. */
  fire(ev: StationEvent): void;
  /** A widget on this station was pressed. Returns the outcome for logging. */
  respond(element: string, t: number): void;
  /** Reset accumulators between conditions. */
  beginCondition(condition: string): void;
  readonly active: boolean;
  dispose(): void;
}

/* ------------------------------------------------------------------ base */

abstract class PanelStation implements Station {
  readonly group = new THREE.Group();
  protected panel: Panel;
  protected condition = '';
  active = false;

  constructor(readonly id: StationId, protected host: StationHost, name: string, widthM: number) {
    // The logical canvas is fixed at PX_W x PX_H on every platform, so one
    // draw routine serves all three; only the physical width changes, and
    // pxPerMeter follows from it. Text therefore keeps its angular size.
    this.panel = new Panel({
      width: widthM,
      height: (widthM * PX_H) / PX_W,
      pxPerMeter: PX_W / widthM,
      theme: host.ctx.theme,
      frame: true,
      name,
      superSample: 2,
    });
    this.panel.setDraw((ui) => this.draw(ui));
    this.group.add(this.panel.group);
    host.ctx.panels.add(this.panel);
  }

  place(pos: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.panel.group.position.copy(pos);
    this.panel.group.lookAt(lookAt);
    this.panel.invalidate();
  }

  ownsPanel(p: Panel): boolean {
    return this.panel === p;
  }

  /** World position of the panel centre - used for the head-facing metric. */
  worldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.panel.group.getWorldPosition(target);
  }

  setActive(active: boolean, condition: string): void {
    this.active = active;
    this.condition = condition;
    this.group.visible = active;
    this.panel.invalidate();
  }

  beginCondition(condition: string): void {
    this.condition = condition;
  }

  dispose(): void {
    this.host.ctx.panels.remove(this.panel);
    this.panel.dispose();
  }

  protected abstract draw(ui: UI): void;
  abstract update(dt: number, t: number): void;
  abstract fire(ev: StationEvent): void;
  abstract respond(element: string, t: number): void;

  protected header(ui: UI, title: string, right?: string): void {
    const t = ui.t;
    ui.background(t.surface, 18);
    ui.text(title, 24, 30, {
      size: 21, color: t.textMuted, weight: '700', font: t.fontMono, letterSpacing: '0.16em',
    });
    if (right) {
      ui.text(right, ui.w - 24, 30, {
        size: 21, color: t.accent, weight: '700', font: t.fontMono, align: 'right',
      });
    }
    ui.line(24, 52, ui.w - 24, 52, withAlpha(t.textMuted, 0.24), 2);
  }
}

/* ------------------------------------------------------------- MONITOR */

const SCALE_COUNT = 4;
/** Persistent offset that counts as a deviation, in scale ticks. */
const SCALE_EVENT_TICKS = 3.2;
const SCALE_RANGE_TICKS = 6;

interface MonitorPending {
  element: string;
  kind: string;
  onsetT: number;
}

export class MonitorStation extends PanelStation {
  private greenOn = true;
  private redOn = false;
  private scaleOffset = new Array<number>(SCALE_COUNT).fill(0);
  private scalePhase: number[] = [];
  private pending: MonitorPending[] = [];
  private flash: { element: string; ok: boolean; until: number } | null = null;

  hits = 0;
  misses = 0;
  falseAlarms = 0;
  rts: number[] = [];

  constructor(host: StationHost, widthM: number) {
    super('monitor', host, 'multi-monitor', widthM);
    for (let i = 0; i < SCALE_COUNT; i++) this.scalePhase.push(host.rng.range(0, Math.PI * 2));
  }

  override beginCondition(condition: string): void {
    super.beginCondition(condition);
    this.hits = 0; this.misses = 0; this.falseAlarms = 0; this.rts = [];
    this.pending = [];
    this.greenOn = true; this.redOn = false;
    this.scaleOffset.fill(0);
  }

  update(_dt: number, t: number): void {
    if (!this.active) return;
    let dirty = false;
    for (const p of [...this.pending]) {
      if (t - p.onsetT >= MONITOR_WINDOW_MS) {
        this.pending = this.pending.filter((x) => x !== p);
        this.misses++;
        this.resolveElement(p.element);
        this.host.log('station_timeout', {
          station: 'monitor', element: p.element, kind: p.kind,
          onsetT: Math.round(p.onsetT), windowMs: MONITOR_WINDOW_MS,
        });
        dirty = true;
      }
    }
    if (this.flash && t > this.flash.until) { this.flash = null; dirty = true; }
    // The pointers oscillate continuously, so the panel needs a redraw every
    // frame while it is active. A static pointer would make a deviation
    // detectable from the corner of the eye, which is not what this measures.
    this.panel.invalidate();
    void dirty;
  }

  fire(ev: StationEvent): void {
    const t = this.host.now();
    ev.firedAt = t;
    if (ev.element === 'green') this.greenOn = false;
    else if (ev.element === 'red') this.redOn = true;
    else {
      const i = Number(ev.element.slice(5));
      this.scaleOffset[i] = this.host.rng.bool() ? SCALE_EVENT_TICKS : -SCALE_EVENT_TICKS;
    }
    this.pending.push({ element: ev.element, kind: ev.kind, onsetT: t });
    this.panel.invalidate();
  }

  respond(element: string, t: number): void {
    const p = this.pending.find((x) => x.element === element);
    if (!p) {
      this.falseAlarms++;
      this.host.log('false_alarm', { station: 'monitor', element, t: Math.round(t) });
      if (this.host.isPractice()) this.flash = { element, ok: false, until: t + 400 };
      this.panel.invalidate();
      return;
    }
    this.pending = this.pending.filter((x) => x !== p);
    const rt = t - p.onsetT;
    this.hits++;
    this.rts.push(rt);
    this.resolveElement(element);
    this.host.log('station_response', {
      station: 'monitor', element, kind: p.kind, rtMs: +rt.toFixed(1),
      onsetT: Math.round(p.onsetT), correct: true,
    });
    if (this.host.isPractice()) this.flash = { element, ok: true, until: t + 400 };
    this.panel.invalidate();
  }

  private resolveElement(element: string): void {
    if (element === 'green') this.greenOn = true;
    else if (element === 'red') this.redOn = false;
    else this.scaleOffset[Number(element.slice(5))] = 0;
  }

  protected draw(ui: UI): void {
    const t = ui.t;
    this.header(ui, 'RENDSZER');

    const light = (id: string, x: number, on: boolean, colour: string, caption: string) => {
      const y = 108;
      ui.hit(id, x - 52, y - 46, 104, 104);
      const flashing = this.flash?.element === id;
      ui.circle(x, y, 34, on ? colour : withAlpha(colour, 0.13),
        flashing ? (this.flash!.ok ? t.ok : t.bad) : withAlpha(t.textMuted, 0.4), flashing ? 5 : 3);
      ui.text(caption, x, y + 62, {
        size: 17, color: t.textMuted, align: 'center', weight: '600', font: t.fontMono,
      });
    };
    light('green', 148, this.greenOn, t.ok, 'ÜZEM');
    light('red', 300, this.redOn, t.bad, 'HIBA');

    const now = this.host.now() / 1000;
    const x0 = 60;
    const gap = 112;
    const top = 196;
    const h = 132;
    for (let i = 0; i < SCALE_COUNT; i++) {
      const cx = x0 + i * gap + 28;
      ui.hit(`scale${i}`, cx - 40, top - 14, 80, h + 44);
      ui.roundRect(cx - 17, top, 34, h, 8, withAlpha(t.textMuted, 0.12), withAlpha(t.textMuted, 0.3), 2);
      for (let k = -2; k <= 2; k++) {
        const y = top + h / 2 - (k / SCALE_RANGE_TICKS) * (h / 2);
        ui.line(cx - 17, y, cx - 9, y, withAlpha(t.textMuted, 0.34), 1.5);
      }
      const osc = Math.sin(now * 2 * Math.PI * 0.3 + this.scalePhase[i]!) * 1;
      const ticks = Math.max(-SCALE_RANGE_TICKS, Math.min(SCALE_RANGE_TICKS, osc + this.scaleOffset[i]!));
      const y = top + h / 2 - (ticks / SCALE_RANGE_TICKS) * (h / 2);
      const flashing = this.flash?.element === `scale${i}`;
      ui.rect(cx - 22, y - 3.5, 44, 7,
        flashing ? (this.flash!.ok ? t.ok : t.bad) : t.accent);
      ui.text(String(i + 1), cx, top + h + 22, {
        size: 16, color: t.textMuted, align: 'center', font: t.fontMono,
      });
    }
  }
}

export const MONITOR_WINDOW_MS = 8000;

/* ------------------------------------------------------------ RESOURCE */

const TANK_CAPACITY = 4000;
const TANK_TARGET = 2500;
const TANK_BAND = 500;
const TANK_DRAIN = 30;
const PUMP_RATE = 45;
/** pump index -> tank */
const PUMP_TANK = [0, 0, 1, 1];

export class ResourceStation extends PanelStation {
  private level = [TANK_TARGET, TANK_TARGET];
  private pumpOn = [true, false, true, false];
  private pumpFailed = [false, false, false, false];
  private failUntil = [0, 0, 0, 0];
  /** Failure onsets still waiting for a compensating switch. */
  private failWatch: { pump: number; onsetT: number }[] = [];

  private devSum = 0;
  private devCount = 0;
  recoveryLags: number[] = [];
  toggles = 0;

  constructor(host: StationHost, widthM: number) {
    super('resource', host, 'multi-resource', widthM);
  }

  override beginCondition(condition: string): void {
    super.beginCondition(condition);
    this.level = [TANK_TARGET, TANK_TARGET];
    this.pumpOn = [true, false, true, false];
    this.pumpFailed = [false, false, false, false];
    this.failWatch = [];
    this.devSum = 0; this.devCount = 0;
    this.recoveryLags = [];
    this.toggles = 0;
  }

  get deviation(): number {
    return this.devCount ? this.devSum / this.devCount : NaN;
  }

  update(dt: number, t: number): void {
    if (!this.active) return;
    for (let i = 0; i < 4; i++) {
      if (this.pumpFailed[i] && t >= this.failUntil[i]!) {
        this.pumpFailed[i] = false;
        this.host.log('pump_repair', { pump: i + 1 });
      }
    }
    for (let k = 0; k < 2; k++) {
      let flow = -TANK_DRAIN;
      for (let i = 0; i < 4; i++) {
        if (PUMP_TANK[i] === k && this.pumpOn[i] && !this.pumpFailed[i]) flow += PUMP_RATE;
      }
      this.level[k] = Math.max(0, Math.min(TANK_CAPACITY, this.level[k]! + flow * dt));
    }
    // Deviation is sampled on the frame clock, so a dropped frame does not
    // silently weight one moment more than another.
    this.devSum += (Math.abs(this.level[0]! - TANK_TARGET) + Math.abs(this.level[1]! - TANK_TARGET)) / 2;
    this.devCount++;
    this.panel.invalidate();
  }

  fire(ev: StationEvent): void {
    const t = this.host.now();
    ev.firedAt = t;
    const i = Number(ev.element.slice(4)) - 1;
    if (this.pumpFailed[i]) return;
    this.pumpFailed[i] = true;
    this.failUntil[i] = t + this.host.rng.range(14000, 30000);
    // Only failures that actually require an action are timed: if the sibling
    // pump on the same tank is already running, nothing needs to be done and
    // a "recovery lag" would be meaningless.
    const sibling = PUMP_TANK.findIndex((tank, j) => tank === PUMP_TANK[i] && j !== i);
    if (sibling >= 0 && !this.pumpOn[sibling]) this.failWatch.push({ pump: i, onsetT: t });
    this.host.log('pump_fail', { pump: i + 1, tank: PUMP_TANK[i] === 0 ? 'A' : 'B', compensationNeeded: sibling >= 0 && !this.pumpOn[sibling] });
    this.panel.invalidate();
  }

  respond(element: string, t: number): void {
    const i = Number(element.slice(4)) - 1;
    if (i < 0 || i > 3) return;
    this.pumpOn[i] = !this.pumpOn[i];
    this.toggles++;
    const w = this.failWatch.find((f) => PUMP_TANK[f.pump] === PUMP_TANK[i] && f.pump !== i);
    if (w && this.pumpOn[i]) {
      this.recoveryLags.push(t - w.onsetT);
      this.failWatch = this.failWatch.filter((x) => x !== w);
    }
    this.host.log('pump_toggle', { pump: i + 1, on: this.pumpOn[i], t: Math.round(t) });
    this.panel.invalidate();
  }

  protected draw(ui: UI): void {
    const t = ui.t;
    this.header(ui, 'TARTÁLYOK');

    const tank = (k: number, x: number) => {
      const top = 84;
      const h = 168;
      const w = 128;
      ui.roundRect(x, top, w, h, 10, withAlpha(t.textMuted, 0.1), withAlpha(t.textMuted, 0.32), 2);
      // Acceptable band, drawn behind the fill so the target is always visible.
      const bandTop = top + h * (1 - (TANK_TARGET + TANK_BAND) / TANK_CAPACITY);
      const bandH = h * ((TANK_BAND * 2) / TANK_CAPACITY);
      ui.rect(x + 2, bandTop, w - 4, bandH, withAlpha(t.ok, 0.16));
      const lv = this.level[k]!;
      const fh = h * (lv / TANK_CAPACITY);
      const inBand = Math.abs(lv - TANK_TARGET) <= TANK_BAND;
      ui.rect(x + 2, top + h - fh, w - 4, fh, withAlpha(inBand ? t.accent : t.bad, 0.62));
      ui.line(x, bandTop + bandH / 2, x + w, bandTop + bandH / 2, withAlpha(t.ok, 0.7), 2);
      ui.text(k === 0 ? 'A' : 'B', x + w / 2, top - 18, {
        size: 22, color: t.text, align: 'center', weight: '700', font: t.fontDisplay,
      });
      ui.text(String(Math.round(lv)), x + w / 2, top + h + 20, {
        size: 19, color: inBand ? t.textMuted : t.bad, align: 'center', font: t.fontMono,
      });
    };
    tank(0, 82);
    tank(1, 330);

    for (let i = 0; i < 4; i++) {
      const x = 34 + i * 122;
      const y = 292;
      const w = 108;
      const h = 54;
      ui.hit(`pump${i + 1}`, x, y, w, h);
      const failed = this.pumpFailed[i]!;
      const on = this.pumpOn[i]!;
      const fill = failed ? withAlpha(t.bad, 0.34) : on ? withAlpha(t.accent, 0.8) : withAlpha(t.textMuted, 0.12);
      const border = failed ? t.bad : on ? t.accent : withAlpha(t.textMuted, 0.34);
      ui.roundRect(x, y, w, h, 12, fill, border, 2);
      ui.text(`P${i + 1}`, x + w / 2, y + h / 2 - 7, {
        size: 21, color: failed ? t.bad : on ? '#0a0d12' : t.text,
        align: 'center', weight: '700', font: t.fontDisplay,
      });
      ui.text(failed ? 'HIBA' : PUMP_TANK[i] === 0 ? '→ A' : '→ B', x + w / 2, y + h / 2 + 15, {
        size: 14, color: failed ? t.bad : on ? withAlpha('#0a0d12', 0.75) : t.textMuted,
        align: 'center', font: t.fontMono,
      });
    }
  }
}

/* ---------------------------------------------------------------- COMM */

export const COMM_WINDOW_MS = 10000;
export const CALL_SIGNS = ['KILO 4', 'TANGO 7', 'ROMEO 2', 'SIERRA 5', 'VIKTOR 9', 'ALFA 3'];
/** One three-note motif per call sign, for when speech synthesis is absent. */
const MOTIFS: Record<string, number[]> = {
  'KILO 4': [659, 440, 554],
  'TANGO 7': [440, 659, 554],
  'ROMEO 2': [554, 440, 784],
  'SIERRA 5': [784, 554, 440],
  'VIKTOR 9': [440, 784, 659],
  'ALFA 3': [659, 554, 784],
};
const CHANNEL_WORDS = ['', 'egyes', 'kettes', 'hármas', 'négyes'];

export class CommStation extends PanelStation {
  callSign = CALL_SIGNS[0]!;
  useSpeech = true;
  private selected = 1;
  private pending: { channel: number; onsetT: number } | null = null;
  private transmitting = 0;
  private snrDb = 8;

  hits = 0;
  misses = 0;
  falseAlarms = 0;
  ownCalls = 0;
  rts: number[] = [];

  constructor(host: StationHost, widthM: number) {
    super('comm', host, 'multi-comm', widthM);
  }

  setSnr(db: number): void { this.snrDb = db; }

  override beginCondition(condition: string): void {
    super.beginCondition(condition);
    this.hits = 0; this.misses = 0; this.falseAlarms = 0; this.ownCalls = 0; this.rts = [];
    this.pending = null;
    this.selected = 1;
  }

  update(_dt: number, t: number): void {
    if (!this.active) return;
    if (this.pending && t - this.pending.onsetT >= COMM_WINDOW_MS) {
      this.misses++;
      this.host.log('station_timeout', {
        station: 'comm', element: `ch${this.pending.channel}`, kind: 'call',
        onsetT: Math.round(this.pending.onsetT), windowMs: COMM_WINDOW_MS,
      });
      this.pending = null;
      this.panel.invalidate();
    }
    if (this.transmitting && t > this.transmitting) {
      this.transmitting = 0;
      this.panel.invalidate();
    }
  }

  fire(ev: StationEvent): void {
    const t = this.host.now();
    ev.firedAt = t;
    const own = !!ev.own;
    // Never announce the channel already selected: the response would then be
    // "do nothing", which is indistinguishable from a miss.
    let channel = ev.channel ?? 1;
    if (own && channel === this.selected) channel = (channel % 4) + 1;
    const sign = own ? this.callSign : this.otherSign();

    const toneGain = 0.3;
    const noiseGain = toneGain / Math.pow(10, this.snrDb / 20);
    const durationMs = this.play(sign, channel, toneGain);
    this.host.ctx.audio.noise(durationMs + 260, noiseGain);
    this.transmitting = t + durationMs + 260;

    if (own) {
      this.ownCalls++;
      this.pending = { channel, onsetT: t };
    }
    this.host.log('station_event', {
      station: 'comm', kind: 'call', element: `ch${channel}`, callSign: sign, own,
      channel, snrDb: this.snrDb, toneGain, noiseGain: +noiseGain.toFixed(4),
      commChannel: this.useSpeech ? 'speech' : 'tones',
    });
    this.panel.invalidate();
  }

  private otherSign(): string {
    return this.host.rng.pick(CALL_SIGNS.filter((s) => s !== this.callSign));
  }

  /** Plays the call and returns how long it lasts, in ms. */
  play(sign: string, channel: number, gain = 0.3): number {
    const audio = this.host.ctx.audio;
    if (this.useSpeech && audio.speak(`${sign}, ${CHANNEL_WORDS[channel]} csatorna`, { rate: 1.05 })) {
      return 2000;
    }
    this.useSpeech = false;
    const motif = MOTIFS[sign] ?? MOTIFS[CALL_SIGNS[0]!]!;
    let at = 0;
    for (const f of motif) {
      setTimeout(() => audio.tone({ freq: f, durationMs: 170, gain, shape: 'sine' }), at);
      at += 230;
    }
    at += 260;
    for (let i = 0; i < channel; i++) {
      setTimeout(() => audio.tone({ freq: 1250, durationMs: 110, gain: gain * 0.9, shape: 'triangle' }), at);
      at += 210;
    }
    return at;
  }

  respond(element: string, t: number): void {
    const ch = Number(element.slice(2));
    if (!(ch >= 1 && ch <= 4)) return;
    this.selected = ch;
    if (!this.pending) {
      this.falseAlarms++;
      this.host.log('false_alarm', { station: 'comm', element, t: Math.round(t) });
      this.panel.invalidate();
      return;
    }
    const rt = t - this.pending.onsetT;
    const correct = ch === this.pending.channel;
    if (correct) { this.hits++; this.rts.push(rt); } else { this.misses++; }
    this.host.log('station_response', {
      station: 'comm', element, kind: 'call', rtMs: +rt.toFixed(1), correct,
      onsetT: Math.round(this.pending.onsetT), expected: `ch${this.pending.channel}`,
    });
    this.pending = null;
    this.panel.invalidate();
  }

  protected draw(ui: UI): void {
    const t = ui.t;
    this.header(ui, 'RÁDIÓ', this.callSign);

    ui.circle(64, 108, 15, this.transmitting ? t.accent2 : withAlpha(t.textMuted, 0.16),
      withAlpha(t.textMuted, 0.4), 2);
    ui.text('ADÁS', 92, 108, {
      size: 18, color: this.transmitting ? t.accent2 : t.textMuted, weight: '700', font: t.fontMono,
    });
    ui.text('Csak a saját hívójeledre válaszolj.', ui.w - 24, 108, {
      size: 16, color: t.textMuted, align: 'right',
    });

    for (let i = 1; i <= 4; i++) {
      const x = 30 + (i - 1) * 124;
      const y = 168;
      const w = 110;
      const h = 128;
      ui.hit(`ch${i}`, x, y, w, h);
      const on = this.selected === i;
      ui.roundRect(x, y, w, h, 14,
        on ? withAlpha(t.accent, 0.82) : withAlpha(t.textMuted, 0.1),
        on ? t.accent : withAlpha(t.textMuted, 0.32), on ? 3 : 2);
      ui.text(String(i), x + w / 2, y + h / 2 - 6, {
        size: 52, color: on ? '#0a0d12' : t.text, align: 'center', weight: '700', font: t.fontDisplay,
      });
      ui.text('CSATORNA', x + w / 2, y + h - 22, {
        size: 12, color: on ? withAlpha('#0a0d12', 0.7) : t.textMuted,
        align: 'center', font: t.fontMono, letterSpacing: '0.1em',
      });
    }
  }
}

/* --------------------------------------------------------------- TRACK */

/** Non-harmonic forcing frequencies: their ratios are irrational enough that
 *  the sum does not repeat inside a block, so the drift cannot be learned. */
export const FORCING_FREQS = [0.043, 0.097, 0.211, 0.367];
const FORCING_AMPS = [1.9, 1.4, 0.9, 0.55];
/** Degrees per second at full stick deflection. */
const STICK_GAIN = 9.0;
export const TRACK_CLAMP_DEG = 12;

export class TrackStation implements Station {
  readonly id: StationId = 'track';
  readonly group = new THREE.Group();
  active = false;

  private ring: THREE.Mesh;
  private outer: THREE.Mesh;
  private disc: THREE.Mesh;
  private centre = new THREE.Vector3();
  private right = new THREE.Vector3(1, 0, 0);
  private up = new THREE.Vector3(0, 1, 0);
  private radius = 2;

  private errX = 0;
  private errY = 0;
  private phaseX: number[] = [];
  private phaseY: number[] = [];
  private gain = 1;
  private t0 = 0;

  private sumSq = 0;
  private samples = 0;
  private binSumSq = 0;
  private binCount = 0;
  private binMax = 0;
  private binStickSum = 0;
  private binStart = 0;
  private idleSince: number | null = null;
  idleMs = 0;
  private settleUntil = 0;

  constructor(private host: StationHost, private stick: () => { x: number; y: number }) {
    const th = host.ctx.theme;
    this.outer = makePrimitive({ kind: 'torus', color: th.textMuted, unlit: true, size: 0.52, opacity: 0.16 });
    this.ring = makePrimitive({ kind: 'torus', color: th.textMuted, unlit: true, size: 0.26, opacity: 0.55 });
    this.disc = makePrimitive({ kind: 'sphere', color: th.accent, unlit: true, size: 0.072 });
    this.group.add(this.outer, this.ring, this.disc);
    for (let i = 0; i < FORCING_FREQS.length; i++) {
      this.phaseX.push(host.rng.range(0, Math.PI * 2));
      this.phaseY.push(host.rng.range(0, Math.PI * 2));
    }
  }

  get phases(): { x: number[]; y: number[] } {
    return { x: this.phaseX.map((v) => +v.toFixed(3)), y: this.phaseY.map((v) => +v.toFixed(3)) };
  }

  place(pos: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.centre.copy(pos);
    this.radius = Math.max(0.5, pos.distanceTo(lookAt));
    const fwd = this.centre.clone().sub(lookAt).normalize();
    this.right.set(0, 1, 0).cross(fwd).normalize();
    this.up.copy(fwd).cross(this.right).normalize();
    for (const o of [this.ring, this.outer]) {
      o.position.copy(this.centre);
      o.lookAt(lookAt);
    }
    this.disc.position.copy(this.centre);
  }

  worldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.centre);
  }

  setActive(active: boolean, condition: string): void {
    this.active = active;
    this.group.visible = active;
    void condition;
  }

  setGain(g: number): void { this.gain = g; }

  beginCondition(_condition: string): void {
    this.errX = 0; this.errY = 0;
    this.sumSq = 0; this.samples = 0;
    this.binSumSq = 0; this.binCount = 0; this.binMax = 0; this.binStickSum = 0;
    this.idleMs = 0; this.idleSince = null;
    this.t0 = this.host.now();
    this.binStart = this.t0;
    // The first seconds are picking up the stick, not tracking.
    this.settleUntil = this.t0 + 5000;
  }

  get rmsDeg(): number {
    return this.samples ? Math.sqrt(this.sumSq / this.samples) : NaN;
  }

  update(dt: number, t: number): void {
    if (!this.active) return;
    const s = (t - this.t0) / 1000;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < FORCING_FREQS.length; i++) {
      const w = 2 * Math.PI * FORCING_FREQS[i]!;
      vx += FORCING_AMPS[i]! * this.gain * Math.sin(w * s + this.phaseX[i]!);
      vy += FORCING_AMPS[i]! * this.gain * Math.sin(w * s + this.phaseY[i]!);
    }
    const st = this.stick();
    this.errX += (vx - STICK_GAIN * st.x) * dt;
    this.errY += (vy - STICK_GAIN * st.y) * dt;
    // Without a clamp an abandoned tracking task would integrate towards
    // infinity, and the RMS would measure block length rather than behaviour.
    const mag = Math.hypot(this.errX, this.errY);
    if (mag > TRACK_CLAMP_DEG) {
      this.errX = (this.errX / mag) * TRACK_CLAMP_DEG;
      this.errY = (this.errY / mag) * TRACK_CLAMP_DEG;
    }

    const mPerDegX = this.radius * Math.tan((this.errX * Math.PI) / 180);
    const mPerDegY = this.radius * Math.tan((this.errY * Math.PI) / 180);
    this.disc.position.copy(this.centre)
      .addScaledVector(this.right, mPerDegX)
      .addScaledVector(this.up, mPerDegY);

    const stickMag = Math.hypot(st.x, st.y);
    if (stickMag < 0.05) {
      if (this.idleSince === null) this.idleSince = t;
      else if (t - this.idleSince >= 1500) { this.idleMs += dt * 1000; }
    } else this.idleSince = null;

    if (t >= this.settleUntil) {
      const e2 = mag * mag;
      this.sumSq += e2;
      this.samples++;
      this.binSumSq += e2;
      this.binCount++;
      this.binMax = Math.max(this.binMax, mag);
      this.binStickSum += stickMag;
    }
    if (t - this.binStart >= 1000) {
      if (this.binCount > 0) {
        this.host.log('track_bin', {
          rmsDeg: +Math.sqrt(this.binSumSq / this.binCount).toFixed(2),
          maxDeg: +this.binMax.toFixed(2),
          stickMean: +(this.binStickSum / this.binCount).toFixed(3),
          binMs: Math.round(t - this.binStart),
        });
      }
      this.binStart = t;
      this.binSumSq = 0; this.binCount = 0; this.binMax = 0; this.binStickSum = 0;
    }
  }

  fire(): void { /* the tracking station has no discrete events */ }
  respond(): void { /* nor a discrete response */ }
  dispose(): void { /* geometry is disposed with the module root */ }
}
