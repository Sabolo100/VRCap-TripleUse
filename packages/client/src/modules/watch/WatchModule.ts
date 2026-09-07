import * as THREE from 'three';
import {
  MODULE_BY_CODE, median, mean, slope, normaliseSoft, opsScore, clamp,
  sdt, normalisedEntropy,
  type ModuleManifest, type TrialRecord,
} from '@vrcap/shared';
import type { AssessmentModule, BlockDescriptor, ModuleContext, ModuleResult } from '../../engine/task/Module.js';
import { makePrimitive, disposeTree } from '../../engine/world/Primitives.js';
import { Panel, type UI } from '../../engine/ui/Panel.js';
import { fitAngles } from '../../engine/ui/viewport.js';
import { withAlpha } from '../../engine/ui/UITheme.js';
import type { ActionEvent } from '../../engine/core/types.js';
import { layoutVolume, volumeFor, viewRelation, wrapDeg, type VolumeField, type VolumeSlot } from '../shared/volume.js';

/**
 * MODULE 06 - WATCH
 * Vigilance and spatial supervision.
 *
 * The classic vigilance task puts one monotonous stream on a screen and asks
 * whether rare deviations get missed over time. That measures one thing: the
 * temporal decay of detection. A guard post, a control room or a sensor
 * operator's station is not like that - the event can be behind you, above
 * you, or far away.
 *
 * So the participant stands inside a 32-emitter LATTICE that surrounds them
 * completely. Every emitter is a glowing sphere on a column, at a genuinely
 * different distance, and the whole lattice pulses in unison. The task is to
 * catch any single emitter stepping out of that rhythm.
 *
 * Three measurements follow that a flat display cannot produce:
 *
 *   SPATIAL COVERAGE   turning is the sampling behaviour. If you do not turn,
 *                      you cannot see - so head direction is the task, not a
 *                      proxy for it.
 *   SCAN SHRINKAGE     the spatial form of vigilance decrement: how much of
 *                      the sector supervised in the first third is still being
 *                      supervised in the last. Two people with identical
 *                      detection decay can differ completely here, and quietly
 *                      giving up on the rear arc is the more dangerous pattern.
 *   REAR DETECTION     events behind the participant's initial facing are only
 *                      catchable if they actually look round.
 *
 * Depth is a separate channel: angular size is held constant across the 3.2 -
 * 8.5 m range, so distance is carried by disparity and parallax alone. That
 * exists in a headset and does not exist on a monitor, which is why
 * `depth_cost` is reported as a VR-only metric.
 */

type BlockId = 'calibration' | 'watchA' | 'watchB';
type EventType = 'skip' | 'double' | 'hue' | 'drift' | 'audio';

const BASE_COLOR = 0x3c7fb1;
/** Trough of the pulse: dark enough that the ramp is unmistakable. */
const IDLE_COLOR = 0x16222e;
/**
 * Detection window for an event in the frontal field.
 *
 * An event you are already looking at is a detection-latency measurement, and
 * 2.4 s is generous for that.
 */
const RESPONSE_WINDOW_MS = 2400;
/**
 * Extra time granted in proportion to how far the event is from where the
 * participant was looking when it started.
 *
 * With a flat window an event behind the participant was undetectable unless
 * they happened to already be turning - which measured luck, not vigilance.
 * A 180 degree turn plus recognition takes well over two seconds, so the
 * window has to cover the search the surround layout demands. Directly behind
 * therefore gets 2.4 + 3.6 = 6.0 s.
 */
const REAR_SEARCH_ALLOWANCE_MS = 3600;
const MIN_GAP_MS = 4000;

/** Response window for an event that started `eccDeg` off the gaze axis. */
function windowForEccentricity(eccDeg: number): number {
  return RESPONSE_WINDOW_MS + (clamp(eccDeg, 0, 180) / 180) * REAR_SEARCH_ALLOWANCE_MS;
}
const PULSE_HZ = 1.15;

interface Emitter {
  index: number;
  slot: VolumeSlot;
  group: THREE.Group;
  sphere: THREE.Mesh;
  /** Set while this emitter is the deviant. */
  event: EventType | null;
  eventStart: number;
  /** Pulse counter at which the emitter last fired, for skip/double. */
  driftOffset: THREE.Vector3;
}

interface WatchEvent {
  type: EventType;
  emitterIndex: number;
  onsetT: number;
  eccentricityDeg: number;
  behind: boolean;
  third: number;
  detected: boolean;
  rtMs: number | null;
  block: BlockId;
  radius: number;
  /** How long this event stays available, scaled by its onset eccentricity. */
  windowMs: number;
}

export class WatchModule implements AssessmentModule {
  readonly manifest: ModuleManifest = MODULE_BY_CODE.WATCH!;

  readonly blocks: BlockDescriptor[] = [
    {
      id: 'calibration',
      title: 'KALIBRÁCIÓ',
      instruction:
        'Körülötted fények pulzálnak, mind egyszerre. NYOMD MEG A RAVASZT, valahányszor BÁRMELYIK kilép a közös ütemből: ' +
        'kihagy egy pulzust, duplán villan, színt vált, vagy elmozdul. Ebben a rövid blokkban sűrűn lesznek események — ' +
        'ez méri, mit veszel észre pihenten.',
      controlHint: '',
      trials: 1,
      practiceTrials: 1,
    },
    {
      id: 'watchA',
      title: 'SZOLGÁLAT A',
      instruction:
        'Négy perc figyelés. Az események most jóval ritkábbak, és bárhol történhetnek — akár mögötted is. ' +
        'Fordulj körbe folyamatosan: amit nem nézel, azt nem látod. A hátad mögött induló eltérés hosszabb ' +
        'ideig marad, hogy legyen időd megfordulni és megtalálni. Nem kapsz visszajelzést; ez szándékos.',
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
    },
    {
      id: 'watchB',
      title: 'SZOLGÁLAT B',
      instruction:
        'Még négy perc. A rács most lassan forogni fog körülötted, tehát a fények helye folyamatosan változik. ' +
        'Néha hang is jelezhet eseményt — arról az irányból, ahol történt.',
      controlHint: '',
      trials: 1,
      practiceTrials: 0,
    },
  ];

  /* ------------------------------------------------------------ state */

  private ctx!: ModuleContext;
  private root = new THREE.Group();
  /** Everything rotates as one rigid body in block B. */
  private lattice = new THREE.Group();
  private field!: VolumeField;
  private emitters: Emitter[] = [];
  private hudPanel!: Panel;

  private currentBlock: BlockId = 'calibration';
  private practice = false;
  private blockStartT = 0;
  private blockDurationMs = 0;
  private running = false;
  private rotationDegPerSec = 0;
  private latticeYaw = 0;

  private events: WatchEvent[] = [];
  private falseAlarms: { t: number; sinceLastEventMs: number }[] = [];
  private activeEvent: WatchEvent | null = null;
  private nextEventAt = 0;
  private eventRateMs = 14000;
  private lastEventEndT = 0;

  private trials: TrialRecord[] = [];
  private offInput: (() => void) | null = null;
  private aborted = false;
  private blockResolve: (() => void) | null = null;

  /** Head-direction sampling, per block third. */
  private yawSamples: number[][] = [[], [], []];
  private yawBins: number[][] = [new Array(24).fill(0), new Array(24).fill(0), new Array(24).fill(0)];
  private sampleTimer = 0;
  private lastYaw: number | null = null;
  private yawTravelDeg = 0;

  private practiceFeedback = '';

  /* ------------------------------------------------------------- init */

  init(ctx: ModuleContext): void {
    this.ctx = ctx;
    ctx.root.add(this.root);
    this.root.add(this.lattice);

    this.field = volumeFor(ctx.platform, {
      vr: { azDeg: 180, elMinDeg: -16, elMaxDeg: 26, rNear: 3.2, rFar: 8.5, minSepDeg: 9 },
      desktop: { azDeg: 26, elMinDeg: -11, elMaxDeg: 13, rNear: 4.0, rFar: 5.2, minSepDeg: 7 },
      mobile: { azDeg: 20, elMinDeg: -10, elMaxDeg: 12, rNear: 4.0, rFar: 5.0, minSepDeg: 7 },
    });

    const count = ctx.platform === 'vr' ? 32 : ctx.platform === 'desktop' ? 18 : 14;
    this.buildLattice(count);

    this.hudPanel = new Panel({
      width: 0.5, height: 0.11, pxPerMeter: 950, theme: ctx.theme, frame: false, name: 'watch-hud',
    });
    this.hudPanel.setDraw((ui) => this.drawHud(ui));
    this.hudPanel.group.visible = false;
    ctx.root.add(this.hudPanel.group);
    ctx.panels.add(this.hudPanel);

    for (const b of this.blocks) b.controlHint = this.controlHint();

    this.offInput = ctx.engine.input.on((e) => this.onAction(e));

    ctx.recorder.event('lattice_built', {
      emitters: count,
      azSpan: this.field.azDeg * 2,
      rRange: [this.field.rNear, this.field.rFar],
      elRange: [this.field.elMinDeg, this.field.elMaxDeg],
      platform: ctx.platform,
    });
  }

  private controlHint(): string {
    switch (this.ctx.platform) {
      case 'vr':
        return 'Fordulj körbe nyugodtan — az események bárhol történhetnek, akár mögötted is. ' +
          'Húzd meg a ravaszt, amint bármelyik fény kilép a közös ütemből.';
      case 'mobile':
        return 'A képernyő alján az ELTÉRÉS gombra koppints, amint bármelyik fény kilép a közös ütemből.';
      default:
        return 'Kattints vagy nyomj SZÓKÖZT, amint bármelyik fény kilép a közös ütemből.';
    }
  }

  /* ---------------------------------------------------------- lattice */

  private buildLattice(count: number): void {
    const slots = layoutVolume(count, this.field, this.ctx.rng);
    for (let i = 0; i < count; i++) {
      const slot = slots[i]!;
      const g = new THREE.Group();

      // A bare floating sphere has no depth anchor. The column and the base
      // plate give perspective, which is what makes this a place rather than a
      // set of dots painted on a sphere.
      const sphere = makePrimitive({
        kind: 'sphere', color: BASE_COLOR, unlit: true, size: 0.17 * slot.depthScale,
      });
      const columnHeight = 1.1 * slot.depthScale;
      const column = makePrimitive({
        kind: 'cylinder', color: 0x1b2836, unlit: true, size: [0.03 * slot.depthScale, columnHeight, 0.03 * slot.depthScale],
      });
      column.position.y = -columnHeight / 2 - 0.10 * slot.depthScale;
      const base = makePrimitive({
        kind: 'cylinder', color: 0x16202c, unlit: true, size: [0.26 * slot.depthScale, 0.02 * slot.depthScale, 0.26 * slot.depthScale],
      });
      base.position.y = -columnHeight - 0.10 * slot.depthScale;

      g.add(sphere, column, base);
      g.position.copy(slot.position);
      this.lattice.add(g);

      this.emitters.push({
        index: i, slot, group: g, sphere,
        event: null, eventStart: 0,
        driftOffset: new THREE.Vector3(),
      });
    }
  }

  /* ------------------------------------------------------- block driver */

  /**
   * Touch controls.
   *
   * The response is a trigger pull in the headset. On a phone a bare tap would
   * do, but this is a vigilance task: a stray touch while shifting grip would
   * land as a false alarm on a measure that is mostly about false alarms. A
   * dedicated button keeps the scene free of accidental answers.
   *
   * The lattice is already narrowed to +/-20 degrees on a phone, so everything
   * is inside the field of view and no turning is required here.
   */
  private setupTouchControls(): void {
    this.ctx.mobileControls?.set({
      hint: 'Figyeld a közös ütemet. Amint bármelyik fény kilép belőle, nyomd meg a gombot.',
      buttons: [{
        id: 'deviation', label: 'ELTÉRÉS', sub: 'most lépett ki az ütemből',
        variant: 'primary', wide: true,
        action: 'PRIMARY',
      }],
    });
  }

  async runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void> {
    this.setupTouchControls();
    this.practice = practice;
    this.currentBlock = block.id as BlockId;
    if (practice && this.currentBlock !== 'calibration') return;

    if (practice) {
      await this.runWatch(38000, 6000, 0, true);
      return;
    }

    switch (this.currentBlock) {
      case 'calibration':
        await this.runWatch(100000, 7000, 0, false);
        break;
      case 'watchA':
        await this.runWatch(240000, 14000, 0, false);
        break;
      case 'watchB':
        // The lattice turns slowly, so emitters drift through the field of
        // view and their positions cannot be memorised. Over four minutes it
        // completes more than a full revolution, which also guarantees that
        // every emitter spends time in the rear arc.
        this.rotationDegPerSec = ctx.platform === 'vr' ? 2.2 : ctx.platform === 'desktop' ? 1.2 : 1.0;
        ctx.recorder.event('lattice_rotation', { degPerSec: this.rotationDegPerSec });
        await this.runWatch(240000, 14000, this.rotationDegPerSec, false);
        this.rotationDegPerSec = 0;
        break;
    }
  }

  private runWatch(durationMs: number, rateMs: number, rotation: number, practice: boolean): Promise<void> {
    const ctx = this.ctx;
    this.blockStartT = ctx.engine.clock.frameTime;
    this.blockDurationMs = durationMs;
    this.eventRateMs = rateMs;
    this.rotationDegPerSec = rotation;
    this.running = true;
    this.activeEvent = null;
    this.lastEventEndT = this.blockStartT;
    this.nextEventAt = this.blockStartT + ctx.rng.range(2500, 5000);
    this.yawSamples = [[], [], []];
    this.yawBins = [new Array(24).fill(0), new Array(24).fill(0), new Array(24).fill(0)];
    this.yawTravelDeg = 0;
    this.lastYaw = null;
    this.hudPanel.group.visible = true;

    return new Promise<void>((resolve) => {
      this.blockResolve = () => {
        this.running = false;
        this.hudPanel.group.visible = false;
        this.clearEvent();
        if (!practice) this.logThirdSummaries();
        resolve();
      };
    });
  }

  /* ------------------------------------------------------------ events */

  private eventPool(): EventType[] {
    // Audio events carry their information in HRTF panning, which needs head
    // tracking to be interpretable at all. On a flat screen they would be a
    // "something happened somewhere" cue, so the type is dropped entirely
    // rather than degraded.
    const spatialAudio = this.ctx.platform === 'vr';
    const pool: EventType[] = [
      'skip', 'skip', 'skip', 'skip',
      'double', 'double', 'double', 'double',
      'hue', 'hue', 'hue',
      'drift', 'drift',
    ];
    if (spatialAudio) pool.push('audio', 'audio');
    return pool;
  }

  private startEvent(now: number): WatchEvent {
    const ctx = this.ctx;
    const type = ctx.rng.pick(this.eventPool());
    const em = ctx.rng.pick(this.emitters);
    const worldPos = new THREE.Vector3();
    em.group.getWorldPosition(worldPos);
    const rel = viewRelation(ctx.engine.camera, worldPos);

    em.event = type;
    em.eventStart = now;

    const third = clamp(Math.floor(((now - this.blockStartT) / this.blockDurationMs) * 3), 0, 2);
    const ev: WatchEvent = {
      type,
      emitterIndex: em.index,
      onsetT: now,
      eccentricityDeg: rel.eccentricityDeg,
      behind: rel.behind,
      third,
      detected: false,
      rtMs: null,
      block: this.currentBlock,
      radius: em.slot.radius,
      windowMs: windowForEccentricity(rel.eccentricityDeg),
    };
    this.activeEvent = ev;
    if (!this.practice) this.events.push(ev);

    if (type === 'audio') {
      ctx.audio.tone({ freq: 660, durationMs: 180, gain: 0.3, position: worldPos });
    }

    ctx.recorder.event('watch_event', {
      eventType: type, emitterIndex: em.index,
      azDeg: +em.slot.azDeg.toFixed(1), elDeg: +em.slot.elDeg.toFixed(1),
      radius: +em.slot.radius.toFixed(2),
      eccentricityDeg: +rel.eccentricityDeg.toFixed(1), behind: rel.behind, third,
      windowMs: Math.round(ev.windowMs),
      quantisationMs: +ctx.engine.clock.frameInterval.toFixed(1),
    }, now);
    return ev;
  }

  private clearEvent(): void {
    for (const em of this.emitters) {
      if (!em.event) continue;
      em.event = null;
      em.driftOffset.set(0, 0, 0);
      em.group.position.copy(em.slot.position);
    }
  }

  private closeEvent(now: number): void {
    const ev = this.activeEvent;
    this.activeEvent = null;
    this.clearEvent();
    this.lastEventEndT = now;
    if (!ev || this.practice) return;

    if (!ev.detected) {
      this.ctx.recorder.event('watch_miss', {
        eventType: ev.type, eccentricityDeg: +ev.eccentricityDeg.toFixed(1), behind: ev.behind,
      }, now);
    }
    this.recordTrial(ev);
  }

  private recordTrial(ev: WatchEvent): void {
    const rec: TrialRecord = {
      trialNumber: this.trials.length + 1,
      block: ev.block,
      stimulus: {
        kind: 'watch', block: ev.block, eventType: ev.type, emitterIndex: ev.emitterIndex,
        eccentricityDeg: +ev.eccentricityDeg.toFixed(1), behind: ev.behind,
        radius: +ev.radius.toFixed(2), third: ev.third, practice: false,
      },
      response: ev.detected ? { rtMs: +(ev.rtMs ?? 0).toFixed(1), detected: true } : null,
      correct: ev.detected,
      outcome: ev.detected ? 'hit' : 'miss',
      reactionTimeMs: ev.rtMs === null ? null : +ev.rtMs.toFixed(1),
      startedAt: +ev.onsetT.toFixed(1),
      endedAt: +(ev.onsetT + ev.windowMs).toFixed(1),
    };
    this.ctx.recorder.trial(rec);
    this.trials.push(rec);
  }

  /* ------------------------------------------------------------ input */

  private onAction(e: ActionEvent): void {
    if (!e.down || e.action !== 'PRIMARY' || !this.running) return;
    const ev = this.activeEvent;

    if (ev && !ev.detected && e.t - ev.onsetT <= ev.windowMs) {
      ev.detected = true;
      ev.rtMs = e.t - ev.onsetT;
      this.ctx.audio.click();
      this.ctx.engine.input.pulse('both', 0.25, 20);
      this.ctx.recorder.event('watch_response', {
        rtMs: +ev.rtMs.toFixed(1), detected: true, eventType: ev.type,
        eccentricityDeg: +ev.eccentricityDeg.toFixed(1), behind: ev.behind,
      }, e.t);
      if (this.practice) {
        this.practiceFeedback = `${Math.round(ev.rtMs)} ms · ${TYPE_LABEL[ev.type]}`;
        this.ctx.audio.ok();
        this.hudPanel.invalidate();
      }
      return;
    }

    // Anything outside a response window is a false alarm. There are no
    // discrete blank trials in a continuous watch, so this is the only way the
    // criterion can be estimated at all.
    const sinceLast = e.t - this.lastEventEndT;
    if (!this.practice) this.falseAlarms.push({ t: e.t, sinceLastEventMs: sinceLast });
    this.ctx.recorder.event('watch_false_alarm', { sinceLastEventMs: +sinceLast.toFixed(1) }, e.t);
    this.ctx.audio.error();
    if (this.practice) {
      this.practiceFeedback = 'NEM VOLT ESEMÉNY';
      this.hudPanel.invalidate();
    }
  }

  /* ---------------------------------------------------------- per frame */

  update(dt: number, ctx: ModuleContext): void {
    const now = ctx.engine.clock.frameTime;

    if (this.rotationDegPerSec !== 0) {
      this.latticeYaw += (this.rotationDegPerSec * Math.PI / 180) * dt;
      this.lattice.rotation.y = this.latticeYaw;
    }

    this.updatePulse(now);

    if (!this.running) return;

    // Sample head direction for coverage. This is not incidental telemetry:
    // in this module it is half the measurement.
    // Sampled on every platform so the trace is always complete; the derived
    // coverage metrics are gated to VR at scoring time, because on a flat
    // screen the camera only turns if the participant chooses to drag it.
    this.sampleTimer += dt;
    if (this.sampleTimer >= 0.1) {
      this.sampleTimer = 0;
      const q = new THREE.Quaternion();
      ctx.engine.camera.getWorldQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const yaw = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
      const third = clamp(Math.floor(((now - this.blockStartT) / this.blockDurationMs) * 3), 0, 2);
      const samples = this.yawSamples[third];
      const bins = this.yawBins[third];
      if (samples && bins) {
        samples.push(yaw);
        const bin = clamp(Math.floor(((yaw + 180) / 360) * 24), 0, 23);
        bins[bin] = (bins[bin] ?? 0) + 1;
        if (samples.length % 10 === 0) ctx.recorder.event('head_sample', { yawDeg: +yaw.toFixed(1) });
      }
      if (this.lastYaw !== null) this.yawTravelDeg += Math.abs(wrapDeg(yaw - this.lastYaw));
      this.lastYaw = yaw;
    }

    // Close an event once its window has elapsed.
    if (this.activeEvent && now - this.activeEvent.onsetT > this.activeEvent.windowMs) {
      this.closeEvent(now);
    }

    // Schedule the next event.
    if (!this.activeEvent && now >= this.nextEventAt && now - this.lastEventEndT >= MIN_GAP_MS) {
      const remaining = this.blockDurationMs - (now - this.blockStartT);
      // Room for the longest window an event might claim, so a late rear
      // event is never cut short by the end of the block.
      if (remaining > RESPONSE_WINDOW_MS + REAR_SEARCH_ALLOWANCE_MS + 1500) {
        const started = this.startEvent(now);
        const w = started.windowMs;
        // Exponential spacing keeps the participant from learning a rhythm.
        this.nextEventAt = now + w + ctx.rng.isi(MIN_GAP_MS, this.eventRateMs * 1.9);
      }
    }

    if (now - this.blockStartT >= this.blockDurationMs) {
      if (this.activeEvent) this.closeEvent(now);
      const r = this.blockResolve;
      this.blockResolve = null;
      r?.();
      return;
    }

    // The HUD shows time remaining and nothing else. A hit counter or a live
    // score would itself sustain vigilance, and would erase exactly the
    // decrement this module exists to measure.
    if (Math.floor(now / 1000) !== this.lastHudSecond) {
      this.lastHudSecond = Math.floor(now / 1000);
      this.hudPanel.invalidate();
    }
    this.positionHud();
  }

  private lastHudSecond = 0;

  /**
   * The shared pulse, plus whatever deviation is currently in force.
   * Everything the participant has to detect is a departure from this one
   * common rhythm - which is why the phase must be shared exactly.
   */
  private updatePulse(now: number): void {
    const phase = (now / 1000) * PULSE_HZ;
    const base = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    const accent = new THREE.Color(this.ctx.theme.accent);
    const accent2 = new THREE.Color(this.ctx.theme.accent2);
    const idle = new THREE.Color(IDLE_COLOR);

    for (const em of this.emitters) {
      const mat = em.sphere.material as THREE.MeshBasicMaterial;
      let level = base;
      let target = accent;

      if (em.event) {
        const dt = now - em.eventStart;
        switch (em.event) {
          case 'skip':
            // Hold dark through one whole cycle.
            level = dt < 1000 / PULSE_HZ ? 0.06 : base;
            break;
          case 'double': {
            // Two pulses inside one period.
            const p2 = (now / 1000) * PULSE_HZ * 2;
            level = dt < 1000 / PULSE_HZ ? 0.5 - 0.5 * Math.cos(p2 * Math.PI * 2) : base;
            break;
          }
          case 'hue':
            // One period in the wrong colour. Visible from any angle, so a
            // tumbling or distant emitter is not disadvantaged.
            if (dt < 1000 / PULSE_HZ) target = accent2;
            break;
          case 'drift': {
            // Slide out and back over 1.2 s. In a volume this reads as a real
            // displacement in depth and direction, not a 2D nudge.
            const k = clamp(dt / 1200, 0, 1);
            const amount = Math.sin(k * Math.PI) * 0.55 * em.slot.depthScale;
            const lateral = new THREE.Vector3(-em.slot.position.z, 0, em.slot.position.x).normalize();
            em.driftOffset.copy(lateral).multiplyScalar(amount);
            em.group.position.copy(em.slot.position).add(em.driftOffset);
            break;
          }
          case 'audio':
            break;
        }
      }

      // The pulse is a single ramp from a dark idle to the target colour, so
      // brightness and hue carry the same phase and there is one rhythm to
      // step out of.
      mat.color.copy(idle).lerp(target, clamp(level, 0, 1));
    }
  }

  private positionHud(): void {
    const cam = this.ctx.engine.camera;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    cam.getWorldPosition(p);
    cam.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    fwd.normalize();
    // The HUD follows the participant so it is readable whichever way they
    // have turned - and it must, because turning is the task. On a phone the
    // drop below eye level has to be clamped: 42 degrees of vertical viewport
    // is not much, and there is no looking down on a flat screen.
    const fit = fitAngles(this.ctx, {
      elDeg: -20, distanceM: 1.7,
      widthM: this.hudPanel.width, heightM: this.hudPanel.height,
    });
    const rad = (fit.elDeg * Math.PI) / 180;
    this.hudPanel.group.position.copy(p)
      .addScaledVector(fwd, fit.distanceM * Math.cos(rad));
    this.hudPanel.group.position.y = p.y + fit.distanceM * Math.sin(rad);
    this.hudPanel.group.lookAt(p);
  }

  private logThirdSummaries(): void {
    for (let third = 0; third < 3; third++) {
      const evs = this.events.filter((e) => e.block === this.currentBlock && e.third === third);
      if (evs.length === 0) continue;
      const hits = evs.filter((e) => e.detected).length;
      const rts = evs.filter((e) => e.detected && e.rtMs !== null).map((e) => e.rtMs!);
      this.ctx.recorder.event('third_summary', {
        block: this.currentBlock, third, hits, events: evs.length,
        hitRate: +(hits / evs.length).toFixed(3),
        medianRt: rts.length ? +median(rts).toFixed(1) : null,
        scanRangeDeg: +this.coverageOf(third).toFixed(1),
      });
    }
  }

  /** Angular sector actually supervised in a block third, degrees. */
  private coverageOf(third: number): number {
    const bins = this.yawBins[third];
    if (!bins) return 0;
    const visited = bins.filter((c) => c > 0).length;
    return (visited / 24) * 360;
  }

  /* --------------------------------------------------------------- UI */

  private drawHud(ui: UI): void {
    const t = ui.t;
    const now = this.ctx.engine.clock.frameTime;
    const remain = Math.max(0, this.blockDurationMs - (now - this.blockStartT));
    ui.roundRect(0, 0, ui.w, ui.h, 12, withAlpha('#000000', 0.45));
    const mm = Math.floor(remain / 60000);
    const ss = Math.floor((remain % 60000) / 1000);
    ui.text(`${mm}:${String(ss).padStart(2, '0')}`, ui.w / 2, ui.h / 2, {
      size: 34, color: withAlpha(t.textMuted, 0.85), align: 'center', weight: '600', font: t.fontMono,
    });
    if (this.practice && this.practiceFeedback) {
      ui.text(this.practiceFeedback, ui.w / 2, ui.h - 18, {
        size: 18, color: this.practiceFeedback.includes('ms') ? t.ok : t.bad, align: 'center', weight: '600',
      });
    }
  }

  /* ----------------------------------------------------------- scoring */

  finish(ctx: ModuleContext): ModuleResult {
    const rec = ctx.recorder;
    const isVr = ctx.platform === 'vr';

    const watchEvents = this.events.filter((e) => e.block !== 'calibration');
    const calibEvents = this.events.filter((e) => e.block === 'calibration');

    const hitRateOf = (evs: WatchEvent[]) => (evs.length ? evs.filter((e) => e.detected).length / evs.length : NaN);
    const hitRate = hitRateOf(watchEvents);
    const calibHitRate = hitRateOf(calibEvents);
    const fatigueIndex = Number.isFinite(calibHitRate) && Number.isFinite(hitRate) ? calibHitRate - hitRate : NaN;

    /* --- signal detection over a continuous watch ------------------- */
    // With no discrete blank trials, the false-alarm denominator is a
    // convention: the watch time is divided into response-window-sized slots
    // and the ones not containing an event are treated as noise trials. The
    // count is stored alongside so any reanalysis knows what d' was against.
    const watchDurationMs = 240000 * 2;
    const noiseTrials = Math.max(1, Math.round(watchDurationMs / RESPONSE_WINDOW_MS) - watchEvents.length);
    const hits = watchEvents.filter((e) => e.detected).length;
    const misses = watchEvents.length - hits;
    const fa = this.falseAlarms.length;
    const stats = sdt(hits, misses, fa, Math.max(0, noiseTrials - fa));

    const rts = watchEvents.filter((e) => e.detected && e.rtMs !== null).map((e) => e.rtMs!);
    const medianRt = median(rts);

    /* --- vigilance decrement across thirds --------------------------- */
    const thirdStats = [0, 1, 2].map((third) => {
      const evs = watchEvents.filter((e) => e.third === third);
      const h = evs.filter((e) => e.detected).length;
      const m = evs.length - h;
      const faShare = Math.round(fa / 3);
      const s = evs.length ? sdt(h, m, faShare, Math.max(0, Math.round(noiseTrials / 3) - faShare)) : null;
      const r = evs.filter((e) => e.detected && e.rtMs !== null).map((e) => e.rtMs!);
      return {
        third,
        hitRate: evs.length ? h / evs.length : NaN,
        dPrime: s ? s.dPrime : NaN,
        medianRt: r.length ? median(r) : NaN,
        n: evs.length,
      };
    });
    const usable = thirdStats.filter((s) => Number.isFinite(s.hitRate) && s.n > 0);
    const decHitRate = usable.length >= 2 ? slope(usable.map((s) => s.third), usable.map((s) => s.hitRate)) : NaN;
    const decDPrime = usable.length >= 2 ? slope(usable.map((s) => s.third), usable.map((s) => s.dPrime)) : NaN;
    const rtThirds = thirdStats.filter((s) => Number.isFinite(s.medianRt));
    const decRt = rtThirds.length >= 2 ? slope(rtThirds.map((s) => s.third), rtThirds.map((s) => s.medianRt)) : NaN;

    /* --- spatial measures (VR only) ---------------------------------- */
    const eccPoints = watchEvents.map((e) => e.eccentricityDeg);
    const eccCost = eccPoints.length >= 4
      ? slope(eccPoints, watchEvents.map((e) => (e.detected ? 1 : 0)))
      : NaN;

    const rearEvents = watchEvents.filter((e) => e.behind);
    const frontEvents = watchEvents.filter((e) => !e.behind);
    const rearHitRate = isVr ? hitRateOf(rearEvents) : NaN;
    const frontHitRate = isVr ? hitRateOf(frontEvents) : NaN;
    const rearShare = watchEvents.length ? rearEvents.length / watchEvents.length : NaN;

    const midRadius = (this.field.rNear + this.field.rFar) / 2;
    const nearHit = isVr ? hitRateOf(watchEvents.filter((e) => e.radius < midRadius)) : NaN;
    const farHit = isVr ? hitRateOf(watchEvents.filter((e) => e.radius >= midRadius)) : NaN;
    const depthCost = isVr && Number.isFinite(nearHit) && Number.isFinite(farHit) ? nearHit - farHit : NaN;

    const audioEvents = watchEvents.filter((e) => e.type === 'audio');
    const audioHitRate = audioEvents.length ? hitRateOf(audioEvents) : NaN;

    const allYaw = this.yawSamples.flat();
    const scanRange = (() => {
      if (!isVr || allYaw.length < 10) return NaN;
      const bins = new Array(24).fill(0);
      for (const y of allYaw) bins[clamp(Math.floor(((y + 180) / 360) * 24), 0, 23)]++;
      return (bins.filter((c) => c > 0).length / 24) * 360;
    })();
    const scanEntropy = isVr && allYaw.length > 10
      ? normalisedEntropy(this.yawBins.reduce((acc, b) => acc.map((v, i) => v + b[i]!), new Array(24).fill(0)))
      : NaN;
    const firstCoverage = this.coverageOf(0);
    const lastCoverage = this.coverageOf(2);
    // The spatial form of vigilance decrement: how much of the sector that was
    // being supervised at the start is still being supervised at the end.
    const scanShrinkage = isVr && firstCoverage > 1 ? lastCoverage / firstCoverage : NaN;
    const scanRate = isVr ? (this.yawTravelDeg / Math.max(1, watchDurationMs / 60000)) : NaN;

    const typeRate = (t: EventType) => hitRateOf(watchEvents.filter((e) => e.type === t));

    const M: [string, number, string, string?][] = [
      ['hit_rate', hitRate, 'ratio'],
      ['calibration_hit_rate', calibHitRate, 'ratio', 'calibration'],
      ['fatigue_index', fatigueIndex, 'ratio'],
      ['false_alarms', fa, 'count'],
      ['false_alarm_rate', fa / Math.max(1, watchDurationMs / 60000), 'per_min'],
      ['d_prime', stats.dPrime, 'z'],
      ['criterion', stats.criterion, 'z'],
      ['d_prime_noise_trials', noiseTrials, 'count'],
      ['median_rt', medianRt, 'ms'],
      ['vigilance_decrement_hitrate', decHitRate, 'ratio/third'],
      ['vigilance_decrement_dprime', decDPrime, 'z/third'],
      ['vigilance_decrement_rt', decRt, 'ms/third'],
      ['eccentricity_cost', eccCost, 'ratio/deg'],
      ['rear_hit_rate', rearHitRate, 'ratio'],
      ['front_hit_rate', frontHitRate, 'ratio'],
      ['rear_event_share', rearShare, 'ratio'],
      ['depth_cost', depthCost, 'ratio'],
      ['audio_hit_rate', audioHitRate, 'ratio'],
      ['head_scan_range', scanRange, 'deg'],
      ['head_scan_entropy', scanEntropy, 'ratio'],
      ['scan_shrinkage', scanShrinkage, 'ratio'],
      ['scan_rate', scanRate, 'deg/min'],
      ['hit_rate_skip', typeRate('skip'), 'ratio'],
      ['hit_rate_double', typeRate('double'), 'ratio'],
      ['hit_rate_hue', typeRate('hue'), 'ratio'],
      ['hit_rate_drift', typeRate('drift'), 'ratio'],
    ];
    for (const [name, value, unit, scope] of M) rec.metric(name, value, unit, scope);

    /* -------------------------------------------------------- scores */

    const attention = normaliseSoft(stats.dPrime, 3.5, 0.7);
    const stability = normaliseSoft(Number.isFinite(decHitRate) ? decHitRate : -0.3, 0, -0.3);
    const coverage = isVr ? normaliseSoft(scanEntropy, 0.85, 0.30) : 0;
    const persistence = isVr ? normaliseSoft(Number.isFinite(scanShrinkage) ? Math.min(1.2, scanShrinkage) : 0.45, 1.0, 0.45) : 0;
    const discipline = normaliseSoft(fa, 0, 12);
    const speed = normaliseSoft(medianRt, 600, 1900);

    // On a flat screen the two spatial components cannot be measured at all,
    // so they are given zero weight rather than a made-up value - and the
    // result screen says so, to keep a 0.72 here from looking like a 0.72 in VR.
    const ops = opsScore([
      { key: 'sustained_attention', value: attention, weight: 0.28 },
      { key: 'vigilance_stability', value: stability, weight: 0.22 },
      { key: 'spatial_coverage', value: coverage, weight: isVr ? 0.16 : 0 },
      { key: 'coverage_persistence', value: persistence, weight: isVr ? 0.14 : 0 },
      { key: 'response_discipline', value: discipline, weight: 0.12 },
      { key: 'detection_speed', value: speed, weight: 0.08 },
    ]);

    rec.score('sustained_attention', attention, '1.0.0');
    rec.score('vigilance_stability', stability, '1.0.0');
    if (isVr) {
      rec.score('spatial_coverage', coverage, '1.0.0');
      rec.score('coverage_persistence', persistence, '1.0.0');
    }
    rec.score('response_discipline', discipline, '1.0.0');
    rec.score('detection_speed', speed, '1.0.0');

    const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
    const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
    const pts = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))} pont / harmad` : '—');

    const headline = [
      { label: 'Észlelési érzékenység (d′)', value: num(stats.dPrime), hint: `találat ${pct(hitRate)}` },
      { label: 'Éberség-lejtés', value: pts(decHitRate), hint: Number.isFinite(decRt) ? `RT ${decRt >= 0 ? '+' : ''}${Math.round(decRt)} ms/harmad` : undefined },
      { label: 'Téves riasztás', value: `${fa}`, hint: `kalibráció ${pct(calibHitRate)}` },
      { label: 'Detekciós idő', value: Number.isFinite(medianRt) ? `${Math.round(medianRt)} ms` : '—' },
    ];
    if (isVr) {
      headline.splice(2, 0,
        { label: 'Térbeli lefedettség', value: Number.isFinite(scanRange) ? `${Math.round(scanRange)}°` : '—', hint: `entrópia ${num(scanEntropy)}` },
        {
          label: 'Lefedettség megtartása',
          value: num(scanShrinkage),
          hint: Number.isFinite(scanShrinkage) && scanShrinkage < 0.75 ? 'szűkülő felügyelet' : 'stabil',
        });
      headline.push({ label: 'Hátsó szektor', value: pct(rearHitRate), hint: `elöl ${pct(frontHitRate)}` });
    } else {
      headline.push({ label: 'Térbeli mutatók', value: 'VR szükséges', hint: 'lefedettség, hátsó detekció, mélység' });
    }

    return {
      opsScore: ops,
      headline: headline.slice(0, 6),
      summary: {
        detection: {
          hitRate: r(hitRate, 3), dPrime: r(stats.dPrime, 3), criterion: r(stats.criterion, 3),
          falseAlarms: fa, noiseTrials, corrected: stats.corrected, medianRtMs: r(medianRt),
        },
        decrement: {
          hitRatePerThird: thirdStats.map((s) => r(s.hitRate, 3)),
          dPrimePerThird: thirdStats.map((s) => r(s.dPrime, 3)),
          rtPerThird: thirdStats.map((s) => r(s.medianRt)),
          slopeHitRate: r(decHitRate, 4), slopeDPrime: r(decDPrime, 4), slopeRt: r(decRt, 1),
          calibrationHitRate: r(calibHitRate, 3), fatigueIndex: r(fatigueIndex, 3),
        },
        spatial: isVr ? {
          scanRangeDeg: r(scanRange, 1), scanEntropy: r(scanEntropy, 3),
          coverageFirstThirdDeg: r(firstCoverage, 1), coverageLastThirdDeg: r(lastCoverage, 1),
          scanShrinkage: r(scanShrinkage, 3), scanRateDegPerMin: r(scanRate, 1),
          rearHitRate: r(rearHitRate, 3), frontHitRate: r(frontHitRate, 3), rearEventShare: r(rearShare, 3),
          depthCost: r(depthCost, 3), nearHitRate: r(nearHit, 3), farHitRate: r(farHit, 3),
          audioHitRate: r(audioHitRate, 3),
        } : { available: false, reason: 'flat_platform' },
        byType: {
          skip: r(typeRate('skip'), 3), double: r(typeRate('double'), 3),
          hue: r(typeRate('hue'), 3), drift: r(typeRate('drift'), 3),
          audio: r(audioHitRate, 3),
        },
        platform: ctx.platform,
        eventsScored: watchEvents.length,
        spatialWeightsApplied: isVr,
      },
      axisScores: {
        attention: (attention + stability) / 2,
        workload: stability,
        cognitive_control: discipline,
      },
    };
  }

  abort(): void {
    this.aborted = true;
    this.running = false;
    const r0 = this.blockResolve;
    this.blockResolve = null;
    r0?.();
  }

  dispose(ctx: ModuleContext): void {
    this.offInput?.();
    this.running = false;
    ctx.panels.remove(this.hudPanel);
    this.hudPanel.dispose();
    disposeTree(this.root);
  }
}

const TYPE_LABEL: Record<EventType, string> = {
  skip: 'kihagyás', double: 'dupla', hue: 'színváltás', drift: 'elmozdulás', audio: 'hang',
};

function r(v: number, digits = 1): number | null {
  return Number.isFinite(v) ? +v.toFixed(digits) : null;
}
