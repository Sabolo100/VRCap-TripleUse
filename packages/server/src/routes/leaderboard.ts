import type { FastifyInstance } from 'fastify';
import type { LeaderboardRow } from '@vrcap/shared';
import { query } from '../db.js';
import { hasDatabase } from '../config.js';

/**
 * FAIR LEADERBOARD.
 *
 * A row only appears next to another row when module, module version, domain,
 * mode and comparability class all match. Without that constraint the board
 * would rank input devices; with it, it ranks people.
 */
export function leaderboardRoutes(app: FastifyInstance): void {
  app.get('/api/leaderboard', async (req, reply) => {
    if (!hasDatabase()) return [];
    const q = req.query as {
      module?: string; domain?: string; device?: string; version?: string;
      config?: string; variant?: string; self?: string;
    };
    if (!q.module || !q.domain) return reply.code(400).send({ error: 'module és domain kötelező' });

    const rows = await query<{ external_id: string | null; ops_score: number; finished_at: Date; subject_id: string | null }>(
      `SELECT DISTINCT ON (r.subject_id)
              s.external_id, r.ops_score, r.finished_at, r.subject_id
         FROM runs r
         JOIN subjects s ON s.id = r.subject_id
        WHERE r.module_code = $1
          AND r.domain = $2
          AND r.mode = 'assessment'
          AND r.status = 'completed'
          AND ($3::text IS NULL OR r.comparability = $3)
          AND ($4::text IS NULL OR r.module_version = $4)
          -- A and B are different tasks. Without this filter the board would
          -- rank a spatial run against a flat one and call it a ranking.
          AND ($5::text IS NULL OR r.config_version = $5)
          AND ($6::text IS NULL OR r.variant = $6)
        ORDER BY r.subject_id, r.ops_score DESC`,
      [q.module.toUpperCase(), q.domain, q.device ?? null, q.version ?? null,
       q.config ?? null, q.variant ?? null]
    );

    const sorted = rows.rows.sort((a, b) => b.ops_score - a.ops_score).slice(0, 50);
    const out: LeaderboardRow[] = sorted.map((r, i) => ({
      rank: i + 1,
      externalId: r.external_id ?? '—',
      opsScore: r.ops_score,
      finishedAt: r.finished_at.toISOString(),
      isSelf: q.self ? r.subject_id === q.self : undefined,
    }));
    return out;
  });

  /** Group analytics for a supervisor: distribution rather than a ranking. */
  app.get('/api/analytics/module', async (req, reply) => {
    if (!hasDatabase()) return reply.code(503).send({ error: 'nincs adatbázis' });
    const q = req.query as { module?: string; domain?: string; device?: string; variant?: string };
    if (!q.module) return reply.code(400).send({ error: 'module kötelező' });

    const res = await query<{
      n: string; avg: number; sd: number; p25: number; p50: number; p75: number; min: number; max: number;
    }>(
      `SELECT COUNT(*)::text AS n,
              AVG(ops_score)::float AS avg,
              COALESCE(STDDEV_SAMP(ops_score), 0)::float AS sd,
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ops_score)::float AS p25,
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ops_score)::float AS p50,
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ops_score)::float AS p75,
              MIN(ops_score)::float AS min,
              MAX(ops_score)::float AS max
         FROM runs
        WHERE module_code = $1
          AND ($2::text IS NULL OR domain = $2)
          AND ($3::text IS NULL OR comparability = $3)
          AND ($4::text IS NULL OR variant = $4)
          AND mode = 'assessment' AND status = 'completed'`,
      [q.module.toUpperCase(), q.domain ?? null, q.device ?? null, q.variant ?? null]
    );

    const metricRes = await query<{ name: string; scope: string | null; n: string; avg: number; p50: number }>(
      `SELECT m.name, m.scope, COUNT(*)::text AS n, AVG(m.value)::float AS avg,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.value)::float AS p50
         FROM metrics m JOIN runs r ON r.id = m.run_id
        WHERE r.module_code = $1
          AND ($2::text IS NULL OR r.domain = $2)
          AND ($3::text IS NULL OR r.comparability = $3)
          AND ($4::text IS NULL OR r.variant = $4)
          AND r.mode = 'assessment'
        GROUP BY m.name, m.scope
        ORDER BY m.name`,
      [q.module.toUpperCase(), q.domain ?? null, q.device ?? null, q.variant ?? null]
    );

    return { summary: res.rows[0] ?? null, metrics: metricRes.rows };
  });
}
