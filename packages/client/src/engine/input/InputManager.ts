import * as THREE from 'three';
import type { Engine } from '../core/Engine.js';
import type { ActionEvent, ActionId, PointerSource, PoseSample, SourceId } from '../core/types.js';

/**
 * INPUT ABSTRACTION.
 *
 * Modules never ask "was the right Quest trigger pressed". They ask whether
 * ACTION_PRIMARY happened, and get an ActionEvent carrying a timestamp, the
 * source, and - crucially - how much timing uncertainty that source has.
 *
 * Mapping (see docs/02-CROSSPLATFORM-INTERACTION.md for the full table):
 *
 *   ACTION        VR                     Desktop              Mobile
 *   PRIMARY       either trigger         left click / Space   tap
 *   SECONDARY     either grip            right click          two-finger tap
 *   LEFT          left trigger           F / ArrowLeft        tap in left third
 *   RIGHT         right trigger          J / ArrowRight       tap in right third
 *   CONFIRM       A / X button           Enter                tap on confirm widget
 *   CANCEL        B / Y button           Escape               tap on cancel widget
 *
 * Timing honesty: DOM events carry event.timeStamp, which shares an origin with
 * performance.now() and is captured before any of our code runs. XR buttons are
 * polled once per frame, so their timestamps carry a quantisation bound of one
 * frame interval, reported on every event as `quantisationMs`.
 */

type Listener = (e: ActionEvent) => void;

interface XRControllerState {
  index: number;
  hand: 'left' | 'right' | 'none';
  controller: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  ray: THREE.Line;
  cursor: THREE.Mesh;
  connected: boolean;
  buttons: boolean[];
  axes: number[];
  gamepad: Gamepad | null;
}

const RAY_LEN = 12;
/** Movement below this stays a tap; beyond it the gesture is a turn. */
const TAP_SLOP_PX = 12;
/** Screen widths per full turn, expressed as degrees across the canvas. */
const LOOK_RANGE_DEG = 190;
const MAX_PITCH_RAD = 0.62;

export class InputManager {
  private engine: Engine;
  private listeners = new Set<Listener>();

  /** All pointer sources that currently produce a ray, in priority order. */
  readonly pointers: PointerSource[] = [];

  private controllers: XRControllerState[] = [];
  private mousePointer: PointerSource;
  private ndc = new THREE.Vector2(0, 0);
  private hasPointer = false;
  private raycaster = new THREE.Raycaster();

  /** Screen-space zones used for LEFT/RIGHT on touch devices. */
  private touchZones = true;

  /**
   * Drag-to-turn on a touch screen.
   *
   * A headset turns by turning your head. On a phone there was no equivalent
   * at all, which made every surround task - WATCH's whole premise, SIGNAL's
   * 360 block, NAV's pointing - unplayable rather than merely awkward.
   *
   * The same gesture also has to keep working as a tap, so a press only counts
   * as a selection if the finger stayed within TAP_SLOP; past that it is a
   * turn and no PRIMARY is emitted.
   */
  private touchLook: 'off' | 'yaw' | 'free' = 'off';
  private lookState: {
    id: number; x: number; y: number; startX: number; startY: number;
    src: SourceId; dragging: boolean; t: number;
  } | null = null;

  /** Locomotion axes, -1..1, unified across thumbstick / WASD / virtual stick. */
  readonly move = new THREE.Vector2();
  readonly turn = { value: 0 };

  private keys = new Set<string>();
  private canvas: HTMLCanvasElement;
  private disposed = false;

  constructor(engine: Engine) {
    this.engine = engine;
    this.canvas = engine.renderer.domElement;

    this.mousePointer = {
      id: 'mouse',
      hand: 'none',
      active: false,
      pressed: false,
      ray: new THREE.Ray(),
      object3D: null,
    };
    this.pointers.push(this.mousePointer);

    this.setupXRControllers();
    this.setupDom();
  }

  /* ------------------------------------------------------------ events */

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(
    action: ActionId,
    source: SourceId,
    hand: 'left' | 'right' | 'none',
    down: boolean,
    t: number,
    quantisationMs: number | null,
    ray?: THREE.Ray
  ): void {
    const e: ActionEvent = { action, source, hand, down, t, quantisationMs, ray };
    for (const cb of [...this.listeners]) {
      try {
        cb(e);
      } catch (err) {
        console.error('[input] listener failed', err);
      }
    }
  }

  /* -------------------------------------------------------- XR setup */

  private setupXRControllers(): void {
    const xr = this.engine.renderer.xr;
    for (let i = 0; i < 2; i++) {
      const controller = xr.getController(i);
      const grip = xr.getControllerGrip(i);

      const rayGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -RAY_LEN),
      ]);
      const ray = new THREE.Line(
        rayGeom,
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, depthTest: false })
      );
      ray.renderOrder = 999;
      ray.name = 'pointer-ray';
      controller.add(ray);

      const cursor = new THREE.Mesh(
        new THREE.RingGeometry(0.012, 0.02, 24),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
      );
      cursor.renderOrder = 1000;
      cursor.visible = false;
      this.engine.rig.add(cursor);

      // A simple procedural controller stand-in: no downloaded models, in line
      // with the asset-light principle, and it makes the grip pose legible.
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.018, 0.07, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.6, metalness: 0.1 })
      );
      body.rotation.x = Math.PI / 2.4;
      grip.add(body);

      const state: XRControllerState = {
        index: i,
        hand: 'none',
        controller,
        grip,
        ray,
        cursor,
        connected: false,
        buttons: [],
        axes: [],
        gamepad: null,
      };

      controller.addEventListener('connected', (ev: { data: XRInputSource }) => {
        state.connected = true;
        state.hand = ev.data.handedness === 'left' ? 'left' : ev.data.handedness === 'right' ? 'right' : 'none';
        state.gamepad = ev.data.gamepad ?? null;
        const color = state.hand === 'left' ? 0x4fc3f7 : 0xff9e1b;
        (ray.material as THREE.LineBasicMaterial).color.setHex(color);
        (cursor.material as THREE.MeshBasicMaterial).color.setHex(color);
      });
      controller.addEventListener('disconnected', () => {
        state.connected = false;
        state.gamepad = null;
        cursor.visible = false;
      });

      this.engine.rig.add(controller);
      this.engine.rig.add(grip);
      this.controllers.push(state);

      this.pointers.push({
        id: i === 0 ? 'left' : 'right',
        hand: 'none',
        active: false,
        pressed: false,
        ray: new THREE.Ray(),
        object3D: controller,
      });
    }
  }

  /* ------------------------------------------------------- DOM setup */

  private setupDom(): void {
    const c = this.canvas;
    c.addEventListener('pointermove', this.onPointerMove, { passive: true });
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    c.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private ndcFromEvent(ev: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1
    );
    this.hasPointer = true;
  }

  private onPointerMove = (ev: PointerEvent) => {
    if (this.engine.inXR) return;
    this.ndcFromEvent(ev);

    const L = this.lookState;
    if (!L || ev.pointerId !== L.id) return;
    const dx = ev.clientX - L.x;
    const dy = ev.clientY - L.y;
    L.x = ev.clientX;
    L.y = ev.clientY;
    if (!L.dragging &&
        Math.hypot(ev.clientX - L.startX, ev.clientY - L.startY) > TAP_SLOP_PX) {
      L.dragging = true;
    }
    if (!L.dragging) return;

    // Turn the rig, not the camera: the camera's transform belongs to the XR
    // pose, and modules read head direction from it.
    const rect = this.canvas.getBoundingClientRect();
    const perPx = (LOOK_RANGE_DEG * Math.PI) / 180 / Math.max(1, rect.width);
    this.engine.rig.rotation.y += dx * perPx;
    if (this.touchLook === 'free') {
      const next = this.engine.camera.rotation.x + dy * perPx;
      // Clamped: a phone screen gives no vestibular reference, and letting the
      // horizon roll past vertical is disorienting rather than useful.
      this.engine.camera.rotation.x = Math.max(-MAX_PITCH_RAD, Math.min(MAX_PITCH_RAD, next));
    }
  };

  private onContextMenu = (ev: Event) => {
    ev.preventDefault();
  };

  private onPointerDown = (ev: PointerEvent) => {
    if (this.engine.inXR) return;
    this.ndcFromEvent(ev);
    this.updateMouseRay();
    this.mousePointer.pressed = true;
    const src: SourceId = ev.pointerType === 'touch' ? 'touch' : 'mouse';
    const t = ev.timeStamp;

    if (ev.button === 2) {
      this.emit('SECONDARY', src, 'none', true, t, null, this.mousePointer.ray);
      return;
    }

    // While turning is enabled the press is ambiguous: it becomes a tap on
    // release if the finger barely moved, and a turn otherwise. Emitting
    // PRIMARY here would fire a selection at the start of every swipe.
    if (this.touchLook !== 'off') {
      this.lookState = {
        id: ev.pointerId, x: ev.clientX, y: ev.clientY,
        startX: ev.clientX, startY: ev.clientY, src, dragging: false, t,
      };
      ev.preventDefault?.();
      return;
    }

    this.emit('PRIMARY', src, 'none', true, t, null, this.mousePointer.ray);

    // Touch devices additionally map screen thirds to LEFT / RIGHT so that
    // choice-reaction and bimanual blocks have a native two-handed gesture.
    if (src === 'touch' && this.touchZones) {
      const r = this.canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      if (x < 0.38) this.emit('LEFT', 'touch', 'left', true, t, null, this.mousePointer.ray);
      else if (x > 0.62) this.emit('RIGHT', 'touch', 'right', true, t, null, this.mousePointer.ray);
    }
    ev.preventDefault?.();
  };

  private onPointerUp = (ev: PointerEvent) => {
    if (this.engine.inXR) return;
    this.mousePointer.pressed = false;
    const src: SourceId = ev.pointerType === 'touch' ? 'touch' : 'mouse';

    const L = this.lookState;
    if (L && ev.pointerId === L.id) {
      this.lookState = null;
      if (!L.dragging) {
        // It was a tap after all. The ray is rebuilt from the release point so
        // selection lands where the finger actually was.
        this.ndcFromEvent(ev);
        this.updateMouseRay();
        this.emit('PRIMARY', src, 'none', true, ev.timeStamp, null, this.mousePointer.ray);
        this.emit('PRIMARY', src, 'none', false, ev.timeStamp, null, this.mousePointer.ray);
      }
      return;
    }

    this.emit(ev.button === 2 ? 'SECONDARY' : 'PRIMARY', src, 'none', false, ev.timeStamp, null, this.mousePointer.ray);
  };

  private onPointerLeave = () => {
    if (this.engine.inXR) return;
    this.hasPointer = false;
    this.mousePointer.active = false;
  };

  private onKeyDown = (ev: KeyboardEvent) => {
    if (ev.repeat) return;
    const target = ev.target as HTMLElement | null;
    // Never steal keys from a real form field.
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    this.keys.add(ev.code);
    const t = ev.timeStamp;
    switch (ev.code) {
      case 'Space':
        ev.preventDefault();
        this.emit('PRIMARY', 'key', 'none', true, t, null, this.mousePointer.ray);
        break;
      case 'KeyF':
      case 'ArrowLeft':
        this.emit('LEFT', 'key', 'left', true, t, null);
        break;
      case 'KeyJ':
      case 'ArrowRight':
        this.emit('RIGHT', 'key', 'right', true, t, null);
        break;
      case 'Enter':
        this.emit('CONFIRM', 'key', 'none', true, t, null);
        break;
      case 'Escape':
        this.emit('CANCEL', 'key', 'none', true, t, null);
        break;
      case 'Tab':
        ev.preventDefault();
        this.emit('MENU', 'key', 'none', true, t, null);
        break;
    }
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.code);
    const t = ev.timeStamp;
    if (ev.code === 'Space') this.emit('PRIMARY', 'key', 'none', false, t, null);
    if (ev.code === 'KeyF' || ev.code === 'ArrowLeft') this.emit('LEFT', 'key', 'left', false, t, null);
    if (ev.code === 'KeyJ' || ev.code === 'ArrowRight') this.emit('RIGHT', 'key', 'right', false, t, null);
  };

  /* ---------------------------------------------------------- per frame */

  update(_frame: XRFrame | null): void {
    if (this.engine.inXR) {
      this.mousePointer.active = false;
      this.updateXRControllers();
    } else {
      for (const p of this.pointers) if (p.id !== 'mouse') p.active = false;
      for (const c of this.controllers) c.cursor.visible = false;
      this.updateMouseRay();
      this.updateKeyboardLocomotion();
    }
  }

  private updateMouseRay(): void {
    this.mousePointer.active = this.hasPointer;
    if (!this.hasPointer) return;
    this.raycaster.setFromCamera(this.ndc, this.engine.camera);
    this.mousePointer.ray.copy(this.raycaster.ray);
  }

  private updateKeyboardLocomotion(): void {
    const k = this.keys;
    // Arrows as well as WASD: MULTI's tracking station is held with the left
    // hand while the right works the mouse, and either home position should
    // work depending on which hand the participant favours.
    this.move.set(
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    );
    this.turn.value = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  }

  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  private updateXRControllers(): void {
    const quant = this.engine.clock.frameInterval;
    const t = this.engine.clock.frameTime;
    this.move.set(0, 0);
    this.turn.value = 0;

    for (const c of this.controllers) {
      const p = this.pointers.find((x) => x.object3D === c.controller);
      if (!p) continue;
      p.hand = c.hand;
      p.active = c.connected;
      c.ray.visible = c.connected;
      if (!c.connected) continue;

      c.controller.getWorldPosition(this.tmpV);
      c.controller.getWorldQuaternion(this.tmpQ);
      p.ray.origin.copy(this.tmpV);
      p.ray.direction.set(0, 0, -1).applyQuaternion(this.tmpQ).normalize();

      const gp = c.gamepad;
      if (!gp) continue;

      // Buttons: 0 trigger, 1 grip, 3 thumbstick, 4 A/X, 5 B/Y on Quest Touch.
      const pressed = gp.buttons.map((b) => b.pressed);
      const prev = c.buttons;
      const fire = (i: number, action: ActionId, hand: 'left' | 'right' | 'none') => {
        const now = pressed[i] ?? false;
        const was = prev[i] ?? false;
        if (now !== was) {
          this.emit(action, c.hand === 'left' ? 'left' : 'right', hand, now, t, quant, p.ray);
        }
      };

      fire(0, 'PRIMARY', c.hand);
      fire(0, c.hand === 'left' ? 'LEFT' : 'RIGHT', c.hand);
      fire(1, 'SECONDARY', c.hand);
      fire(4, c.hand === 'left' ? 'MENU' : 'CONFIRM', c.hand);
      fire(5, 'CANCEL', c.hand);

      p.pressed = pressed[0] ?? false;
      c.buttons = pressed;
      c.axes = [...gp.axes];

      // Thumbsticks: left drives translation, right drives snap turn. Modules
      // that must not allow locomotion simply ignore these values.
      const ax = gp.axes[2] ?? gp.axes[0] ?? 0;
      const ay = gp.axes[3] ?? gp.axes[1] ?? 0;
      if (c.hand === 'left') {
        if (Math.abs(ax) > 0.15) this.move.x += ax;
        if (Math.abs(ay) > 0.15) this.move.y += -ay;
      } else {
        if (Math.abs(ax) > 0.6) this.turn.value += Math.sign(ax);
      }
    }
  }

  /* ---------------------------------------------------------- utilities */

  /**
   * The controller's GRIP space - where the hand physically is, as opposed to
   * the target ray, which points forward out of it.
   *
   * A manipulation module needs the grip: HANDS measures where a peg was
   * released relative to a 9 mm hole, and the target ray origin sits a few
   * centimetres ahead of the hand and tilted. Reading this object's world
   * position also keeps full float precision, which `pose()` does not - it
   * rounds to a millimetre, and hand tremor is a few tenths of one.
   *
   * Null outside XR, or when that hand is not tracked.
   */
  gripSpace(hand: 'left' | 'right'): THREE.Object3D | null {
    const c = this.controllers.find((x) => x.connected && x.hand === hand);
    return c ? c.grip : null;
  }

  /** Whether that hand's trigger is currently held. */
  isPressed(hand: 'left' | 'right'): boolean {
    return this.pointers.some((p) => p.hand === hand && p.active && p.pressed);
  }

  /** The ray that should drive UI hover, i.e. the most recently active source. */
  primaryRay(): THREE.Ray | null {
    if (this.engine.inXR) {
      const right = this.pointers.find((p) => p.id === 'right' && p.active);
      const left = this.pointers.find((p) => p.id === 'left' && p.active);
      return (right ?? left)?.ray ?? null;
    }
    return this.mousePointer.active ? this.mousePointer.ray : null;
  }

  activePointers(): PointerSource[] {
    return this.pointers.filter((p) => p.active);
  }

  /**
   * Objects the pointer ray should stop on and show a cursor for.
   *
   * Panels were the only thing that ever terminated the ray, so pointing at a
   * stimulus in the scene left a twelve-metre line shooting straight through
   * it with no cursor - you could see the direction you were aiming, but not
   * what you were about to select. Modules register their selectable objects
   * here and get the same feedback panels have.
   */
  private pointerTargets: THREE.Object3D[] = [];

  setPointerTargets(objects: THREE.Object3D[]): void {
    this.pointerTargets = objects;
  }

  clearPointerTargets(): void {
    this.pointerTargets = [];
  }

  /** Nearest registered scene object under this pointer, if any. */
  pickPointerTarget(pointer: PointerSource): THREE.Intersection | null {
    if (this.pointerTargets.length === 0) return null;
    this.raycaster.set(pointer.ray.origin, pointer.ray.direction);
    this.raycaster.far = RAY_LEN;
    const visible = this.pointerTargets.filter((o) => o.visible);
    if (visible.length === 0) return null;
    return this.raycaster.intersectObjects(visible, true)[0] ?? null;
  }

  /** Place the 3D cursor disc for a controller at a hit point. */
  setCursor(pointer: PointerSource, point: THREE.Vector3 | null, normal?: THREE.Vector3): void {
    const c = this.controllers.find((x) => x.controller === pointer.object3D);
    if (!c) return;
    if (!point) {
      c.cursor.visible = false;
      // Reset the length too. Without this the ray keeps whatever length the
      // last hit gave it and stays visually stuck to a surface it is no longer
      // pointing at.
      c.ray.scale.z = 1;
      return;
    }
    c.cursor.visible = true;
    c.cursor.position.copy(point);
    if (normal) c.cursor.lookAt(point.clone().add(normal));
    // Keep the ray from visually punching through the panel it just hit.
    const dist = point.distanceTo(pointer.ray.origin);
    c.ray.scale.z = Math.max(0.02, dist / RAY_LEN);
  }

  /** Head + controller pose for motion logging and avatar sync. */
  pose(): PoseSample {
    const out: PoseSample = { head: [], left: [], right: [] };
    const cam = this.engine.camera;
    cam.getWorldPosition(this.tmpV);
    cam.getWorldQuaternion(this.tmpQ);
    out.head = [
      r3(this.tmpV.x), r3(this.tmpV.y), r3(this.tmpV.z),
      r3(this.tmpQ.x), r3(this.tmpQ.y), r3(this.tmpQ.z), r3(this.tmpQ.w),
    ];
    for (const c of this.controllers) {
      if (!c.connected) continue;
      c.grip.getWorldPosition(this.tmpV);
      c.grip.getWorldQuaternion(this.tmpQ);
      const arr = [
        r3(this.tmpV.x), r3(this.tmpV.y), r3(this.tmpV.z),
        r3(this.tmpQ.x), r3(this.tmpQ.y), r3(this.tmpQ.z), r3(this.tmpQ.w),
      ];
      if (c.hand === 'left') out.left = arr;
      else if (c.hand === 'right') out.right = arr;
    }
    return out;
  }

  /** Short haptic pulse. Optional feedback channel only - never a measurement. */
  pulse(hand: 'left' | 'right' | 'both', intensity = 0.4, ms = 40): void {
    for (const c of this.controllers) {
      if (hand !== 'both' && c.hand !== hand) continue;
      const actuator = (c.gamepad as (Gamepad & { hapticActuators?: { pulse?: (i: number, d: number) => void }[] }) | null)
        ?.hapticActuators?.[0];
      actuator?.pulse?.(intensity, ms);
    }
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Enable drag-to-turn, and with it the tap/turn disambiguation. */
  setTouchLook(mode: 'off' | 'yaw' | 'free'): void {
    this.touchLook = mode;
    this.lookState = null;
  }

  /**
   * Emit an action that did not come from a physical control.
   *
   * On-screen buttons are the phone's stand-in for a trigger, and modules
   * should not have to know which one they got: the event they receive is
   * identical either way.
   */
  emitSynthetic(action: ActionId, t: number, hand: 'left' | 'right' | 'none' = 'none'): void {
    this.emit(action, 'touch', hand, true, t, null, this.mousePointer.ray);
    this.emit(action, 'touch', hand, false, t, null, this.mousePointer.ray);
  }

  setTouchZonesEnabled(v: boolean): void {
    this.touchZones = v;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const c = this.canvas;
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.listeners.clear();
  }
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
