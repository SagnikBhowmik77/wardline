/**
 * Server entry point.
 *
 * Loopback binding is necessary but nowhere near sufficient: a browser can
 * reach 127.0.0.1 from any page. Every request therefore has to present the
 * run token, arrive from an allowed origin, and address a loopback Host.
 */

import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { allowedOrigin, bearerFrom, hostIsLoopback, resolveToken, tokenMatches } from './auth.js';
import { GitHubClient } from './github.js';
import { registerRoutes } from './routes.js';
import { Store } from './db.js';

export interface BuildOptions {
  dbPath?: string;
  store?: Store;
  github?: GitHubClient;
  logger?: boolean;
  /** Shared secret every request must present. */
  token?: string;
  /** Port the dashboard is served from, for the origin allowlist. */
  webPort?: number;
  /**
   * Disable access control. Only for tests: this endpoint can read any path on
   * the machine, so an unauthenticated instance is a filesystem reader.
   */
  insecureNoAuth?: boolean;
}

export function buildServer(options: BuildOptions = {}): FastifyInstance {
  const store = options.store ?? new Store(options.dbPath ?? '.data/wardline.db');
  const github = options.github ?? new GitHubClient();
  const webPort = options.webPort ?? Number(process.env['WEB_PORT'] ?? 5180);

  const app = Fastify({ logger: options.logger ?? false });

  app.register(cors, {
    origin: (origin, done) => {
      done(null, allowedOrigin(origin ?? undefined, webPort));
    },
    credentials: false,
  });

  if (!options.insecureNoAuth) {
    const token = options.token ?? resolveToken();

    app.addHook('onRequest', async (request, reply) => {
      if (!hostIsLoopback(request.headers.host)) {
        return reply.code(421).send({ error: 'this API only answers on loopback' });
      }

      const origin = request.headers.origin;
      if (!allowedOrigin(origin, webPort)) {
        return reply.code(403).send({ error: 'origin not allowed' });
      }

      const presented =
        bearerFrom(request.headers.authorization) ||
        String(request.headers['x-wardline-token'] ?? '');

      if (!presented || !tokenMatches(presented, token)) {
        return reply.code(401).send({
          error: 'missing or invalid token; it is written to .data/token when the server starts',
        });
      }

      return undefined;
    });
  }

  registerRoutes(app, { store, github });

  app.addHook('onClose', async () => {
    store.close();
  });

  return app;
}

const entry = process.argv[1] ?? '';
const startedDirectly = entry.endsWith('server.ts') || entry.endsWith('server.js');

if (startedDirectly) {
  const port = Number(process.env['PORT'] ?? 8800);
  const host = process.env['HOST'] ?? '127.0.0.1';
  const github = new GitHubClient();
  const token = resolveToken();

  const app = buildServer({
    logger: true,
    dbPath: process.env['DB_PATH'] ?? '.data/wardline.db',
    github,
    token,
  });

  app
    .listen({ port, host })
    .then(() => {
      app.log.info(
        'wardline api ready' +
          (github.authenticated
            ? ' (github: authenticated, 5000 req/hr)'
            : ' (github: anonymous, 60 req/hr - set GITHUB_TOKEN to raise it)'),
      );
      app.log.info('access token written to .data/token; the dashboard proxy reads it');
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
