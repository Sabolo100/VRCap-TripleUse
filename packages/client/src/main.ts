import './styles/main.css';
import './styles/mobile.css';
import * as THREE from 'three';
import {
  DOMAINS, MODULE_BY_CODE, domainBySlug, randomSeed, configVersionFor, variantOf, supportsPlatform,
  type DomainCode, type ModuleManifest, type RunPayload, type VariantId, type PlatformMode,
} from '@vrcap/shared';
import { Engine } from './engine/core/Engine.js';
import { PanelManager } from './engine/ui/PanelManager.js';
import { ModuleRunner } from './engine/task/ModuleRunner.js';
import { Room } from './engine/world/Room.js';
import { audio } from './engine/audio/AudioSystem.js';
import { deviceSync } from './engine/core/Device.js';
import { store } from './app/state.js';
import { api } from './app/api.js';
import { applyDomainTheme } from './shell/theme.js';
import { renderLanding } from './shell/LandingView.js';
import { renderHub } from './shell/HubView.js';
import { renderMobileLanding, renderMobileHub } from './shell/mobile/MobileApp.js';
import { requestLandscape, releaseLandscape } from './shell/mobile/orientation.js';
import { toast } from './shell/dom.js';
import { HubScene } from './hub/HubScene.js';
import { createModule } from './modules/registry.js';

const SHEPARD_URL = (import.meta.env.VITE_SHEPARD_URL as string | undefined) || 'https://mindview-vr.vercel.app/';

/**
 * Application shell.
 *
 * Three surfaces share one engine and one state store:
 *   - the flat DOM shell (landing + hub), which is also the WebXR entry gesture,
 *   - the 3D hub, which is the same hub rendered inside the headset,
 *   - a module scene, which either surface can start.
 *
 * The engine is created once and never torn down, because re-entering an
 * immersive session always costs another user gesture; scenes are swapped
 * underneath it instead.
 */
class App {
  /** Exposed through the debug handle; treat as private elsewhere. */
  engine!: Engine;
  private shellEl = document.getElementById('shell') as HTMLElement;
  private xrEl = document.getElementById('xr-container') as HTMLElement;
  private overlayEl = document.getElementById('overlay') as HTMLElement;

  private hubScene: HubScene | null = null;
  /** Set while a module owns the screen, so the back gesture can exit it. */
  private runningModule: { domain: DomainCode; fromVr: boolean } | null = null;
  /** Exposed through the debug handle; treat as private elsewhere. */
  moduleScene: {
    scene: THREE.Scene;
    room: Room;
    panels: PanelManager;
    runner: ModuleRunner;
    off: () => void;
  } | null = null;

  async boot(): Promise<void> {
    this.engine = new Engine({ container: this.xrEl, domOverlay: this.overlayEl });
    await this.engine.init();
    const vrSupported = await this.engine.isVrSupported();
    store.set({ vrSupported });

    this.engine.onSessionChange((inXr) => {
      store.set({ inVr: inXr });
      if (!inXr) this.leaveScene();
    });

    void api.health().then((ok) => store.set({ offline: !ok }));

    // The phone layout is a property of the device, not of the current view,
    // so the flag is set once rather than toggled from every render path.
    document.body.classList.toggle('is-mobile-app', this.isPhone());

    this.registerServiceWorker();

    // On a phone, back is how people leave things. Inside a module it used to
    // pop the hash and land on the domain picker - the participant lost the
    // whole area, not just the test. A module now owns a history entry, so
    // back exits the test and returns to its own hub.
    window.addEventListener('popstate', () => {
      const running = this.runningModule;
      if (!running) return;
      this.runningModule = null;
      this.exitModule(running.domain, running.fromVr, false);
    });

    window.addEventListener('hashchange', () => this.route());
    this.route();
  }

  /**
   * Register the service worker so the app is installable and opens offline.
   *
   * Only over HTTPS (or localhost) - the API refuses to register otherwise,
   * and a rejected promise here would surface as a console error on every
   * plain-http visit for no benefit.
   */
  private registerServiceWorker(): void {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    const go = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[pwa] service worker registration failed', err);
      });
    };
    // boot() runs behind a couple of awaits, so `load` has usually fired by
    // the time we get here - waiting for it again would mean never
    // registering at all.
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }

  /* ------------------------------------------------------------ routing */

  private route(): void {
    const hash = location.hash.replace(/^#\/?/, '');
    const [, slug, , code] = ['', ...hash.split('/')];

    if (!slug) {
      this.showShell();
      applyDomainTheme(null);
      store.set({ domain: null });
      const pick = (d: DomainCode) => { location.hash = `#/${DOMAINS[d].slug}`; };
      // A phone gets a different information architecture, not a narrower
      // stylesheet: see shell/mobile/MobileApp.ts.
      if (this.isPhone()) renderMobileLanding(this.shellEl, this.mobileCallbacks(null, pick));
      else renderLanding(this.shellEl, pick);
      return;
    }

    const domain = domainBySlug(slug);
    if (!domain) {
      location.hash = '#/';
      return;
    }
    store.set({ domain: domain.code });
    applyDomainTheme(domain.code);

    if (code) {
      const manifest = MODULE_BY_CODE[code.toUpperCase()];
      if (manifest) {
        void this.startModule(manifest, domain.code, false);
        return;
      }
    }

    this.showShell();
    this.renderHubShell(domain.code);
  }

  /**
   * True for a touch device that is not a headset. The Quest browser reports
   * `desktop` until an immersive session starts, so it keeps the wide layout
   * it needs as a WebXR launcher.
   */
  private isPhone(): boolean {
    return (deviceSync()?.platform ?? 'desktop') === 'mobile';
  }

  private mobileCallbacks(
    domain: DomainCode | null,
    onPickDomain: (d: DomainCode) => void
  ): Parameters<typeof renderMobileHub>[2] {
    return {
      onStartModule: (m, variant) => {
        if (domain) void this.startModule(m, domain, false, variant);
      },
      onEnterVR: () => { if (domain) void this.enterVrHub(domain); },
      onPickDomain,
      onChangeDomain: () => { location.hash = '#/'; },
      onSignIn: (id) => (domain ? this.signIn(id, domain) : Promise.resolve()),
      onSignOut: () => {
        store.signOut();
        if (domain) this.renderHubShell(domain);
      },
    };
  }

  private renderHubShell(domain: DomainCode): void {
    if (this.isPhone()) {
      renderMobileHub(
        this.shellEl, domain,
        this.mobileCallbacks(domain, (d) => { location.hash = `#/${DOMAINS[d].slug}`; })
      );
      return;
    }
    renderHub(this.shellEl, domain, {
      onStartModule: (m, variant) => void this.startModule(m, domain, false, variant),
      onEnterVR: () => void this.enterVrHub(domain),
      onChangeDomain: () => { location.hash = '#/'; },
      onSignIn: (id) => this.signIn(id, domain),
      onSignOut: () => {
        store.signOut();
        this.renderHubShell(domain);
      },
    });
  }

  private async signIn(externalId: string, domain: DomainCode): Promise<void> {
    const subject = await api.identify(externalId, domain);
    store.set({ subject });
    const profile = await api.profile(subject.id, domain);
    store.set({ profile });
    if (subject.id.startsWith('local:')) {
      toast('Nincs szerverkapcsolat — az azonosító helyben él, az eredmények később szinkronizálódnak.');
    }
    if (this.hubScene) return;
    this.renderHubShell(domain);
  }

  /* -------------------------------------------------------- 2D / 3D mode */

  private showShell(): void {
    // Back on the shell, the phone is free to rotate again.
    releaseLandscape();
    document.body.classList.remove('mode-3d');
    document.body.classList.add('mode-2d');
    this.shellEl.style.display = '';
    this.xrEl.style.display = 'none';
    this.engine.stop();
  }

  private showScene(): void {
    document.body.classList.remove('mode-2d');
    document.body.classList.add('mode-3d');
    this.shellEl.style.display = 'none';
    this.xrEl.style.display = '';
    // A module's 3D UI is laid out for a wide viewport; on a phone that means
    // landscape. See shell/mobile/orientation.ts.
    if (this.isPhone()) requestLandscape();
    this.engine.start();
  }

  /* ------------------------------------------------------------ 3D hub */

  private async enterVrHub(domain: DomainCode): Promise<void> {
    await audio.unlock();
    this.buildHubScene(domain);
    this.showScene();
    const ok = await this.engine.enterVR(this.overlayEl);
    if (!ok) {
      toast('A VR munkamenet nem indult el. A 3D központ így is használható egérrel.');
    }
  }

  private buildHubScene(domain: DomainCode): void {
    this.teardownHubScene();
    this.hubScene = new HubScene(this.engine, domain, {
      onStartModule: (m, variant) => void this.startModule(m, domain, true, variant),
      onSignIn: (id) => this.signIn(id, domain),
      onSignOut: () => store.signOut(),
      onExitVR: () => {
        void this.engine.exitVR();
        this.leaveScene();
      },
      onChangeDomain: () => {
        void this.engine.exitVR();
        this.teardownHubScene();
        location.hash = '#/';
        this.showShell();
      },
    });
    this.engine.setScene(this.hubScene.scene);
  }

  private teardownHubScene(): void {
    this.hubScene?.dispose();
    this.hubScene = null;
  }

  private leaveScene(): void {
    releaseLandscape();
    this.teardownModuleScene();
    this.teardownHubScene();
    const d = store.get().domain;
    this.showShell();
    if (d) this.renderHubShell(d);
    else renderLanding(this.shellEl, (x) => { location.hash = `#/${DOMAINS[x].slug}`; });
  }

  /* ------------------------------------------------------------ modules */

  private async startModule(
    manifest: ModuleManifest,
    domain: DomainCode,
    fromVr: boolean,
    variant?: VariantId
  ): Promise<void> {
    if (manifest.status === 'external') {
      const url = manifest.code === 'SPACE' ? SHEPARD_URL : manifest.externalUrl;
      if (!url) return;
      if (this.engine.inXR) {
        // A new tab cannot open over an immersive session; leave VR first so
        // the external experience gets a clean gesture of its own.
        await this.engine.exitVR();
      }
      toast('A Shepard–Metzler modul külön alkalmazásként nyílik meg.');
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (manifest.status !== 'active') {
      toast(`${manifest.code}: specifikálva, de még nem indítható.`);
      return;
    }

    // Some modules cannot run on a flat platform at all - STEADY's measurement
    // is the headset's own position trace. Refused up front rather than
    // started and left to produce a run full of nulls.
    const platform: PlatformMode = this.engine.inXR ? 'vr' : 'desktop';
    if (!supportsPlatform(manifest, platform)) {
      toast(`${manifest.code}: ehhez a modulhoz VR headset kell.`);
      return;
    }

    // A variant the current platform cannot run is refused rather than
    // silently downgraded: the two forms are different tasks, and starting the
    // wrong one would put the result in the wrong norm group.
    const chosen = variantOf(manifest, variant);
    if (chosen && !chosen.supports.includes(platform)) {
      toast(`${manifest.code} ${chosen.id}: ehhez a változathoz VR headset kell.`);
      return;
    }

    await audio.unlock();
    const module = createModule(manifest.code, variant);
    if (!module) {
      toast(`${manifest.code}: nincs implementáció regisztrálva.`);
      return;
    }

    this.teardownModuleScene();
    this.hubScene?.setVisible(false);

    const scene = new THREE.Scene();
    const room = new Room(scene, domain, { minimal: manifest.code === 'REACT' });
    const panels = new PanelManager(this.engine);
    this.engine.setScene(scene);
    this.showScene();

    // The module's own history entry. Same URL, so nothing navigates; the
    // popstate handler above turns a back gesture into "leave the test".
    //
    // When the launch came from a bottom sheet, that sheet's entry is still
    // the current one and it was deliberately left for us - taking it over
    // keeps the stack at [hub, module] instead of growing a dead entry that
    // back would have to step through twice.
    this.runningModule = { domain, fromVr };
    const state = { module: manifest.code };
    if (history.state?.sheet) history.replaceState(state, '');
    else history.pushState(state, '');

    const snapshot = store.get();
    const runner = new ModuleRunner({
      engine: this.engine,
      panels,
      module,
      domain,
      mode: 'assessment',
      seed: randomSeed(),
      variant: chosen?.id,
      configVersion: configVersionFor(manifest, variant),
      motionHz: manifest.code === 'REACT' ? 30 : 10,
      subjectId: snapshot.subject?.id.startsWith('local:') ? null : snapshot.subject?.id ?? null,
      sessionId: snapshot.sessionId,
      onSave: (payload: RunPayload) => this.saveRun(payload, domain),
      onExit: () => this.exitModule(domain, fromVr),
    });

    const off = this.engine.onFrame((dt) => room.update(dt));
    this.moduleScene = { scene, room, panels, runner, off };
    await runner.begin();
  }

  private async saveRun(payload: RunPayload, domain: DomainCode) {
    const res = await api.saveRun(payload);
    store.set({ offline: !api.online });
    const subject = store.get().subject;
    if (subject && !subject.id.startsWith('local:')) {
      void api.profile(subject.id, domain).then((profile) => profile && store.set({ profile }));
    }
    store.addLocalRun({
      id: payload.header.id,
      moduleCode: payload.header.moduleCode,
      moduleVersion: payload.header.moduleVersion,
      configVersion: payload.header.configVersion,
      variant: payload.header.variant,
      domain: payload.header.domain,
      mode: payload.header.mode,
      opsScore: payload.opsScore,
      finishedAt: payload.finishedAt,
      headline: [],
    });
    return res;
  }

  private exitModule(domain: DomainCode, fromVr: boolean, popEntry = true): void {
    // Leaving by button rather than by gesture. Navigating back consumes the
    // module's history entry, and the popstate handler calls this again with
    // popEntry = false to do the actual teardown - so `runningModule` must
    // stay set until then, or that handler bails out and the module is left
    // running behind the shell.
    if (popEntry && this.runningModule && history.state?.module) {
      history.back();
      return;
    }
    this.runningModule = null;
    this.teardownModuleScene();
    if (fromVr && this.hubScene) {
      this.hubScene.setVisible(true);
      this.engine.setScene(this.hubScene.scene);
      return;
    }
    if (this.engine.inXR) void this.engine.exitVR();
    this.showShell();
    this.renderHubShell(domain);
    // Keep the URL on the hub so a refresh does not immediately relaunch.
    const slug = DOMAINS[domain].slug;
    if (location.hash !== `#/${slug}`) location.hash = `#/${slug}`;
  }

  private teardownModuleScene(): void {
    if (!this.moduleScene) return;
    const { runner, panels, room, off } = this.moduleScene;
    off();
    runner.dispose();
    panels.dispose();
    room.dispose();
    this.moduleScene = null;
  }
}

/* -------------------------------------------------------------------- */

const app = new App();
void app.boot().catch((err) => {
  console.error('[boot] failed', err);
  const shell = document.getElementById('shell');
  if (shell) {
    shell.innerHTML =
      '<div class="wrap" style="padding:60px 24px"><h2>Indítási hiba</h2>' +
      `<p style="color:#8296ab">${String(err)}</p>` +
      '<p style="color:#8296ab">Ha WebGL nem elérhető, próbáld másik böngészőben.</p></div>';
  }
});

// Flush anything that was buffered offline as soon as the network is back.
window.addEventListener('online', () => {
  void api.flush().then((n) => {
    if (n > 0) toast(`${n} korábbi eredmény feltöltve.`);
    store.set({ offline: false });
  });
});
window.addEventListener('offline', () => store.set({ offline: true }));

// Debug handle. Devtools on a headset are awkward at best, so the running
// engine, the current module runner and the live recorder counts are reachable
// from the console (and from an automated smoke test).
(window as unknown as { vrcap: unknown }).vrcap = {
  store,
  api,
  device: deviceSync,
  app,
  /** The live engine: frame interval, XR state and device profile are the
   *  things worth checking first when something looks wrong on a headset. */
  get engine() {
    return (app as unknown as { engine?: unknown }).engine ?? null;
  },
  get runner() {
    return (app as unknown as { moduleScene?: { runner: unknown } }).moduleScene?.runner ?? null;
  },
};
