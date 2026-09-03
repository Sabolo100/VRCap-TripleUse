import { Panel } from './Panel.js';
import type { UITheme } from './UITheme.js';
import type { PanelManager, PanelClickEvent } from './PanelManager.js';

/**
 * In-headset virtual keyboard.
 *
 * DOM inputs are invisible inside an immersive session, so any text the user
 * has to enter while in VR - subject id, room code, a message in COMMAND -
 * goes through this. It is an ordinary Panel, so it hit-tests through exactly
 * the same ray path as every other button.
 */

const ROWS_LOWER = ['1234567890', 'qwertzuiop', 'asdfghjkl', 'yxcvbnm'];
const ROWS_UPPER = ['!"+%/=()-', 'QWERTZUIOP', 'ASDFGHJKL', 'YXCVBNM'];

export interface Keyboard3DOptions {
  theme: UITheme;
  title?: string;
  maxLength?: number;
  /** Uppercase everything - subject ids are uppercase by convention. */
  forceUpper?: boolean;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  onChange?: (value: string) => void;
}

export class Keyboard3D {
  readonly panel: Panel;
  value = '';
  private shift = false;
  private opts: Keyboard3DOptions;
  private manager: PanelManager;
  private off: () => void;

  constructor(manager: PanelManager, opts: Keyboard3DOptions) {
    this.opts = opts;
    this.manager = manager;
    this.panel = new Panel({
      width: 0.86,
      height: 0.46,
      pxPerMeter: 1100,
      theme: opts.theme,
      name: 'keyboard',
    });
    this.panel.setDraw((ui) => {
      const t = ui.t;
      ui.background(t.surface, 20);
      ui.roundRect(0, 0, ui.w, ui.h, 20, undefined, t.accent, 2);

      const pad = 22;
      ui.label(opts.title ?? 'BEVITEL', pad, 32);

      // Field
      const fieldH = 62;
      ui.roundRect(pad, 50, ui.w - pad * 2, fieldH, 10, 'rgba(0,0,0,0.35)', t.accent, 2);
      const shown = this.value || '';
      ui.text(shown + (Math.floor(performance.now() / 500) % 2 ? '|' : ''), pad + 18, 50 + fieldH / 2, {
        size: 34,
        font: t.fontMono,
        color: t.text,
      });

      const rows = this.shift ? ROWS_UPPER : ROWS_LOWER;
      const keyH = 54;
      const gap = 7;
      let y = 50 + fieldH + 16;

      rows.forEach((row, ri) => {
        const chars = row.split('');
        const totalW = ui.w - pad * 2;
        const keyW = (totalW - gap * (chars.length - 1)) / chars.length;
        let x = pad;
        // Centre the shorter rows.
        if (ri > 0) x = pad + (totalW - (keyW * chars.length + gap * (chars.length - 1))) / 2;
        chars.forEach((ch) => {
          ui.button(`k:${ch}`, x, y, keyW, keyH, {
            label: opts.forceUpper ? ch.toUpperCase() : ch,
            variant: 'ghost',
            fontSize: 26,
            data: { key: ch },
          });
          x += keyW + gap;
        });
        y += keyH + gap;
      });

      // Bottom row
      const bw = (ui.w - pad * 2 - gap * 4) / 5;
      ui.button('k:shift', pad, y, bw, keyH, { label: this.shift ? 'abc' : 'ABC', variant: 'ghost', fontSize: 20 });
      ui.button('k:-', pad + (bw + gap), y, bw, keyH, { label: '-', variant: 'ghost', fontSize: 26 });
      ui.button('k:space', pad + (bw + gap) * 2, y, bw, keyH, { label: 'SPACE', variant: 'ghost', fontSize: 18 });
      ui.button('k:back', pad + (bw + gap) * 3, y, bw, keyH, { label: '⌫', variant: 'ghost', fontSize: 26 });
      ui.button('k:enter', pad + (bw + gap) * 4, y, bw, keyH, {
        label: 'OK',
        variant: 'primary',
        fontSize: 22,
        disabled: this.value.length === 0,
      });
    });

    manager.add(this.panel);
    this.off = manager.onClick(this.onClick);
  }

  private onClick = (e: PanelClickEvent) => {
    if (e.panel !== this.panel) return;
    const id = e.widget.id;
    if (!id.startsWith('k:')) return;
    const key = id.slice(2);
    const max = this.opts.maxLength ?? 24;

    if (key === 'shift') this.shift = !this.shift;
    else if (key === 'back') this.value = this.value.slice(0, -1);
    else if (key === 'space') { if (this.value.length < max) this.value += ' '; }
    else if (key === 'enter') { this.opts.onSubmit(this.value.trim()); return; }
    else if (this.value.length < max) {
      this.value += this.opts.forceUpper ? key.toUpperCase() : key;
    }
    this.opts.onChange?.(this.value);
    this.panel.invalidate();
  };

  setValue(v: string): void {
    this.value = v;
    this.panel.invalidate();
  }

  /** Blinking caret needs a repaint about twice a second. */
  tick(): void {
    this.panel.invalidate();
  }

  dispose(): void {
    this.off();
    this.manager.remove(this.panel);
    this.panel.dispose();
  }
}
