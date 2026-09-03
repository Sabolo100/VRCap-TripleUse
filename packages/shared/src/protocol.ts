import type { CommandScenario, Fact, Assignment, PlanOutcome } from './command.js';
import type { StructureScenario, Inventory, InventoryOutcome } from './commandStructure.js';
import type { CommandRole, DomainCode, TeamMemberInfo, VariantId } from './types.js';

/**
 * Realtime protocol for COMMAND (module 10).
 * One WebSocket, JSON frames, room-scoped. The server is authoritative for
 * phase, scenario truth and scoring; clients never see other players' facts
 * until they are explicitly shared.
 */

export const WS_PATH = '/ws/command';

export type CommandPhase =
  | 'lobby'
  | 'briefing'
  | 'roundA'
  | 'interlude'
  | 'roundB'
  | 'debrief';

export const PHASE_ORDER: CommandPhase[] = [
  'lobby', 'briefing', 'roundA', 'interlude', 'roundB', 'debrief',
];

export interface RoomConfig {
  domain: DomainCode;
  /**
   * 'A' is the logistics board with text-card asymmetry; 'B' is the shared
   * structure, where the asymmetry comes from where each person is standing.
   */
  variant: VariantId;
  /** seconds */
  briefingSeconds: number;
  roundSeconds: number;
  interludeSeconds: number;
  /** Server-driven teammates so the module is testable with one human. */
  botCount: number;
  /** How chatty / how fast bots share what they know. */
  botStyle: 'cooperative' | 'reticent' | 'mixed';
  seed: number;
}

export const DEFAULT_ROOM_CONFIG: Omit<RoomConfig, 'domain' | 'seed' | 'variant'> = {
  briefingSeconds: 45,
  roundSeconds: 300,
  interludeSeconds: 30,
  botCount: 2,
  botStyle: 'mixed',
};

/* ---------------------------- client -> server --------------------- */

export type ClientMessage =
  | { t: 'create'; externalId: string; displayName?: string; domain: DomainCode; config?: Partial<RoomConfig> }
  | { t: 'join'; room: string; externalId: string; displayName?: string; domain: DomainCode }
  | { t: 'leave' }
  | { t: 'ready'; value: boolean }
  | { t: 'start' }
  | { t: 'chat'; text: string }
  | { t: 'shareFact'; factId: string }
  | { t: 'assign'; unitId: string; taskId: string | null }
  | { t: 'propose'; unitId: string; taskId: string | null; note?: string }
  | { t: 'commit' }
  | { t: 'inventory'; counts: Inventory }
  | { t: 'ping'; x: number; z: number }
  | { t: 'pose'; head: number[]; left: number[]; right: number[] }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'heartbeat' };

/* ---------------------------- server -> client --------------------- */

export interface ChatEntry {
  id: string;
  from: string;          // playerId
  fromLabel: string;     // external id / seat label
  seat: number;
  text: string;
  /** ms since room start */
  t: number;
  kind: 'chat' | 'fact' | 'system' | 'proposal';
}

export interface ProposalEntry {
  id: string;
  from: string;
  fromLabel: string;
  seat: number;
  unitId: string;
  taskId: string | null;
  note?: string;
  t: number;
  /** Set once the committed plan contains this pairing. */
  adopted?: boolean;
}

export interface PlayerScore {
  playerId: string;
  externalId: string;
  seat: number;
  role: CommandRole;
  isBot: boolean;
  metrics: Record<string, number>;
  /** 0-1000 */
  opsScore: number;
}

export interface RoundResult {
  round: 'A' | 'B';
  /** Variant A only. */
  outcome: PlanOutcome;
  /** Variant B only: how close the team's count came to the truth. */
  structureOutcome?: InventoryOutcome;
  submittedInventory?: Inventory;
  trueInventory?: Inventory;
  /** The error the single best-placed seat would have made alone. */
  bestSingleSeatError?: number;
  assignment: Assignment;
  timeToCommitMs: number;
  infoCoverage: number;
  revisions: number;
  players: PlayerScore[];
}

export type ServerMessage =
  | { t: 'error'; message: string; fatal?: boolean }
  | {
      t: 'room';
      room: string;
      hostId: string;
      phase: CommandPhase;
      config: RoomConfig;
      members: TeamMemberInfo[];
      /** epoch ms when the current phase ends, null in lobby/debrief */
      phaseEndsAt: number | null;
      round: 'A' | 'B' | null;
    }
  | {
      t: 'you';
      playerId: string;
      seat: number;
      role: CommandRole;
      /** Only this player's private corrections. */
      facts: Fact[];
      sharedFactIds: string[];
    }
  | { t: 'scenario'; scenario: Omit<CommandScenario, 'facts'> }
  /** Variant B. `visibleBlockIds` is what THIS seat can see - never the rest. */
  | {
      t: 'structure';
      scenario: Omit<StructureScenario, 'visibility' | 'exclusive' | 'privileged' | 'trueInventory' | 'invisible'>;
      yourSeat: number;
      visibleBlockIds: number[];
      privilegedCount: number;
    }
  | { t: 'inventory'; counts: Inventory; byPlayerId: string | null; revision: number }
  | { t: 'chat'; entry: ChatEntry }
  | { t: 'proposal'; entry: ProposalEntry }
  | { t: 'plan'; assignment: Assignment; revision: number; byPlayerId: string | null }
  | { t: 'ping'; from: string; seat: number; x: number; z: number }
  | { t: 'pose'; playerId: string; head: number[]; left: number[]; right: number[] }
  | { t: 'infoUpdate'; text: string }
  | { t: 'roundResult'; result: RoundResult }
  | { t: 'final'; rounds: RoundResult[]; teamScore: number }
  | { t: 'rtc'; from: string; data: unknown };

/* ---------------------------- helpers ------------------------------ */

export const SEAT_COLORS = ['#ff9e1b', '#4fc3f7', '#c6ff3d', '#ff2e93', '#a78bfa'];

/**
 * Variant B's phrase set is deliberately split between egocentric and
 * allocentric wording. Which one a participant reaches for is itself a
 * measure: teams that establish a shared, structure-centred frame of
 * reference count more accurately than teams that each describe the world
 * from their own side.
 */
export const STRUCTURE_PHRASES: { key: string; text: string; frame: 'egocentric' | 'allocentric' | 'neutral' }[] = [
  { key: 's_mine', text: 'Az én oldalamról ennyit látok.', frame: 'egocentric' },
  { key: 's_hidden', text: 'Nálam takarásban van valami.', frame: 'egocentric' },
  { key: 's_left', text: 'Tőlem balra van egy, amit ti nem láttok.', frame: 'egocentric' },
  { key: 's_top', text: 'A szerkezet TETEJÉN van egy.', frame: 'allocentric' },
  { key: 's_bottom', text: 'A szerkezet ALJÁN van egy.', frame: 'allocentric' },
  { key: 's_middle', text: 'A KÖZÉPSŐ csomóban számoljunk.', frame: 'allocentric' },
  { key: 's_double', text: 'Vigyázzunk, ezt ketten is látjuk — egyszer számoljuk.', frame: 'neutral' },
  { key: 's_ready', text: 'Nálam megvan minden, mehet az összeadás.', frame: 'neutral' },
];

export const QUICK_PHRASES: { key: string; text: string }[] = [
  { key: 'q_info', text: 'Mit tudsz, amit mi nem?' },
  { key: 'q_who', text: 'Ki vállalja a döntést?' },
  { key: 'i_have', text: 'Van egy infóm, ami módosítja a táblát.' },
  { key: 'agree', text: 'Egyetértek, menjünk ezzel.' },
  { key: 'disagree', text: 'Ez így nem fog összejönni.' },
  { key: 'check_time', text: 'Kevés az idő, zárjuk le.' },
  { key: 'propose_lead', text: 'Javaslom, hogy én vigyem a tervet.' },
  { key: 'ask_check', text: 'Valaki ellenőrizze az útvonalköltségeket.' },
];

export function seatLabel(seat: number): string {
  return String.fromCharCode(65 + seat); // A, B, C, D, E
}
