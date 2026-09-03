import pg from 'pg';
import { config, hasDatabase } from './config.js';

/**
 * PostgreSQL access.
 *
 * The target deployment is a Coolify-managed Postgres on a Hetzner server, so
 * the pool is sized for a single small instance and every query goes through
 * here. If DATABASE_URL is absent the server still boots and serves the client
 * - it just reports itself as storage-less, which keeps local development and
 * offline demonstrations working.
 */

const { Pool } = pg;

export let pool: pg.Pool | null = null;

export function initDb(): pg.Pool | null {
  if (!hasDatabase()) return null;
  if (pool) return pool;
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.pgSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    application_name: 'vrcap',
  });
  pool.on('error', (err) => console.error('[db] idle client error', err));
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  const p = initDb();
  if (!p) throw new Error('DATABASE_URL is not configured');
  return p.query<T>(text, params);
}

/** Run a set of statements in one transaction. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = initDb();
  if (!p) throw new Error('DATABASE_URL is not configured');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function dbHealthy(): Promise<boolean> {
  if (!hasDatabase()) return false;
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
