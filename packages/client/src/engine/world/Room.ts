import * as THREE from 'three';
import { DOMAINS, type DomainCode } from '@vrcap/shared';
import { makeGrid, disposeTree } from './Primitives.js';

/**
 * STANDARD ASSESSMENT ENVIRONMENT.
 *
 * One visual language - dark neutral background, faint grid, glowing geometric
 * objects, minimal HUD - rendered in three domain skins. The room is deliberately
 * quiet: it is a measuring instrument, not entertainment, and every extra visual
 * element is an uncontrolled stimulus.
 *
 * The three signatures differ only in colour, floor treatment and one horizon
 * motif, so a run in the defence skin and a run in the sport skin remain
 * physically comparable.
 */
export class Room {
  readonly group = new THREE.Group();
  private motes: THREE.Points | null = null;
  private horizon: THREE.Mesh | null = null;
  private t = 0;

  constructor(scene: THREE.Scene, private domain: DomainCode, opts: { minimal?: boolean } = {}) {
    const d = DOMAINS[domain];
    const p = d.palette;

    scene.background = new THREE.Color(p.bg);
    scene.fog = new THREE.FogExp2(new THREE.Color(p.fog).getHex(), p.fogDensity);

    // Lighting: a hemisphere plus one key light. Assessment objects mostly use
    // unlit materials, so this exists for the room, not for the stimuli.
    const hemi = new THREE.HemisphereLight(new THREE.Color(p.lightSky), new THREE.Color(p.lightGround), 1.1);
    this.group.add(hemi);
    const key = new THREE.DirectionalLight(new THREE.Color(p.accent), 0.55);
    key.position.set(3, 6, 2);
    this.group.add(key);

    // Floor
    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.bgAlt),
      roughness: 0.94,
      metalness: 0.02,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(d.room.horizon, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    this.group.add(floor);

    if (!opts.minimal) {
      this.group.add(makeGrid(d.room.horizon * 1.6, d.room.floor === 'track' ? 28 : 48, new THREE.Color(p.grid).getHex()));
      this.buildSignature(d.room.signature, p.accent, p.accent2, d.room.horizon);
      if (d.room.motes > 0) this.buildMotes(d.room.motes, p.accent, d.room.horizon);
    }

    scene.add(this.group);
  }

  private buildSignature(kind: 'radar' | 'blueprint' | 'stadium', accent: string, accent2: string, horizon: number): void {
    const color = new THREE.Color(accent);

    if (kind === 'radar') {
      // Concentric range rings and a slow sweep - reads as an instrument.
      for (let i = 1; i <= 4; i++) {
        const r = (horizon / 5) * i;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r - 0.02, r + 0.02, 96),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1 + 0.04 * (4 - i), side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.01;
        this.group.add(ring);
      }
      const sweep = new THREE.Mesh(
        new THREE.CircleGeometry(horizon / 1.6, 48, 0, 0.42),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
      );
      sweep.rotation.x = -Math.PI / 2;
      sweep.position.y = 0.012;
      sweep.name = 'sweep';
      this.group.add(sweep);
      this.horizon = sweep;
    }

    if (kind === 'blueprint') {
      // A calm technical drawing: two faint wall planes with measure ticks.
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide });
      for (const [x, z, ry] of [[0, -horizon * 0.55, 0], [-horizon * 0.55, 0, Math.PI / 2]] as const) {
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(horizon * 0.9, 5), mat);
        wall.position.set(x, 2.5, z);
        wall.rotation.y = ry;
        this.group.add(wall);
      }
      const tickMat = new THREE.LineBasicMaterial({ color: new THREE.Color(accent2), transparent: true, opacity: 0.25 });
      const pts: THREE.Vector3[] = [];
      for (let i = -12; i <= 12; i++) {
        pts.push(new THREE.Vector3(i * 0.5, 0.02, -horizon * 0.54), new THREE.Vector3(i * 0.5, i % 2 === 0 ? 0.22 : 0.11, -horizon * 0.54));
      }
      this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), tickMat));
    }

    if (kind === 'stadium') {
      // Lane lines converging to a bright horizon band.
      const laneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14 });
      for (let i = -4; i <= 4; i++) {
        const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.06, horizon * 1.5), laneMat);
        lane.rotation.x = -Math.PI / 2;
        lane.position.set(i * 1.25, 0.011, -horizon * 0.2);
        this.group.add(lane);
      }
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(horizon * 0.92, horizon * 0.92, 0.5, 64, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(accent2), transparent: true, opacity: 0.16, side: THREE.BackSide })
      );
      band.position.y = 3.4;
      this.group.add(band);
      this.horizon = band;
    }
  }

  private buildMotes(count: number, accent: string, horizon: number): void {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * horizon * 0.6;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * 6;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: new THREE.Color(accent),
        size: 0.035,
        transparent: true,
        opacity: 0.42,
        sizeAttenuation: true,
        depthWrite: false,
      })
    );
    this.group.add(this.motes);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.motes) this.motes.rotation.y += dt * 0.012;
    const d = DOMAINS[this.domain];
    if (this.horizon && d.room.signature === 'radar') this.horizon.rotation.z -= dt * 0.35;
    if (this.horizon && d.room.signature === 'stadium') {
      const m = this.horizon.material as THREE.MeshBasicMaterial;
      m.opacity = 0.12 + Math.sin(this.t * 0.6) * 0.05;
    }
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
