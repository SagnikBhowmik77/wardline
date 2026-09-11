import { afterEach, describe, expect, it } from 'vitest';

import { fileURLToPath } from 'node:url';

import { buildServer } from '../src/server';
import { KEYED_BRIEF, LEAKY_SETTINGS, memoryStore, stubGitHub } from './support';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function serverWith(repos: Record<string, Record<string, string>> = {}): FastifyInstance {
  return buildServer({ store: memoryStore(), github: stubGitHub(repos), insecureNoAuth: true });
}

// fileURLToPath, not URL.pathname: the home directory here contains a space,
// which the URL form percent-encodes into a path that does not exist.
const DEMO_PATH = fileURLToPath(new URL('../../core/examples/insecure-config', import.meta.url));

describe('api', () => {
  it('reports health with the corpus size', async () => {
    app = serverWith();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, corpusSize: 0 });
  });

  it('exposes the rule catalogue', async () => {
    app = serverWith();
    const body = (await app.inject({ method: 'GET', url: '/api/rules' })).json();

    expect(body.total).toBeGreaterThan(60);
    expect(body.rules[0]).toHaveProperty('id');
  });

  it('scans a local path and stores the result', async () => {
    app = serverWith();
    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { path: DEMO_PATH },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.grade).toBe('F');
    expect(body.scanId).toBeGreaterThan(0);

    const detail = (await app.inject({ url: '/api/scans/' + body.scanId })).json();
    expect(detail.findings.length).toBeGreaterThan(20);
  });

  it('rejects a malformed repository slug', async () => {
    app = serverWith();
    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { repo: 'not a slug' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a request with neither a path nor a repo', async () => {
    app = serverWith();
    const res = await app.inject({ method: 'POST', url: '/api/scans', payload: {} });

    expect(res.statusCode).toBe(400);
  });

  it('ingests a public repository and withholds its evidence', async () => {
    app = serverWith({
      'someone/leaky': { 'CLAUDE.md': KEYED_BRIEF, 'settings.json': LEAKY_SETTINGS },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { repo: 'someone/leaky' },
    });

    expect(res.statusCode).toBe(200);
    const scanId = res.json().scanId;

    const detail = (await app.inject({ url: '/api/scans/' + scanId })).json();
    const secret = detail.findings.find((f: { rule_id: string }) => f.rule_id === 'WL-SEC-001');

    expect(secret).toBeDefined();
    expect(secret.evidence).toBeNull();
  });

  it('reports a repository with no agent config rather than inventing a scan', async () => {
    app = serverWith({ 'someone/empty': { 'README.md': '# nothing here' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { repo: 'someone/empty' },
    });

    expect(res.statusCode).toBe(422);
    // The message must name what was searched, or it reads as a limitation of
    // the scanner rather than a fact about the repository.
    const error = res.json().error as string;
    expect(error).toContain('No agent configuration found');
    expect(error).toContain('Cursor');
    expect(error).toContain('Claude Code');
  });

  it('benchmarks a scan against the ingested corpus', async () => {
    app = serverWith({
      'a/one': { 'settings.json': LEAKY_SETTINGS },
      'a/two': { 'settings.json': LEAKY_SETTINGS },
      'a/three': { 'settings.json': LEAKY_SETTINGS },
    });

    await app.inject({
      method: 'POST',
      url: '/api/corpus/ingest',
      payload: { slugs: ['a/one', 'a/two', 'a/three'] },
    });

    const mine = (
      await app.inject({ method: 'POST', url: '/api/scans', payload: { path: DEMO_PATH } })
    ).json();

    const bench = (await app.inject({ url: '/api/benchmark/' + mine.scanId })).json();

    expect(bench.corpusSize).toBe(3);
    expect(bench.categories).toHaveLength(5);
    expect(bench.overall).toHaveProperty('percentile');
  });

  it('summarises the corpus', async () => {
    app = serverWith({ 'a/one': { 'settings.json': LEAKY_SETTINGS } });
    await app.inject({
      method: 'POST',
      url: '/api/corpus/ingest',
      payload: { slugs: ['a/one'] },
    });

    const stats = (await app.inject({ url: '/api/corpus/stats' })).json();
    expect(stats.size).toBe(1);
    expect(stats.topRules.length).toBeGreaterThan(0);
  });

  it('404s an unknown scan', async () => {
    app = serverWith();
    expect((await app.inject({ url: '/api/scans/9999' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/benchmark/9999' })).statusCode).toBe(404);
  });
});

describe('thin configurations', () => {
  it('reports a near-empty repository as unrated and keeps it out of the corpus', async () => {
    app = serverWith({
      'someone/barely': { 'CLAUDE.md': '# app\n', 'AGENTS.md': 'Use the tokens.\n' },
      'someone/real': { 'settings.json': LEAKY_SETTINGS },
    });

    const thin = (
      await app.inject({ method: 'POST', url: '/api/scans', payload: { target: 'someone/barely' } })
    ).json();

    expect(thin.ok).toBe(true);
    expect(thin.unrated).toBe(true);
    expect(thin.grade).toBe('--');
    expect(thin.findings).toBe(0);

    await app.inject({ method: 'POST', url: '/api/scans', payload: { target: 'someone/real' } });

    // Only the repository with real configuration belongs in the population.
    const stats = (await app.inject({ url: '/api/corpus/stats' })).json();
    expect(stats.size).toBe(1);
  });

  it('does not let an empty repository inflate the benchmark', async () => {
    app = serverWith({
      'a/empty1': { 'CLAUDE.md': '# a\n' },
      'a/empty2': { 'CLAUDE.md': '# b\n' },
      'a/loose': { 'settings.json': LEAKY_SETTINGS },
    });

    for (const slug of ['a/empty1', 'a/empty2', 'a/loose']) {
      await app.inject({ method: 'POST', url: '/api/scans', payload: { target: slug } });
    }

    const stats = (await app.inject({ url: '/api/corpus/stats' })).json();
    expect(stats.size).toBe(1);
    expect(stats.grades['A']).toBe(0);
  });

  it('accepts a pasted GitHub URL through the scan endpoint', async () => {
    app = serverWith({ 'owner/repo': { 'settings.json': LEAKY_SETTINGS } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { target: 'https://github.com/owner/repo' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('owner/repo');
  });
});

describe('tuning endpoint', () => {
  it('ranks rules against the ingested corpus', async () => {
    app = serverWith({
      'a/one': { 'settings.json': LEAKY_SETTINGS },
      'a/two': { 'settings.json': LEAKY_SETTINGS },
    });

    await app.inject({
      method: 'POST',
      url: '/api/corpus/ingest',
      payload: { slugs: ['a/one', 'a/two'] },
    });

    const tuning = (await app.inject({ url: '/api/corpus/tuning' })).json();

    expect(tuning.corpusSize).toBe(2);
    expect(tuning.provisional).toBe(true);
    expect(tuning.rules.some((r: { ruleId: string }) => r.ruleId === 'WL-PRM-001')).toBe(true);
    expect(Array.isArray(tuning.neverFired)).toBe(true);
  });
});
