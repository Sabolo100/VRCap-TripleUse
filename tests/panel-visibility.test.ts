/**
 * CAN THE PARTICIPANT ACTUALLY SEE THE BUTTON?
 *
 * On a headset you look down and the control panel is there. On a laptop you
 * cannot look down at all: the camera never moves, so anything outside the
 * frustum is not merely awkward, it is unreachable. A panel placed at -36
 * degrees is fine in VR and invisible on a 65 degree viewport - and the module
 * happily waits for a press on a button nobody can see.
 *
 * So this builds every module for real, off-screen, and measures where its
 * panels end up relative to the flat camera. No numbers are copied from the
 * module source into the test; the test asks the module where it put things.
 */
import * as THREE from 'three';
import { Rng, MODULES, isRunnable, isRunnableOn, type ModuleManifest } from '@vrcap/shared';
import { installHeadlessDom } from './helpers/headless-dom.js';

installHeadlessDom();

const { createModule } = await import('../packages/client/src/modules/registry.js');
const { Panel } = await import('../packages/client/src/engine/ui/Panel.js');
const { themeForDomain } = await import('../packages/client/src/engine/ui/UITheme.js');
const { runnerPanelLayout } = await import('../packages/client/src/engine/task/ModuleRunner.js');
const { flatHudTopDeg } = await import('../packages/client/src/engine/ui/viewport.js');
const { isEffectivelyVisible } = await import('../packages/client/src/engine/ui/Panel.js');
type PanelT = InstanceType<typeof Panel>;
type ModuleContext = import('../packages/client/src/engine/task/Module.js').ModuleContext;

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${JSON.stringify(extra ?? '')}`);
  if (!cond) failures++;
};

/* ------------------------------------------------------------- viewport */

/** The engine's flat camera: 65 degrees vertical, eye at 1.6 m, looking -Z. */
const FLAT_FOV_DEG = 65;
const MOBILE_FOV_DEG = 42;
/** The narrowest laptop the platform claims to support: 16:10. */
const DESKTOP_ASPECT = 16 / 10;
/** Landscape phone, and the aspect that gives the least horizontal room. */
const MOBILE_ASPECT = 16 / 9;

function halfAngles(fovDeg: number, aspect: number): { v: number; h: number } {
  const v = fovDeg / 2;
  const h = (Math.atan(Math.tan((v * Math.PI) / 180) * aspect) * 180) / Math.PI;
  return { v, h };
}

interface Corner { hDeg: number; vDeg: number; behind: boolean }

/** Where a point sits relative to the camera axis, in degrees. */
function angles(camera: THREE.Camera, world: THREE.Vector3): Corner {
  const local = world.clone().applyMatrix4(new THREE.Matrix4().copy(camera.matrixWorld).invert());
  // Camera space: -z forward, +x right, +y up.
  const depth = -local.z;
  return {
    hDeg: (Math.atan2(local.x, depth) * 180) / Math.PI,
    vDeg: (Math.atan2(local.y, depth) * 180) / Math.PI,
    behind: depth <= 0.01,
  };
}

function panelCorners(p: PanelT): THREE.Vector3[] {
  const w = p.width / 2;
  const h = p.height / 2;
  p.group.updateMatrixWorld(true);
  return [
    new THREE.Vector3(-w, -h, 0), new THREE.Vector3(w, -h, 0),
    new THREE.Vector3(-w, h, 0), new THREE.Vector3(w, h, 0),
  ].map((v) => p.mesh.localToWorld(v));
}

/* ----------------------------------------------------------- fake world */

interface Harness {
  ctx: ModuleContext;
  panels: PanelT[];
  camera: THREE.PerspectiveCamera;
}

function harness(platform: 'vr' | 'desktop' | 'mobile', manifest: ModuleManifest): Harness {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(
    platform === 'mobile' ? MOBILE_FOV_DEG : FLAT_FOV_DEG,
    platform === 'mobile' ? MOBILE_ASPECT : DESKTOP_ASPECT,
    0.05, 300
  );
  camera.position.set(0, 1.6, 0);
  // The engine holds the camera inside the rig and moves the rig, never the
  // camera. Modules that seat the participant rotate the rig, so the harness
  // has to mirror that or their panels look like they are behind the viewer.
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  camera.updateMatrixWorld(true);

  const panels: PanelT[] = [];
  const noop = () => {};
  const ctx = {
    platform,
    scene,
    root,
    manifest,
    domain: 'A',
    mode: 'assessment',
    configVersion: `${manifest.code}_STANDARD_A`,
    rng: new Rng(7),
    theme: themeForDomain('A'),
    mobileControls: null,
    engine: {
      camera,
      scene,
      rig,
      inXR: platform === 'vr',
      clock: { frameTime: 0, frameInterval: 11.1 },
      onFrame: () => noop,
      input: {
        on: () => noop,
        move: new THREE.Vector2(),
        turn: { value: 0 },
        pointers: [],
        primaryRay: () => null,
        gripSpace: () => null,
        isPressed: () => false,
        isKeyDown: () => false,
        setPointerTargets: noop,
        clearPointerTargets: noop,
        pickPointerTarget: () => null,
        setCursor: noop,
        setTouchLook: noop,
        setTouchZonesEnabled: noop,
        emitSynthetic: noop,
        pulse: noop,
        pose: () => ({ head: [], left: [], right: [] }),
      },
    },
    panels: {
      add: (p: PanelT) => { panels.push(p); },
      remove: noop,
      onClick: () => noop,
      invalidateAll: noop,
    },
    recorder: {
      setMotionHz: noop, event: noop, metric: noop, score: noop, trial: noop, sampleMotion: noop,
    },
    signals: { update: noop, spawn: noop, clear: noop },
    motion: { update: noop, clear: noop },
    audio: {
      speechAvailable: false, outputLatencyMs: 12,
      tone: () => 0, noise: () => 0, speak: () => false, stopSpeech: noop,
      ok: noop, error: noop, click: noop, warn: noop, countdown: noop, unlock: async () => {},
    },
  } as unknown as ModuleContext;
  return { ctx, panels, camera };
}

/** Placement often happens after init, in a method the module calls itself. */
const PLACEMENT_METHODS = [
  'place', 'placeStations', 'placeStatus', 'positionPanels', 'rebuildGeometry', 'layoutPanels',
  'positionPrompt', 'positionMap', 'positionHud', 'moveToSeat',
];

async function build(code: string, variant: string | undefined, platform: 'vr' | 'desktop' | 'mobile') {
  const manifest = MODULES.find((m) => m.code === code)!;
  const h = harness(platform, manifest);
  const mod = createModule(code, variant);
  if (!mod) return null;
  await mod.init(h.ctx);
  const anyMod = mod as unknown as Record<string, unknown>;
  for (const name of PLACEMENT_METHODS) {
    const fn = anyMod[name];
    if (typeof fn === 'function') {
      try { (fn as () => void).call(mod); } catch { /* placement needs a live block */ }
    }
  }
  h.ctx.scene.updateMatrixWorld(true);
  h.ctx.root.updateMatrixWorld(true);
  return { ...h, mod };
}

/* ---------------------------------------------------------------- audit */

interface Offender {
  module: string;
  panel: string;
  centre: Corner;
  worstV: number;
  worstH: number;
  behind: boolean;
  onHud?: boolean;
}

async function audit(platform: 'desktop' | 'mobile'): Promise<{ audited: number; offenders: Offender[] }> {
  const limit = halfAngles(
    platform === 'mobile' ? MOBILE_FOV_DEG : FLAT_FOV_DEG,
    platform === 'mobile' ? MOBILE_ASPECT : DESKTOP_ASPECT
  );
  const offenders: Offender[] = [];
  let audited = 0;

  const targets: [string, string | undefined][] = [];
  for (const m of MODULES) {
    if (!isRunnable(m) || m.status === 'external') continue;
    if (!isRunnableOn(m, platform)) continue;
    targets.push([m.code, undefined]);
    for (const v of m.variants ?? []) {
      if (v.id === 'A') continue;
      if (!v.supports.includes(platform)) continue;
      targets.push([m.code, v.id]);
    }
  }

  for (const [code, variant] of targets) {
    let built;
    try {
      built = await build(code, variant, platform);
    } catch (err) {
      offenders.push({
        module: variant ? `${code}-${variant}` : code,
        panel: `init threw: ${(err as Error).message}`,
        centre: { hDeg: 0, vDeg: 0, behind: false }, worstV: 0, worstH: 0, behind: false,
      });
      continue;
    }
    if (!built) continue;
    audited++;
    for (const p of built.panels) {
      const centre = angles(built.camera, p.group.getWorldPosition(new THREE.Vector3()));
      const corners = panelCorners(p).map((c) => angles(built.camera, c));
      const worstV = Math.max(...corners.map((c) => Math.abs(c.vDeg)));
      const worstH = Math.max(...corners.map((c) => Math.abs(c.hDeg)));
      const behind = centre.behind || corners.some((c) => c.behind);
      // The runner's HUD strip is up for the whole of a block, so a module
      // panel reaching into it lands on top of the block line and the exit.
      const lowest = Math.min(...corners.map((c) => c.vDeg));
      const onHud = platform === 'desktop' && !behind && lowest < flatHudTopDeg() - 0.2;
      if (behind || worstV > limit.v || worstH > limit.h || onHud) {
        offenders.push({
          module: variant ? `${code}-${variant}` : code,
          panel: p.mesh.name,
          centre: { hDeg: +centre.hDeg.toFixed(1), vDeg: +centre.vDeg.toFixed(1), behind: centre.behind },
          worstV: +worstV.toFixed(1), worstH: +worstH.toFixed(1), behind,
          onHud,
        });
      }
    }
  }
  return { audited, offenders };
}

/* ----------------------------------------------------------------- run */

console.log('\nPANEL-LÁTHATÓSÁG  (minden modul, minden panel)');
{
  const limitD = halfAngles(FLAT_FOV_DEG, DESKTOP_ASPECT);
  const limitM = halfAngles(MOBILE_FOV_DEG, MOBILE_ASPECT);
  console.log(`  asztali látómező: ±${limitD.v.toFixed(1)}° függőleges, ±${limitD.h.toFixed(1)}° vízszintes`);
  console.log(`  mobil látómező:   ±${limitM.v.toFixed(1)}° függőleges, ±${limitM.h.toFixed(1)}° vízszintes`);

  for (const platform of ['desktop', 'mobile'] as const) {
    const { audited, offenders } = await audit(platform);
    check(`${platform}: every runnable module builds headlessly`, audited >= 12, audited);
    if (offenders.length) {
      console.log(`\n  ${platform} — ${offenders.length} panel a látómezőn kívül:`);
      for (const o of offenders) {
        console.log(`    ${o.module.padEnd(16)} ${o.panel.padEnd(22)} `
          + `közép v=${String(o.centre.vDeg).padStart(6)}° h=${String(o.centre.hDeg).padStart(6)}° `
          + `· szél v=${o.worstV}° h=${o.worstH}°`
          + `${o.behind ? ' HÁTUL' : ''}${o.onHud ? ' A HUD SÁVBAN' : ''}`);
      }
      console.log('');
    }
    check(`${platform}: every panel is inside the viewport and clear of the HUD strip`,
      offenders.length === 0, offenders.map((o) => `${o.module}/${o.panel}`));
  }
}

/* -------------------------------------------- the runner's own panels */

/**
 * The instruction panel carries the button that starts a block, and the HUD
 * strip carries the way out. Neither belongs to a module, so the sweep above
 * never sees them - and the reported bug was a control panel off the bottom of
 * the screen, which is exactly what the HUD was doing to its own block line.
 */
console.log('\nA FUTTATÓ SAJÁT PANELJEI');
{
  for (const platform of ['desktop', 'mobile'] as const) {
    const limits = halfAngles(
      platform === 'mobile' ? MOBILE_FOV_DEG : FLAT_FOV_DEG,
      platform === 'mobile' ? MOBILE_ASPECT : DESKTOP_ASPECT
    );
    const L = runnerPanelLayout(true);
    const camera = new THREE.PerspectiveCamera(
      platform === 'mobile' ? MOBILE_FOV_DEG : FLAT_FOV_DEG,
      platform === 'mobile' ? MOBILE_ASPECT : DESKTOP_ASPECT, 0.05, 300);
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld(true);

    const extent = (
      pos: [number, number, number], w: number, h: number, tilt = 0
    ) => {
      const g = new THREE.Group();
      g.position.set(...pos);
      g.rotation.x = tilt;
      g.updateMatrixWorld(true);
      const cs = [
        new THREE.Vector3(-w / 2, -h / 2, 0), new THREE.Vector3(w / 2, -h / 2, 0),
        new THREE.Vector3(-w / 2, h / 2, 0), new THREE.Vector3(w / 2, h / 2, 0),
      ].map((v) => angles(camera, g.localToWorld(v)));
      return {
        v: Math.max(...cs.map((c) => Math.abs(c.vDeg))),
        h: Math.max(...cs.map((c) => Math.abs(c.hDeg))),
      };
    };

    const info = extent(L.info.position, L.info.width, L.info.height);
    check(`${platform}: the instruction panel - and its start button - is fully on screen`,
      info.v <= limits.v && info.h <= limits.h,
      { info, limits: { v: +limits.v.toFixed(1), h: +limits.h.toFixed(1) } });

    const rad = (L.hud.elDeg * Math.PI) / 180;
    const hudPos: [number, number, number] = [
      0, 1.6 + Math.sin(rad) * L.hud.distanceM, -Math.cos(rad) * L.hud.distanceM,
    ];
    const hud = extent(hudPos, L.hud.width, L.hud.height, L.hud.tiltRad);
    if (platform === 'desktop') {
      check('desktop: the HUD strip is fully on screen, block line included',
        hud.v <= limits.v && hud.h <= limits.h,
        { hud, limits: { v: +limits.v.toFixed(1), h: +limits.h.toFixed(1) } });
    } else {
      // On a phone there is no room for it in the scene at all, which is why
      // the runner hides it there and puts the same information in a DOM strip.
      check('mobile: the 3D HUD is known not to fit, and is replaced by the DOM strip',
        hud.v > limits.v, { hud, limits: { v: +limits.v.toFixed(1) } });
    }
  }
}

/* --------------------------------------- hidden panels must not be clickable */

/**
 * Panels are hidden by their group, and three.js leaves the child mesh's own
 * `visible` flag alone when it does that - so a raycast against the mesh still
 * hits a panel nobody can see. That was letting a click during calibration
 * reach the instruction panel underneath and advance the run.
 */
console.log('\nREJTETT PANEL NEM KATTINTHATÓ');
{
  const group = new THREE.Group();
  const child = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  group.add(child);
  child.add(mesh);

  check('a mesh under visible ancestors counts as visible', isEffectivelyVisible(mesh));
  group.visible = false;
  check('hiding the GROUP hides the mesh for hit-testing, even though its own flag is true',
    !isEffectivelyVisible(mesh) && mesh.visible === true);
  group.visible = true;
  child.visible = false;
  check('hiding any ancestor is enough', !isEffectivelyVisible(mesh));
  child.visible = true;
  check('and restoring them brings it back', isEffectivelyVisible(mesh));
  mesh.visible = false;
  check('the object\'s own flag still counts', !isEffectivelyVisible(mesh));
  check('nothing is not visible', !isEffectivelyVisible(null));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
