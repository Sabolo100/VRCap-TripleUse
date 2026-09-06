import type { ActionId } from '../core/types.js';
import type { InputManager } from '../input/InputManager.js';

/**
 * TOUCH CONTROLS FOR MODULES.
 *
 * The modules were written for a headset: aim a controller ray, pull a
 * trigger, turn your head to look behind you. Two of those have no touch
 * equivalent at all, so on a phone the affected blocks were either invisible
 * (a "no target" control drawn as a 3D panel that the stimuli now sit in front
 * of) or simply impossible (a 360-degree vigilance task with no way to turn).
 *
 * This is the missing half: a DOM layer over the canvas that gives every
 * module the same vocabulary of touch controls. A module declares what it
 * needs and the layer renders it - so a control built for SIGNAL's "no target"
 * is the same control REACT uses for a two-hand response, and any module added
 * later gets them for free.
 *
 * Buttons dispatch real ActionEvents through the InputManager, which means
 * module code that already listens for PRIMARY / SECONDARY / LEFT / RIGHT
 * keeps working untouched - the phone simply becomes another way to produce
 * the same event.
 */

export interface MobileButtonSpec {
  id: string;
  label: string;
  /** Small line under the label. */
  sub?: string;
  /** Emitted through the InputManager when tapped. */
  action?: ActionId;
  /** Called instead of / in addition to the action. */
  onTap?: (t: number) => void;
  variant?: 'primary' | 'ghost' | 'accent2';
  disabled?: boolean;
  /** Takes the full width of the bar. */
  wide?: boolean;
}

export interface MobileStickSpec {
  /** Which bottom corner. Defaults to the left, for a right-handed tapper. */
  side?: 'left' | 'right';
  /** Small caption under the pad. */
  label?: string;
  /** Optional push notification; polling `stickVector()` is the normal use. */
  onChange?: (x: number, y: number) => void;
}

export interface MobileControlSpec {
  /** Buttons along the bottom, in thumb reach. */
  buttons?: MobileButtonSpec[];
  /** One line of guidance above the buttons. */
  hint?: string;
  /**
   * Drag anywhere on the scene to turn.
   *
   * `yaw` is horizontal only, which is what a surround task needs and what
   * avoids the disorientation of free-look on a screen you are holding.
   */
  look?: 'off' | 'yaw' | 'free';
  /** Crosshair at screen centre - for "turn to face it" answers. */
  reticle?: boolean;
  /**
   * A ring of direction choices.
   *
   * "Which way was it?" has no answer a row of buttons expresses well: the
   * choices are directions, and laying them out as directions is both faster
   * to hit and impossible to misread. Used by FIELD for the eight-way
   * peripheral answer and the four-way gap answer, and available to anything
   * else that asks the same question.
   */
  dial?: {
    /** Number of evenly spaced directions, starting at the top, clockwise. */
    segments: number;
    /** Optional labels, one per segment. */
    labels?: string[];
    onPick: (index: number, t: number) => void;
  };
  /**
   * An analogue thumb stick.
   *
   * Some tasks need a continuous, proportional input that a row of buttons
   * cannot express: MULTI's compensatory tracking is nulling a drifting error
   * signal, and quantising that into button presses would measure the button
   * layout rather than the tracking. The stick sits in one bottom corner so
   * the other thumb stays free for tapping - which is what keeps a dual-task
   * block genuinely dual on a phone.
   *
   * Read it with `stickVector()` each frame rather than reacting to events:
   * it is a state, not an event.
   */
  stick?: MobileStickSpec;
  /** A labelled slider, e.g. a distance estimate. */
  slider?: {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    unit?: string;
    onInput: (v: number) => void;
  };
}

export class MobileControls {
  private root: HTMLElement;
  private bar: HTMLElement;
  private hintEl: HTMLElement;
  private reticleEl: HTMLElement;
  private sliderWrap: HTMLElement;
  private dialEl: HTMLElement;
  private stickEl: HTMLElement;
  private stickKnob: HTMLElement;
  private stickPointer: number | null = null;
  private stickCentre = { x: 0, y: 0 };
  private stickRadius = 1;
  private stickVec = { x: 0, y: 0 };
  private spec: MobileControlSpec = {};
  private disposed = false;

  constructor(
    private input: InputManager,
    private now: () => number,
    /** Told how much of the bottom of the screen the controls cover. */
    private onInsetChange: (px: number) => void = () => {}
  ) {
    this.root = document.createElement('div');
    this.root.className = 'mc-root';
    // Only the controls themselves take input; the rest of the layer must let
    // taps through to the scene, or selecting a stimulus stops working.
    this.root.style.pointerEvents = 'none';

    this.reticleEl = document.createElement('div');
    this.reticleEl.className = 'mc-reticle';
    this.reticleEl.hidden = true;

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'mc-hint';
    this.hintEl.hidden = true;

    this.sliderWrap = document.createElement('div');
    this.sliderWrap.className = 'mc-slider';
    this.sliderWrap.hidden = true;

    this.dialEl = document.createElement('div');
    this.dialEl.className = 'mc-dial';
    this.dialEl.hidden = true;

    this.stickEl = document.createElement('div');
    this.stickEl.className = 'mc-stick';
    this.stickEl.hidden = true;
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'mc-stick-knob';
    this.stickEl.appendChild(this.stickKnob);
    this.bindStick();

    this.bar = document.createElement('div');
    this.bar.className = 'mc-bar';

    this.root.append(this.reticleEl, this.hintEl, this.dialEl, this.stickEl, this.sliderWrap, this.bar);
    document.body.appendChild(this.root);
  }

  /** Replace the whole control set. Modules call this at block start. */
  set(spec: MobileControlSpec): void {
    if (this.disposed) return;
    this.spec = spec;
    this.render();
    this.input.setTouchLook(spec.look && spec.look !== 'off' ? spec.look : 'off');
    // Screen-thirds LEFT/RIGHT is invisible and undiscoverable; once a module
    // shows real buttons it must not also fire from a stray tap.
    this.input.setTouchZonesEnabled(false);
  }

  clear(): void {
    this.spec = {};
    this.releaseStick();
    this.render();
    this.input.setTouchLook('off');
  }

  /**
   * Current stick deflection, x right and y up, each in [-1, 1] and the pair
   * clamped to the unit disc. Zero when nothing is touching it.
   */
  stickVector(): { x: number; y: number } {
    return { x: this.stickVec.x, y: this.stickVec.y };
  }

  /** Whether a finger is on the stick right now. */
  get stickHeld(): boolean {
    return this.stickPointer !== null;
  }

  private bindStick(): void {
    const el = this.stickEl;
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const r = el.getBoundingClientRect();
      this.stickCentre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      // The knob travels within the pad, so the usable radius is the pad's
      // radius less half the knob - otherwise full deflection is unreachable
      // without the finger leaving the pad.
      this.stickRadius = Math.max(1, r.width / 2 - 6);
      this.stickPointer = ev.pointerId;
      el.setPointerCapture(ev.pointerId);
      this.moveStick(ev.clientX, ev.clientY);
    });
    el.addEventListener('pointermove', (ev) => {
      if (this.stickPointer !== ev.pointerId) return;
      ev.preventDefault();
      this.moveStick(ev.clientX, ev.clientY);
    });
    const end = (ev: PointerEvent) => {
      if (this.stickPointer !== ev.pointerId) return;
      this.releaseStick();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private moveStick(cx: number, cy: number): void {
    let dx = (cx - this.stickCentre.x) / this.stickRadius;
    // Screen y grows downward; a stick pushed up must read positive.
    let dy = -(cy - this.stickCentre.y) / this.stickRadius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.stickVec = { x: dx, y: dy };
    this.stickKnob.style.transform =
      `translate(calc(-50% + ${dx * this.stickRadius}px), calc(-50% + ${-dy * this.stickRadius}px))`;
    this.spec.stick?.onChange?.(dx, dy);
  }

  private releaseStick(): void {
    this.stickPointer = null;
    this.stickVec = { x: 0, y: 0 };
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
    this.spec.stick?.onChange?.(0, 0);
  }

  /** Update one button's disabled state without rebuilding the bar. */
  setDisabled(id: string, disabled: boolean): void {
    const b = this.bar.querySelector<HTMLButtonElement>(`[data-mc="${id}"]`);
    if (b) b.disabled = disabled;
  }

  setHint(text: string | undefined): void {
    this.spec = { ...this.spec, hint: text };
    this.hintEl.textContent = text ?? '';
    this.hintEl.hidden = !text;
  }

  private render(): void {
    const s = this.spec;

    this.reticleEl.hidden = !s.reticle;
    this.hintEl.textContent = s.hint ?? '';
    this.hintEl.hidden = !s.hint;

    this.sliderWrap.replaceChildren();
    this.sliderWrap.hidden = !s.slider;
    if (s.slider) {
      const sl = s.slider;
      const label = document.createElement('div');
      label.className = 'mc-slider-label';
      const value = document.createElement('strong');
      const paint = (v: number) => { value.textContent = `${v}${sl.unit ? ' ' + sl.unit : ''}`; };
      label.append(document.createTextNode(sl.label + ' '), value);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(sl.min);
      input.max = String(sl.max);
      input.step = String(sl.step);
      input.value = String(sl.value);
      paint(sl.value);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        paint(v);
        sl.onInput(v);
      });
      this.sliderWrap.style.pointerEvents = 'auto';
      this.sliderWrap.append(label, input);
    }

    this.stickEl.hidden = !s.stick;
    this.stickEl.style.pointerEvents = s.stick ? 'auto' : 'none';
    this.stickEl.classList.toggle('is-right', s.stick?.side === 'right');
    this.stickEl.dataset.label = s.stick?.label ?? '';
    if (!s.stick) this.releaseStick();

    this.dialEl.replaceChildren();
    this.dialEl.hidden = !s.dial;
    this.dialEl.style.pointerEvents = s.dial ? 'auto' : 'none';
    if (s.dial) {
      const d = s.dial;
      for (let i = 0; i < d.segments; i++) {
        const a = (i / d.segments) * Math.PI * 2 - Math.PI / 2;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mc-dial-btn';
        // Placed on a circle so the control looks like the question it asks.
        btn.style.left = `${50 + Math.cos(a) * 38}%`;
        btn.style.top = `${50 + Math.sin(a) * 38}%`;
        btn.textContent = d.labels?.[i] ?? '';
        btn.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          d.onPick(i, ev.timeStamp || this.now());
        });
        this.dialEl.appendChild(btn);
      }
    }

    this.bar.replaceChildren();
    const buttons = s.buttons ?? [];
    this.bar.hidden = buttons.length === 0;
    this.bar.style.pointerEvents = buttons.length ? 'auto' : 'none';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset.mc = b.id;
      el.className = `mc-btn${b.variant ? ' is-' + b.variant : ''}${b.wide ? ' is-wide' : ''}`;
      el.disabled = !!b.disabled;
      const lab = document.createElement('span');
      lab.className = 'mc-btn-label';
      lab.textContent = b.label;
      el.appendChild(lab);
      if (b.sub) {
        const sub = document.createElement('span');
        sub.className = 'mc-btn-sub';
        sub.textContent = b.sub;
        el.appendChild(sub);
      }
      // pointerdown, not click: a reaction-time task must not pay for the
      // browser's click synthesis, and every module here is timing something.
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const t = ev.timeStamp || this.now();
        if (b.action) this.input.emitSynthetic(b.action, t);
        b.onTap?.(t);
      });
      this.bar.appendChild(el);
    }

    this.reportInset();
  }

  /**
   * Tell the engine how much of the bottom the controls cover.
   *
   * Measured synchronously: reading a rect forces layout, so the numbers are
   * already correct here, and depending on requestAnimationFrame would make
   * the whole thing conditional on a frame loop that is not guaranteed to be
   * running when a block sets up its controls.
   */
  private reportInset(): void {
    if (this.disposed) return;
    // Only the strip that actually swallows touches. The hint does not take
    // input, so a stimulus behind it is still selectable, and reserving space
    // for it as well pushed the top of a search array off the screen.
    const visible = [this.sliderWrap, this.bar, this.stickEl]
      .filter((el) => !el.hidden && el.getClientRects().length > 0);
    if (visible.length === 0) {
      this.onInsetChange(0);
      return;
    }
    const top = Math.min(...visible.map((el) => el.getBoundingClientRect().top));
    const used = window.innerHeight - top;
    this.onInsetChange(Number.isFinite(used) && used > 0 ? used + 8 : 0);
  }

  dispose(): void {
    this.disposed = true;
    this.releaseStick();
    this.onInsetChange(0);
    this.input.setTouchLook('off');
    this.input.setTouchZonesEnabled(true);
    this.root.remove();
  }
}
