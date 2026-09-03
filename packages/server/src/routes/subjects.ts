import type { FastifyInstance } from 'fastify';
import {
  PROFILE_AXES, type DomainCode, type RunSummary, type Subject, type SubjectProfile,
} from '@vrcap/shared';
import { query } from '../db.js';
import { hasDatabase } from '../config.js';

/**
 * Identity and personal history.
 *
 * The platform stores a pseudonymous external identifier and nothing else about
 * the person - no name, no date of birth, no free text. "Identify" is
 * deliberately not authentication: this is a supervised measurement setting
 * where a participant types the identifier they were given. Anything stronger
 * (PIN, SSO, operator-issued tokens) belongs in the deployment that needs it,
 * and the schema leaves room for it.
 */

const ID_RE = /^[A-Z0-9][A-Z0-9\-_.]{2,23}$/;

export function subjectRoutes(app: FastifyInstance): void {
  app.post('/api/subjects/identify', async (req, reply) => {
    const body = req.body as { externalId?: string; domain?: DomainCode };
    const externalId = (body.externalId ?? '').trim().toUpperCase();
    const domain = body.domain;
    if (!ID_RE.test(externalId)) {
      return reply.code(400).send({ error: 'Az azonosító 3-24 karakter, betű/szám/kötőjel.' });
    }
    if (!domain || !['A', 'B', 'C'].includes(domain)) {
      return reply.code(400).send({ error: 'Ismeretlen terület.' });
    }
    if (!hasDatabase()) {
      return reply.code(503).send({ error: 'Nincs adatbázis konfigurálva.' });
    }

    const res = await query<{ id: string; external_id: string; display_name: string | null; domains: string[]; created_at: Date }>(
      `INSERT INTO subjects (external_id, domains)
       VALUES ($1, ARRAY[$2]::text[])
       ON CONFLICT (external_id) DO UPDATE SET
         last_seen_at = now(),
         domains = (
           SELECT ARRAY(SELECT DISTINCT unnest(subjects.domains || ARRAY[$2]::text[]))
         )
       RETURNING id, external_id, display_name, domains, created_at`,
      [externalId, domain]
    );
    const row = res.rows[0]!;
    const subject: Subject = {
      id: row.id,
      externalId: row.external_id,
      displayName: row.display_name,
      domains: row.domains as DomainCode[],
      createdAt: row.created_at.toISOString(),
    };
    return subject;
  });

  app.get('/api/subjects/:id/profile', async (req, reply) => {
    const { id } = req.params as { id: string };
    const domain = ((req.query as { domain?: string }).domain ?? 'A') as DomainCode;
    if (!hasDatabase()) return reply.code(503).send({ error: 'Nincs adatbázis konfigurálva.' });

    const subjRes = await query<{ id: string; external_id: string; display_name: string | null; domains: string[]; created_at: Date }>(
      'SELECT id, external_id, display_name, domains, created_at FROM subjects WHERE id = $1',
      [id]
    );
    const s = subjRes.rows[0];
    if (!s) return reply.code(404).send({ error: 'Ismeretlen azonosító.' });

    const runsRes = await query<{
      id: string; module_code: string; module_version: string; config_version: string;
      variant: string | null; domain: string; mode: string; ops_score: number; finished_at: Date;
    }>(
      `SELECT id, module_code, module_version, config_version, variant, domain, mode, ops_score, finished_at
         FROM runs
        WHERE subject_id = $1 AND domain = $2 AND status = 'completed'
        ORDER BY finished_at DESC
        LIMIT 120`,
      [id, domain]
    );

    const runs: RunSummary[] = runsRes.rows.map((r) => ({
      id: r.id,
      moduleCode: r.module_code,
      moduleVersion: r.module_version,
      configVersion: r.config_version,
      variant: (r.variant === 'B' ? 'B' : 'A') as 'A' | 'B',
      domain: r.domain as DomainCode,
      mode: r.mode as RunSummary['mode'],
      opsScore: r.ops_score,
      finishedAt: r.finished_at.toISOString(),
      headline: [],
    }));

    // Personal bests per module, restricted to assessment runs so a challenge
    // score can never masquerade as a measurement.
    // Personal bests are per module AND per variant: a spatial run and a flat
    // run of the same module are different tasks, and collapsing them would
    // report a best that was never achieved on either.
    const bestRes = await query<{ module_code: string; variant: string | null; best: number }>(
      `SELECT module_code, variant, MAX(ops_score) AS best
         FROM runs
        WHERE subject_id = $1 AND domain = $2 AND mode = 'assessment' AND status = 'completed'
        GROUP BY module_code, variant`,
      [id, domain]
    );
    const personalBests: Record<string, number> = {};
    for (const b of bestRes.rows) {
      // The profile axes key off the plain module code, so variant A (and any
      // single-form module) keeps the bare key and B gets a suffixed one.
      const key = b.variant === 'B' ? `${b.module_code}:B` : b.module_code;
      personalBests[key] = Math.max(personalBests[key] ?? 0, b.best);
    }

    const axes = PROFILE_AXES.filter((a) => a.domains.includes(domain)).map((a) => {
      let num = 0;
      let den = 0;
      const sources: string[] = [];
      for (const [code, w] of Object.entries(a.sources)) {
        const best = personalBests[code];
        if (best === undefined) continue;
        num += (best / 10) * w;
        den += w;
        sources.push(code);
      }
      return { key: a.key, label: a.label, value: den > 0 ? Math.round((num / den) * 10) / 10 : null, sources };
    });

    const profile: SubjectProfile = {
      subject: {
        id: s.id,
        externalId: s.external_id,
        displayName: s.display_name,
        domains: s.domains as DomainCode[],
        createdAt: s.created_at.toISOString(),
      },
      runs,
      axes,
      personalBests,
    };
    return profile;
  });
}
