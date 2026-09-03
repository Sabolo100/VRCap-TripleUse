/**
 * VR CAP - core domain types.
 * Shared verbatim between client and server so the wire format has exactly one definition.
 */

/* ------------------------------------------------------------------ *
 * Application domains (the "triple use" of the platform)
 * ------------------------------------------------------------------ */

/** A = Defence, B = Work / occupational fitness, C = Sport / talent identification. */
export type DomainCode = 'A' | 'B' | 'C';

export const DOMAIN_CODES: DomainCode[] = ['A', 'B', 'C'];

/** How strongly a module relates to a domain. Drives filtering + ordering on the hub. */
export type Relevance = 'primary' | 'secondary' | 'none';

/* ------------------------------------------------------------------ *
 * Modules
 * ------------------------------------------------------------------ */

export type ModuleStatus =
  /** Implemented and runnable in this build. */
  | 'active'
  /** Implemented elsewhere - opens an external deployment (e.g. Shepard-Metzler). */
  | 'external'
  /** Specified but not yet built. Visible on the hub, not startable. */
  | 'planned';

export type PlatformMode = 'vr' | 'desktop' | 'mobile';

export type RunMode = 'assessment' | 'challenge' | 'practice';

/** A cognitive construct the platform claims to measure. */
export interface ConstructRef {
  /** Stable id, e.g. "simple_reaction_time". */
  id: string;
  /** Human label (hu). */
  label: string;
  /** Row number in the 136-item master measurement catalog, when it maps to one. */
  catalogRef?: number;
}

export interface ModuleDomainProfile {
  relevance: Relevance;
  /** Domain-specific title override, e.g. REACT is "Reakció & pszichomotoros kontroll" everywhere
   *  but its framing text differs per domain. */
  headline?: string;
  /** One paragraph: why this module matters in this domain. */
  rationale?: string;
  /** Concrete example roles / sports this predicts for. */
  examples?: string[];
}

export type VariantId = 'A' | 'B';

/**
 * A runnable variant of a module.
 *
 * Some modules exist in two forms: the established version (A), which follows
 * the published paper-or-screen layout and runs on every platform, and a
 * spatial version (B), which extends the same paradigm into the third
 * dimension and usually needs a headset.
 *
 * They measure the SAME construct - otherwise it would be a new module, not a
 * variant - but they are different tasks, so their results never share a norm
 * group. The distinct `configVersion` is what keeps them apart in the database
 * and on the leaderboard.
 */
export interface ModuleVariant {
  id: VariantId;
  /** One word, shown on the card button. */
  label: string;
  /** What this variant is, in a few words. */
  subtitle: string;
  /** How it differs, and when to pick it. */
  summary: string;
  status: ModuleStatus;
  supports: PlatformMode[];
  /** True when the scoring depends on stereo depth, surround or reach. */
  spatial: boolean;
  configVersion: string;
  duration: number;
  paradigms?: string[];
  /** Which of the six spatial affordances this variant uses. */
  spatialAffordances?: SpatialAffordance[];
}

/** The spatial tools from docs/03-SPATIAL-DESIGN.md. */
export type SpatialAffordance =
  | 'surround'
  | 'depth'
  | 'approach'
  | 'peripersonal'
  | 'rotation'
  | 'hidden_transform';

export interface ModuleManifest {
  /** Two digit ordinal used through the whole documentation, e.g. "04". */
  ordinal: string;
  /** Stable code, e.g. "REACT". Primary key everywhere. */
  code: string;
  /** Short title (hu). */
  title: string;
  /** Sub-title / paradigm name (hu). */
  subtitle: string;
  version: string;
  status: ModuleStatus;
  /** For status === 'external'. */
  externalUrl?: string;
  /** Nominal duration of one assessment run, seconds. */
  duration: number;
  supports: PlatformMode[];
  assessmentMode: boolean;
  challengeMode: boolean;
  /** COMMAND-style modules need >1 concurrent participant. */
  multiuser?: { min: number; max: number; botsSupported: boolean };
  /** Short description shown on the hub card (hu). */
  summary: string;
  /** Measured constructs. */
  constructs: ConstructRef[];
  /** Headline metrics surfaced on the result screen. */
  headlineMetrics: string[];
  /** 1-5, how much bespoke 3D content the module needs. */
  assetLoad: 1 | 2 | 3 | 4 | 5;
  /** 1-5, implementation complexity. */
  codeLoad: 1 | 2 | 3 | 4 | 5;
  /** Per-domain relevance and framing. */
  domains: Record<DomainCode, ModuleDomainProfile>;
  /**
   * Present only when the module has more than one runnable form. Absent means
   * a single form, which is the right answer for a module that already uses
   * the space (WATCH, HOLD, MEMORY, NAV).
   */
  variants?: ModuleVariant[];
  /** Reference paradigm(s) the module is modelled on. */
  paradigms?: string[];
  /** Accent hue override for the hub card (deg). Defaults to the domain accent. */
  hue?: number;
}

/* ------------------------------------------------------------------ *
 * Identity + session
 * ------------------------------------------------------------------ */

export interface Subject {
  id: string;
  /** Pseudonymous external identifier: HU-001572, A17-093, ATH-2211 ... */
  externalId: string;
  displayName?: string | null;
  domains: DomainCode[];
  createdAt: string;
}

export interface DeviceProfile {
  platform: PlatformMode;
  /** 'quest3' | 'quest2' | 'unknown-hmd' | 'desktop' | 'mobile' */
  deviceClass: string;
  browser: string;
  browserVersion: string;
  userAgent: string;
  xrSupported: boolean;
  immersiveVrSupported: boolean;
  /** WebXR needs a secure context; over plain HTTP it is absent entirely. */
  secureContext: boolean;
  /**
   * True when WebXR is missing ONLY because the page is not served over HTTPS.
   * A headset on an http:// URL is indistinguishable from a device with no VR
   * unless this is recorded, and the two have completely different fixes.
   */
  blockedByInsecureContext: boolean;
  handTracking: boolean;
  /** Refresh rate when detectable, else null. */
  refreshRate: number | null;
  screen: { width: number; height: number; dpr: number };
  inputMode: 'controller' | 'hands' | 'mouse' | 'touch' | 'keyboard' | 'mixed';
  locale: string;
  timezone: string;
}

export interface SessionInfo {
  id: string;
  subjectId: string | null;
  domain: DomainCode;
  device: DeviceProfile;
  startedAt: string;
  finishedAt?: string | null;
  /** Optional supervisor-created batch, e.g. "ALPHA-4". */
  groupCode?: string | null;
}

/* ------------------------------------------------------------------ *
 * Runs / trials / events
 * ------------------------------------------------------------------ */

export interface RunHeader {
  id: string;
  sessionId: string;
  subjectId: string | null;
  domain: DomainCode;
  moduleCode: string;
  moduleVersion: string;
  configVersion: string;
  /** 'A' or 'B' for modules that have variants; undefined for single-form ones. */
  variant?: VariantId;
  mode: RunMode;
  seed: number;
  device: DeviceProfile;
  startedAt: string;
  /** Set on the client for multiuser runs so team members can be joined up later. */
  teamId?: string | null;
  teamRole?: string | null;
}

export type TrialOutcome = 'hit' | 'miss' | 'false_alarm' | 'correct_reject' | 'timeout' | 'invalid';

export interface TrialRecord {
  trialNumber: number;
  /** Sub-task inside a module, e.g. "simple" | "choice" | "point" | "track" | "twohand". */
  block: string;
  stimulus: Record<string, unknown>;
  response: Record<string, unknown> | null;
  correct: boolean | null;
  outcome: TrialOutcome;
  /** Milliseconds from stimulus onset to response. Null when no response. */
  reactionTimeMs: number | null;
  startedAt: number;
  endedAt: number;
}

export interface EventRecord {
  /** Milliseconds since run start, monotonic (performance.now based). */
  t: number;
  trialNumber: number | null;
  type: string;
  payload?: Record<string, unknown>;
}

/** Compact motion sample. Arrays keep the payload small at 10-30 Hz. */
export interface MotionSample {
  t: number;
  /** head: [px,py,pz, qx,qy,qz,qw] */
  head: number[];
  /** left controller, same layout, empty when absent */
  left: number[];
  right: number[];
}

export interface MetricRecord {
  name: string;
  value: number;
  unit: string;
  /** Optional sub-scope, e.g. block name. */
  scope?: string;
}

export interface ScoreRecord {
  type: string;
  value: number;
  scoringVersion: string;
}

export interface RunPayload {
  header: RunHeader;
  finishedAt: string;
  status: 'completed' | 'aborted' | 'error';
  trials: TrialRecord[];
  events: EventRecord[];
  motion: MotionSample[];
  metrics: MetricRecord[];
  scores: ScoreRecord[];
  /** 0-1000 headline gamification score. */
  opsScore: number;
  /** Free-form module summary shown on the result screen. */
  summary: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Results / reporting
 * ------------------------------------------------------------------ */

export interface RunSummary {
  id: string;
  moduleCode: string;
  moduleVersion: string;
  configVersion?: string;
  variant?: VariantId;
  domain: DomainCode;
  mode: RunMode;
  opsScore: number;
  finishedAt: string;
  headline: { label: string; value: string }[];
}

export interface ProfileAxis {
  /** Construct group, e.g. "reaction", "attention". */
  key: string;
  label: string;
  /** 0-100 normalised, null when never measured. */
  value: number | null;
  /** Which modules contributed. */
  sources: string[];
}

export interface SubjectProfile {
  subject: Subject;
  runs: RunSummary[];
  axes: ProfileAxis[];
  personalBests: Record<string, number>;
}

export interface LeaderboardRow {
  rank: number;
  externalId: string;
  opsScore: number;
  finishedAt: string;
  isSelf?: boolean;
}

/* ------------------------------------------------------------------ *
 * Multiuser (COMMAND)
 * ------------------------------------------------------------------ */

export type CommandRole = 'member' | 'commander';

export interface TeamMemberInfo {
  playerId: string;
  externalId: string;
  seat: number;
  role: CommandRole;
  connected: boolean;
  isBot: boolean;
  ready: boolean;
}
