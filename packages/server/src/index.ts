import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { config, hasDatabase } from './config.js';
import { dbHealthy, initDb, closeDb } from './db.js';
import { runMigrations } from './migrate.js';
import { subjectRoutes } from './routes/subjects.js';
import { runRoutes } from './routes/runs.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { catalogRoutes, syncCatalog } from './routes/catalog.js';
import { realtimeRoutes } from './realtime/index.js';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const app = Fastify({
    logger: config.nodeEnv === 'production'
      ? { level: 'info' }
      : { level: 'info', transport: undefined },
    bodyLimit: config.maxPayloadBytes,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: false,
  });
  await app.register(websocket, {
    options: { maxPayload: 1 << 20 },
  });

  app.get('/api/health', async () => ({
    ok: true,
    database: await dbHealthy(),
    storage: hasDatabase() ? 'postgres' : 'none',
    version: process.env.APP_VERSION ?? 'dev',
    time: new Date().toISOString(),
  }));

  catalogRoutes(app);
  subjectRoutes(app);
  runRoutes(app);
  leaderboardRoutes(app);
  await app.register(async (scoped) => { realtimeRoutes(scoped); });

  // Serve the built client from the same origin when it is present. That keeps
  // the deployment to a single container and makes the WebXR secure-context
  // requirement someone else's problem (the reverse proxy terminates TLS).
  const clientDir = resolve(here, '..', config.clientDir);
  const indexHtml = join(clientDir, 'index.html');
  if (existsSync(indexHtml)) {
    // wildcard:true matters: with wildcard:false the plugin enumerates the
    // directory once at registration, so any file written afterwards - every
    // client rebuild against a running server - 404s until restart. With the
    // wildcard route, misses fall through to the not-found handler below,
    // which is where the SPA fallback lives.
    await app.register(fastifyStatic, { root: clientDir, wildcard: true });

    // Cache policy. Vite fingerprints every asset, so assets are immutable and
    // can be cached hard; index.html must never be, or a browser keeps the
    // previous deploy's shell and asks for asset filenames that are already
    // gone. That failure mode surfaces as an opaque module MIME error, so it is
    // worth being explicit about.
    app.addHook('onSend', async (req, reply) => {
      const path = (req.url.split('?')[0] ?? '/');
      // Only cache SUCCESSFUL asset responses. Marking a 404 immutable would
      // be close to unrecoverable: a client that asks for an asset during a
      // deploy would cache the failure for a year and stay broken, with no
      // way for the server to invalidate it.
      if (path.startsWith('/assets/') && reply.statusCode >= 200 && reply.statusCode < 300) {
        reply.header('cache-control', 'public, max-age=31536000, immutable');
      } else if (path === '/' || path.endsWith('.html') || !/\.[a-z0-9]{2,5}$/i.test(path)) {
        reply.header('cache-control', 'no-store');
      } else {
        reply.header('cache-control', 'no-store');
      }
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not found' });
      }
      // Only routes fall through to the SPA. A missing *file* must 404: after
      // a redeploy a cached index.html asks for asset filenames that no longer
      // exist, and answering those with HTML produces a module MIME error that
      // looks nothing like the stale cache it actually is.
      const path = req.url.split('?')[0] ?? '';
      if (/\.[a-z0-9]{2,5}$/i.test(path)) {
        return reply.code(404).send({ error: 'asset not found', path });
      }
      return reply.sendFile('index.html');
    });
    app.log.info(`serving client from ${clientDir}`);
  } else {
    app.log.warn(`client build not found at ${clientDir} - API only`);
  }

  if (hasDatabase()) {
    initDb();
    if (config.autoMigrate) {
      try {
        await runMigrations();
        await syncCatalog();
      } catch (err) {
        app.log.error({ err }, 'migration failed - continuing without storage');
      }
    }
  } else {
    app.log.warn('DATABASE_URL not set - runs will not be persisted');
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`VR CAP server listening on ${config.host}:${config.port}`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] fatal', err);
  process.exit(1);
});
