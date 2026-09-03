import {
  WS_PATH, type ClientMessage, type ServerMessage, type CommandPhase, type RoomConfig,
  type Fact, type Assignment, type ChatEntry, type ProposalEntry, type RoundResult,
  type CommandScenario, type DomainCode, type TeamMemberInfo, type CommandRole,
  type StructureScenario, type Inventory, type VariantId,
} from '@vrcap/shared';

/**
 * COMMAND realtime client.
 *
 * One WebSocket per participant. The server is authoritative for phase, for the
 * hidden facts and for scoring; this class holds the mirrored room state and
 * fires a change callback whenever anything the UI draws has moved.
 *
 * Reconnection matters here more than in the single-player modules: losing the
 * socket mid-round would destroy a five-person session, so the client retries
 * with backoff and rejoins the same room code automatically.
 */

export interface CommandRoomState {
  connected: boolean;
  room: string | null;
  hostId: string | null;
  phase: CommandPhase;
  round: 'A' | 'B' | null;
  config: RoomConfig | null;
  members: TeamMemberInfo[];
  phaseEndsAt: number | null;
  playerId: string | null;
  seat: number;
  role: CommandRole;
  facts: Fact[];
  sharedFactIds: string[];
  scenario: Omit<CommandScenario, 'facts'> | null;
  /** Variant B: the shared structure, plus what THIS seat can see. */
  structure: Omit<StructureScenario, 'visibility' | 'exclusive' | 'privileged' | 'trueInventory' | 'invisible'> | null;
  visibleBlockIds: number[];
  privilegedCount: number;
  inventory: Inventory;
  inventoryRevision: number;
  chat: ChatEntry[];
  proposals: ProposalEntry[];
  assignment: Assignment;
  planRevision: number;
  planBy: string | null;
  infoUpdate: string | null;
  results: RoundResult[];
  teamScore: number | null;
  error: string | null;
  poses: Map<string, { head: number[]; left: number[]; right: number[] }>;
  pings: { from: string; seat: number; x: number; z: number; at: number }[];
}

function emptyState(): CommandRoomState {
  return {
    connected: false,
    room: null,
    hostId: null,
    phase: 'lobby',
    round: null,
    config: null,
    members: [],
    phaseEndsAt: null,
    playerId: null,
    seat: 0,
    role: 'member',
    facts: [],
    sharedFactIds: [],
    scenario: null,
    structure: null,
    visibleBlockIds: [],
    privilegedCount: 0,
    inventory: { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 },
    inventoryRevision: 0,
    chat: [],
    proposals: [],
    assignment: {},
    planRevision: 0,
    planBy: null,
    infoUpdate: null,
    results: [],
    teamScore: null,
    error: null,
    poses: new Map(),
    pings: [],
  };
}

type ChangeCb = (s: CommandRoomState) => void;

export class CommandClient {
  state = emptyState();
  private ws: WebSocket | null = null;
  private listeners = new Set<ChangeCb>();
  private roundListeners = new Set<(r: RoundResult) => void>();
  private phaseListeners = new Set<(p: CommandPhase) => void>();
  private rtcListeners = new Set<(from: string, data: unknown) => void>();
  private retry = 0;
  private closing = false;
  private lastJoin: { room?: string; externalId: string; domain: DomainCode; create: boolean; config?: Partial<RoomConfig> } | null = null;
  private heartbeat: number | undefined;
  private poseTimer = 0;

  onChange(cb: ChangeCb): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  onRoundResult(cb: (r: RoundResult) => void): () => void {
    this.roundListeners.add(cb);
    return () => this.roundListeners.delete(cb);
  }
  onPhase(cb: (p: CommandPhase) => void): () => void {
    this.phaseListeners.add(cb);
    return () => this.phaseListeners.delete(cb);
  }
  onRtc(cb: (from: string, data: unknown) => void): () => void {
    this.rtcListeners.add(cb);
    return () => this.rtcListeners.delete(cb);
  }

  private emit(): void {
    for (const l of [...this.listeners]) {
      try { l(this.state); } catch (err) { console.error('[command] listener failed', err); }
    }
  }

  private wsUrl(): string {
    const base = (import.meta.env.VITE_WS_BASE as string | undefined) || '';
    if (base) return base.replace(/\/$/, '') + WS_PATH;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${WS_PATH}`;
  }

  setInventory(counts: Inventory): void { this.send({ t: 'inventory', counts }); }

  async create(externalId: string, domain: DomainCode, config?: Partial<RoomConfig>): Promise<void> {
    this.lastJoin = { externalId, domain, create: true, config };
    await this.connect();
    this.send({ t: 'create', externalId, domain, config });
  }

  async join(room: string, externalId: string, domain: DomainCode): Promise<void> {
    this.lastJoin = { room: room.toUpperCase(), externalId, domain, create: false };
    await this.connect();
    this.send({ t: 'join', room: room.toUpperCase(), externalId, domain });
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return resolve();
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.wsUrl());
      } catch (err) {
        return reject(err);
      }
      this.ws = ws;
      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          reject(new Error('A szerver nem válaszol.'));
        }
      }, 6000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.retry = 0;
        this.state.connected = true;
        this.state.error = null;
        this.emit();
        this.heartbeat = window.setInterval(() => this.send({ t: 'heartbeat' }), 20000);
        resolve();
      };
      ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)) as ServerMessage);
      ws.onerror = () => {
        clearTimeout(timeout);
        this.state.error = 'Hálózati hiba.';
        this.emit();
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        window.clearInterval(this.heartbeat);
        this.state.connected = false;
        this.emit();
        if (!this.closing) this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    if (!this.lastJoin) return;
    this.retry++;
    if (this.retry > 6) {
      this.state.error = 'A kapcsolat megszakadt. Próbáld újra.';
      this.emit();
      return;
    }
    const delay = Math.min(8000, 500 * 2 ** this.retry);
    setTimeout(() => {
      const j = this.lastJoin;
      if (!j) return;
      void this.connect()
        .then(() => {
          // Reconnecting always rejoins by code; the server matches the player
          // back to their seat by external id so the round can continue.
          if (j.create && this.state.room) this.send({ t: 'join', room: this.state.room, externalId: j.externalId, domain: j.domain });
          else if (j.room) this.send({ t: 'join', room: j.room, externalId: j.externalId, domain: j.domain });
          else this.send({ t: 'create', externalId: j.externalId, domain: j.domain, config: j.config });
        })
        .catch(() => this.scheduleReconnect());
    }, delay);
  }

  private handle(msg: ServerMessage): void {
    const s = this.state;
    switch (msg.t) {
      case 'error':
        s.error = msg.message;
        break;
      case 'room': {
        const phaseChanged = s.phase !== msg.phase;
        s.room = msg.room;
        s.hostId = msg.hostId;
        s.phase = msg.phase;
        s.config = msg.config;
        s.members = msg.members;
        s.phaseEndsAt = msg.phaseEndsAt;
        s.round = msg.round;
        if (phaseChanged) for (const cb of [...this.phaseListeners]) cb(msg.phase);
        break;
      }
      case 'you':
        s.playerId = msg.playerId;
        s.seat = msg.seat;
        s.role = msg.role;
        s.facts = msg.facts;
        s.sharedFactIds = msg.sharedFactIds;
        break;
      case 'scenario':
        s.scenario = msg.scenario;
        break;
      case 'structure':
        s.structure = msg.scenario;
        s.visibleBlockIds = msg.visibleBlockIds;
        s.privilegedCount = msg.privilegedCount;
        s.seat = msg.yourSeat;
        break;
      case 'inventory':
        s.inventory = msg.counts;
        s.inventoryRevision = msg.revision;
        break;
      case 'chat':
        s.chat = [...s.chat, msg.entry].slice(-120);
        break;
      case 'proposal':
        s.proposals = [...s.proposals, msg.entry].slice(-80);
        break;
      case 'plan':
        s.assignment = msg.assignment;
        s.planRevision = msg.revision;
        s.planBy = msg.byPlayerId;
        break;
      case 'ping':
        s.pings = [...s.pings.filter((p) => Date.now() - p.at < 2600), { ...msg, at: Date.now() }];
        break;
      case 'pose':
        s.poses.set(msg.playerId, { head: msg.head, left: msg.left, right: msg.right });
        break;
      case 'infoUpdate':
        s.infoUpdate = msg.text;
        break;
      case 'roundResult':
        s.results = [...s.results.filter((r) => r.round !== msg.result.round), msg.result];
        for (const cb of [...this.roundListeners]) cb(msg.result);
        break;
      case 'final':
        s.results = msg.rounds;
        s.teamScore = msg.teamScore;
        break;
      case 'rtc':
        for (const cb of [...this.rtcListeners]) cb(msg.from, msg.data);
        break;
    }
    this.emit();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  ready(v: boolean): void { this.send({ t: 'ready', value: v }); }
  start(): void { this.send({ t: 'start' }); }
  chat(text: string): void { if (text.trim()) this.send({ t: 'chat', text: text.trim().slice(0, 240) }); }
  shareFact(factId: string): void { this.send({ t: 'shareFact', factId }); }
  assign(unitId: string, taskId: string | null): void { this.send({ t: 'assign', unitId, taskId }); }
  propose(unitId: string, taskId: string | null, note?: string): void { this.send({ t: 'propose', unitId, taskId, note }); }
  commit(): void { this.send({ t: 'commit' }); }
  ping(x: number, z: number): void { this.send({ t: 'ping', x, z }); }
  rtc(to: string, data: unknown): void { this.send({ t: 'rtc', to, data }); }

  /** Avatar poses are sent at ~12 Hz; enough for presence, cheap on bandwidth. */
  sendPose(dt: number, pose: { head: number[]; left: number[]; right: number[] }): void {
    this.poseTimer += dt;
    if (this.poseTimer < 0.083) return;
    this.poseTimer = 0;
    this.send({ t: 'pose', ...pose });
  }

  isHost(): boolean {
    return !!this.state.playerId && this.state.playerId === this.state.hostId;
  }

  me(): TeamMemberInfo | undefined {
    return this.state.members.find((m) => m.playerId === this.state.playerId);
  }

  close(): void {
    this.closing = true;
    window.clearInterval(this.heartbeat);
    this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null;
  }
}
