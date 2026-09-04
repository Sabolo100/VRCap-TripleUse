import * as THREE from 'three';
import type { ModuleContext } from '../../engine/task/Module.js';
import type { Panel } from '../../engine/ui/Panel.js';

/**
 * Raycasting scene objects while letting UI panels win.
 *
 * Modules that put both clickable 3D stimuli and control panels in front of the
 * participant have to resolve which one a click belongs to. The rule is simple
 * and matches what the eye expects: whichever surface the ray reaches first.
 */
export class ObjectPicker {
  private raycaster = new THREE.Raycaster();

  constructor(private ctx: ModuleContext, private panels: Panel[] = []) {}

  setPanels(panels: Panel[]): void {
    this.panels = panels;
  }

  /**
   * Declare which objects the participant can aim at right now.
   *
   * This drives the pointer visual: the ray stops on these and shows a cursor,
   * the same way it does on a panel. Call it whenever the selectable set
   * changes - at the start of a trial, and with an empty list when the
   * response window closes.
   */
  setHoverTargets(objects: THREE.Object3D[]): void {
    this.ctx.engine.input.setPointerTargets(objects);
  }

  /**
   * Returns the nearest hit object from `targets`, or null when the ray misses
   * or lands on a panel first.
   */
  pick(ray: THREE.Ray, targets: THREE.Object3D[], far = 12): { object: THREE.Object3D; point: THREE.Vector3; distance: number } | null {
    if (targets.length === 0) return null;
    this.raycaster.set(ray.origin, ray.direction);
    this.raycaster.far = far;
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;

    const panelMeshes = this.panels.filter((p) => p.mesh.visible && p.group.parent).map((p) => p.mesh);
    if (panelMeshes.length) {
      const panelHit = this.raycaster.intersectObjects(panelMeshes, false)[0];
      if (panelHit && panelHit.distance < hit.distance) return null;
    }
    // Walk up to the object that carries the stimulus tag, so a group with
    // several child meshes still resolves to one logical item.
    let obj: THREE.Object3D | null = hit.object;
    while (obj && obj.userData.stimulusIndex === undefined && obj.parent) obj = obj.parent;
    return { object: obj ?? hit.object, point: hit.point, distance: hit.distance };
  }

  /** Angle between the ray and the direction to a world point, degrees. */
  angularErrorTo(ray: THREE.Ray, target: THREE.Vector3): number {
    const toTarget = target.clone().sub(ray.origin).normalize();
    return THREE.MathUtils.radToDeg(ray.direction.angleTo(toTarget));
  }

  dispose(): void {
    this.panels = [];
    this.ctx.engine.input.clearPointerTargets();
  }
}
