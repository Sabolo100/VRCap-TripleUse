import * as THREE from 'three';
import type { UITheme } from './UITheme.js';
import { withAlpha } from './UITheme.js';

/**
 * 3D UI PANEL.
 *
 * A panel is a plane carrying a 2D canvas texture. All UI - hub, instructions,
 * results, the COMMAND briefing, the virtual keyboard - is drawn with the same
 * immediate-mode API into that canvas, and hit tested by raycasting the plane
 * and converting the UV back to canvas pixels.
 *
 * The payoff is that one implementation serves all three platforms: in VR the
 * ray comes from a controller, on desktop from the mouse, on mobile from a
 * touch. Nothing about the widget code knows the difference.
 */

export interface WidgetRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled?: boolean;
  /** Larger values win when rects overlap. */
  layer?: number;
  data?: unknown;
}

export type PanelDraw = (ui: UI, panel: Panel) => void;

export interface PanelOptions {
  /** Physical size in metres. */
  width: number;
  height: number;
  /**
   * LOGICAL canvas resolution: the coordinate space every draw callback is
   * written against.
   *
   * The angular size of a glyph is `fontPx / (pxPerMeter * distance)` - the
   * panel's physical width cancels out entirely. So to make text bigger in the
   * headset without rewriting every layout, LOWER this and raise `width` by
   * the same factor: the logical canvas stays identical, the panel just covers
   * more of the field of view.
   */
  pxPerMeter?: number;
  theme: UITheme;
  /** Rounded backing plate behind the canvas. */
  frame?: boolean;
  name?: string;
  /**
   * Supersampling factor for the backing canvas. The draw callback still works
   * in logical pixels; the canvas is this many times larger and the context is
   * scaled to match, so glyph edges land on real texels instead of being
   * reconstructed by the sampler. 2 is the useful default on Quest 3.
   */
  superSample?: number;
}

/**
 * Whether an object is really on screen, ancestors included.
 *
 * `Object3D.visible = false` on a parent hides the subtree when RENDERING, but
 * it leaves every child's own `visible` flag true - and a raycast against the
 * child still hits it. Panels are hidden by their group, so checking the mesh
 * alone let clicks land on buttons nobody could see: a stray press during
 * calibration was reaching the instruction panel underneath it and advancing
 * the run.
 */
export function isEffectivelyVisible(o: THREE.Object3D | null): boolean {
  // Nothing is not visible: the safe answer for a hit-test guard.
  if (!o) return false;
  let n: THREE.Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    n = n.parent;
  }
  return true;
}

export class Panel {
  readonly mesh: THREE.Mesh;
  readonly group = new THREE.Group();
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly width: number;
  readonly height: number;
  readonly pxW: number;
  readonly pxH: number;
  theme: UITheme;

  /** Hit rects registered during the last draw. */
  widgets: WidgetRect[] = [];
  hoveredId: string | null = null;
  pressedId: string | null = null;

  private drawFn: PanelDraw | null = null;
  private dirty = true;
  private disposed = false;

  /** Supersampling factor between logical pixels and real canvas pixels. */
  private readonly ss: number;

  constructor(opts: PanelOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.theme = opts.theme;
    const ppm = opts.pxPerMeter ?? 900;
    // Logical size: what draw callbacks and hit tests use.
    this.pxW = Math.round(opts.width * ppm);
    this.pxH = Math.round(opts.height * ppm);
    this.ss = Math.max(1, opts.superSample ?? 2);

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.pxW * this.ss);
    this.canvas.height = Math.round(this.pxH * this.ss);
    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 16;
    // No mipmaps. A panel is read head-on at a roughly fixed distance, where
    // the texture is deliberately oversampled - and that is exactly the case
    // where mipmapping picks a smaller level and softens the text it was meant
    // to protect. Linear filtering on the full-resolution canvas is sharper.
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts.width, opts.height), mat);
    this.mesh.name = opts.name ?? 'panel';
    this.mesh.userData.panel = this;
    this.group.add(this.mesh);

    if (opts.frame !== false) {
      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(opts.width * 1.012, opts.height * 1.018),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(this.theme.accent), transparent: true, opacity: 0.16 })
      );
      back.position.z = -0.004;
      this.group.add(back);
    }
  }

  setDraw(fn: PanelDraw): void {
    this.drawFn = fn;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** Re-run the draw callback into the canvas. Called by PanelManager. */
  redraw(): void {
    if (!this.drawFn || this.disposed) return;
    this.widgets = [];
    const ui = new UI(this);
    // Everything below draws in logical pixels; the transform maps them onto
    // the larger real canvas.
    this.ctx.setTransform(this.ss, 0, 0, this.ss, 0, 0);
    this.ctx.clearRect(0, 0, this.pxW, this.pxH);
    this.drawFn(ui, this);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  widgetAt(px: number, py: number): WidgetRect | null {
    let best: WidgetRect | null = null;
    for (const w of this.widgets) {
      if (px < w.x || px > w.x + w.w || py < w.y || py > w.y + w.h) continue;
      if (!best || (w.layer ?? 0) >= (best.layer ?? 0)) best = w;
    }
    return best;
  }

  /** UV (0..1, origin bottom-left) to canvas pixels (origin top-left). */
  uvToPx(u: number, v: number): { x: number; y: number } {
    return { x: u * this.pxW, y: (1 - v) * this.pxH };
  }

  dispose(): void {
    this.disposed = true;
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}

/* ------------------------------------------------------------------ *
 * Immediate mode drawing API
 * ------------------------------------------------------------------ */

export interface ButtonOptions {
  label: string;
  variant?: 'primary' | 'ghost' | 'danger' | 'quiet';
  disabled?: boolean;
  sub?: string;
  align?: CanvasTextAlign;
  fontSize?: number;
  badge?: string;
  data?: unknown;
  layer?: number;
  /** Draw the button as selected/active. */
  active?: boolean;
}

export class UI {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly t: UITheme;
  private panel: Panel;

  constructor(panel: Panel) {
    this.panel = panel;
    this.ctx = panel.ctx;
    this.w = panel.pxW;
    this.h = panel.pxH;
    this.t = panel.theme;
  }

  /* ---------------------------------------------------------- surfaces */

  background(color?: string, radius = 22): void {
    this.roundRect(0, 0, this.w, this.h, radius, color ?? this.t.surface);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string, lw = 2): void {
    const c = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  }

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
  }

  line(x1: number, y1: number, x2: number, y2: number, color?: string, lw = 2): void {
    const c = this.ctx;
    c.strokeStyle = color ?? this.t.line;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }

  divider(y: number, x = 32, w = this.w - 64, color?: string): void {
    this.line(x, y, x + w, y, color ?? withAlpha(this.t.textMuted, 0.25), 2);
  }

  circle(x: number, y: number, r: number, fill?: string, stroke?: string, lw = 2): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  }

  /* ------------------------------------------------------------- text */

  text(
    s: string,
    x: number,
    y: number,
    opts: {
      size?: number;
      color?: string;
      font?: string;
      align?: CanvasTextAlign;
      baseline?: CanvasTextBaseline;
      weight?: string;
      maxWidth?: number;
      letterSpacing?: string;
    } = {}
  ): void {
    const c = this.ctx;
    c.save();
    c.font = `${opts.weight ?? '500'} ${opts.size ?? 26}px ${opts.font ?? this.t.fontBody}`;
    c.fillStyle = opts.color ?? this.t.text;
    c.textAlign = opts.align ?? 'left';
    c.textBaseline = opts.baseline ?? 'middle';
    if (opts.letterSpacing && 'letterSpacing' in c) {
      (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = opts.letterSpacing;
    }
    c.fillText(s, x, y, opts.maxWidth);
    c.restore();
  }

  /** Word-wrapped paragraph. Returns the y coordinate after the last line. */
  paragraph(
    s: string,
    x: number,
    y: number,
    maxWidth: number,
    opts: { size?: number; color?: string; lineHeight?: number; font?: string; weight?: string; maxLines?: number } = {}
  ): number {
    const c = this.ctx;
    const size = opts.size ?? 22;
    const lh = opts.lineHeight ?? size * 1.45;
    c.save();
    c.font = `${opts.weight ?? '400'} ${size}px ${opts.font ?? this.t.fontBody}`;
    c.fillStyle = opts.color ?? this.t.textMuted;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    let line = '';
    let cy = y;
    let lines = 0;
    const flush = () => {
      c.fillText(line, x, cy);
      cy += lh;
      lines++;
      line = '';
    };
    for (const word of s.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word;
      if (c.measureText(probe).width > maxWidth && line) {
        flush();
        if (opts.maxLines && lines >= opts.maxLines) { c.restore(); return cy; }
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) flush();
    c.restore();
    return cy;
  }

  /**
   * How many lines `paragraph()` would need, without drawing anything.
   *
   * Same wrap rule as paragraph(), so a caller can pick a font size that
   * fits a fixed box before committing ink to the canvas.
   */
  measureParagraph(s: string, maxWidth: number, size: number, font?: string, weight = '400'): number {
    const c = this.ctx;
    c.save();
    c.font = `${weight} ${size}px ${font ?? this.t.fontBody}`;
    let line = '';
    let lines = 0;
    for (const word of s.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word;
      if (c.measureText(probe).width > maxWidth && line) {
        lines++;
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) lines++;
    c.restore();
    return lines;
  }

  title(s: string, x: number, y: number, size = 40, color?: string, align: CanvasTextAlign = 'left'): void {
    this.text(s, x, y, {
      size,
      color: color ?? this.t.text,
      font: this.t.fontDisplay,
      weight: '700',
      align,
      letterSpacing: '0.5px',
    });
  }

  label(s: string, x: number, y: number, color?: string, size = 17, align: CanvasTextAlign = 'left'): void {
    this.text(s.toUpperCase(), x, y, {
      size,
      color: color ?? this.t.textMuted,
      font: this.t.fontMono,
      weight: '600',
      align,
      letterSpacing: '1.6px',
    });
  }

  /* ---------------------------------------------------------- widgets */

  /** Registers a hit rect and returns whether it is currently hovered. */
  hit(id: string, x: number, y: number, w: number, h: number, opts: { disabled?: boolean; layer?: number; data?: unknown } = {}): boolean {
    this.panel.widgets.push({ id, x, y, w, h, disabled: opts.disabled, layer: opts.layer, data: opts.data });
    return this.panel.hoveredId === id && !opts.disabled;
  }

  button(id: string, x: number, y: number, w: number, h: number, o: ButtonOptions): boolean {
    const hovered = this.hit(id, x, y, w, h, { disabled: o.disabled, layer: o.layer, data: o.data });
    const pressed = this.panel.pressedId === id;
    const t = this.t;
    const variant = o.variant ?? 'primary';

    let fill = t.surfaceAlt;
    let border = withAlpha(t.textMuted, 0.28);
    let fg = t.text;

    if (variant === 'primary') {
      fill = o.disabled ? withAlpha(t.textMuted, 0.12) : hovered ? t.accent : withAlpha(t.accent, 0.9);
      border = t.accent;
      fg = o.disabled ? t.textMuted : '#0a0d12';
    } else if (variant === 'danger') {
      fill = hovered ? t.bad : withAlpha(t.bad, 0.22);
      border = t.bad;
      fg = hovered ? '#0a0d12' : t.bad;
    } else if (variant === 'ghost') {
      fill = hovered ? withAlpha(t.accent, 0.2) : 'rgba(255,255,255,0.04)';
      border = hovered ? t.accent : withAlpha(t.textMuted, 0.32);
      fg = o.disabled ? withAlpha(t.textMuted, 0.6) : t.text;
    } else {
      fill = hovered ? withAlpha(t.accent, 0.12) : 'rgba(0,0,0,0)';
      border = 'rgba(0,0,0,0)';
      fg = o.disabled ? withAlpha(t.textMuted, 0.5) : t.textMuted;
    }
    if (o.active) {
      fill = withAlpha(t.accent, 0.28);
      border = t.accent;
      fg = t.text;
    }

    const inset = pressed && !o.disabled ? 2 : 0;
    this.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, t.radius, fill, border, hovered ? 3 : 2);

    const cx = o.align === 'left' ? x + 26 : x + w / 2;
    const align = o.align ?? 'center';
    const fs = o.fontSize ?? Math.min(30, h * 0.36);
    if (o.sub) {
      this.text(o.label, cx, y + h / 2 - fs * 0.42, { size: fs, color: fg, align, weight: '600', font: this.t.fontDisplay });
      this.text(o.sub, cx, y + h / 2 + fs * 0.6, { size: fs * 0.62, color: withAlpha(fg, 0.72), align, weight: '400' });
    } else {
      this.text(o.label, cx, y + h / 2, { size: fs, color: fg, align, weight: '600', font: this.t.fontDisplay });
    }

    if (o.badge) {
      const bw = this.ctx.measureText(o.badge).width + 22;
      this.roundRect(x + w - bw - 14, y + 12, bw, 30, 15, withAlpha(t.accent2, 0.9));
      this.text(o.badge, x + w - bw / 2 - 14, y + 27, { size: 16, color: '#0a0d12', align: 'center', weight: '700' });
    }
    return hovered;
  }

  /** Horizontal progress / gauge bar. */
  bar(x: number, y: number, w: number, h: number, value01: number, color?: string, track?: string): void {
    this.roundRect(x, y, w, h, h / 2, track ?? withAlpha(this.t.textMuted, 0.18));
    const v = Math.max(0, Math.min(1, value01));
    if (v > 0) this.roundRect(x, y, Math.max(h, w * v), h, h / 2, color ?? this.t.accent);
  }

  /** Big numeric readout with a caption. */
  stat(x: number, y: number, w: number, value: string, caption: string, color?: string, size = 54): void {
    this.text(value, x + w / 2, y, { size, color: color ?? this.t.accent, align: 'center', weight: '700', font: this.t.fontDisplay });
    this.label(caption, x + w / 2, y + size * 0.72, this.t.textMuted, 15, 'center');
  }

  /** Radar / spider chart used by the capability profile. */
  radar(
    cx: number,
    cy: number,
    radius: number,
    axes: { label: string; value: number | null }[],
    color?: string
  ): void {
    const c = this.ctx;
    const n = axes.length;
    if (n < 3) return;
    const t = this.t;
    for (let ring = 1; ring <= 4; ring++) {
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = (radius * ring) / 4;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.strokeStyle = withAlpha(t.textMuted, ring === 4 ? 0.4 : 0.16);
      c.lineWidth = 1.5;
      c.stroke();
    }
    c.beginPath();
    let any = false;
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const a = (idx / n) * Math.PI * 2 - Math.PI / 2;
      const v = axes[idx]!.value;
      const r = ((v ?? 0) / 100) * radius;
      if (v !== null) any = true;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
    if (any) {
      c.fillStyle = withAlpha(color ?? t.accent, 0.26);
      c.fill();
      c.strokeStyle = color ?? t.accent;
      c.lineWidth = 3;
      c.stroke();
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const lx = cx + Math.cos(a) * (radius + 34);
      const ly = cy + Math.sin(a) * (radius + 28);
      const axis = axes[i]!;
      this.text(axis.label, lx, ly, {
        size: 16,
        color: axis.value === null ? withAlpha(t.textMuted, 0.5) : t.textMuted,
        align: Math.abs(Math.cos(a)) < 0.3 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right',
        weight: '600',
      });
    }
  }

  /** Sparkline for personal history. */
  spark(x: number, y: number, w: number, h: number, values: number[], color?: string): void {
    if (values.length < 2) return;
    const c = this.ctx;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    c.beginPath();
    values.forEach((v, i) => {
      const px = x + (i / (values.length - 1)) * w;
      const py = y + h - ((v - min) / span) * h;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    });
    c.strokeStyle = color ?? this.t.accent;
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.stroke();
    const lastV = values[values.length - 1]!;
    this.circle(x + w, y + h - ((lastV - min) / span) * h, 5, color ?? this.t.accent);
  }
}
