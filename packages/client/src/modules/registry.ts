import type { AssessmentModule } from '../engine/task/Module.js';
import { ReactModule } from './react/ReactModule.js';
import { CommandModule } from './command/CommandModule.js';
import { SignalModule } from './signal/SignalModule.js';
import { NavModule } from './nav/NavModule.js';
import { PressureModule } from './pressure/PressureModule.js';
import { AnticipateModule } from './anticipate/AnticipateModule.js';
import { WatchModule } from './watch/WatchModule.js';
import { HoldModule } from './hold/HoldModule.js';
import { MemoryModule } from './memory/MemoryModule.js';
import { SignalSpatialModule } from './signal/SignalSpatialModule.js';
import { ReactSpatialModule } from './react/ReactSpatialModule.js';
import { PressureSpatialModule } from './pressure/PressureSpatialModule.js';
import { CommandSpatialModule } from './command/CommandSpatialModule.js';
import { AnticipateSpatialModule } from './anticipate/AnticipateSpatialModule.js';
import { FieldModule } from './field/FieldModule.js';
import { SteadyModule } from './steady/SteadyModule.js';
import { RhythmModule } from './rhythm/RhythmModule.js';
import { AdaptModule } from './adapt/AdaptModule.js';
import { MultiModule } from './multi/MultiModule.js';
import { HandsModule } from './hands/HandsModule.js';

/**
 * MODULE REGISTRY.
 *
 * The catalog in @vrcap/shared lists every module that exists on paper; this
 * maps the ones that exist in code. A module whose code is absent here stays
 * visible on the hub with a "planned" badge - the catalog is the specification,
 * this is the build.
 */
const FACTORIES: Record<string, () => AssessmentModule> = {
  SIGNAL: () => new SignalModule(),
  NAV: () => new NavModule(),
  REACT: () => new ReactModule(),
  WATCH: () => new WatchModule(),
  PRESSURE: () => new PressureModule(),
  HOLD: () => new HoldModule(),
  MEMORY: () => new MemoryModule(),
  COMMAND: () => new CommandModule(),
  ANTICIPATE: () => new AnticipateModule(),
  FIELD: () => new FieldModule(),
  STEADY: () => new SteadyModule(),
  RHYTHM: () => new RhythmModule(),
  ADAPT: () => new AdaptModule(),
  MULTI: () => new MultiModule(),
  HANDS: () => new HandsModule(),
};

/**
 * Variant factories, keyed `CODE:VARIANT`. A module without an entry here for
 * a given variant falls back to its single form.
 */
const VARIANT_FACTORIES: Record<string, () => AssessmentModule> = {
  // Variant A is the module's default factory above; only the spatial
  // extensions need their own entry.
  'SIGNAL:B': () => new SignalSpatialModule(),
  'REACT:B': () => new ReactSpatialModule(),
  'PRESSURE:B': () => new PressureSpatialModule(),
  'COMMAND:B': () => new CommandSpatialModule(),
  'ANTICIPATE:B': () => new AnticipateSpatialModule(),
};

export function createModule(code: string, variant?: string): AssessmentModule | null {
  const key = code.toUpperCase();
  if (variant) {
    const v = VARIANT_FACTORIES[`${key}:${variant.toUpperCase()}`];
    if (v) return v();
  }
  const f = FACTORIES[key];
  return f ? f() : null;
}

export function registerVariant(code: string, variant: string, factory: () => AssessmentModule): void {
  VARIANT_FACTORIES[`${code.toUpperCase()}:${variant.toUpperCase()}`] = factory;
}

export function hasVariantImplementation(code: string, variant: string): boolean {
  return `${code.toUpperCase()}:${variant.toUpperCase()}` in VARIANT_FACTORIES;
}

export function implementedModules(): string[] {
  return Object.keys(FACTORIES);
}
