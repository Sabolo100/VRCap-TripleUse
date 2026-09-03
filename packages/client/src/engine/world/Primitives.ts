import * as THREE from 'three';

/**
 * PRIMITIVE LIBRARY.
 *
 * The visual vocabulary of the whole platform, deliberately tiny: spheres,
 * boxes, cylinders, cones, planes, rings, lines, arrows, grids, text.
 * Geometries and materials are shared and pooled, because a vigilance module
 * spawning 36 emitters for 15 minutes must not churn the GPU.
 */

const geometryCache = new Map<string, THREE.BufferGeometry>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geometryCache.get(key);
  if (hit) return hit as T;
  const g = make();
  geometryCache.set(key, g);
  return g;
}

export const Geo = {
  sphere: (segments = 24) => cached(`sph:${segments}`, () => new THREE.SphereGeometry(0.5, segments, segments / 2)),
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cylinder: (seg = 24) => cached(`cyl:${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg)),
  cone: (seg = 20) => cached(`cone:${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg)),
  plane: () => cached('plane', () => new THREE.PlaneGeometry(1, 1)),
  ring: (inner = 0.38, outer = 0.5, seg = 40) =>
    cached(`ring:${inner}:${outer}:${seg}`, () => new THREE.RingGeometry(inner, outer, seg)),
  torus: (tube = 0.1, seg = 32) => cached(`tor:${tube}:${seg}`, () => new THREE.TorusGeometry(0.5, tube, 12, seg)),
  capsule: () => cached('cap', () => new THREE.CapsuleGeometry(0.4, 0.6, 4, 12)),
};

export type PrimitiveKind = 'sphere' | 'box' | 'cylinder' | 'cone' | 'plane' | 'ring' | 'torus' | 'capsule';

export interface PrimitiveOptions {
  kind: PrimitiveKind;
  color?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  opacity?: number;
  size?: number | [number, number, number];
  metalness?: number;
  roughness?: number;
  /** Unlit material - use for stimuli whose brightness must not depend on
   *  scene lighting, which is most of them in an assessment context. */
  unlit?: boolean;
  doubleSided?: boolean;
}

export function makePrimitive(o: PrimitiveOptions): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  switch (o.kind) {
    case 'box': geo = Geo.box(); break;
    case 'cylinder': geo = Geo.cylinder(); break;
    case 'cone': geo = Geo.cone(); break;
    case 'plane': geo = Geo.plane(); break;
    case 'ring': geo = Geo.ring(); break;
    case 'torus': geo = Geo.torus(); break;
    case 'capsule': geo = Geo.capsule(); break;
    default: geo = Geo.sphere();
  }

  const color = o.color ?? 0xffffff;
  const transparent = (o.opacity ?? 1) < 1;
  const material = o.unlit
    ? new THREE.MeshBasicMaterial({
        color,
        transparent,
        opacity: o.opacity ?? 1,
        side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        toneMapped: false,
      })
    : new THREE.MeshStandardMaterial({
        color,
        emissive: o.emissive ?? color,
        emissiveIntensity: o.emissiveIntensity ?? 0.35,
        roughness: o.roughness ?? 0.42,
        metalness: o.metalness ?? 0.05,
        transparent,
        opacity: o.opacity ?? 1,
        side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });

  const mesh = new THREE.Mesh(geo, material);
  const s = o.size ?? 1;
  if (Array.isArray(s)) mesh.scale.set(s[0], s[1], s[2]);
  else mesh.scale.setScalar(s);
  return mesh;
}

/** A simple arrow: shaft + head, both primitives, no imported model. */
export function makeArrow(length = 0.4, color: THREE.ColorRepresentation = 0xffffff): THREE.Group {
  const g = new THREE.Group();
  const shaft = makePrimitive({ kind: 'cylinder', color, unlit: true, size: [0.018, length * 0.72, 0.018] });
  shaft.position.y = length * 0.36;
  const head = makePrimitive({ kind: 'cone', color, unlit: true, size: [0.055, length * 0.28, 0.055] });
  head.position.y = length * 0.86;
  g.add(shaft, head);
  return g;
}

/** Floor grid with a soft radial fade so the horizon does not end abruptly. */
export function makeGrid(size = 40, divisions = 40, color = 0x1c3247, fade = true): THREE.Object3D {
  const grid = new THREE.GridHelper(size, divisions, color, color);
  const mat = grid.material as THREE.Material & { opacity: number; transparent: boolean };
  mat.transparent = true;
  mat.opacity = 0.5;
  if (fade) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = (modelMatrix * vec4(position,1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
        .replace(
          '#include <opaque_fragment>',
          'float d = length(vWorld.xz);\ngl_FragColor.a *= 1.0 - smoothstep(' +
            (size * 0.18).toFixed(1) +
            ', ' +
            (size * 0.5).toFixed(1) +
            ', d);\n#include <opaque_fragment>'
        );
    };
  }
  return grid;
}

/** Text as a canvas sprite - avoids shipping a font atlas or a text geometry. */
export function makeLabel(
  text: string,
  opts: { size?: number; color?: string; bg?: string; font?: string; padding?: number; scale?: number } = {}
): THREE.Sprite {
  const size = opts.size ?? 64;
  const font = `600 ${size}px ${opts.font ?? 'Inter, system-ui, sans-serif'}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const pad = opts.padding ?? 18;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.5);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, w);
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.font = font;
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, toneMapped: false }));
  const scale = opts.scale ?? 0.0016;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.userData.dispose = () => { tex.dispose(); (sprite.material as THREE.Material).dispose(); };
  return sprite;
}

/**
 * Object pool. Modules that spawn and retire many identical stimuli use this
 * so allocation never lands inside a response window.
 */
export class Pool<T extends THREE.Object3D> {
  private free: T[] = [];
  private live = new Set<T>();
  constructor(private factory: () => T, private reset: (o: T) => void, preload = 0) {
    for (let i = 0; i < preload; i++) this.free.push(factory());
  }
  acquire(): T {
    const o = this.free.pop() ?? this.factory();
    this.reset(o);
    o.visible = true;
    this.live.add(o);
    return o;
  }
  release(o: T): void {
    if (!this.live.delete(o)) return;
    o.visible = false;
    o.removeFromParent();
    this.free.push(o);
  }
  releaseAll(): void {
    for (const o of [...this.live]) this.release(o);
  }
  get activeCount(): number {
    return this.live.size;
  }
  forEach(fn: (o: T) => void): void {
    this.live.forEach(fn);
  }
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const anyO = o as THREE.Mesh & { userData: { dispose?: () => void } };
    anyO.userData?.dispose?.();
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      // Geometries are shared through the cache; only dispose materials.
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  });
  root.removeFromParent();
}
