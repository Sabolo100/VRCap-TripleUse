/** Runtime configuration, all from the environment so a Coolify redeploy
 *  never needs a code change. */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? '',
  pgSsl: (process.env.PGSSLMODE ?? 'disable') !== 'disable',
  autoMigrate: (process.env.AUTO_MIGRATE ?? 'true') === 'true',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  storeAnonymousRuns: (process.env.STORE_ANONYMOUS_RUNS ?? 'true') === 'true',
  /** Where the built client lives, when the server also serves it. */
  clientDir: process.env.CLIENT_DIR ?? '../client/dist',
  /** Cap on a single uploaded run payload. Motion traces are the bulk. */
  maxPayloadBytes: Number(process.env.MAX_PAYLOAD_BYTES ?? 12 * 1024 * 1024),
};

export const hasDatabase = (): boolean => config.databaseUrl.length > 0;
