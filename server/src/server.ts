/**
 * Server entry point.
 *
 * Loopback binding is necessary but nowhere near sufficient: a browser can
 * reach 127.0.0.1 from any page. Every request therefore has to present the
 * run token, arrive from an allowed origin, and address a loopback Host.
 */

import { existsSync } from 'node:fs';

import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { allowedOrigin, bearerFrom, hostIsLoopback, resolveToken, tokenMatches } from './auth.js';
import { hostedOriginAllowed, isHosted, isPublicRead } from './hosted.js';
import { GitHubClient } from './github.js';
import { registerRoutes } from './routes.js';
import { Store } from './db.js';
import { seedIfEmpty } from './seed.js';

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
  /** Run the public-deployment policy: no local scans, public corpus reads. */
  hosted?: boolean;
  /** The host this deployment answers on, for the hosted origin check. */
  publicHost?: string;
  /** Built dashboard to serve alongside the API. */
  webRoot?: string;
}

export function buildServer(options: BuildOptions = {}): FastifyInstance {
  const store = options.store ?? new Store(options.dbPath ?? '.data/wardline.db');
  const github = options.github ?? new GitHubClient();
  const webPort = options.webPort ?? Number(process.env['WEB_PORT'] ?? 5180);
  const hosted = options.hosted ?? isHosted();
  const publicHost = options.publicHost ?? process.env['RENDER_EXTERNAL_HOSTNAME'];

  const app = Fastify({ logger: options.logger ?? false });

  app.register(cors, {
    origin: (origin, done) => {
      // Hosted: the dashboard is same-origin, so nothing cross-origin is
      // needed and none is granted. Local: the Vite dev server is a separate
      // origin and has to be allowed explicitly.
      done(null, hosted ? false : allowedOrigin(origin ?? undefined, webPort));
    },
    credentials: false,
  });

  if (!options.insecureNoAuth) {
    const token = options.token ?? resolveToken();

    app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;

      if (hosted) {
        // The deployment's own Host, so this holds behind any domain.
        if (!hostedOriginAllowed(origin, request.headers.host ?? publicHost)) {
          return reply.code(403).send({ error: 'origin not allowed' });
        }
        // Reading the corpus is the point of a public deployment; writing to
        // it, or spending the GitHub rate limit, is not.
        if (isPublicRead(request.method, request.url)) return undefined;
      } else {
        // Loopback binding is not a boundary, but off-loopback Host headers
        // are how DNS rebinding arrives, so they are refused outright.
        if (!hostIsLoopback(request.headers.host)) {
          return reply.code(421).send({ error: 'this API only answers on loopback' });
        }
        if (!allowedOrigin(origin, webPort)) {
          return reply.code(403).send({ error: 'origin not allowed' });
        }
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

  registerRoutes(app, { store, github, hosted });

  // On a deployment the dashboard is served by this same process, so there is
  // one origin, one certificate and no cross-origin surface at all.
  // Resolved from this module, not the working directory: the start command
  // runs from the repository root, and dev runs from server/, so cwd is not a
  // reliable anchor for finding the built dashboard.
  const dist = options.webRoot ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (hosted && existsSync(dist)) {
    app.register(fastifyStatic, { root: dist, wildcard: false });

    // A single-page app owns its routes; anything that is not an API call and
    // not a real file has to fall through to index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'no such endpoint' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    store.close();
  });

  return app;
}

const entry = process.argv[1] ?? '';
const startedDirectly = entry.endsWith('server.ts') || entry.endsWith('server.js');

if (startedDirectly) {
  const hosted = isHosted();
  const port = Number(process.env['PORT'] ?? 8800);
  // A container reaches its process through the container's own interface, so
  // a hosted deployment has to listen beyond loopback. Everything that made
  // loopback a safety net is replaced by the hosted policy above.
  const host = process.env['HOST'] ?? '0.0.0.0';
  const github = new GitHubClient();
  const token = resolveToken();

  const store = new Store(process.env['DB_PATH'] ?? '.data/wardline.db');

  // Free hosting has no disk that survives a restart. Without this the corpus
  // would be empty on every boot and the benchmark would compare against
  // nothing at all.
  // Resolved from this module, like the dashboard root: the start command runs
  // from the repository root, so a relative default would miss.
  const seedPath =
    process.env['SEED_PATH'] ?? fileURLToPath(new URL('../seed/corpus.json', import.meta.url));
  const seeded = seedIfEmpty(store, seedPath);

  const app = buildServer({ logger: true, store, github, token });

  app
    .listen({ port, host })
    .then(() => {
      app.log.info(
        'wardline api ready' +
          (github.authenticated
            ? ' (github: authenticated, 5000 req/hr)'
            : ' (github: anonymous, 60 req/hr - set GITHUB_TOKEN to raise it)'),
      );
      if (seeded > 0) app.log.info('seeded the corpus with ' + seeded + ' repositories');
      app.log.info(
        hosted
          ? 'hosted mode: local path scanning is disabled, corpus reads are public'
          : 'access token written to .data/token; the dashboard proxy reads it',
      );
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
