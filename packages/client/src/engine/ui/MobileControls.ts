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

    this.bar = document.createElement('div');
    this.bar.className = 'mc-bar';

    this.root.append(this.reticleEl, this.hintEl, this.sliderWrap, this.bar);
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
    this.render();
    this.input.setTouchLook('off');
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
    const visible = [this.sliderWrap, this.bar]
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
    this.onInsetChange(0);
    this.input.setTouchLook('off');
    this.input.setTouchZonesEnabled(true);
    this.root.remove();
  }
}
