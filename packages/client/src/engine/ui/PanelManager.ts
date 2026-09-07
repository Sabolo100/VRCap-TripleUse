import * as THREE from 'three';
import type { Engine } from '../core/Engine.js';
import { isEffectivelyVisible } from './Panel.js';
import type { Panel, WidgetRect } from './Panel.js';
import type { ActionEvent, PointerSource } from '../core/types.js';

export interface PanelClickEvent {
  panel: Panel;
  widget: WidgetRect;
  source: PointerSource;
  /** performance.now() of the underlying input event. */
  t: number;
  /** Where on the panel canvas the click landed, in the panel's own pixels.
   *  Continuous controls - a map to click into, a slider to drag - need the
   *  position, not just which widget was hit. */
  px: number;
  py: number;
}

/**
 * Raycasts the active pointer(s) against every registered panel, drives hover
 * state, dispatches clicks, and re-renders only the panels that changed.
 *
 * Hover is deliberately single-pointer: with two Quest controllers, the one
 * that last produced a hit owns the hover, otherwise buttons flicker between
 * hands and users start "fighting" the UI.
 */
export class PanelManager {
  private engine: Engine;
  private panels = new Set<Panel>();
  private raycaster = new THREE.Raycaster();
  private listeners = new Set<(e: PanelClickEvent) => void>();
  private offInput: () => void;
  private offFrame: () => void;
  private hoverOwner: PointerSource | null = null;
  private pressed: { panel: Panel; widget: WidgetRect } | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
    this.offInput = engine.input.on(this.onAction);
    this.offFrame = engine.onFrame(() => this.update());
  }

  add(panel: Panel): void {
    this.panels.add(panel);
    panel.invalidate();
  }

  remove(panel: Panel): void {
    this.panels.delete(panel);
    if (panel.hoveredId) { panel.hoveredId = null; panel.invalidate(); }
  }

  clear(): void {
    this.panels.clear();
  }

  onClick(cb: (e: PanelClickEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Panels currently registered - used by scenes that need to redraw all. */
  invalidateAll(): void {
    for (const p of this.panels) p.invalidate();
  }

  private meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const p of this.panels) if (p.group.parent && isEffectivelyVisible(p.mesh)) out.push(p.mesh);
    return out;
  }

  private hitTest(source: PointerSource): {
    panel: Panel; widget: WidgetRect | null; point: THREE.Vector3; normal: THREE.Vector3; px: number; py: number;
  } | null {
    this.raycaster.set(source.ray.origin, source.ray.direction);
    this.raycaster.far = 20;
    const hits = this.raycaster.intersectObjects(this.meshes(), false);
    const hit = hits[0];
    if (!hit || !hit.uv) return null;
    const panel = hit.object.userData.panel as Panel | undefined;
    if (!panel) return null;
    const { x, y } = panel.uvToPx(hit.uv.x, hit.uv.y);
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 0, 1);
    return { panel, widget: panel.widgetAt(x, y), point: hit.point, normal, px: x, py: y };
  }

  private update(): void {
    const sources = this.engine.input.activePointers();
    // Prefer whichever source is actually pointing at a panel; keep the current
    // owner when it still has a hit so hover does not thrash between hands.
    let chosen: { src: PointerSource; hit: ReturnType<PanelManager['hitTest']> } | null = null;

    const ordered = this.hoverOwner
      ? [this.hoverOwner, ...sources.filter((s) => s !== this.hoverOwner)]
      : sources;

    for (const src of ordered) {
      if (!src.active) continue;
      const hit = this.hitTest(src);
      if (hit) { chosen = { src, hit }; break; }
      if (!chosen) chosen = { src, hit: null };
    }

    // Clear hover everywhere, then set it on the winner.
    for (const p of this.panels) {
      const want = chosen?.hit?.panel === p ? chosen.hit.widget?.id ?? null : null;
      if (p.hoveredId !== want) { p.hoveredId = want; p.invalidate(); }
    }

    this.hoverOwner = chosen?.hit ? chosen.src : null;

    // 3D cursor placement for VR controllers. A panel wins when the ray
    // reaches it first; otherwise the module's registered scene objects get
    // the same treatment, so the ray terminates on the thing being aimed at
    // instead of passing through it.
    for (const src of sources) {
      if (src.id !== 'left' && src.id !== 'right') continue;
      const panelHit = chosen && chosen.src === src ? chosen.hit : null;
      const sceneHit = this.engine.input.pickPointerTarget(src);
      // The panel hit carries a point but not a distance, so compare in world
      // space against the ray origin.
      const panelDist = panelHit ? panelHit.point.distanceTo(src.ray.origin) : Infinity;
      const useScene = sceneHit && sceneHit.distance < panelDist;
      if (useScene && sceneHit) {
        this.engine.input.setCursor(src, sceneHit.point, sceneHit.face?.normal ?? undefined);
      } else if (panelHit) {
        this.engine.input.setCursor(src, panelHit.point, panelHit.normal);
      } else {
        this.engine.input.setCursor(src, null);
      }
    }

    for (const p of this.panels) if (p.isDirty) p.redraw();
  }

  private onAction = (e: ActionEvent) => {
    if (e.action !== 'PRIMARY') return;
    const sources = this.engine.input.activePointers();
    const src =
      sources.find((s) => (e.source === 'left' || e.source === 'right' ? s.id === e.source : s.id === 'mouse' || s.id === 'touch')) ??
      this.hoverOwner ??
      sources[0];
    if (!src) return;

    if (e.down) {
      const hit = this.hitTest(src);
      if (hit?.widget && !hit.widget.disabled) {
        this.pressed = { panel: hit.panel, widget: hit.widget };
        hit.panel.pressedId = hit.widget.id;
        hit.panel.invalidate();
      }
      return;
    }

    // Release: only fire when the release lands on the same widget as the press.
    const press = this.pressed;
    this.pressed = null;
    if (press) { press.panel.pressedId = null; press.panel.invalidate(); }
    if (!press) return;
    const hit = this.hitTest(src);
    if (!hit?.widget || hit.widget.id !== press.widget.id || hit.panel !== press.panel) return;
    if (hit.widget.disabled) return;

    this.engine.input.pulse(src.hand === 'left' ? 'left' : src.hand === 'right' ? 'right' : 'both', 0.25, 18);
    const evt: PanelClickEvent = {
      panel: hit.panel, widget: hit.widget, source: src, t: e.t,
      px: hit.px, py: hit.py,
    };
    for (const cb of [...this.listeners]) {
      try { cb(evt); } catch (err) { console.error('[panels] click handler failed', err); }
    }
  };

  dispose(): void {
    this.offInput();
    this.offFrame();
    this.listeners.clear();
    this.panels.clear();
  }
}
