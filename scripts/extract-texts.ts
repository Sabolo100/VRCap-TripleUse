/**
 * Dump every user-facing string the platform can show, with a stable id.
 *
 * The block texts are read by BUILDING each module for each platform and
 * asking it, rather than by scraping the source: instructions are now
 * per-platform, control hints are computed, and some modules drop whole
 * blocks on a flat screen. What comes out here is what a participant on that
 * device would actually read.
 */
import { MODULES, Rng, isRunnable, type ModuleManifest, type PlatformMode } from '@vrcap/shared';
import { installHeadlessDom } from '../tests/helpers/headless-dom.js';

installHeadlessDom();

const { createModule } = await import('../packages/client/src/modules/registry.js');
const { themeForDomain } = await import('../packages/client/src/engine/ui/UITheme.js');
const { resolveText } = await import('../packages/client/src/engine/task/text.js');
const THREE = await import('three');

export interface Row {
  category: string;
  id: string;
  module: string;
  variant: string;
  place: string;
  field: string;
  platform: string;
  text: string;
  file: string;
}

const rows: Row[] = [];
const PLATFORMS: PlatformMode[] = ['vr', 'desktop', 'mobile'];

function fakeCtx(platform: PlatformMode, manifest: ModuleManifest) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(platform === 'mobile' ? 42 : 65, 1.6, 0.05, 300);
  camera.position.set(0, 1.6, 0);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  const noop = () => {};
  return {
    platform, scene, root, manifest, domain: 'A', mode: 'assessment',
    configVersion: `${manifest.code}_STANDARD_A`,
    rng: new Rng(7),
    theme: themeForDomain('A'),
    mobileControls: null,
    engine: {
      camera, scene, rig, inXR: platform === 'vr',
      clock: { frameTime: 0, frameInterval: 11.1 },
      onFrame: () => noop,
      input: {
        on: () => noop, move: new THREE.Vector2(), turn: { value: 0 }, pointers: [],
        primaryRay: () => null, gripSpace: () => null, isPressed: () => false,
        isKeyDown: () => false, setPointerTargets: noop, clearPointerTargets: noop,
        pickPointerTarget: () => null, setCursor: noop, setTouchLook: noop,
        setTouchZonesEnabled: noop, emitSynthetic: noop, pulse: noop,
        pose: () => ({ head: [], left: [], right: [] }),
      },
    },
    panels: { add: noop, remove: noop, onClick: () => noop, invalidateAll: noop },
    recorder: { setMotionHz: noop, event: noop, metric: noop, score: noop, trial: noop, sampleMotion: noop },
    signals: { update: noop, spawn: noop, clear: noop },
    motion: { update: noop, clear: noop },
    audio: {
      speechAvailable: false, outputLatencyMs: 12, tone: () => 0, noise: () => 0,
      speak: () => false, stopSpeech: noop, ok: noop, error: noop, click: noop,
      warn: noop, countdown: noop, unlock: async () => {},
    },
  } as never;
}

/* ------------------------------------------------- 1. block texts */

for (const m of MODULES) {
  if (!isRunnable(m) || m.status === 'external') continue;
  const variantIds = m.variants && m.variants.length > 1 ? m.variants.map((v) => v.id) : [undefined];

  for (const variantId of variantIds) {
    const variant = m.variants?.find((v) => v.id === variantId);
    const supports = (variant?.supports ?? m.supports) as PlatformMode[];
    const label = variantId ?? '-';

    // block id -> platform -> { title, instruction, hint }
    const byBlock = new Map<string, { order: number; title: string; per: Map<string, { instruction: string; hint: string }> }>();

    for (const p of PLATFORMS) {
      if (!supports.includes(p)) continue;
      const mod = createModule(m.code, variantId);
      if (!mod) continue;
      try {
        await mod.init(fakeCtx(p, m));
      } catch (err) {
        console.error(`  ! ${m.code}${variantId ?? ''} / ${p}: ${(err as Error).message}`);
        continue;
      }
      mod.blocks.forEach((b, i) => {
        let e = byBlock.get(b.id);
        if (!e) { e = { order: i, title: b.title, per: new Map() }; byBlock.set(b.id, e); }
        e.per.set(p, { instruction: resolveText(b.instruction, p), hint: b.controlHint });
      });
    }

    const file = `packages/client/src/modules/`;
    for (const [blockId, e] of [...byBlock].sort((a, b) => a[1].order - b[1].order)) {
      const base = `${m.ordinal}.${m.code}${variantId ? '-' + variantId : ''}.${blockId}`;
      rows.push({
        category: '1 FELADAT', id: `${base}.cim`, module: `${m.ordinal} ${m.code}`,
        variant: label, place: blockId, field: 'blokk címe', platform: 'mind',
        text: e.title, file,
      });
      for (const field of ['instruction', 'hint'] as const) {
        const values = [...e.per].map(([p, v]) => [p, v[field]] as const);
        const uniq = new Set(values.map(([, t]) => t));
        const name = field === 'instruction' ? 'instrukció' : 'IRÁNYÍTÁS sor';
        if (uniq.size === 1) {
          rows.push({
            category: '1 FELADAT', id: `${base}.${field}`, module: `${m.ordinal} ${m.code}`,
            variant: label, place: blockId, field: name, platform: 'mind',
            text: values[0]![1], file,
          });
        } else {
          for (const [p, t] of values) {
            rows.push({
              category: '1 FELADAT', id: `${base}.${field}.${p}`, module: `${m.ordinal} ${m.code}`,
              variant: label, place: blockId, field: name,
              platform: p === 'vr' ? 'VR' : p === 'desktop' ? 'asztali' : 'mobil',
              text: t, file,
            });
          }
        }
      }
    }
  }
}

/* ------------------------------------------------ 2. catalogue */

for (const m of MODULES) {
  const id = `${m.ordinal}.${m.code}`;
  const mod = `${m.ordinal} ${m.code}`;
  const F = 'packages/shared/src/modules.ts';
  rows.push({ category: '3 KATALÓGUS', id: `${id}.subtitle`, module: mod, variant: '-', place: 'kártya', field: 'alcím', platform: 'mind', text: m.subtitle, file: F });
  rows.push({ category: '3 KATALÓGUS', id: `${id}.summary`, module: mod, variant: '-', place: 'kártya', field: 'összefoglaló', platform: 'mind', text: m.summary, file: F });
  for (const d of ['A', 'B', 'C'] as const) {
    const dom = m.domains[d];
    const dn = d === 'A' ? 'védelmi' : d === 'B' ? 'munka' : 'sport';
    if (dom.headline) {
      rows.push({ category: '3 KATALÓGUS', id: `${id}.dom${d}.headline`, module: mod, variant: '-', place: `${dn} terület`, field: 'fejléc', platform: 'mind', text: dom.headline, file: F });
    }
    if (dom.rationale) {
      rows.push({ category: '3 KATALÓGUS', id: `${id}.dom${d}.rationale`, module: mod, variant: '-', place: `${dn} terület`, field: 'indoklás', platform: 'mind', text: dom.rationale, file: F });
    }
  }
  for (const c of m.constructs) {
    rows.push({ category: '3 KATALÓGUS', id: `${id}.construct.${c.id}`, module: mod, variant: '-', place: 'képességlista', field: 'képesség', platform: 'mind', text: c.label, file: F });
  }
  for (const v of m.variants ?? []) {
    rows.push({ category: '3 KATALÓGUS', id: `${id}.var${v.id}.label`, module: mod, variant: v.id, place: 'változatválasztó', field: 'név', platform: 'mind', text: v.label, file: F });
    rows.push({ category: '3 KATALÓGUS', id: `${id}.var${v.id}.subtitle`, module: mod, variant: v.id, place: 'változatválasztó', field: 'alcím', platform: 'mind', text: v.subtitle, file: F });
    rows.push({ category: '3 KATALÓGUS', id: `${id}.var${v.id}.summary`, module: mod, variant: v.id, place: 'változatválasztó', field: 'leírás', platform: 'mind', text: v.summary, file: F });
  }
}

console.log(JSON.stringify(rows, null, 0));
