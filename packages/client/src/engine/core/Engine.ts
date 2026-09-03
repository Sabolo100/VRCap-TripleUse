import * as THREE from 'three';
import { Clock } from './Clock.js';
import { InputManager } from '../input/InputManager.js';
import { detectDevice, updateDeviceRuntime } from './Device.js';
import type { DeviceProfile } from '@vrcap/shared';

export interface EngineOptions {
  canvas?: HTMLCanvasElement;
  container: HTMLElement;
  /** Overlay element shown over the WebXR session on supporting devices. */
  domOverlay?: HTMLElement;
}

export type FrameHook = (dt: number, clock: Clock, frame: XRFrame | null) => void;

/**
 * The single WebXR runtime for the whole platform.
 *
 * There is exactly one Engine per page. Scenes (hub, module) are swapped in and
 * out of it, so entering VR once carries the user through the entire session:
 * lobby, instructions, practice, assessment, results. Nothing forces a return
 * to the 2D page, which matters because re-entering an immersive session always
 * needs a fresh user gesture.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly clock = new Clock();
  readonly input: InputManager;
  /** The rig holds the camera; move the rig, never the camera, so XR poses stay valid. */
  readonly rig = new THREE.Group();
  readonly camera: THREE.PerspectiveCamera;

  scene: THREE.Scene;
  device!: DeviceProfile;

  private hooks = new Set<FrameHook>();
  private container: HTMLElement;
  private running = false;
  private sessionListeners = new Set<(inXr: boolean) => void>();
  private resizeObserver?: ResizeObserver;

  /** True while an immersive session is presenting. */
  get inXR(): boolean {
    return this.renderer.xr.isPresenting;
  }

  constructor(opts: EngineOptions) {
    this.container = opts.container;
    const canvas = opts.canvas ?? document.createElement('canvas');
    if (!canvas.parentElement) this.container.appendChild(canvas);
    canvas.classList.add('vrcap-canvas');

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // Reaction timing benefits from the shortest possible present path.
      // `desynchronized` is not in the three.js parameter type, but the option
      // is forwarded verbatim to getContext, so it still takes effect.
      ...({ desynchronized: true } as object),
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.xr.enabled = true;
    // local-floor puts y=0 at the physical floor, so a 1.6 m panel is at eye
    // height for a standing adult and modules do not need per-user calibration.
    this.renderer.xr.setReferenceSpaceType('local-floor');

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.05, 300);
    this.camera.position.set(0, 1.6, 0);
    this.rig.add(this.camera);

    this.input = new InputManager(this);

    this.onResize();
    window.addEventListener('resize', this.onResize);
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }

    this.renderer.xr.addEventListener('sessionstart', this.onSessionStart);
    this.renderer.xr.addEventListener('sessionend', this.onSessionEnd);
  }

  async init(): Promise<void> {
    this.device = await detectDevice();
  }

  /* ------------------------------------------------------------- scenes */

  setScene(scene: THREE.Scene): void {
    // The rig belongs to whichever scene is live.
    this.rig.removeFromParent();
    scene.add(this.rig);
    this.scene = scene;
  }

  /* -------------------------------------------------------------- loop */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop(this.frame);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  onFrame(hook: FrameHook): () => void {
    this.hooks.add(hook);
    return () => this.hooks.delete(hook);
  }

  private frame = (time: number, frame?: XRFrame) => {
    // `time` inside an XR session is the predicted display time of this frame.
    this.clock.beginFrame(time);
    const dt = this.clock.frameDelta / 1000;

    this.input.update(frame ?? null);

    for (const hook of this.hooks) {
      try {
        hook(dt, this.clock, frame ?? null);
      } catch (err) {
        console.error('[engine] frame hook failed', err);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  /* ---------------------------------------------------------- XR session */

  async isVrSupported(): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return false;
    try {
      return await xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  /**
   * Must be called from a user gesture - the spec requires it and browsers
   * enforce it. Everything upstream of here (the ENTER VR button) exists purely
   * to provide that gesture.
   */
  async enterVR(domOverlay?: HTMLElement): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return false;
    const init: XRSessionInit = {
      optionalFeatures: [
        'local-floor',
        'bounded-floor',
        'hand-tracking',
        'layers',
        ...(domOverlay ? ['dom-overlay'] : []),
      ],
      requiredFeatures: ['local-floor'],
      ...(domOverlay ? { domOverlay: { root: domOverlay } } : {}),
    } as XRSessionInit;
    try {
      const session = await xr.requestSession('immersive-vr', init);
      await this.renderer.xr.setSession(session);
      return true;
    } catch (err) {
      console.warn('[engine] immersive-vr session refused', err);
      return false;
    }
  }

  async exitVR(): Promise<void> {
    const session = this.renderer.xr.getSession();
    if (session) await session.end();
  }

  onSessionChange(cb: (inXr: boolean) => void): () => void {
    this.sessionListeners.add(cb);
    return () => this.sessionListeners.delete(cb);
  }

  private onSessionStart = () => {
    const session = this.renderer.xr.getSession();
    const hands = !!session?.inputSources && Array.from(session.inputSources).some((s) => !!s.hand);
    updateDeviceRuntime({
      platform: 'vr',
      inputMode: hands ? 'hands' : 'controller',
      handTracking: hands,
      refreshRate: this.clock.refreshRate,
    });
    this.container.classList.add('in-xr');
    this.sessionListeners.forEach((cb) => cb(true));
  };

  private onSessionEnd = () => {
    updateDeviceRuntime({
      platform: this.device?.deviceClass === 'mobile' ? 'mobile' : 'desktop',
      inputMode: this.device?.inputMode === 'touch' ? 'touch' : 'mouse',
    });
    this.container.classList.remove('in-xr');
    this.sessionListeners.forEach((cb) => cb(false));
    this.onResize();
  };

  /* ------------------------------------------------------------- resize */

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    // A narrow phone in portrait needs a wider vertical FOV or the scene
    // reads as if the user is standing too close to everything.
    this.camera.fov = h > w ? 78 : 65;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.renderer.xr.removeEventListener('sessionstart', this.onSessionStart);
    this.renderer.xr.removeEventListener('sessionend', this.onSessionEnd);
    this.input.dispose();
    this.renderer.dispose();
  }
}
