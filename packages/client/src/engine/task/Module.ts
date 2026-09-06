import * as THREE from 'three';
import type { DomainCode, ModuleManifest, RunMode } from '@vrcap/shared';
import type { Engine } from '../core/Engine.js';
import type { Recorder } from '../data/Recorder.js';
import type { PanelManager } from '../ui/PanelManager.js';
import type { SignalSystem } from '../world/SignalSystem.js';
import type { MotionSystem } from '../world/MotionSystem.js';
import type { UITheme } from '../ui/UITheme.js';
import type { Rng } from '@vrcap/shared';
import type { AudioSystem } from '../audio/AudioSystem.js';
import type { MobileControls } from '../ui/MobileControls.js';

/**
 * STANDARD MODULE CONTRACT.
 *
 * Adding a module means implementing this interface and registering a manifest.
 * Nothing in the core platform needs to change, which is the whole point of the
 * engine-plus-configuration architecture: ten modules are one engine and ten
 * task descriptions, not ten VR applications.
 */

export interface ModuleContext {
  engine: Engine;
  scene: THREE.Scene;
  /** Everything the module adds should be parented here so teardown is trivial. */
  root: THREE.Group;
  panels: PanelManager;
  recorder: Recorder;
  signals: SignalSystem;
  motion: MotionSystem;
  audio: AudioSystem;
  rng: Rng;
  theme: UITheme;
  domain: DomainCode;
  mode: RunMode;
  manifest: ModuleManifest;
  /** Which platform the module is actually running on right now. */
  platform: 'vr' | 'desktop' | 'mobile';
  /** Difficulty / configuration identifier stored with the run. */
  configVersion: string;
  /**
   * On-screen controls, present only on a phone.
   *
   * A module declares what it needs - a response button, a "no target"
   * button, drag-to-turn, a slider - and the layer renders it. Buttons
   * dispatch the same ActionEvents a controller would, so the module's own
   * input handling does not change. Null on every other platform.
   */
  mobileControls: MobileControls | null;
}

export interface BlockDescriptor {
  id: string;
  title: string;
  /** One or two sentences shown before the block starts. */
  instruction: string;
  /** Platform-specific control hint, filled in by the module. */
  controlHint: string;
  trials: number;
  /** Practice trials shown before the assessment portion of this block. */
  practiceTrials: number;
  /**
   * What `trials` counts, when it is not trials.
   *
   * A few modules are not trial-based: RHYTHM's first block runs three tempi
   * of 48 beats each, and STEADY's blocks are continuous recordings. Showing
   * "3 próba" for those is simply wrong, so they name their own unit.
   */
  unitLabel?: string;
}

export interface ModuleResult {
  /** 0-1000 headline. */
  opsScore: number;
  /** Rows for the result panel. */
  headline: { label: string; value: string; hint?: string }[];
  /** Free-form structured summary stored with the run. */
  summary: Record<string, unknown>;
  /** Optional per-axis contributions, 0-100, for the capability profile. */
  axisScores?: Record<string, number>;
}

export interface AssessmentModule {
  readonly manifest: ModuleManifest;
  /** Blocks in execution order. Drives the progress display. */
  readonly blocks: BlockDescriptor[];

  /** Build scene content. Called once, before the intro screen. */
  init(ctx: ModuleContext): Promise<void> | void;

  /** Short calibration step; resolve when the user is ready. */
  calibrate?(ctx: ModuleContext): Promise<void>;

  /** Run one block. `practice` blocks give feedback and are not scored. */
  runBlock(ctx: ModuleContext, block: BlockDescriptor, practice: boolean): Promise<void>;

  /** Called every frame while the module is active. */
  update(dt: number, ctx: ModuleContext): void;

  /** Compute metrics + score once all blocks are finished. */
  finish(ctx: ModuleContext): ModuleResult;

  /** Free everything. */
  dispose(ctx: ModuleContext): void;

  /** Optional: abort cleanly mid-run (user quit, session lost). */
  abort?(ctx: ModuleContext): void;
}
