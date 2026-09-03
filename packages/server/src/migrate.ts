import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, initDb } from './db.js';
import { hasDatabase } from './config.js';

/**
 * Migration runner. Plain SQL files applied in filename order, recorded in a
 * schema_migrations table. No ORM and no DSL: the schema is the thing everyone
 * - including a DBA who has never seen this codebase - needs to be able to read.
 */

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<string[]> {
  if (!hasDatabase()) {
    console.warn('[migrate] DATABASE_URL not set - skipping');
    return [];
  }
  initDb();
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const applied = new Set(
    (await query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
  );

  const dir = join(here, 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = await readFile(join(dir, f), 'utf8');
    console.log(`[migrate] applying ${f}`);
    await query(sql);
    await query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    ran.push(f);
  }
  if (ran.length === 0) console.log('[migrate] up to date');
  return ran;
}

// Allow `npm run migrate` as a standalone command.
const invokedDirectly = process.argv[1] && process.argv[1].includes('migrate');
if (invokedDirectly) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed', err);
      process.exit(1);
    });
}
