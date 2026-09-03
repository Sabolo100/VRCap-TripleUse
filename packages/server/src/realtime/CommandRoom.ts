import { randomUUID } from 'node:crypto';
import {
  generateScenario, scorePlan, publicScenario, boardOnlyPlan, optimalPlan,
  generateStructure, scoreInventory, visibleInventory, bestSingleSeat, rarityWeight,
  BLOCK_COLORS, STRUCTURE_PHRASES,
  DEFAULT_ROOM_CONFIG, SEAT_COLORS, seatLabel, QUICK_PHRASES, opsScore, clamp, mean,
  type CommandScenario, type Fact, type Assignment, type RoomConfig, type CommandPhase,
  type ServerMessage, type ChatEntry, type ProposalEntry, type RoundResult, type PlayerScore,
  type TeamMemberInfo, type DomainCode, type CommandRole,
  type StructureScenario, type Inventory, type BlockColor, type VariantId,
} from '@vrcap/shared';

/**
 * COMMAND room - server side.
 *
 * Authoritative for: phase timing, the hidden facts, which facts have actually
 * been shared, the committed plan, and scoring. A client can never see another
 * participant's private corrections until that participant presses "share",
 * which is what makes the information-sharing metric trustworthy.
 *
 * Bots exist so that the module is usable and testable with one human. They
 * hold real facts, share them on a delay, react to being asked, and make
 * proposals. They are labelled as bots everywhere - a run recorded against
 * bot teammates is marked as such and must not be pooled with all-human runs.
 */

export interface Player {
  id: string;
  externalId: string;
  seat: number;
  role: CommandRole;
  isBot: boolean;
  ready: boolean;
  connected: boolean;
  send: (msg: ServerMessage) => void;
  /** Facts this seat holds. */
  facts: Fact[];
  sharedFactIds: Set<string>;
  /** Per-round behavioural counters. */
  stats: PlayerStats;
  lastSeen: number;
  /** Bot personality. */
  bot?: BotBrain;
}

interface PlayerStats {
  messages: number;
  chars: number;
  questions: number;
  proposals: number;
  proposalsAdopted: number;
  assignments: number;
  factsShared: number;
  firstShareAt: number | null;
  firstMessageAt: number | null;
  readyAt: number | null;
  repliesToQuestions: number;
  overrides: number;
  /** Assignments made after the mid-round information update. */
  actionsAfterUpdate: number;
  /** Variant B: inventory edits this player made. */
  inventoryEdits: number;
  /** Variant B: egocentric vs allocentric spatial phrasing. */
  egocentricPhrases: number;
  allocentricPhrases: number;
}

function emptyStats(): PlayerStats {
  return {
    messages: 0, chars: 0, questions: 0, proposals: 0, proposalsAdopted: 0,
    assignments: 0, factsShared: 0, firstShareAt: null, firstMessageAt: null,
    readyAt: null, repliesToQuestions: 0, overrides: 0, actionsAfterUpdate: 0,
    inventoryEdits: 0, egocentricPhrases: 0, allocentricPhrases: 0,
  };
}

interface BotBrain {
  /** 0..1 - how eagerly it volunteers what it knows. */
  openness: number;
  /** ms after round start before it starts contributing. */
  latency: number;
  /** Whether it tends to propose or to follow. */
  assertiveness: number;
  sharedIndex: number;
  nextActionAt: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class CommandRoom {
  readonly code: string;
  readonly id = randomUUID();
  readonly domain: DomainCode;
  config: RoomConfig;
  phase: CommandPhase = 'lobby';
  round: 'A' | 'B' | null = null;
  hostId: string | null = null;

  private players = new Map<string, Player>();
  private scenario: CommandScenario;
  /** Variant B only. */
  private structure: StructureScenario | null = null;
  private inventory: Inventory = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 };
  private inventoryRevision = 0;
  private lastInventoryBy: string | null = null;
  private assignment: Assignment = {};
  private planRevision = 0;
  private chat: ChatEntry[] = [];
  private proposals: ProposalEntry[] = [];
  private results: RoundResult[] = [];
  private phaseEndsAt: number | null = null;
  private roundStartedAt = 0;
  private roomStartedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private infoUpdateSent = false;
  private infoUpdateAt = 0;
  private closed = false;
  private onFinished: ((room: CommandRoom) => void) | null = null;
  /** Transcript for persistence. */
  transcript: { round: string | null; seat: number; externalId: string; isBot: boolean; kind: string; text: string; t: number }[] = [];

  constructor(domain: DomainCode, config?: Partial<RoomConfig>) {
    this.domain = domain;
    this.code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.config = { ...DEFAULT_ROOM_CONFIG, variant: 'A', ...config, domain, seed };
    // Generate for the maximum table so seats added later still hold facts.
    this.scenario = generateScenario(seed, 5);
    if (this.config.variant === 'B') this.structure = generateStructure(seed, 5);
  }

  get variant(): VariantId {
    return this.config.variant;
  }

  onFinish(cb: (room: CommandRoom) => void): void {
    this.onFinished = cb;
  }

  /* ------------------------------------------------------------ join */

  addPlayer(externalId: string, send: (m: ServerMessage) => void): Player {
    // Reconnecting with the same identifier reclaims the seat, so a dropped
    // socket mid-round does not cost the team a participant.
    const existing = [...this.players.values()].find((p) => p.externalId === externalId && !p.isBot);
    if (existing) {
      existing.send = send;
      existing.connected = true;
      existing.lastSeen = Date.now();
      this.pushAll();
      this.pushYou(existing);
      this.pushScenario(existing);
      this.replay(existing);
      return existing;
    }

    const seat = this.nextSeat();
    const player: Player = {
      id: randomUUID(),
      externalId,
      seat,
      role: 'member',
      isBot: false,
      ready: false,
      connected: true,
      send,
      facts: this.scenario.facts.filter((f) => f.seat === seat),
      sharedFactIds: new Set(),
      stats: emptyStats(),
      lastSeen: Date.now(),
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;

    this.pushAll();
    this.pushYou(player);
    this.pushScenario(player);
    this.replay(player);
    this.system(`${seatLabel(seat)} csatlakozott.`);
    return player;
  }

  addBot(): Player {
    const seat = this.nextSeat();
    const style = this.config.botStyle;
    const openness = style === 'cooperative' ? 0.9 : style === 'reticent' ? 0.35 : 0.4 + Math.random() * 0.5;
    const bot: Player = {
      id: randomUUID(),
      externalId: `AI-${seatLabel(seat)}`,
      seat,
      role: 'member',
      isBot: true,
      ready: true,
      connected: true,
      send: () => {},
      facts: this.scenario.facts.filter((f) => f.seat === seat),
      sharedFactIds: new Set(),
      stats: emptyStats(),
      lastSeen: Date.now(),
      bot: {
        openness,
        latency: 6000 + Math.random() * 14000,
        assertiveness: 0.25 + Math.random() * 0.6,
        sharedIndex: 0,
        nextActionAt: 0,
      },
    };
    this.players.set(bot.id, bot);
    this.pushAll();
    return bot;
  }

  private nextSeat(): number {
    const taken = new Set([...this.players.values()].map((p) => p.seat));
    for (let i = 0; i < 5; i++) if (!taken.has(i)) return i;
    return this.players.size;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.lastSeen = Date.now();
    // The seat is kept during a live round so a reconnect can resume it.
    if (this.phase === 'lobby') {
      this.players.delete(id);
      if (this.hostId === id) this.hostId = [...this.players.values()].find((x) => !x.isBot)?.id ?? null;
    } else {
      this.system(`${seatLabel(p.seat)} kapcsolata megszakadt.`);
    }
    this.pushAll();
  }

  get humanCount(): number {
    return [...this.players.values()].filter((p) => !p.isBot).length;
  }

  get isEmpty(): boolean {
    return [...this.players.values()].every((p) => p.isBot || !p.connected);
  }

  /* --------------------------------------------------------- lifecycle */

  start(byPlayerId: string): void {
    if (this.phase !== 'lobby') return;
    if (byPlayerId !== this.hostId) return;
    const live = [...this.players.values()];
    if (live.length < 2) {
      this.players.get(byPlayerId)?.send({ t: 'error', message: 'Legalább két résztvevő kell (AI társ is számít).' });
      return;
    }
    this.roomStartedAt = Date.now();
    this.setPhase('briefing', this.config.briefingSeconds * 1000);
  }

  private setPhase(phase: CommandPhase, durationMs: number | null): void {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
    if (this.timer) clearTimeout(this.timer);

    if (phase === 'roundA' || phase === 'roundB') {
      this.round = phase === 'roundA' ? 'A' : 'B';
      this.assignment = {};
      this.planRevision = 0;
      this.proposals = [];
      this.infoUpdateSent = false;
      this.roundStartedAt = Date.now();
      this.inventory = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 };
      this.inventoryRevision = 0;
      this.lastInventoryBy = null;
      // Round B re-seats everyone, so what each person can see changes and the
      // team cannot simply repeat round A's answer from memory.
      if (this.config.variant === 'B' && this.structure && phase === 'roundB') {
        this.structure = generateStructure((this.config.seed ^ 0x5bf03635) >>> 0, 5);
        for (const p of this.players.values()) if (!p.isBot) this.pushScenario(p);
      }
      for (const p of this.players.values()) {
        p.ready = false;
        p.stats = emptyStats();
        p.sharedFactIds = new Set();
        if (p.bot) { p.bot.sharedIndex = 0; p.bot.nextActionAt = Date.now() + p.bot.latency; }
      }
      // Round B appoints a commander: whoever the team listened to most in
      // round A, which makes the appointment a consequence of observed
      // behaviour rather than an arbitrary pick.
      if (phase === 'roundB') this.appointCommander();
      this.system(
        phase === 'roundA'
          ? '1. KÖR indul. Nincs kijelölt vezető. Osszátok meg, amit tudtok.'
          : `2. KÖR indul. Parancsnok: ${seatLabel(this.commander()?.seat ?? 0)}.`
      );
    }

    if (phase === 'debrief') {
      this.round = null;
      this.onFinished?.(this);
    }

    this.pushAll();

    if (durationMs) {
      this.timer = setTimeout(() => this.onPhaseTimeout(), durationMs);
    }
    if (phase === 'roundA' || phase === 'roundB' || phase === 'briefing') {
      this.tickBots();
    }
  }

  private onPhaseTimeout(): void {
    if (this.closed) return;
    switch (this.phase) {
      case 'briefing':
        this.setPhase('roundA', this.config.roundSeconds * 1000);
        break;
      case 'roundA':
        this.system('Lejárt az idő — a terv jelenlegi állapota kerül kiértékelésre.');
        this.finishRound('A');
        break;
      case 'interlude':
        this.setPhase('roundB', this.config.roundSeconds * 1000);
        break;
      case 'roundB':
        this.system('Lejárt az idő — a terv jelenlegi állapota kerül kiértékelésre.');
        this.finishRound('B');
        break;
      default:
        break;
    }
  }

  private appointCommander(): void {
    const roundA = this.results.find((r) => r.round === 'A');
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of this.players.values()) {
      const m = roundA?.players.find((x) => x.playerId === p.id)?.metrics;
      // Prefer a human, then whoever showed the most leadership behaviour.
      const score = (m?.leadership_index ?? 0) + (p.isBot ? -1 : 0.35);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    for (const p of this.players.values()) p.role = p === best ? 'commander' : 'member';
  }

  private commander(): Player | undefined {
    return [...this.players.values()].find((p) => p.role === 'commander');
  }

  /* ------------------------------------------------------------ actions */

  setReady(id: string, value: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.ready = value;
    if (value && p.stats.readyAt === null) p.stats.readyAt = this.t();
    this.pushAll();
    this.maybeAutoCommit();
  }

  chatMessage(id: string, text: string, kind: ChatEntry['kind'] = 'chat'): void {
    const p = this.players.get(id);
    if (!p) return;
    const clean = text.slice(0, 240).trim();
    if (!clean) return;
    const entry: ChatEntry = {
      id: randomUUID(),
      from: p.id,
      fromLabel: p.externalId,
      seat: p.seat,
      text: clean,
      t: this.t(),
      kind,
    };
    this.chat.push(entry);
    if (this.chat.length > 300) this.chat.shift();
    this.transcript.push({ round: this.round, seat: p.seat, externalId: p.externalId, isBot: p.isBot, kind, text: clean, t: entry.t });

    if (this.config.variant === 'B') {
      const phrase = STRUCTURE_PHRASES.find((x) => x.text === clean);
      if (phrase?.frame === 'egocentric') p.stats.egocentricPhrases++;
      if (phrase?.frame === 'allocentric') p.stats.allocentricPhrases++;
    }
    if (kind === 'chat' || kind === 'fact') {
      p.stats.messages++;
      p.stats.chars += clean.length;
      if (p.stats.firstMessageAt === null) p.stats.firstMessageAt = entry.t;
      if (/\?|mit tudsz|ki vállalja|valaki/i.test(clean)) p.stats.questions++;
      // A message shortly after someone else asked a question counts as a reply.
      const lastOther = [...this.chat].reverse().find((c) => c.from !== p.id && c.kind === 'chat');
      if (lastOther && /\?/.test(lastOther.text) && entry.t - lastOther.t < 25000) p.stats.repliesToQuestions++;
    }
    this.broadcast({ t: 'chat', entry });
  }

  private system(text: string): void {
    const entry: ChatEntry = {
      id: randomUUID(), from: 'system', fromLabel: 'SYSTEM', seat: -1, text, t: this.t(), kind: 'system',
    };
    this.chat.push(entry);
    this.transcript.push({ round: this.round, seat: -1, externalId: 'SYSTEM', isBot: false, kind: 'system', text, t: entry.t });
    this.broadcast({ t: 'chat', entry });
  }

  shareFact(id: string, factId: string): void {
    const p = this.players.get(id);
    if (!p) return;
    const fact = p.facts.find((f) => f.id === factId);
    if (!fact || p.sharedFactIds.has(factId)) return;
    p.sharedFactIds.add(factId);
    p.stats.factsShared++;
    if (p.stats.firstShareAt === null) p.stats.firstShareAt = this.t();
    this.chatMessage(id, fact.text, 'fact');
    this.pushYou(p);
  }

  assign(id: string, unitId: string, taskId: string | null): void {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase !== 'roundA' && this.phase !== 'roundB') return;
    if (this.phase === 'roundB' && p.role !== 'commander') {
      // Non-commanders cannot edit the plan directly; the client should have
      // sent a proposal, but the server enforces it regardless.
      this.propose(id, unitId, taskId);
      return;
    }
    if (!this.scenario.units.some((u) => u.id === unitId)) return;
    if (taskId && !this.scenario.tasks.some((t) => t.id === taskId)) return;

    const previous = this.assignment[unitId] ?? null;
    if (previous === taskId) return;
    // Overwriting someone else's recent assignment is a coordination signal.
    if (previous && this.lastAssignedBy[unitId] && this.lastAssignedBy[unitId] !== p.id) p.stats.overrides++;

    this.assignment[unitId] = taskId;
    this.lastAssignedBy[unitId] = p.id;
    this.planRevision++;
    p.stats.assignments++;
    if (this.infoUpdateSent) p.stats.actionsAfterUpdate++;

    // Adopting someone's proposal is the clearest measure of influence.
    for (const prop of this.proposals) {
      if (prop.unitId === unitId && prop.taskId === taskId && !prop.adopted && prop.from !== p.id) {
        prop.adopted = true;
        const proposer = this.players.get(prop.from);
        if (proposer) proposer.stats.proposalsAdopted++;
        this.broadcast({ t: 'proposal', entry: prop });
      }
    }

    // Changing the plan invalidates everyone's ready state.
    for (const other of this.players.values()) if (!other.isBot) other.ready = false;

    this.broadcast({ t: 'plan', assignment: { ...this.assignment }, revision: this.planRevision, byPlayerId: p.id });
    this.pushAll();
  }

  private lastAssignedBy: Record<string, string> = {};

  /** Variant B: the team's shared count, editable by anyone in round A and by
   *  the commander in round B. */
  setInventory(id: string, counts: Inventory): void {
    const p = this.players.get(id);
    if (!p || this.config.variant !== 'B') return;
    if (this.phase !== 'roundA' && this.phase !== 'roundB') return;
    if (this.phase === 'roundB' && p.role !== 'commander') {
      p.send({ t: 'error', message: 'Ebben a körben a parancsnok vezeti a leltárt.' });
      return;
    }
    const next: Inventory = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 };
    for (const c of BLOCK_COLORS) next[c] = Math.max(0, Math.min(60, Math.round(counts[c] ?? 0)));
    const changed = BLOCK_COLORS.some((c) => next[c] !== this.inventory[c]);
    if (!changed) return;

    this.inventory = next;
    this.inventoryRevision++;
    this.lastInventoryBy = p.id;
    p.stats.inventoryEdits++;
    if (this.infoUpdateSent) p.stats.actionsAfterUpdate++;
    // Any change invalidates readiness: nobody has agreed to the new numbers.
    for (const other of this.players.values()) if (!other.isBot) other.ready = false;
    this.broadcast({ t: 'inventory', counts: next, byPlayerId: p.id, revision: this.inventoryRevision });
    this.pushAll();
  }

  propose(id: string, unitId: string, taskId: string | null, note?: string): void {
    const p = this.players.get(id);
    if (!p) return;
    const entry: ProposalEntry = {
      id: randomUUID(), from: p.id, fromLabel: p.externalId, seat: p.seat, unitId, taskId, note, t: this.t(),
    };
    this.proposals.push(entry);
    p.stats.proposals++;
    if (this.infoUpdateSent) p.stats.actionsAfterUpdate++;
    this.broadcast({ t: 'proposal', entry });
    this.chatMessage(id, `Javaslat: ${unitId} → ${taskId ?? 'nincs'}${note ? ` (${note})` : ''}`, 'proposal');
  }

  ping(id: string, x: number, z: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.broadcast({ t: 'ping', from: p.id, seat: p.seat, x, z }, p.id);
  }

  pose(id: string, head: number[], left: number[], right: number[]): void {
    const p = this.players.get(id);
    if (!p) return;
    this.broadcast({ t: 'pose', playerId: p.id, head, left, right }, p.id);
  }

  relayRtc(fromId: string, toId: string, data: unknown): void {
    const target = this.players.get(toId);
    target?.send({ t: 'rtc', from: fromId, data });
  }

  commit(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase !== 'roundA' && this.phase !== 'roundB') return;

    if (this.phase === 'roundB' && p.role !== 'commander') {
      p.send({ t: 'error', message: 'Ebben a körben a parancsnok zárja le a tervet.' });
      return;
    }
    if (this.config.variant === 'B') {
      const anyCount = BLOCK_COLORS.some((c) => this.inventory[c] > 0);
      if (!anyCount) {
        p.send({ t: 'error', message: 'Előbb írjátok be a leltárt.' });
        return;
      }
    }
    if (this.phase === 'roundA') {
      // Leaderless: pressing commit marks you ready; the plan closes when
      // every connected human is ready.
      p.ready = true;
      if (p.stats.readyAt === null) p.stats.readyAt = this.t();
      this.pushAll();
      if (!this.everyoneReady()) {
        this.system(`${seatLabel(p.seat)} lezárásra szavazott. Mindenki készre jelentkezése szükséges.`);
        return;
      }
    }
    this.finishRound(this.phase === 'roundA' ? 'A' : 'B');
  }

  private everyoneReady(): boolean {
    const humans = [...this.players.values()].filter((p) => !p.isBot && p.connected);
    return humans.length > 0 && humans.every((p) => p.ready);
  }

  private maybeAutoCommit(): void {
    if (this.phase !== 'roundA' || !this.everyoneReady()) return;
    const hasAnswer = this.config.variant === 'B'
      ? BLOCK_COLORS.some((c) => this.inventory[c] > 0)
      : Object.values(this.assignment).some(Boolean);
    if (hasAnswer) this.finishRound('A');
  }

  /* ------------------------------------------------------------ scoring */

  private finishRound(round: 'A' | 'B'): void {
    if (this.timer) clearTimeout(this.timer);
    const timeToCommitMs = Date.now() - this.roundStartedAt;

    if (this.config.variant === 'B' && this.structure) {
      this.finishStructureRound(round, timeToCommitMs);
      return;
    }

    const outcome = scorePlan(this.scenario, this.assignment);
    const totalFacts = this.scenario.facts.filter((f) => this.seatIsLive(f.seat)).length;
    const sharedFacts = [...this.players.values()].reduce((a, p) => a + p.sharedFactIds.size, 0);
    const infoCoverage = totalFacts > 0 ? sharedFacts / totalFacts : 0;

    const players = [...this.players.values()].map((p) => this.scorePlayer(p, outcome.optimality, infoCoverage, round));

    const result: RoundResult = {
      round,
      outcome,
      assignment: { ...this.assignment },
      timeToCommitMs,
      infoCoverage,
      revisions: this.planRevision,
      players,
    };
    this.results = [...this.results.filter((r) => r.round !== round), result];
    this.broadcast({ t: 'roundResult', result });

    const board = boardOnlyPlan(this.scenario).achievedValue;
    this.system(
      `${round === 'A' ? 1 : 2}. kör kész. Elért érték: ${outcome.achievedValue} / ${outcome.optimalValue}. ` +
        `Megosztás nélkül ${board} lett volna. Megosztott információ: ${Math.round(infoCoverage * 100)}%.`
    );

    if (round === 'A') {
      this.setPhase('interlude', this.config.interludeSeconds * 1000);
    } else {
      const teamScore = Math.round(mean(this.results.map((r) => r.outcome.optimality)) * 1000);
      this.broadcast({ t: 'final', rounds: this.results, teamScore });
      this.setPhase('debrief', null);
    }
  }

  /**
   * Variant B scoring.
   *
   * The team's count is compared with the truth, and - the informative part -
   * with what the single best-placed seat could have managed alone. Over- and
   * under-counting are reported separately because they are different
   * failures: over-counting means the same block was reported twice without
   * anyone noticing, under-counting means someone's view never made it in.
   */
  private finishStructureRound(round: 'A' | 'B', timeToCommitMs: number): void {
    const sc = this.structure!;
    const outcome = scoreInventory(sc.trueInventory, this.inventory);
    const alone = bestSingleSeat(sc);

    // Information coverage here is perceptual: of all the privileged blocks in
    // the structure, how much of that rare view the team's count accounts for.
    const totalRarity = sc.blocks.reduce((a, b) => a + rarityWeight(sc, b.id), 0);
    const recovered = Math.max(0, totalRarity - outcome.totalAbsError);
    const infoCoverage = totalRarity > 0 ? clamp(recovered / totalRarity, 0, 1) : 0;

    // Optimality on the same 0..1 scale the variant-A result uses, so the two
    // rounds and the two variants render through the same UI - while staying
    // in separate norm groups.
    const worst = Math.max(1, alone.outcome.totalAbsError * 2);
    const optimality = clamp(1 - outcome.totalAbsError / worst, 0, 1);

    const players = [...this.players.values()].map((p) => this.scorePlayer(p, optimality, infoCoverage, round));

    const result: RoundResult = {
      round,
      outcome: { achievedValue: 0, optimalValue: 0, optimality, detail: [] },
      structureOutcome: outcome,
      submittedInventory: { ...this.inventory },
      trueInventory: { ...sc.trueInventory },
      bestSingleSeatError: alone.outcome.totalAbsError,
      assignment: {},
      timeToCommitMs,
      infoCoverage,
      revisions: this.inventoryRevision,
      players,
    };
    this.results = [...this.results.filter((r) => r.round !== round), result];
    this.broadcast({ t: 'roundResult', result });

    this.system(
      `${round === 'A' ? 1 : 2}. kör kész. Leltár eltérése: ${outcome.totalAbsError} (túlszámolás ${outcome.overCount}, ` +
        `kimaradt ${outcome.underCount}). Egyedül a legjobb helyről ${alone.outcome.totalAbsError} lett volna.`
    );

    if (round === 'A') {
      this.setPhase('interlude', this.config.interludeSeconds * 1000);
    } else {
      const teamScore = Math.round(mean(this.results.map((r) => r.outcome.optimality)) * 1000);
      this.broadcast({ t: 'final', rounds: this.results, teamScore });
      this.setPhase('debrief', null);
    }
  }

  private seatIsLive(seat: number): boolean {
    return [...this.players.values()].some((p) => p.seat === seat);
  }

  /**
   * Individual scoring inside a team task.
   *
   * The team outcome is shared, but three things separate participants:
   * how much of their private knowledge they put on the table, whether the
   * team acted on what they said, and whether they moved the plan forward
   * rather than only reacting. Talk volume deliberately does not score by
   * itself - talking a lot is not leadership, and rewarding it would teach
   * exactly the wrong behaviour.
   */
  private scorePlayer(p: Player, optimality: number, infoCoverage: number, round: 'A' | 'B'): PlayerScore {
    const s = p.stats;
    const heldFacts = p.facts.length;
    // In variant B there are no fact buttons: contributing means describing
    // your view, so messages carrying counts stand in for shared facts.
    const shareRate = this.config.variant === 'B'
      ? clamp(s.messages / 4, 0, 1)
      : (heldFacts > 0 ? s.factsShared / heldFacts : 1);
    const allMessages = [...this.players.values()].reduce((a, x) => a + x.stats.messages, 0);
    const talkShare = allMessages > 0 ? s.messages / allMessages : 0;
    const proposalAdoption = s.proposals > 0 ? s.proposalsAdopted / s.proposals : 0;
    const roundMs = Math.max(1, Date.now() - this.roundStartedAt);
    const firstShareMs = s.firstShareAt ?? roundMs;

    // Leadership: initiative that the team actually followed, plus a bonus for
    // asking questions (which surfaces other people's information) and a
    // penalty for overriding teammates without their proposals being adopted.
    const leadership = clamp(
      0.34 * proposalAdoption +
        0.24 * Math.min(1, s.assignments / 4) +
        0.16 * Math.min(1, s.questions / 3) +
        0.16 * shareRate +
        0.10 * Math.min(1, s.repliesToQuestions / 3) -
        0.08 * Math.min(1, s.overrides / 3),
      0,
      1
    );

    const contribution = clamp(
      0.45 * shareRate + 0.3 * proposalAdoption + 0.25 * Math.min(1, (s.assignments + s.proposals) / 5),
      0,
      1
    );

    const promptness = clamp(1 - firstShareMs / Math.max(1, this.config.roundSeconds * 1000 * 0.6), 0, 1);

    const ops = opsScore([
      { key: 'team_outcome', value: optimality * 100, weight: 0.4 },
      { key: 'contribution', value: contribution * 100, weight: 0.3 },
      { key: 'leadership', value: leadership * 100, weight: 0.2 },
      { key: 'promptness', value: promptness * 100, weight: 0.1 },
    ]);

    const sc = this.structure;
    const structureMetrics: Record<string, number> = {};
    if (this.config.variant === 'B' && sc) {
      const privileged = sc.privileged[p.seat] ?? [];
      const visible = sc.blocks.filter((b) => sc.visibility[b.id]!.includes(p.seat));
      // How much of what this seat could see was rare, and how strongly this
      // seat was the one who had to speak for it.
      const privilegeWeight = privileged.reduce((a, id) => a + rarityWeight(sc, id), 0);
      structureMetrics.privileged_blocks = privileged.length;
      structureMetrics.privilege_weight = round2(privilegeWeight);
      structureMetrics.visible_blocks = visible.length;
      structureMetrics.view_share = round2(visible.length / Math.max(1, sc.blocks.length));
      structureMetrics.inventory_edits = s.inventoryEdits;
      const spatialPhrases = s.egocentricPhrases + s.allocentricPhrases;
      structureMetrics.allocentric_ratio = spatialPhrases > 0
        ? round2(s.allocentricPhrases / spatialPhrases) : 0;
      structureMetrics.spatial_phrases = spatialPhrases;
    }

    const metrics: Record<string, number> = {
      ...structureMetrics,
      information_sharing_rate: round2(shareRate),
      facts_held: heldFacts,
      facts_shared: s.factsShared,
      time_to_first_share_ms: s.firstShareAt ?? -1,
      messages_sent: s.messages,
      talk_share: round2(talkShare),
      questions_asked: s.questions,
      responsiveness: round2(s.repliesToQuestions / Math.max(1, s.messages)),
      proposals_made: s.proposals,
      proposals_adopted: s.proposalsAdopted,
      adoption_rate: round2(proposalAdoption),
      assignments_made: s.assignments,
      overrides: s.overrides,
      leadership_index: round2(leadership),
      contribution_index: round2(contribution),
      team_optimality: round2(optimality),
      team_info_coverage: round2(infoCoverage),
      ready_latency_ms: s.readyAt ?? -1,
    };
    if (round === 'B') {
      const window = Math.max(1, Date.now() - (this.infoUpdateAt || Date.now()));
      metrics.adaptation_after_update = round2(clamp(s.actionsAfterUpdate / 3, 0, 1));
      metrics.time_since_update_ms = window;
    }

    return { playerId: p.id, externalId: p.externalId, seat: p.seat, role: p.role, isBot: p.isBot, metrics, opsScore: ops };
  }

  /* --------------------------------------------------------------- bots */

  /**
   * Bot behaviour loop.
   *
   * Bots do three things a human does: share what they know, propose an
   * assignment, and answer when asked. They are intentionally imperfect - a
   * bot with low openness sits on its facts, which lets a single tester
   * experience the failure mode the exercise is designed to expose.
   */
  private tickBots(): void {
    const step = () => {
      if (this.closed) return;
      if (this.phase !== 'roundA' && this.phase !== 'roundB') {
        setTimeout(step, 1500);
        return;
      }
      const now = Date.now();
      if (this.config.variant === 'B') { this.tickStructureBots(now); setTimeout(step, 1200); return; }
      for (const p of this.players.values()) {
        if (!p.bot) continue;
        const b = p.bot;
        if (now < b.nextActionAt) continue;

        // Someone asked a question recently: answering takes priority.
        const recentQuestion = [...this.chat]
          .reverse()
          .find((c) => c.kind === 'chat' && c.from !== p.id && /\?/.test(c.text) && this.t() - c.t < 30000);

        if (recentQuestion && b.sharedIndex < p.facts.length && Math.random() < 0.85) {
          this.shareFact(p.id, p.facts[b.sharedIndex++]!.id);
          b.nextActionAt = now + 4000 + Math.random() * 7000;
          continue;
        }

        if (b.sharedIndex < p.facts.length && Math.random() < b.openness) {
          this.shareFact(p.id, p.facts[b.sharedIndex++]!.id);
          b.nextActionAt = now + 9000 + Math.random() * 16000;
          continue;
        }

        if (Math.random() < b.assertiveness * 0.5) {
          const suggestion = this.botSuggestion(p);
          if (suggestion) {
            if (this.phase === 'roundB' && p.role !== 'commander') {
              this.propose(p.id, suggestion.unitId, suggestion.taskId, 'ez alapján jobban jönne ki');
            } else if (this.phase === 'roundA') {
              this.assign(p.id, suggestion.unitId, suggestion.taskId);
            } else if (p.role === 'commander') {
              this.assign(p.id, suggestion.unitId, suggestion.taskId);
            }
            b.nextActionAt = now + 12000 + Math.random() * 18000;
            continue;
          }
        }

        if (Math.random() < 0.28) {
          const phrase = QUICK_PHRASES[Math.floor(Math.random() * QUICK_PHRASES.length)]!;
          this.chatMessage(p.id, phrase.text);
        }
        b.nextActionAt = now + 12000 + Math.random() * 20000;
      }

      // Round B mid-round information update: a route closes once a plan
      // already exists, so adaptation cost is measurable.
      if (this.phase === 'roundB' && !this.infoUpdateSent && now - this.roundStartedAt > this.config.roundSeconds * 400) {
        this.sendInfoUpdate();
      }

      // Commander bot closes the plan when time is running short.
      if (this.phaseEndsAt && this.phaseEndsAt - now < 20000) {
        const cmd = this.commander();
        if (cmd?.isBot && Object.values(this.assignment).some(Boolean)) this.commit(cmd.id);
      }

      setTimeout(step, 1200);
    };
    setTimeout(step, 1200);
  }

  /**
   * Variant B bots.
   *
   * A bot reports what its own seat can see, one colour at a time, and adds it
   * to the shared count. A cooperative bot reports everything it sees; a
   * reticent one sits on part of its view. Crucially the bot reports only
   * from its own viewpoint, so a single human plus bots still faces the real
   * problem: the counts have to be reconciled, and double-counting is possible.
   */
  private tickStructureBots(now: number): void {
    const sc = this.structure;
    if (!sc) return;

    for (const p of this.players.values()) {
      if (!p.bot) continue;
      const b = p.bot;
      if (now < b.nextActionAt) continue;

      const mine = visibleInventory(sc, p.seat);
      const colour = BLOCK_COLORS[b.sharedIndex % BLOCK_COLORS.length];
      if (!colour) continue;

      if (b.sharedIndex < BLOCK_COLORS.length && Math.random() < b.openness) {
        this.chatMessage(p.id, `Az én oldalamról ${mine[colour]} darab ${colour}.`);
        b.sharedIndex++;
        b.nextActionAt = now + 7000 + Math.random() * 12000;
        continue;
      }

      // Once it has reported, a bot may add its own view to the tally - which
      // is exactly how double counting happens if nobody is tracking overlap.
      if (b.sharedIndex >= BLOCK_COLORS.length && Math.random() < b.assertiveness * 0.4) {
        if (this.phase === 'roundA') {
          const next = { ...this.inventory };
          const c = BLOCK_COLORS[Math.floor(Math.random() * BLOCK_COLORS.length)]!;
          next[c] = Math.max(next[c], mine[c]);
          this.setInventory(p.id, next);
        }
        b.nextActionAt = now + 12000 + Math.random() * 16000;
        continue;
      }

      if (Math.random() < 0.25) {
        const phrase = STRUCTURE_PHRASES[Math.floor(Math.random() * STRUCTURE_PHRASES.length)]!;
        this.chatMessage(p.id, phrase.text);
      }
      b.nextActionAt = now + 11000 + Math.random() * 18000;
    }

    if (this.phaseEndsAt && this.phaseEndsAt - now < 20000) {
      const cmd = this.commander();
      if (cmd?.isBot && BLOCK_COLORS.some((c) => this.inventory[c] > 0)) this.commit(cmd.id);
    }
  }

  /** Best single change the bot can see, using the facts it knows about. */
  private botSuggestion(p: Player): { unitId: string; taskId: string } | null {
    const known: Fact[] = [
      ...p.facts,
      ...this.scenario.facts.filter((f) => {
        const owner = [...this.players.values()].find((x) => x.seat === f.seat);
        return owner?.sharedFactIds.has(f.id);
      }),
    ];
    // Solve against what this bot believes the world looks like.
    const believed: CommandScenario = { ...this.scenario, facts: known };
    const best = optimalPlan(believed).assignment;
    for (const [unitId, taskId] of Object.entries(best)) {
      if (taskId && this.assignment[unitId] !== taskId) return { unitId, taskId };
    }
    return null;
  }

  private sendInfoUpdate(): void {
    this.infoUpdateSent = true;
    this.infoUpdateAt = Date.now();
    // Close the busiest route in the current plan - the change has to actually
    // bite, otherwise adaptation cannot be observed.
    const route = this.scenario.routes[Math.floor(Math.random() * Math.min(6, this.scenario.routes.length))]!;
    const a = this.scenario.sites.find((s) => s.id === route.a)?.label ?? route.a;
    const b = this.scenario.sites.find((s) => s.id === route.b)?.label ?? route.b;
    const text = `FRISSÍTÉS: a ${a}–${b} szakasz azonnali hatállyal lezárva. A terv felülvizsgálata szükséges.`;
    this.scenario.facts.push({
      id: `UPD-${randomUUID().slice(0, 6)}`,
      kind: 'route_closed',
      ref: route.id,
      text,
      patch: { closed: true },
      seat: -1,
    });
    this.broadcast({ t: 'infoUpdate', text });
    this.system(text);
  }

  /* ------------------------------------------------------ transmission */

  private t(): number {
    return Date.now() - this.roomStartedAt;
  }

  private members(): TeamMemberInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        playerId: p.id,
        externalId: p.externalId,
        seat: p.seat,
        role: p.role,
        connected: p.connected,
        isBot: p.isBot,
        ready: p.ready,
      }));
  }

  private broadcast(msg: ServerMessage, exceptId?: string): void {
    for (const p of this.players.values()) {
      if (p.isBot || !p.connected || p.id === exceptId) continue;
      try { p.send(msg); } catch { /* socket already gone */ }
    }
  }

  private pushAll(): void {
    const msg: ServerMessage = {
      t: 'room',
      room: this.code,
      hostId: this.hostId ?? '',
      phase: this.phase,
      config: this.config,
      members: this.members(),
      phaseEndsAt: this.phaseEndsAt,
      round: this.round,
    };
    this.broadcast(msg);
    // Role can change between rounds, so every push refreshes the private view.
    for (const p of this.players.values()) if (!p.isBot && p.connected) this.pushYou(p);
  }

  private pushYou(p: Player): void {
    if (p.isBot) return;
    p.send({
      t: 'you',
      playerId: p.id,
      seat: p.seat,
      role: p.role,
      facts: p.facts,
      sharedFactIds: [...p.sharedFactIds],
    });
  }

  private pushScenario(p: Player): void {
    if (this.config.variant === 'B' && this.structure) {
      const sc = this.structure;
      // The whole point of the variant: a participant is told what THEY can
      // see and nothing more. Sending the full visibility map would hand the
      // answer to every client.
      const { visibility: _v, exclusive: _e, privileged: _p, trueInventory: _t, invisible: _i, ...pub } = sc;
      p.send({
        t: 'structure',
        scenario: pub,
        yourSeat: p.seat,
        visibleBlockIds: sc.blocks.filter((b) => sc.visibility[b.id]!.includes(p.seat)).map((b) => b.id),
        privilegedCount: (sc.privileged[p.seat] ?? []).length,
      });
      return;
    }
    p.send({ t: 'scenario', scenario: publicScenario(this.scenario) });
  }

  /** Bring a (re)joining client up to date. */
  private replay(p: Player): void {
    for (const c of this.chat.slice(-40)) p.send({ t: 'chat', entry: c });
    for (const pr of this.proposals.slice(-20)) p.send({ t: 'proposal', entry: pr });
    if (this.config.variant === 'B') {
      p.send({ t: 'inventory', counts: { ...this.inventory }, byPlayerId: this.lastInventoryBy, revision: this.inventoryRevision });
    } else {
      p.send({ t: 'plan', assignment: { ...this.assignment }, revision: this.planRevision, byPlayerId: null });
    }
    for (const r of this.results) p.send({ t: 'roundResult', result: r });
  }

  /* ----------------------------------------------------------- exports */

  snapshot() {
    return {
      id: this.id,
      code: this.code,
      domain: this.domain,
      variant: this.config.variant,
      seed: this.config.seed,
      config: this.config,
      results: this.results,
      transcript: this.transcript,
      scenario: this.scenario,
      difficulty: this.config.variant === 'B' && this.structure
        ? {
            blocks: this.structure.blocks.length,
            bestSingleSeatError: bestSingleSeat(this.structure).outcome.totalAbsError,
            trueInventory: this.structure.trueInventory,
          }
        : {
            optimal: optimalPlan(this.scenario).value,
            boardOnly: boardOnlyPlan(this.scenario).achievedValue,
          },
      players: [...this.players.values()].map((p) => ({
        id: p.id, externalId: p.externalId, seat: p.seat, role: p.role, isBot: p.isBot,
      })),
    };
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.players.clear();
  }
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

void SEAT_COLORS;
