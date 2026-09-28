/**
 * HTTP surface.
 *
 * Two kinds of scan live here. A local scan reads a path on this machine, so
 * the server binds to loopback by default - it is a developer tool, not a
 * public service. A corpus scan pulls a public repository over the network and
 * keeps only aggregate-safe data.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ALL_RULES, scan as scanLocal } from 'wardline';
import type { FastifyInstance } from 'fastify';

import { buildBenchmark, corpusStats } from './benchmark.js';
import { tuneRules } from './tuning.js';
import { discoverCandidates, ingestMany, ingestRepo } from './ingest.js';
import { parseTarget } from './target.js';
import { seedCandidates } from './seed.js';
import { LOCAL_SCAN_REFUSED } from './hosted.js';
import type { GitHubClient } from './github.js';
import type { Store } from './db.js';

interface Deps {
  store: Store;
  github: GitHubClient;
  /**
   * Public-deployment policy. Passed in rather than read from the environment
   * so the server's configuration is the single source of truth: a test that
   * builds a hosted server must get hosted behaviour.
   */
  hosted: boolean;
}

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Stored as JSON; rows written before that change hold a joined string. */
function parseHarnesses(value: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // Fall through to the legacy shape.
  }
  return value.split(', ').filter(Boolean);
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { store, github, hosted } = deps;

  app.get('/api/health', async () => ({
    ok: true,
    // A deployment reporting an empty corpus should say whether the snapshot
    // was missing or simply not loaded yet, rather than leaving it a mystery.
    seedAvailable: seedCandidates().some((p) => existsSync(p)),
    // The dashboard needs to know it is read-only before a user presses a
    // button that can only fail.
    hosted,
    corpusSize: store.corpusSize(),
    githubAuthenticated: github.authenticated,
    rateRemaining: github.rate.remaining,
  }));

  app.get('/api/rules', async () => ({
    total: ALL_RULES.length,
    rules: ALL_RULES.map((r) => ({ id: r.id, category: r.category, title: r.title })),
  }));

  /**
   * One entry point for both kinds of target. The client sends whatever the
   * user typed and the parser decides what it is, so a pasted GitHub URL can
   * never be resolved as a relative filesystem path.
   */
  app.post<{ Body: { target?: string; path?: string; repo?: string } }>(
    '/api/scans',
    async (req, reply) => {
      const body = req.body ?? {};
      const raw = body.target ?? body.repo ?? body.path ?? '';
      const target = parseTarget(raw);

      if (target.kind === 'invalid') {
        return reply.code(400).send({ error: target.reason });
      }

      // Refused by policy, not by authentication. A token holder on a public
      // deployment still must not be able to read the host filesystem.
      if (target.kind === 'path' && hosted) {
        return reply.code(403).send({ error: LOCAL_SCAN_REFUSED, code: 'local-scan-disabled' });
      }

      if (target.kind === 'repo') {
        const result = await ingestRepo(store, github, target.slug, { inCorpus: true });
        if (!result.ok) {
          return reply
            .code(422)
            .send({ error: result.reason, code: result.code, slug: result.slug });
        }
        return result;
      }

      let report;
      try {
        report = scanLocal({ path: target.path });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }

      const repo = store.upsertRepo({ source: 'local', slug: report.root, inCorpus: false });
      const scanId = store.recordScan(repo, report);

      return {
        slug: report.root,
        ok: true,
        scanId,
        grade: report.scorecard.grade,
        score: report.scorecard.score,
        configFiles: report.summary.filesScanned,
        findings: report.summary.total,
        truncated: report.summary.truncated,
      };
    },
  );

  app.get<{ Querystring: { limit?: string } }>('/api/scans', async (req) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    return {
      scans: store
        .recentScans(limit)
        .map((row) => ({ ...row, harnesses: parseHarnesses(row.harnesses) })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/scans/:id', async (req, reply) => {
    const row = store.scan(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: 'no such scan' });

    return {
      scan: { ...row, harnesses: parseHarnesses(row.harnesses) },
      findings: store.findings(row.id),
    };
  });

  app.get<{ Querystring: { slug?: string } }>('/api/history', async (req, reply) => {
    if (!req.query.slug) return reply.code(400).send({ error: 'slug is required' });
    return {
      scans: store
        .scansForRepo(req.query.slug)
        .map((row) => ({ ...row, harnesses: parseHarnesses(row.harnesses) })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/benchmark/:id', async (req, reply) => {
    const row = store.scan(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: 'no such scan' });

    return buildBenchmark(store, row);
  });

  app.get('/api/corpus/stats', async () => corpusStats(store));

  /** Which rules the corpus says are epidemics, and which are probably noise. */
  app.get('/api/corpus/tuning', async () => tuneRules(store));

  app.get('/api/repos', async () => ({ repos: store.repos() }));

  app.post<{ Body: { slugs?: string[]; limit?: number } }>(
    '/api/corpus/ingest',
    async (req, reply) => {
      const body = req.body ?? {};
      const limit = Math.min(200, body.limit ?? 25);

      let slugs = body.slugs?.filter((s) => SLUG.test(s)) ?? [];
      if (slugs.length === 0) {
        try {
          slugs = await discoverCandidates(github, limit);
        } catch (err) {
          return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
        }
      }

      const results = await ingestMany(store, github, slugs.slice(0, limit), { inCorpus: true });

      return {
        requested: slugs.length,
        ingested: results.filter((r) => r.ok).length,
        skipped: results.filter((r) => !r.ok).length,
        corpusSize: store.corpusSize(),
        results,
      };
    },
  );

  app.get<{ Querystring: { root?: string } }>('/api/local/projects', async (req, reply) => {
    const root = req.query.root;
    if (!root) return reply.code(400).send({ error: 'root is required' });

    try {
      const projects = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => join(root, e.name))
        .filter((p) => {
          try {
            return statSync(p).isDirectory();
          } catch {
            return false;
          }
        });

      return { root, projects };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
