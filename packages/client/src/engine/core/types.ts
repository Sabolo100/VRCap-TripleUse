import type * as THREE from 'three';

export type ActionId =
  | 'PRIMARY'      // trigger / click / tap - the universal "respond now"
  | 'SECONDARY'    // grip / right click / two-finger tap
  | 'LEFT'         // left hand response  (choice RT, bimanual)
  | 'RIGHT'        // right hand response
  | 'CONFIRM'      // A / Enter / confirm button
  | 'CANCEL'       // B / Escape
  | 'MENU';

export type SourceId = 'left' | 'right' | 'mouse' | 'touch' | 'key';

export interface ActionEvent {
  action: ActionId;
  source: SourceId;
  hand: 'left' | 'right' | 'none';
  /** performance.now() timebase. For DOM events this is event.timeStamp. */
  t: number;
  /** true = press, false = release */
  down: boolean;
  /** Set when the action came from a device polled once per frame rather than
   *  from a DOM event - the value is the frame interval in ms, i.e. the
   *  quantisation error bound on `t`. Null for event-driven input. */
  quantisationMs: number | null;
  /** World ray at the moment of the action, when the source has one. */
  ray?: THREE.Ray;
}

export interface PointerSource {
  id: SourceId;
  hand: 'left' | 'right' | 'none';
  /** Whether this source currently produces a usable ray. */
  active: boolean;
  pressed: boolean;
  ray: THREE.Ray;
  /** Object the ray visual is attached to (controller grip space), if any. */
  object3D: THREE.Object3D | null;
}

export interface PoseSample {
  /** [x,y,z, qx,qy,qz,qw] or [] when not tracked. */
  head: number[];
  left: number[];
  right: number[];
}
