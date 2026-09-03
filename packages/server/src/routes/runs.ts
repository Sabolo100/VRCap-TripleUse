import type { FastifyInstance } from 'fastify';
import type { RunPayload } from '@vrcap/shared';
import { tx, query } from '../db.js';
import { config, hasDatabase } from '../config.js';
import { comparabilityKey } from '../comparability.js';

/**
 * Run ingestion.
 *
 * One POST carries the whole measurement: header, trials, events, motion,
 * metrics and scores. The client buffers offline and replays, so this endpoint
 * must be idempotent - a duplicate run id is accepted and ignored rather than
 * rejected, otherwise a flaky connection turns into a stuck queue.
 */
export function runRoutes(app: FastifyInstance): void {
  app.post('/api/runs', async (req, reply) => {
    const payload = req.body as RunPayload;
    if (!payload?.header?.id || !payload.header.moduleCode) {
      return reply.code(400).send({ error: 'hiányos futás' });
    }
    if (!hasDatabase()) {
      // No storage configured: acknowledge so the client stops retrying, but
      // say plainly that nothing was persisted.
      return reply.code(202).send({ stored: false, reason: 'no-database' });
    }
    const h = payload.header;
    if (!h.subjectId && !config.storeAnonymousRuns) {
      return reply.send({ stored: false, reason: 'anonymous-runs-disabled' });
    }

    const exists = await query('SELECT 1 FROM runs WHERE id = $1', [h.id]);
    if (exists.rowCount) return reply.send({ stored: true, duplicate: true });

    await tx(async (client) => {
      await client.query(
        `INSERT INTO sessions (id, subject_id, domain, device_profile, started_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [h.sessionId, h.subjectId, h.domain, JSON.stringify(h.device ?? {}), h.startedAt]
      );

      await client.query(
        `INSERT INTO runs (
           id, session_id, subject_id, domain, module_code, module_version, config_version,
           variant, mode, seed, status, ops_score, comparability, device_profile, summary,
           team_id, team_role, started_at, finished_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          h.id, h.sessionId, h.subjectId, h.domain, h.moduleCode, h.moduleVersion, h.configVersion,
          h.variant ?? (h.configVersion.endsWith('_SPATIAL_B') ? 'B' : 'A'),
          h.mode, h.seed, payload.status, Math.round(payload.opsScore),
          comparabilityKey(h.device), JSON.stringify(h.device ?? {}), JSON.stringify(payload.summary ?? {}),
          h.teamId ?? null, h.teamRole ?? null, h.startedAt, payload.finishedAt,
        ]
      );

      // Bulk inserts: one statement each rather than a round trip per row -
      // a REACT run carries ~100 trials and a few thousand events.
      if (payload.trials?.length) {
        const values: unknown[] = [];
        const chunks = payload.trials.map((t, i) => {
          const b = i * 10;
          values.push(
            h.id, t.trialNumber, t.block, JSON.stringify(t.stimulus ?? {}),
            t.response ? JSON.stringify(t.response) : null, t.correct, t.outcome,
            t.reactionTimeMs, t.startedAt, t.endedAt
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
        });
        await client.query(
          `INSERT INTO trials (run_id, trial_number, block, stimulus, response, correct, outcome,
                               reaction_time_ms, started_at_ms, ended_at_ms)
           VALUES ${chunks.join(',')}`,
          values
        );
      }

      if (payload.events?.length) {
        const values: unknown[] = [];
        const chunks = payload.events.map((e, i) => {
          const b = i * 5;
          values.push(h.id, e.trialNumber, e.t, e.type, e.payload ? JSON.stringify(e.payload) : null);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
        });
        // Postgres caps a statement at 65535 parameters; chunk defensively.
        for (let i = 0; i < chunks.length; i += 2000) {
          const slice = chunks.slice(i, i + 2000);
          const vals = values.slice(i * 5, (i + slice.length) * 5);
          const renumbered = slice.map((_, j) => {
            const b = j * 5;
            return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
          });
          await client.query(
            `INSERT INTO events (run_id, trial_number, t_ms, event_type, payload) VALUES ${renumbered.join(',')}`,
            vals
          );
        }
      }

      if (payload.motion?.length) {
        await client.query(
          `INSERT INTO motion_traces (run_id, sample_count, hz, samples)
           VALUES ($1,$2,$3,$4) ON CONFLICT (run_id) DO NOTHING`,
          [
            h.id,
            payload.motion.length,
            estimateHz(payload.motion.map((m) => m.t)),
            JSON.stringify(payload.motion),
          ]
        );
      }

      if (payload.metrics?.length) {
        const values: unknown[] = [];
        const chunks = payload.metrics.map((m, i) => {
          const b = i * 5;
          values.push(h.id, m.name, m.scope ?? null, m.value, m.unit ?? null);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
        });
        await client.query(
          `INSERT INTO metrics (run_id, name, scope, value, unit) VALUES ${chunks.join(',')}`,
          values
        );
      }

      if (payload.scores?.length) {
        const values: unknown[] = [];
        const chunks = payload.scores.map((s, i) => {
          const b = i * 4;
          values.push(h.id, s.type, s.value, s.scoringVersion);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4})`;
        });
        await client.query(
          `INSERT INTO scores (run_id, score_type, value, scoring_version) VALUES ${chunks.join(',')}`,
          values
        );
      }
    });

    return { stored: true, id: h.id };
  });

  app.get('/api/runs/:id', async (req, reply) => {
    if (!hasDatabase()) return reply.code(503).send({ error: 'nincs adatbázis' });
    const { id } = req.params as { id: string };
    const run = await query('SELECT * FROM runs WHERE id = $1', [id]);
    if (!run.rowCount) return reply.code(404).send({ error: 'ismeretlen futás' });
    const metrics = await query('SELECT name, scope, value, unit FROM metrics WHERE run_id = $1', [id]);
    const scores = await query('SELECT score_type, value, scoring_version FROM scores WHERE run_id = $1', [id]);
    return { run: run.rows[0], metrics: metrics.rows, scores: scores.rows };
  });

  /** CSV / JSON export for analysis. Trial level or summary level. */
  app.get('/api/export', async (req, reply) => {
    if (!hasDatabase()) return reply.code(503).send({ error: 'nincs adatbázis' });
    const q = req.query as { module?: string; domain?: string; level?: string; format?: string; token?: string };
    if (config.adminToken && q.token !== config.adminToken) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const level = q.level === 'trial' ? 'trial' : 'summary';

    if (level === 'summary') {
      const rows = await query(
        `SELECT r.id, s.external_id, r.domain, r.module_code, r.module_version, r.config_version,
                r.mode, r.ops_score, r.comparability, r.seed, r.started_at, r.finished_at
           FROM runs r LEFT JOIN subjects s ON s.id = r.subject_id
          WHERE ($1::text IS NULL OR r.module_code = $1)
            AND ($2::text IS NULL OR r.domain = $2)
          ORDER BY r.finished_at DESC LIMIT 20000`,
        [q.module ?? null, q.domain ?? null]
      );
      return q.format === 'csv' ? sendCsv(reply, rows.rows) : rows.rows;
    }

    const rows = await query(
      `SELECT r.id AS run_id, s.external_id, r.module_code, r.domain, r.comparability,
              t.trial_number, t.block, t.outcome, t.correct, t.reaction_time_ms,
              t.stimulus, t.response
         FROM trials t
         JOIN runs r ON r.id = t.run_id
         LEFT JOIN subjects s ON s.id = r.subject_id
        WHERE ($1::text IS NULL OR r.module_code = $1)
          AND ($2::text IS NULL OR r.domain = $2)
        ORDER BY r.finished_at DESC, t.trial_number ASC
        LIMIT 200000`,
      [q.module ?? null, q.domain ?? null]
    );
    return q.format === 'csv' ? sendCsv(reply, rows.rows) : rows.rows;
  });
}

function estimateHz(times: number[]): number | null {
  if (times.length < 3) return null;
  const span = times[times.length - 1]! - times[0]!;
  return span > 0 ? Math.round((times.length / span) * 1000 * 10) / 10 : null;
}

function sendCsv(reply: { header: (k: string, v: string) => void; send: (b: string) => unknown }, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return reply.send('');
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', 'attachment; filename="vrcap-export.csv"');
  return reply.send(body);
}
