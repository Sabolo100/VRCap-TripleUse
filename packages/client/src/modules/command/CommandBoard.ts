import * as THREE from 'three';
import { SEAT_COLORS, type CommandScenario, type Assignment, type Unit, type TaskTarget } from '@vrcap/shared';
import { makePrimitive, makeLabel, disposeTree } from '../../engine/world/Primitives.js';
import type { UITheme } from '../../engine/ui/UITheme.js';

/**
 * The shared board: six sites, the routes between them, four units and four
 * task markers, on a table everyone stands around.
 *
 * Deliberately abstract - cylinders, lines, cones and rings. The exercise is
 * about who says what to whom under time pressure; a detailed map would only
 * add uncontrolled visual load and tie the module to one domain's imagery.
 */

export const TABLE_Y = 0.93;
const RESOURCE_COLORS: Record<string, number> = { ALFA: 0xff9e1b, BRAVO: 0x4fc3f7, CHARLIE: 0xc6ff3d };

export interface BoardPick {
  kind: 'unit' | 'task' | 'site' | 'table';
  id: string;
  point: THREE.Vector3;
}

export class CommandBoard {
  readonly group = new THREE.Group();
  /** Everything raycastable, tagged in userData. */
  private pickables: THREE.Object3D[] = [];
  private unitMeshes = new Map<string, THREE.Group>();
  private taskMeshes = new Map<string, THREE.Group>();
  private linkGroup = new THREE.Group();
  private pingGroup = new THREE.Group();
  private scenario: CommandScenario | Omit<CommandScenario, 'facts'> | null = null;
  private theme: UITheme;
  private selectedUnit: string | null = null;
  private t = 0;

  constructor(theme: UITheme) {
    this.theme = theme;
    this.group.add(this.linkGroup, this.pingGroup);
  }

  build(scenario: Omit<CommandScenario, 'facts'>): void {
    this.clear();
    this.scenario = scenario;
    const t = this.theme;

    // Table top
    const table = makePrimitive({
      kind: 'cylinder', color: 0x121a24, size: [1.9, 0.05, 1.9], roughness: 0.85,
    });
    table.position.set(0, TABLE_Y - 0.025, 0);
    table.userData.pick = { kind: 'table', id: 'table' };
    this.group.add(table);
    this.pickables.push(table);

    const rim = makePrimitive({
      kind: 'torus', color: t.accent, unlit: true, opacity: 0.35, size: 1.94,
    });
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.94, 1.94, 0.6);
    rim.position.set(0, TABLE_Y, 0);
    this.group.add(rim);

    // Routes first, so tokens sit on top of them.
    for (const r of scenario.routes) {
      const a = scenario.sites.find((s) => s.id === r.a)!;
      const b = scenario.sites.find((s) => s.id === r.b)!;
      const mid = new THREE.Vector3((a.x + b.x) / 2, TABLE_Y + 0.004, (a.z + b.z) / 2);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const bar = makePrimitive({ kind: 'box', color: 0x3a4a5e, unlit: true, opacity: 0.75, size: [len, 0.004, 0.012] });
      bar.position.copy(mid);
      bar.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      this.group.add(bar);

      const cost = makeLabel(String(r.cost), { size: 34, color: '#7d90a6', scale: 0.0011 });
      cost.position.set(mid.x, TABLE_Y + 0.05, mid.z);
      this.group.add(cost);
    }

    // Sites
    for (const s of scenario.sites) {
      const pad = makePrimitive({ kind: 'cylinder', color: 0x1d2836, size: [0.11, 0.012, 0.11] });
      pad.position.set(s.x, TABLE_Y + 0.008, s.z);
      pad.userData.pick = { kind: 'site', id: s.id };
      this.group.add(pad);
      this.pickables.push(pad);

      const label = makeLabel(s.label, { size: 34, color: t.textMuted, scale: 0.0012 });
      label.position.set(s.x, TABLE_Y + 0.12, s.z);
      this.group.add(label);
    }

    // Tasks
    for (const task of scenario.tasks) {
      const site = scenario.sites.find((x) => x.id === task.siteId)!;
      const g = new THREE.Group();
      const ring = makePrimitive({
        kind: 'ring', color: t.accent2, unlit: true, doubleSided: true, size: 0.19, opacity: 0.9,
      });
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.014;
      const hit = makePrimitive({ kind: 'cylinder', color: 0xffffff, unlit: true, opacity: 0, size: [0.2, 0.09, 0.2] });
      hit.position.y = 0.045;
      hit.userData.pick = { kind: 'task', id: task.id };
      g.add(ring, hit);

      const label = makeLabel(`${task.id} · ${task.value}`, { size: 32, color: '#8fd8ff', scale: 0.0011 });
      label.position.set(0, 0.2, 0);
      g.add(label);
      const req = makeLabel(`${task.requires} ≥${task.demand} ⏱${task.deadline}`, {
        size: 26, color: '#6f89a3', scale: 0.0011,
      });
      req.position.set(0, 0.155, 0);
      g.add(req);

      g.position.set(site.x, TABLE_Y, site.z);
      this.group.add(g);
      this.pickables.push(hit);
      this.taskMeshes.set(task.id, g);
    }

    // Units - offset slightly from the site centre so they do not sit inside
    // the task ring when a unit happens to start on a task site.
    scenario.units.forEach((u, i) => {
      const site = scenario.sites.find((x) => x.id === u.siteId)!;
      const g = new THREE.Group();
      const color = RESOURCE_COLORS[u.resource] ?? 0xffffff;
      const cone = makePrimitive({ kind: 'cone', color, unlit: true, size: [0.075, 0.13, 0.075] });
      cone.position.y = 0.075;
      cone.userData.pick = { kind: 'unit', id: u.id };
      const base = makePrimitive({ kind: 'cylinder', color, unlit: true, opacity: 0.35, size: [0.11, 0.006, 0.11] });
      base.position.y = 0.012;
      g.add(cone, base);

      const label = makeLabel(`${u.id} ${u.resource} ·${u.capacity}`, { size: 26, color: '#cbd8e6', scale: 0.001 });
      label.position.set(0, 0.2, 0);
      g.add(label);

      const angle = (i / 4) * Math.PI * 2;
      g.position.set(site.x + Math.cos(angle) * 0.05, TABLE_Y, site.z + Math.sin(angle) * 0.05);
      this.group.add(g);
      this.pickables.push(cone);
      this.unitMeshes.set(u.id, g);
    });
  }

  /** Draw the current plan as arcs from each assigned unit to its task. */
  setAssignment(assignment: Assignment): void {
    disposeChildren(this.linkGroup);
    if (!this.scenario) return;
    for (const [unitId, taskId] of Object.entries(assignment)) {
      if (!taskId) continue;
      const from = this.unitMeshes.get(unitId);
      const to = this.taskMeshes.get(taskId);
      if (!from || !to) continue;
      const a = from.position.clone();
      const b = to.position.clone();
      const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.18, 0));
      const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(a.y + 0.06), mid, b.clone().setY(b.y + 0.04));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 22, 0.008, 6, false),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(this.theme.accent), transparent: true, opacity: 0.85 })
      );
      this.linkGroup.add(tube);
    }
  }

  setSelectedUnit(unitId: string | null): void {
    this.selectedUnit = unitId;
    for (const [id, g] of this.unitMeshes) {
      const cone = g.children[0] as THREE.Mesh;
      const mat = cone.material as THREE.MeshBasicMaterial;
      mat.opacity = id === unitId ? 1 : 0.9;
      g.scale.setScalar(id === unitId ? 1.25 : 1);
    }
  }

  get selection(): string | null {
    return this.selectedUnit;
  }

  addPing(x: number, z: number, seat: number): void {
    const ring = makePrimitive({
      kind: 'ring', color: SEAT_COLORS[seat % SEAT_COLORS.length]!, unlit: true, doubleSided: true, size: 0.1,
    });
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, TABLE_Y + 0.02, z);
    ring.userData.born = performance.now();
    this.pingGroup.add(ring);
  }

  raycast(raycaster: THREE.Raycaster): BoardPick | null {
    const hits = raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const pick = h.object.userData.pick as { kind: BoardPick['kind']; id: string } | undefined;
      if (pick) return { ...pick, point: h.point };
    }
    return null;
  }

  update(dt: number): void {
    this.t += dt;
    // Task rings breathe gently so the eye finds them without them shouting.
    for (const g of this.taskMeshes.values()) {
      const ring = g.children[0] as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(this.t * 1.6) * 0.16;
    }
    if (this.selectedUnit) {
      const g = this.unitMeshes.get(this.selectedUnit);
      if (g) g.rotation.y += dt * 1.6;
    }
    for (const p of [...this.pingGroup.children]) {
      const age = performance.now() - (p.userData.born as number);
      if (age > 2400) { p.removeFromParent(); continue; }
      const k = age / 2400;
      p.scale.setScalar(1 + k * 2.4);
      ((p as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
  }

  clear(): void {
    disposeChildren(this.linkGroup);
    disposeChildren(this.pingGroup);
    for (const c of [...this.group.children]) {
      if (c === this.linkGroup || c === this.pingGroup) continue;
      disposeTree(c);
    }
    this.pickables = [];
    this.unitMeshes.clear();
    this.taskMeshes.clear();
  }

  dispose(): void {
    this.clear();
    disposeTree(this.group);
  }
}

function disposeChildren(g: THREE.Group): void {
  for (const c of [...g.children]) disposeTree(c);
}

export function unitById(sc: Omit<CommandScenario, 'facts'> | null, id: string): Unit | undefined {
  return sc?.units.find((u) => u.id === id);
}
export function taskById(sc: Omit<CommandScenario, 'facts'> | null, id: string): TaskTarget | undefined {
  return sc?.tasks.find((t) => t.id === id);
}
