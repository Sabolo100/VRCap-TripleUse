import type { FastifyInstance } from 'fastify';
import { MODULES, DOMAIN_CODES } from '@vrcap/shared';
import { query } from '../db.js';
import { hasDatabase } from '../config.js';

/**
 * Module catalog.
 *
 * The manifest list ships with the client, but it is also mirrored into the
 * database on boot. That gives a deployment one authoritative record of which
 * module version and which domain-relevance mapping was live when a given run
 * was recorded - which matters as soon as the catalog changes and old results
 * have to stay interpretable.
 */
export async function syncCatalog(): Promise<void> {
  if (!hasDatabase()) return;
  for (const m of MODULES) {
    await query(
      `INSERT INTO modules (code, ordinal, title, subtitle, current_version, status, manifest, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (code) DO UPDATE SET
         ordinal = EXCLUDED.ordinal,
         title = EXCLUDED.title,
         subtitle = EXCLUDED.subtitle,
         current_version = EXCLUDED.current_version,
         status = EXCLUDED.status,
         manifest = EXCLUDED.manifest,
         updated_at = now()`,
      [m.code, m.ordinal, m.title, m.subtitle, m.version, m.status, JSON.stringify(m)]
    );

    for (const d of DOMAIN_CODES) {
      const p = m.domains[d];
      await query(
        `INSERT INTO module_domain_relevance (module_code, domain, relevance, headline, rationale, examples)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (module_code, domain) DO UPDATE SET
           relevance = EXCLUDED.relevance,
           headline = EXCLUDED.headline,
           rationale = EXCLUDED.rationale,
           examples = EXCLUDED.examples`,
        [m.code, d, p.relevance, p.headline ?? null, p.rationale ?? null, p.examples ?? []]
      );
    }

    await query(
      `INSERT INTO module_versions (module_code, version, config_version, configuration)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [m.code, m.version, `${m.code}_STANDARD_A`, JSON.stringify({ duration: m.duration, supports: m.supports })]
    );
  }
  console.log(`[catalog] synced ${MODULES.length} modules`);
}

export function catalogRoutes(app: FastifyInstance): void {
  app.get('/api/modules', async (req) => {
    const domain = (req.query as { domain?: string }).domain;
    const list = MODULES.filter((m) => !domain || m.domains[domain as 'A' | 'B' | 'C']?.relevance !== 'none');
    return list;
  });

  app.get('/api/modules/:code', async (req, reply) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const m = MODULES.find((x) => x.code === code);
    if (!m) return reply.code(404).send({ error: 'unknown module' });
    return m;
  });
}
