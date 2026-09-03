import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_PATH, type ClientMessage, type ServerMessage, type DomainCode, DOMAIN_CODES } from '@vrcap/shared';
import { CommandRoom } from './CommandRoom.js';
import { query } from '../db.js';
import { hasDatabase } from '../config.js';

/**
 * WebSocket entry point for COMMAND.
 *
 * Rooms live in process memory: a session lasts fifteen minutes and losing one
 * on a restart is acceptable, whereas the coordination cost of a shared store
 * is not. Results and the full transcript are written to Postgres when a room
 * finishes, so nothing that matters for analysis is only in memory.
 */

const rooms = new Map<string, CommandRoom>();

/** Rooms with no connected humans are collected after a grace period. */
const GRACE_MS = 3 * 60 * 1000;

setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.isEmpty) {
      const idleFor = Date.now() - (roomLastActive.get(code) ?? 0);
      if (idleFor > GRACE_MS) {
        room.close();
        rooms.delete(code);
        roomLastActive.delete(code);
        console.log(`[ws] reaped idle room ${code}`);
      }
    } else {
      roomLastActive.set(code, Date.now());
    }
  }
}, 60_000);

const roomLastActive = new Map<string, number>();

export function realtimeRoutes(app: FastifyInstance): void {
  app.get(WS_PATH, { websocket: true }, (socket: WebSocket) => {
    let room: CommandRoom | null = null;
    let playerId: string | null = null;

    const send = (msg: ServerMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };

    socket.on('message', (raw: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return send({ t: 'error', message: 'hibás üzenet' });
      }

      try {
        switch (msg.t) {
          case 'create': {
            // Reject an unknown domain here rather than at persistence time.
            // The column is one character wide; a bad code used to run the
            // whole exercise and then fail silently on save, losing the
            // session with nobody told.
            if (!DOMAIN_CODES.includes(msg.domain as DomainCode)) {
              return send({ t: 'error', message: 'Ismeretlen terület.', fatal: true });
            }
            const r = new CommandRoom(msg.domain as DomainCode, msg.config);
            rooms.set(r.code, r);
            roomLastActive.set(r.code, Date.now());
            r.onFinish((finished) => void persistRoom(finished));
            const p = r.addPlayer(sanitiseId(msg.externalId), send);
            for (let i = 0; i < (r.config.botCount ?? 0); i++) r.addBot();
            room = r;
            playerId = p.id;
            console.log(`[ws] room ${r.code} (variant ${r.variant}) created by ${p.externalId} (+${r.config.botCount} bots)`);
            break;
          }

          case 'join': {
            // A malformed or missing code must come back as "no such room",
            // not as a generic server error - the client shows this text to
            // the participant, and "Szerverhiba" tells them nothing.
            const code = typeof msg.room === 'string' ? msg.room.trim().toUpperCase() : '';
            const r = code ? rooms.get(code) : undefined;
            if (!r) return send({ t: 'error', message: 'Nincs ilyen szoba.', fatal: true });
            if (r.humanCount >= 5) return send({ t: 'error', message: 'A szoba tele van.', fatal: true });
            const p = r.addPlayer(sanitiseId(msg.externalId), send);
            room = r;
            playerId = p.id;
            roomLastActive.set(r.code, Date.now());
            break;
          }

          case 'leave':
            if (room && playerId) room.removePlayer(playerId);
            room = null;
            playerId = null;
            break;

          case 'ready': if (room && playerId) room.setReady(playerId, msg.value); break;
          case 'start': if (room && playerId) room.start(playerId); break;
          case 'chat': if (room && playerId) room.chatMessage(playerId, msg.text); break;
          case 'shareFact': if (room && playerId) room.shareFact(playerId, msg.factId); break;
          case 'assign': if (room && playerId) room.assign(playerId, msg.unitId, msg.taskId); break;
          case 'propose': if (room && playerId) room.propose(playerId, msg.unitId, msg.taskId, msg.note); break;
          case 'commit': if (room && playerId) room.commit(playerId); break;
          case 'inventory': if (room && playerId) room.setInventory(playerId, msg.counts); break;
          case 'ping': if (room && playerId) room.ping(playerId, msg.x, msg.z); break;
          case 'pose': if (room && playerId) room.pose(playerId, msg.head, msg.left, msg.right); break;
          case 'rtc': if (room && playerId) room.relayRtc(playerId, msg.to, msg.data); break;
          case 'heartbeat': break;
        }
        if (room) roomLastActive.set(room.code, Date.now());
      } catch (err) {
        console.error('[ws] handler failed', err);
        send({ t: 'error', message: 'Szerverhiba a művelet közben.' });
      }
    });

    socket.on('close', () => {
      if (room && playerId) room.removePlayer(playerId);
    });

    socket.on('error', (err: Error) => console.warn('[ws] socket error', err.message));
  });

  /** Small operational view: which rooms exist right now. */
  app.get('/api/rooms', async () => ({
    count: rooms.size,
    rooms: [...rooms.values()].map((r) => ({
      code: r.code, phase: r.phase, round: r.round, domain: r.domain, humans: r.humanCount,
    })),
  }));
}

function sanitiseId(raw: string): string {
  const s = (raw ?? '').trim().toUpperCase().slice(0, 24);
  return /^[A-Z0-9][A-Z0-9\-_.]{2,23}$/.test(s) ? s : `VENDÉG-${Math.floor(Math.random() * 900 + 100)}`;
}

/**
 * Persist a finished team exercise: the rounds, the full transcript and the
 * scenario. Individual runs are also posted by each client through /api/runs;
 * this is the team-level record that ties them together.
 */
async function persistRoom(room: CommandRoom): Promise<void> {
  if (!hasDatabase()) return;
  const snap = room.snapshot();
  try {
    await query(
      `INSERT INTO teams (id, room_code, domain, module_code, seed, config, variant, finished_at)
       VALUES ($1,$2,$3,'COMMAND',$4,$5,$6, now())
       ON CONFLICT (id) DO UPDATE SET finished_at = now()`,
      [snap.id, snap.code, snap.domain, snap.seed,
       JSON.stringify({ ...snap.config, variant: snap.variant, difficulty: snap.difficulty }),
       snap.variant]
    );

    for (const r of snap.results) {
      // Variant B rounds carry an inventory outcome instead of an assignment.
      // It goes into its own columns, because pooling gain - the one number
      // the exercise exists to produce - has to be queryable later.
      await query(
        `INSERT INTO team_rounds (team_id, round, assignment, achieved_value, optimal_value, optimality,
                                  time_to_commit_ms, info_coverage, revisions, detail,
                                  inventory_error, over_count, under_count, best_single_seat_error,
                                  submitted_inventory, true_inventory)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          snap.id, r.round, JSON.stringify(r.assignment), r.outcome.achievedValue, r.outcome.optimalValue,
          r.outcome.optimality, r.timeToCommitMs, r.infoCoverage, r.revisions,
          JSON.stringify({ detail: r.outcome.detail, players: r.players }),
          r.structureOutcome?.totalAbsError ?? null,
          r.structureOutcome?.overCount ?? null,
          r.structureOutcome?.underCount ?? null,
          r.bestSingleSeatError ?? null,
          r.submittedInventory ? JSON.stringify(r.submittedInventory) : null,
          r.trueInventory ? JSON.stringify(r.trueInventory) : null,
        ]
      );
    }

    for (const m of snap.transcript) {
      await query(
        `INSERT INTO team_messages (team_id, round, seat, external_id, is_bot, kind, text, t_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [snap.id, m.round, m.seat, m.externalId, m.isBot, m.kind, m.text, Math.round(m.t)]
      );
    }
    console.log(`[ws] persisted room ${snap.code}: ${snap.results.length} rounds, ${snap.transcript.length} messages`);
  } catch (err) {
    console.error('[ws] persist failed', err);
  }
}
