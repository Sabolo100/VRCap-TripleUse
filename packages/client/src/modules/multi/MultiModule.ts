import * as THREE from 'three';
import {
  MODULE_BY_CODE, mean, median, stdev, clamp, normaliseSoft, opsScore, slope,
  normalisedEntropy, type ModuleManifest, type TrialRecord,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { BodyAnchor } from '../shared/anchor.js';
import { viewRelation } from '../shared/volume.js';
import {
  CALL_SIGNS, CommStation, MonitorStation, ResourceStation, TrackStation,
  FORCING_FREQS, TRACK_CLAMP_DEG, MONITOR_WINDOW_MS, COMM_WINDOW_MS,
  type Station, type StationEvent, type StationHost, type StationId,
} from './stations.js';

/**
 * MODULE 05 - MULTI
 * Multi-attribute task load, after NASA MATB-II.
 *
 * The one module whose headline number is a DIFFERENCE, not a level. A
 * tracking error of 2.8 degrees under load says nothing on its own: we cannot
 * tell a poor divider of attention from someone who simply tracks badly. So
 * every station also runs alone, in a baseline block, and `dual_task_cost` is
 * the ratio between the two.
 *
 * What the headset adds is not that the panels are in 3D - they are flat
 * panels, and honestly so. It is that they SURROUND the participant. At 68 and
 * 138 degrees, no more than two stations are ever in view, so allocating
 * attention stops being an eye movement we cannot measure and becomes a head
 * turn we can. That is where `station_dwell_entropy` and `neglect_time_s` come
 * from, and it is why both are absent on a flat screen, where all four panels
 * are visible at once and there is nothing to allocate.
 *
 * The flat layout is kept deliberately: it is the classic MATB-II arrangement,
 * which is what makes the flat run comparable with the published literature.
 * The two are different measurements and the module says so.
 */

type BlockId = 'baseline' | 'dual' | 'load';

const RADIUS_M = 2.0;
const BASELINE_MS = 50_000;
const DUAL_MS = 80_000;
const LOAD_MS = 140_000;
const PRACTICE_STATION_MS = 15_000;
const PRACTICE_QUAD_MS = 30_000;

interface Rates {
  monitorPerMin: number;
  commPerMin: number;
  pumpPerMin: number;
  forcingGain: number;
  snrDb: number;
}

const RATES_LOW: Rates = { monitorPerMin: 5, commPerMin: 4, pumpPerMin: 1.5, forcingGain: 1.0, snrDb: 8 };
const RATES_HIGH: Rates = { monitorPerMin: 10, commPerMin: 7, pumpPerMin: 3, forcingGain: 1.45, snrDb: 3 };
const OWN_CALL_RATIO = 0.4;

interface CondResult {
  condition: string;
  stations: StationId[];
  durationMs: number;
  trackRms: number;
  trackIdleFraction: number;
  monitorHits: number;
  monitorMisses: number;
  monitorFa: number;
  monitorRts: number[];
  resourceDeviation: number;
  recoveryLags: number[];
  commHits: number;
  commMisses: number;
  commFa: number;
  commOwn: number;
  commRts: number[];
  dwellMs: Record<StationId, number>;
  neglectMs: Record<StationId, number>;
  rtFacing: number[];
  rtAway: number[];
}

const STATION_ORDER: StationId[] = ['track', 'monitor', 'resource', 'comm'];

const STATION_LABEL: Record<StationId, string> = {
  track: 'KÖVETÉS',
  monitor: 'RENDSZER',
  resource: 'TARTÁLYOK',
  comm: 'RÁDIÓ',
};

export class MultiModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.MULTI!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'baseline',
      title: 'EGYESÉVEL',
      instruction:
        'Négy állomás van. Most mindegyiket külön kapod meg, hogy kiderüljön, mire vagy képes, ' +
        'amikor csak egy dolgod van. Ez lesz az összehasonlítási alap.',
      controlHint: '',
      trials: 4,
      practiceTrials: 4,
      unitLabel: 'állomás',
    },
    {
      id: 'dual',
      title: 'KETTŐ EGYSZERRE',
      instruction:
        'Most a KÖVETÉS és a RENDSZER megy egyszerre. A kar a bal kezedben marad, ' +
        'a válasz a jobbal megy.',
      controlHint: '',
      trials: 1,
      practiceTrials: 1,
      unitLabel: 'menet',
    },
    {
      id: 'load',
      title: 'MIND A NÉGY',
      instruction:
        'Mind a négy állomás egyszerre, két szakaszban. A második szakaszban sűrűbben történnek ' +
        'a dolgok. Nem lehet mindent tökéletesen csinálni — az a kérdés, mit engedsz el.',
      controlHint: '',
      trials: 2,
      practiceTrials: 1,
      unitLabel: 'terhelési szint',
    },
  ];

  /* ------------------------------------------------------------- state */

  private ctx!: ModuleContext;
  private anchor!: BodyAnchor;
  private track!: TrackStation;
  private monitor!: MonitorStation;
  private resource!: ResourceStation;
  private comm!: CommStation;
  private stations: Station[] = [];
  private statusPanel!: Panel;

  private condition = '';
  private activeIds: StationId[] = [];
  private practice = false;
  private aborted = false;
  private commSide = 1;
  private trialNumber = 0;

  private queue: StationEvent[] = [];
  private phase: { end: number; resolve: () => void } | null = null;
  private results: CondResult[] = [];
  private cur: CondResult | null = null;
  private eventFacing = new Map<string, StationId | null>();

  private facing: StationId | null = null;
  private lastSeen = new Map<StationId, number>();
  private statusText = '';

  private offClick: (() => void) | null = null;
  private offAction: (() => void) | null = null;

  /* -------------------------------------------------------------- init */

  async init(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    ctx.recorder.setMotionHz(20);
    this.anchor = new BodyAnchor(ctx);
    this.anchor.capture();

    const host: StationHost = {
      ctx,
      rng: ctx.rng,
      now: () => ctx.engine.clock.frameTime,
      log: (type, payload) => this.log(type, payload),
      isPractice: () => this.practice,
    };

    const w = this.panelWidth();
    this.track = new TrackStation(host, () => this.stickInput());
    this.monitor = new MonitorStation(host, w);
    this.resource = new ResourceStation(host, w);
    this.comm = new CommStation(host, w);
    this.stations = [this.track, this.monitor, this.resource, this.comm];
    for (const s of this.stations) {
      ctx.root.add(s.group);
      s.setActive(false, '');
    }

    this.comm.callSign = ctx.rng.pick(CALL_SIGNS);
    this.comm.useSpeech = ctx.audio.speechAvailable;
    this.commSide = ctx.rng.bool() ? 1 : -1;

    this.statusPanel = new Panel({
      width: ctx.platform === 'vr' ? 1.1 : 0.9,
      height: ctx.platform === 'vr' ? 0.17 : 0.14,
      pxPerMeter: 640,
      theme: ctx.theme,
      frame: false,
      name: 'multi-status',
      superSample: 2,
    });
    this.statusPanel.setDraw((ui) => this.drawStatus(ui));
    this.statusPanel.group.visible = false;
    ctx.root.add(this.statusPanel.group);
    ctx.panels.add(this.statusPanel);

    this.placeStations();

    this.offClick = ctx.panels.onClick((e) => this.onPanelClick(e.panel, e.widget.id, e.t));
    for (const b of this.blocks) b.controlHint = this.controlHint();

    if (!ctx.audio.speechAvailable) {
      this.log('speech_unavailable', { fallback: 'tones' });
    }

    ctx.recorder.event('multi_setup', {
      platform: ctx.platform,
      layout: ctx.platform === 'vr' ? 'surround' : 'flat',
      stationAzDeg: Object.fromEntries(STATION_ORDER.map((id) => [id, this.layout()[id][0]])),
      stationElDeg: Object.fromEntries(STATION_ORDER.map((id) => [id, this.layout()[id][1]])),
      commSide: this.commSide > 0 ? 'right' : 'left',
      commChannel: this.comm.useSpeech ? 'speech' : 'tones',
      speechAvailable: ctx.audio.speechAvailable,
      callSign: this.comm.callSign,
      radiusM: RADIUS_M,
      panelWidthM: w,
      forcingFreqs: FORCING_FREQS,
      forcingPhases: this.track.phases,
      trackClampDeg: TRACK_CLAMP_DEG,
      stickResolution: ctx.platform === 'desktop' ? 'digital' : 'analog',
      quantisationMs: +(ctx.engine.clock.frameInterval || 11.1).toFixed(1),
      audioOutputLatencyMs: ctx.audio.outputLatencyMs,
    });
  }

  /* ------------------------------------------------------------ layout */

  private panelWidth(): number {
    switch (this.ctx.platform) {
      case 'vr': return 0.86;
      case 'desktop': return 0.78;
      default: return 0.62;
    }
  }

  /**
   * Where the four stations sit, as [azimuth, elevation] in degrees.
   *
   * In VR the spread is wide enough that no more than two are ever in view -
   * the Quest 3 horizontal half-field is about 55 degrees and the panel half
   * width is 12, so the monitoring panel begins where the field of view ends.
   * On a flat screen that is impossible, so the flat layout is the classic
   * MATB-II one with everything visible, and the allocation metrics are
   * dropped rather than faked.
   */
  private layout(): Record<StationId, [number, number]> {
    switch (this.ctx.platform) {
      case 'vr':
        return {
          track: [0, -6],
          monitor: [-68, 0],
          resource: [68, 0],
          comm: [this.commSide * 138, 0],
        };
      case 'desktop':
        return { track: [0, -12], monitor: [-30, 0], resource: [30, 0], comm: [0, 18] };
      default:
        return { track: [0, -11], monitor: [-26, 0], resource: [26, 0], comm: [0, 14] };
    }
  }

  private placeStations(): void {
    const L = this.layout();
    const origin = this.anchor.origin;
    const pos = new THREE.Vector3();
    const byId: Record<StationId, Station> = {
      track: this.track, monitor: this.monitor, resource: this.resource, comm: this.comm,
    };
    for (const id of STATION_ORDER) {
      const [az, el] = L[id];
      this.anchor.place(az, el, RADIUS_M, pos);
      byId[id].place(pos, origin);
    }
    // The status line sits below the tracking station, which is the one place
    // every layout keeps in front of the participant.
    this.anchor.place(0, this.ctx.platform === 'vr' ? -22 : -24, RADIUS_M * 0.92, pos);
    this.statusPanel.group.position.copy(pos);
    this.statusPanel.group.lookAt(origin);
  }

  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr': return 'BAL KAR: követés · JOBB RAVASZ: válasz az állomásokon';
      case 'desktop': return 'WASD vagy nyilak: követés · KATTINTÁS: válasz az állomásokon';
      default: return 'BAL HÜVELYK: kar · KOPPINTÁS: válasz az állomásokon';
    }
  }

  /** The analogue control, from whichever device this platform has. */
  private stickInput(): { x: number; y: number } {
    const mc = this.ctx.mobileControls;
    if (mc) return mc.stickVector();
    const m = this.ctx.engine.input.move;
    return { x: m.x, y: m.y };
  }

  /* ------------------------------------------------------- calibration */

  async calibrate(ctx: ModuleContext): Promise<void> {
    this.anchor.capture();
    this.placeStations();
    this.statusPanel.group.visible = true;

    const sign = this.comm.callSign;
    this.setStatus(`A hívójeled: ${sign}. Hallgasd meg — kétszer játszom le.`);
    this.comm.play(sign, 2);
    await this.wait(2600);
    if (this.aborted) return;
    this.comm.play(sign, 2);
    await this.wait(2600);
    if (this.aborted) return;

    this.setStatus(
      ctx.platform === 'vr'
        ? 'Fordulj körbe egyszer, hogy lásd mind a négy állomást. Ha kész vagy, nyomd meg a ravaszt.'
        : 'Ha kész vagy, nyomd meg a gombot.'
    );
    this.ctx.mobileControls?.set({
      hint: `A hívójeled: ${sign}`,
      buttons: [{ id: 'ready', label: 'KÉSZ VAGYOK', variant: 'primary', wide: true, action: 'CONFIRM' }],
    });

    await new Promise<void>((resolve) => {
      const off = ctx.engine.input.on((e: ActionEvent) => {
        if (!e.down || (e.action !== 'PRIMARY' && e.action !== 'CONFIRM')) return;
        off();
        resolve();
      });
      this.offAction = off;
    });
    this.offAction = null;
    this.ctx.mobileControls?.clear();

    ctx.recorder.event('calibration_done', {
      callSign: sign,
      commChannel: this.comm.useSpeech ? 'speech' : 'tones',
      anchorHeight: +this.anchor.eyeHeight.toFixed(3),
      anchorYawDeg: +((this.anchor.yaw * 180) / Math.PI).toFixed(1),
    });
    this.statusPanel.group.visible = false;
  }

  /* ------------------------------------------------------------ blocks */

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.practice = practice;
    this.anchor.ensure();
    this.statusPanel.group.visible = true;

    switch (block.id as BlockId) {
      case 'baseline': {
        const ms = practice ? PRACTICE_STATION_MS : BASELINE_MS;
        for (const id of STATION_ORDER) {
          if (this.aborted) return;
          await this.announce(`Következik egyedül: ${STATION_LABEL[id]}`);
          await this.runPhase([id], ms, `baseline_${id}`, RATES_LOW);
        }
        break;
      }
      case 'dual':
        await this.announce('Következik: KÖVETÉS és RENDSZER egyszerre');
        await this.runPhase(['track', 'monitor'], practice ? PRACTICE_QUAD_MS : DUAL_MS, 'dual', RATES_LOW);
        break;
      case 'load': {
        const levels: [string, Rates][] = practice
          ? [['load_practice', RATES_LOW]]
          : [['load_low', RATES_LOW], ['load_high', RATES_HIGH]];
        for (const [cond, rates] of levels) {
          if (this.aborted) return;
          await this.announce(
            cond === 'load_high' ? 'Következik: mind a négy, sűrűbben' : 'Következik: mind a négy állomás'
          );
          await this.runPhase(STATION_ORDER, practice ? PRACTICE_QUAD_MS : LOAD_MS, cond, rates);
        }
        break;
      }
    }

    this.statusPanel.group.visible = false;
    for (const s of this.stations) s.setActive(false, '');
    this.ctx.mobileControls?.clear();
  }

  private async announce(text: string): Promise<void> {
    this.setStatus(text);
    await this.wait(this.practice ? 1800 : 6000);
  }

  private runPhase(active: StationId[], durationMs: number, condition: string, rates: Rates): Promise<void> {
    const ctx = this.ctx;
    const t0 = ctx.engine.clock.frameTime;
    this.condition = condition;
    this.activeIds = active;
    this.eventFacing.clear();

    this.track.setGain(rates.forcingGain);
    this.comm.setSnr(rates.snrDb);
    const byId: Record<StationId, Station> = {
      track: this.track, monitor: this.monitor, resource: this.resource, comm: this.comm,
    };
    for (const id of STATION_ORDER) {
      const on = active.includes(id);
      byId[id].beginCondition(condition);
      byId[id].setActive(on, condition);
    }

    this.queue = this.schedule(active, durationMs, rates, t0);
    this.cur = {
      condition, stations: [...active], durationMs,
      trackRms: NaN, trackIdleFraction: NaN,
      monitorHits: 0, monitorMisses: 0, monitorFa: 0, monitorRts: [],
      resourceDeviation: NaN, recoveryLags: [],
      commHits: 0, commMisses: 0, commFa: 0, commOwn: 0, commRts: [],
      dwellMs: { track: 0, monitor: 0, resource: 0, comm: 0 },
      neglectMs: { track: 0, monitor: 0, resource: 0, comm: 0 },
      rtFacing: [], rtAway: [],
    };
    this.lastSeen.clear();
    for (const id of active) this.lastSeen.set(id, t0);
    this.facing = null;

    this.setStatus(active.map((id) => STATION_LABEL[id]).join(' · '));
    this.setControls(active);

    this.ctx.recorder.event('phase_start', {
      condition, practice: this.practice, activeStations: active,
      durationMs, eventRates: rates, plannedEvents: this.queue.length,
    });

    return new Promise<void>((resolve) => {
      this.phase = { end: t0 + durationMs, resolve };
    });
  }

  /**
   * The whole event list is generated up front from the seeded RNG, never
   * drawn as the block runs. That is what makes a run reproducible from its
   * seed - and what lets a fake-clock unit test see the same sequence the
   * headset would.
   */
  private schedule(active: StationId[], durationMs: number, rates: Rates, t0: number): StationEvent[] {
    const rng = this.ctx.rng;
    const out: StationEvent[] = [];
    const exp = (meanMs: number, minMs: number) =>
      Math.max(minMs, -Math.log(1 - rng.next() * 0.999) * meanMs);

    if (active.includes('monitor')) {
      const elements = ['green', 'red', 'scale0', 'scale1', 'scale2', 'scale3'];
      let t = t0 + exp(60000 / rates.monitorPerMin, 3500);
      while (t < t0 + durationMs - MONITOR_WINDOW_MS) {
        out.push({ station: 'monitor', kind: 'monitor_deviation', element: rng.pick(elements), t });
        t += exp(60000 / rates.monitorPerMin, 3500);
      }
    }
    if (active.includes('comm')) {
      let t = t0 + exp(60000 / rates.commPerMin, 4000);
      while (t < t0 + durationMs - COMM_WINDOW_MS) {
        out.push({
          station: 'comm', kind: 'call', element: 'call', t,
          own: rng.bool(OWN_CALL_RATIO), channel: rng.int(1, 4),
        });
        t += exp(60000 / rates.commPerMin, 4000);
      }
    }
    if (active.includes('resource')) {
      let t = t0 + exp(60000 / rates.pumpPerMin, 6000);
      while (t < t0 + durationMs - 12000) {
        out.push({ station: 'resource', kind: 'pump_fail', element: `pump${rng.int(1, 4)}`, t });
        t += exp(60000 / rates.pumpPerMin, 6000);
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  private setControls(active: StationId[]): void {
    const mc = this.ctx.mobileControls;
    if (!mc) return;
    const hasTrack = active.includes('track');
    const hints: Record<StationId, string> = {
      track: 'Tartsd a korongot a gyűrű közepén.',
      monitor: 'Koppints arra az elemre, ami eltér.',
      resource: 'Tartsd mindkét tartályt a zöld sávban.',
      comm: 'Csak a saját hívójeledre válaszolj.',
    };
    mc.set({
      // Never `look` here: this module times every response, and drag-to-turn
      // defers PRIMARY to pointerup. There is also nothing to turn towards -
      // the flat layout keeps all four stations in view.
      look: 'off',
      hint: active.length === 1 ? hints[active[0]!] : active.map((id) => STATION_LABEL[id]).join(' · '),
      stick: hasTrack ? { side: 'left', label: 'KÖVETÉS' } : undefined,
    });
  }

  /* ------------------------------------------------------------- frame */

  update(dt: number, ctx: ModuleContext): void {
    const ph = this.phase;
    if (!ph) return;
    const t = ctx.engine.clock.frameTime;

    while (this.queue.length && this.queue[0]!.t <= t) {
      const ev = this.queue.shift()!;
      this.dispatch(ev);
    }

    const byId: Record<StationId, Station> = {
      track: this.track, monitor: this.monitor, resource: this.resource, comm: this.comm,
    };
    for (const id of this.activeIds) byId[id].update(dt, t);

    this.sampleFacing(t, dt);

    if (this.aborted || t >= ph.end) {
      this.phase = null;
      this.closePhase(t);
      ph.resolve();
    }
  }

  private dispatch(ev: StationEvent): void {
    const byId: Record<StationId, Station> = {
      track: this.track, monitor: this.monitor, resource: this.resource, comm: this.comm,
    };
    // Captured before the station fires, so the head direction recorded is the
    // one at stimulus onset rather than after the participant has turned.
    this.eventFacing.set(`${ev.station}:${ev.element}`, this.facing);
    if (ev.station === 'monitor') {
      this.ctx.recorder.event('station_event', {
        station: ev.station, kind: ev.kind, element: ev.element,
        condition: this.condition,
        headFacingStation: this.facing,
        headOffsetDeg: this.offsetTo(ev.station),
      });
    }
    byId[ev.station].fire(ev);
  }

  /**
   * Which station the participant is facing, and for how long.
   *
   * This is head direction, not gaze - the Quest 3 has no eye tracking, and
   * the metric names say so. On a flat platform there is no head to read and
   * everything is on screen anyway, so nothing is sampled.
   */
  private sampleFacing(t: number, dt: number): void {
    const cur = this.cur;
    if (!cur || this.ctx.platform !== 'vr') return;
    const cam = this.ctx.engine.camera;
    const p = new THREE.Vector3();
    let best: StationId | null = null;
    let bestEcc = 30;
    const byId: Record<StationId, Station> = {
      track: this.track, monitor: this.monitor, resource: this.resource, comm: this.comm,
    };
    for (const id of this.activeIds) {
      byId[id].worldPosition(p);
      const rel = viewRelation(cam, p);
      if (rel.eccentricityDeg < bestEcc) { bestEcc = rel.eccentricityDeg; best = id; }
    }
    if (best) {
      cur.dwellMs[best] += dt * 1000;
      this.lastSeen.set(best, t);
    }
    for (const id of this.activeIds) {
      const gap = t - (this.lastSeen.get(id) ?? t);
      if (gap > cur.neglectMs[id]) cur.neglectMs[id] = gap;
    }
    if (best !== this.facing) {
      this.ctx.recorder.event('station_gaze', {
        station: best, previous: this.facing, offsetDeg: +bestEcc.toFixed(1), condition: this.condition,
      });
      this.facing = best;
    }
  }

  private offsetTo(id: StationId): number | null {
    if (this.ctx.platform !== 'vr') return null;
    const byId: Record<StationId, Station> = {
      track: this.track, monitor: this.monitor, resource: this.resource, comm: this.comm,
    };
    const p = byId[id].worldPosition(new THREE.Vector3());
    return +viewRelation(this.ctx.engine.camera, p).eccentricityDeg.toFixed(1);
  }

  private closePhase(t: number): void {
    const cur = this.cur;
    if (!cur) return;
    // One last neglect sweep: a station abandoned for the whole tail of the
    // block would otherwise never have its gap closed.
    if (this.ctx.platform === 'vr') {
      for (const id of this.activeIds) {
        const gap = t - (this.lastSeen.get(id) ?? t);
        if (gap > cur.neglectMs[id]) cur.neglectMs[id] = gap;
      }
    }
    if (this.activeIds.includes('track')) {
      cur.trackRms = this.track.rmsDeg;
      cur.trackIdleFraction = clamp(this.track.idleMs / Math.max(1, cur.durationMs), 0, 1);
    }
    if (this.activeIds.includes('monitor')) {
      cur.monitorHits = this.monitor.hits;
      cur.monitorMisses = this.monitor.misses;
      cur.monitorFa = this.monitor.falseAlarms;
      cur.monitorRts = [...this.monitor.rts];
    }
    if (this.activeIds.includes('resource')) {
      cur.resourceDeviation = this.resource.deviation;
      cur.recoveryLags = [...this.resource.recoveryLags];
    }
    if (this.activeIds.includes('comm')) {
      cur.commHits = this.comm.hits;
      cur.commMisses = this.comm.misses;
      cur.commFa = this.comm.falseAlarms;
      cur.commOwn = this.comm.ownCalls;
      cur.commRts = [...this.comm.rts];
    }
    if (!this.practice) this.results.push(cur);
    this.ctx.recorder.event('phase_end', {
      condition: cur.condition, practice: this.practice,
      trackRmsDeg: r(cur.trackRms, 2),
      monitorHits: cur.monitorHits, monitorMisses: cur.monitorMisses, monitorFalseAlarms: cur.monitorFa,
      resourceDeviation: r(cur.resourceDeviation, 0),
      commHits: cur.commHits, commMisses: cur.commMisses, commOwnCalls: cur.commOwn,
      dwellMs: this.ctx.platform === 'vr' ? cur.dwellMs : null,
      neglectMs: this.ctx.platform === 'vr' ? cur.neglectMs : null,
    });
    this.cur = null;
    this.queue = [];
  }

  /* ------------------------------------------------------------ events */

  private onPanelClick(panel: Panel, widgetId: string, t: number): void {
    if (!this.phase) return;
    for (const s of [this.monitor, this.resource, this.comm]) {
      if (!s.ownsPanel(panel)) continue;
      if (!s.active) return;
      s.respond(widgetId, t);
      return;
    }
  }

  /**
   * Every station event goes through here, which is the one place that knows
   * both the response and where the participant was looking when the stimulus
   * appeared - so the orientation cost and the trial record are assembled once.
   */
  private log(type: string, payload: Record<string, unknown> = {}): void {
    const enriched: Record<string, unknown> = { ...payload, condition: this.condition };

    if (type === 'station_response' || type === 'station_timeout') {
      const key = `${payload.station}:${payload.element}`;
      const facingAtOnset = this.eventFacing.get(key) ?? null;
      enriched.facingAtOnset = facingAtOnset;
      enriched.headFacingStation = this.facing;

      const rt = typeof payload.rtMs === 'number' ? payload.rtMs : null;
      const correct = payload.correct === true;
      if (this.cur && rt !== null && correct && payload.station === 'monitor') {
        (facingAtOnset === 'monitor' ? this.cur.rtFacing : this.cur.rtAway).push(rt);
      }
      if (!this.practice) this.recordTrial(type, payload, facingAtOnset, rt, correct);
    }
    this.ctx.recorder.event(type, enriched);
  }

  private recordTrial(
    type: string,
    payload: Record<string, unknown>,
    facingAtOnset: StationId | null,
    rt: number | null,
    correct: boolean
  ): void {
    const started = typeof payload.onsetT === 'number' ? payload.onsetT : this.ctx.engine.clock.frameTime;
    this.trialNumber++;
    const rec: TrialRecord = {
      trialNumber: this.trialNumber,
      block: String(payload.station ?? 'unknown'),
      stimulus: {
        station: payload.station,
        kind: payload.kind ?? null,
        element: payload.element,
        condition: this.condition,
        activeStations: [...this.activeIds],
        headFacingStation: facingAtOnset,
        expected: payload.expected ?? payload.element,
      },
      response: type === 'station_timeout' ? null : {
        element: payload.element,
        rtMs: rt,
        quantisationMs: +(this.ctx.engine.clock.frameInterval || 11.1).toFixed(1),
      },
      correct: type === 'station_timeout' ? false : correct,
      outcome: type === 'station_timeout' ? 'timeout' : correct ? 'hit' : 'miss',
      reactionTimeMs: rt,
      startedAt: started,
      endedAt: this.ctx.engine.clock.frameTime,
    };
    this.ctx.recorder.trial(rec);
  }

  /* ------------------------------------------------------------ status */

  private setStatus(text: string): void {
    this.statusText = text;
    this.statusPanel.invalidate();
  }

  private drawStatus(ui: UI): void {
    const t = ui.t;
    ui.background(withAlpha(t.surface, 0.9), 14);
    ui.text(this.statusText, ui.w / 2, ui.h / 2, {
      size: 30, color: t.text, align: 'center', weight: '600', font: t.fontDisplay,
      maxWidth: ui.w - 40,
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ------------------------------------------------------------ finish */

  /** Whether the radio actually used speech. Safe before init(), which is how
   *  the scoring pipeline can be exercised without a DOM. */
  private commUsedSpeech(): boolean {
    return this.comm?.useSpeech !== false;
  }

  private find(condition: string): CondResult | undefined {
    return this.results.find((r0) => r0.condition === condition);
  }

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    const bTrack = this.find('baseline_track');
    const bMonitor = this.find('baseline_monitor');
    const bResource = this.find('baseline_resource');
    const bComm = this.find('baseline_comm');
    const dual = this.find('dual');
    const low = this.find('load_low');
    const high = this.find('load_high');

    const hitRate = (h: number, m: number) => (h + m > 0 ? h / (h + m) : NaN);
    const monHit = (c?: CondResult) => (c ? hitRate(c.monitorHits, c.monitorMisses) : NaN);
    const comHit = (c?: CondResult) => (c && c.commOwn > 0 ? c.commHits / c.commOwn : NaN);
    const faPerMin = (n: number, c?: CondResult) => (c ? (n * 60000) / c.durationMs : NaN);

    /* ------------------------------------------------ dual-task cost */

    // The comparison is baseline against load_LOW, never load_high: those two
    // share event rates exactly, so the only thing that differs is how many
    // tasks run at once. load_high changes the rates as well, and is reported
    // separately as an overload cost.
    const costOf = (base: number, loaded: number, higherIsWorse: boolean): number => {
      if (!Number.isFinite(base) || !Number.isFinite(loaded) || base === 0) return NaN;
      const raw = higherIsWorse ? (loaded - base) / base : (base - loaded) / base;
      return clamp(raw, 0, 2);
    };
    const costTrack = costOf(bTrack?.trackRms ?? NaN, low?.trackRms ?? NaN, true);
    const costMonitor = costOf(monHit(bMonitor), monHit(low), false);
    const costResource = costOf(bResource?.resourceDeviation ?? NaN, low?.resourceDeviation ?? NaN, true);
    const costComm = costOf(comHit(bComm), comHit(low), false);
    const costs = [costTrack, costMonitor, costResource, costComm].filter(Number.isFinite);
    const dualTaskCost = costs.length ? mean(costs) : NaN;
    const costClipped = [
      [bTrack?.trackRms ?? NaN, low?.trackRms ?? NaN, true] as const,
    ].some(([b, l, h]) => Number.isFinite(b) && Number.isFinite(l) && b !== 0
      && (h ? (l - b) / b : (b - l) / b) > 2);

    const overloadCost = costOf(monHit(low), monHit(high), false);

    /* --------------------------------------------------- load slope */

    // Only track and monitoring run in all three conditions, so the composite
    // is built from those two alone; mixing in stations that are absent from
    // the two-task point would compare different things at each x.
    const compositeAt = (c?: CondResult, trackC?: CondResult, monC?: CondResult): number => {
      const rms = (c ?? trackC)?.trackRms ?? NaN;
      const hit = c ? monHit(c) : monHit(monC);
      const a = normaliseSoft(Number.isFinite(rms) ? rms : 8, 1.4, 6.5);
      const b = normaliseSoft(Number.isFinite(hit) ? hit : 0.4, 0.92, 0.5);
      return (a + b) / 2;
    };
    const p1 = bTrack && bMonitor ? compositeAt(undefined, bTrack, bMonitor) : NaN;
    const p2 = dual ? compositeAt(dual) : NaN;
    const p4 = low ? compositeAt(low) : NaN;
    const havePoints = [p1, p2, p4].every(Number.isFinite);
    const loadSlope = havePoints ? slope([1, 2, 4], [p1, p2, p4]) : NaN;
    const drop12 = havePoints ? p1 - p2 : NaN;
    const drop24 = havePoints ? (p2 - p4) / 2 : NaN;
    const overloadKnee = havePoints ? drop24 > 2 * Math.max(0.5, drop12) : false;

    /* ------------------------------------------- spatial (VR only) */

    let dwellEntropy = NaN;
    let neglectS = NaN;
    let orientationCost = NaN;
    let rearHit = NaN;
    if (isVr && low) {
      dwellEntropy = normalisedEntropy(STATION_ORDER.map((id) => low.dwellMs[id]));
      neglectS = Math.max(...STATION_ORDER.map((id) => low.neglectMs[id])) / 1000;
      if (low.rtFacing.length >= 3 && low.rtAway.length >= 3) {
        orientationCost = median(low.rtAway) - median(low.rtFacing);
      }
      rearHit = comHit(low);
    }

    /* ------------------------------------------------------ metrics */

    const M: [string, number, string, string?][] = [
      ['dual_task_cost', dualTaskCost, 'ratio', 'overall'],
      ['dual_task_cost_track', costTrack, 'ratio', 'overall'],
      ['dual_task_cost_monitor', costMonitor, 'ratio', 'overall'],
      ['dual_task_cost_resource', costResource, 'ratio', 'overall'],
      ['dual_task_cost_comm', costComm, 'ratio', 'overall'],
      ['overload_cost', overloadCost, 'ratio', 'overall'],
      ['load_slope', loadSlope, 'score/task', 'overall'],
      ['tracking_rms', low?.trackRms ?? NaN, 'deg', 'load_low'],
      ['tracking_rms_baseline', bTrack?.trackRms ?? NaN, 'deg', 'baseline'],
      ['tracking_rms_high', high?.trackRms ?? NaN, 'deg', 'load_high'],
      ['tracking_idle_fraction', low?.trackIdleFraction ?? NaN, 'ratio', 'load_low'],
      ['monitor_hit_rate', monHit(low), 'ratio', 'load_low'],
      ['monitor_hit_rate_baseline', monHit(bMonitor), 'ratio', 'baseline'],
      ['monitor_rt_median', low && low.monitorRts.length ? median(low.monitorRts) : NaN, 'ms', 'load_low'],
      ['monitor_false_alarms_per_min', faPerMin(low?.monitorFa ?? NaN, low), '1/min', 'load_low'],
      ['resource_deviation', low?.resourceDeviation ?? NaN, 'units', 'load_low'],
      ['resource_deviation_baseline', bResource?.resourceDeviation ?? NaN, 'units', 'baseline'],
      ['pump_recovery_lag_s',
        low && low.recoveryLags.length ? median(low.recoveryLags) / 1000 : NaN, 's', 'load_low'],
      ['audio_hit_rate', comHit(low), 'ratio', 'load_low'],
      ['audio_hit_rate_baseline', comHit(bComm), 'ratio', 'baseline'],
      ['comm_false_alarms', low?.commFa ?? NaN, 'count', 'load_low'],
      ['comm_rt_median', low && low.commRts.length ? median(low.commRts) : NaN, 'ms', 'load_low'],
    ];
    if (isVr) {
      M.push(['station_dwell_entropy', dwellEntropy, 'ratio', 'load_low']);
      M.push(['neglect_time_s', neglectS, 's', 'load_low']);
      M.push(['orientation_cost_ms', orientationCost, 'ms', 'load_low']);
      M.push(['rear_station_hit_rate', rearHit, 'ratio', 'load_low']);
    }
    for (const [n, v, u, sc] of M) rec.metric(n, v, u, sc);

    /* ------------------------------------------------------- scores */

    const faPenalty = (fa: number, perMin: number) =>
      Number.isFinite(fa) ? clamp(1 - fa / Math.max(1, perMin), 0, 1) : 1;

    const trackingScore = normaliseSoft(Number.isFinite(low?.trackRms ?? NaN) ? low!.trackRms : 8, 1.4, 6.5);
    const monitoringScore = normaliseSoft(Number.isFinite(monHit(low)) ? monHit(low) : 0.4, 0.92, 0.5)
      * faPenalty(faPerMin(low?.monitorFa ?? 0, low), 6);
    const resourceScore = normaliseSoft(
      Number.isFinite(low?.resourceDeviation ?? NaN) ? low!.resourceDeviation : 1200, 220, 900);
    const commScore = normaliseSoft(Number.isFinite(comHit(low)) ? comHit(low) : 0.3, 0.9, 0.45)
      * faPenalty(faPerMin(low?.commFa ?? 0, low), 4);
    const resilience = normaliseSoft(
      Number.isFinite(dualTaskCost) ? 1 - dualTaskCost : 0.2, 0.85, 0.2);
    const distribution = normaliseSoft(Number.isFinite(dwellEntropy) ? dwellEntropy : 0.45, 0.9, 0.45);
    const orientation = normaliseSoft(Number.isFinite(neglectS) ? neglectS : 55, 12, 55);

    const components = isVr
      ? [
          { key: 'tracking_performance', value: trackingScore, weight: 0.20 },
          { key: 'monitoring_performance', value: monitoringScore, weight: 0.18 },
          { key: 'resource_performance', value: resourceScore, weight: 0.14 },
          { key: 'comm_performance', value: commScore, weight: 0.14 },
          { key: 'dual_task_resilience', value: resilience, weight: 0.20 },
          { key: 'attention_distribution', value: distribution, weight: 0.08 },
          { key: 'orientation_efficiency', value: orientation, weight: 0.06 },
        ]
      : [
          { key: 'tracking_performance', value: trackingScore, weight: 0.24 },
          { key: 'monitoring_performance', value: monitoringScore, weight: 0.22 },
          { key: 'resource_performance', value: resourceScore, weight: 0.17 },
          { key: 'comm_performance', value: commScore, weight: 0.17 },
          { key: 'dual_task_resilience', value: resilience, weight: 0.20 },
        ];
    const ops = opsScore(components);
    for (const c of components) rec.score(c.key, c.value, '1.0.0');

    /* ------------------------------------------------------ headline */

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const deg = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}°` : '—');

    const worst = ([
      ['a követést', costTrack], ['a rendszerfigyelést', costMonitor],
      ['a tartályokat', costResource], ['a rádiót', costComm],
    ] as [string, number][])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1])[0];

    const headline: ModuleResult['headline'] = [
      {
        label: 'Többfeladatos költség', value: pct(dualTaskCost),
        hint: worst ? `leginkább ${worst[0]} engedted el` : 'ennyivel romlott a teljesítményed terhelés alatt',
      },
      {
        label: 'Követés terhelés alatt', value: deg(low?.trackRms ?? NaN),
        hint: Number.isFinite(bTrack?.trackRms ?? NaN) ? `egyedül ${deg(bTrack!.trackRms)} volt` : undefined,
      },
      {
        label: 'Rendszerfigyelés', value: pct(monHit(low)),
        hint: low ? `${low.monitorMisses} kihagyott, ${low.monitorFa} téves riasztás` : undefined,
      },
      {
        label: 'Rádió', value: pct(comHit(low)),
        hint: this.commUsedSpeech() ? 'zajban, a saját hívójeledre' : 'hangkódolt hívójel (nincs beszédszintézis)',
      },
    ];
    if (isVr) {
      headline.push({
        label: 'Figyelemelosztás',
        value: Number.isFinite(dwellEntropy) ? dwellEntropy.toFixed(2) : '—',
        hint: Number.isFinite(dwellEntropy)
          ? (dwellEntropy > 0.8 ? 'egyenletesen osztottad el' : 'egy-két állomásra koncentráltál')
          : undefined,
      });
      headline.push({
        label: 'Leghosszabb elhanyagolás',
        value: Number.isFinite(neglectS) ? `${Math.round(neglectS)} s` : '—',
        hint: 'ennyi ideig nem néztél az egyik állomásra',
      });
    } else {
      headline.push({
        label: 'Figyelemelosztás', value: '—',
        hint: 'ehhez VR kell — sík képernyőn mind a négy állomás egyszerre látszik',
      });
    }

    return {
      opsScore: ops,
      headline,
      summary: {
        platform: ctx.platform,
        layout: isVr ? 'surround' : 'flat',
        spatialWeightsApplied: isVr,
        commChannel: this.commUsedSpeech() ? 'speech' : 'tones',
        callSign: this.comm?.callSign ?? null,
        costClipped,
        dualTaskCost: r(dualTaskCost, 3),
        costs: {
          track: r(costTrack, 3), monitor: r(costMonitor, 3),
          resource: r(costResource, 3), comm: r(costComm, 3),
        },
        overloadCost: r(overloadCost, 3),
        loadCurve: { one: r(p1, 1), two: r(p2, 1), four: r(p4, 1), slope: r(loadSlope, 2), knee: overloadKnee },
        conditions: this.results.map((c) => ({
          condition: c.condition,
          stations: c.stations,
          durationMs: Math.round(c.durationMs),
          trackRmsDeg: r(c.trackRms, 2),
          trackIdleFraction: r(c.trackIdleFraction, 3),
          monitorHitRate: r(hitRate(c.monitorHits, c.monitorMisses), 3),
          monitorFalseAlarms: c.monitorFa,
          monitorRtMedianMs: c.monitorRts.length ? r(median(c.monitorRts)) : null,
          resourceDeviation: r(c.resourceDeviation, 0),
          commHitRate: c.commOwn > 0 ? r(c.commHits / c.commOwn, 3) : null,
          commFalseAlarms: c.commFa,
          dwellMs: isVr ? c.dwellMs : null,
          neglectMs: isVr ? c.neglectMs : null,
        })),
        spatial: isVr ? {
          dwellEntropy: r(dwellEntropy, 3),
          neglectTimeS: r(neglectS, 1),
          orientationCostMs: r(orientationCost, 1),
          rearStationHitRate: r(rearHit, 3),
        } : null,
        monitorRtSd: low && low.monitorRts.length > 2 ? r(stdev(low.monitorRts)) : null,
      },
      axisScores: {
        attention: Math.round((monitoringScore + commScore + (isVr ? distribution : monitoringScore)) / 3),
        motor: Math.round(trackingScore),
        executive: Math.round(resilience),
      },
    };
  }

  abort(): void {
    this.aborted = true;
    const ph = this.phase;
    if (ph) {
      this.phase = null;
      ph.resolve();
    }
  }

  dispose(ctx: ModuleContext): void {
    this.aborted = true;
    this.offClick?.();
    this.offAction?.();
    ctx.audio.stopSpeech();
    for (const s of this.stations) s.dispose();
    ctx.panels.remove(this.statusPanel);
    this.statusPanel.dispose();
    disposeTree(ctx.root);
  }
}

function r(v: number, digits = 1): number | null {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
