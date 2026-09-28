import { afterEach, describe, expect, it } from 'vitest';

import { LOCAL_SCAN_REFUSED, hostedOriginAllowed, isHosted, isPublicRead } from '../src/hosted';
import { buildServer } from '../src/server';
import { LEAKY_SETTINGS, memoryStore, stubGitHub } from './support';
import { fileURLToPath } from 'node:url';

import { corpusStats } from '../src/benchmark';
import { readSeed, seedCandidates, seedIfEmpty } from '../src/seed';
import type { FastifyInstance } from 'fastify';

const SEED_PATH = fileURLToPath(new URL('../seed/corpus.json', import.meta.url));

const TOKEN = 'c'.repeat(48);
const HOST = 'wardline.onrender.com';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function deployed(repos: Record<string, Record<string, string>> = {}): FastifyInstance {
  return buildServer({
    store: memoryStore(),
    github: stubGitHub(repos),
    token: TOKEN,
    hosted: true,
    publicHost: HOST,
  });
}

describe('detecting a hosted deployment', () => {
  it('reads the explicit flag and the platform marker', () => {
    expect(isHosted({ WARDLINE_HOSTED: '1' })).toBe(true);
    expect(isHosted({ RENDER: 'true' })).toBe(true);
    expect(isHosted({})).toBe(false);
  });
});

describe('what counts as a public read', () => {
  it('allows GET on corpus data', () => {
    expect(isPublicRead('GET', '/api/health')).toBe(true);
    expect(isPublicRead('GET', '/api/scans?limit=50')).toBe(true);
    expect(isPublicRead('GET', '/api/benchmark/12')).toBe(true);
    expect(isPublicRead('GET', '/api/corpus/stats')).toBe(true);
  });

  it('never allows a write, whatever the path', () => {
    expect(isPublicRead('POST', '/api/scans')).toBe(false);
    expect(isPublicRead('POST', '/api/corpus/ingest')).toBe(false);
    expect(isPublicRead('DELETE', '/api/scans')).toBe(false);
  });

  it('does not let a prefix match open something else', () => {
    expect(isPublicRead('GET', '/api/local/projects')).toBe(false);
    expect(isPublicRead('GET', '/api/scansomething')).toBe(false);
  });
});

describe('hosted origin checks', () => {
  it('accepts only its own host', () => {
    expect(hostedOriginAllowed('https://' + HOST, HOST)).toBe(true);
    expect(hostedOriginAllowed('https://evil.example.com', HOST)).toBe(false);
    expect(hostedOriginAllowed('http://localhost:5180', HOST)).toBe(false);
    expect(hostedOriginAllowed(undefined, HOST)).toBe(true);
  });
});

describe('a public deployment', () => {
  it('refuses to scan a local path even with a valid token', async () => {
    app = deployed();

    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { authorization: 'Bearer ' + TOKEN },
      payload: { target: 'C:/Users' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('local-scan-disabled');
    expect(res.json().error).toBe(LOCAL_SCAN_REFUSED);
  });

  it('refuses a unix path and a relative path too', async () => {
    app = deployed();

    for (const target of ['/etc/passwd', './', '../../']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/scans',
        headers: { authorization: 'Bearer ' + TOKEN },
        payload: { target },
      });
      expect(res.statusCode, target).toBe(403);
    }
  });

  it('lets anyone read the corpus without a token', async () => {
    app = deployed();

    for (const url of ['/api/health', '/api/rules', '/api/corpus/stats', '/api/scans']) {
      expect((await app.inject({ url })).statusCode, url).toBe(200);
    }
  });

  it('still requires the token to ingest a repository', async () => {
    app = deployed({ 'a/one': { 'settings.json': LEAKY_SETTINGS } });

    const anon = await app.inject({
      method: 'POST',
      url: '/api/corpus/ingest',
      payload: { slugs: ['a/one'] },
    });
    expect(anon.statusCode).toBe(401);

    const withToken = await app.inject({
      method: 'POST',
      url: '/api/corpus/ingest',
      headers: { authorization: 'Bearer ' + TOKEN },
      payload: { slugs: ['a/one'] },
    });
    expect(withToken.statusCode).toBe(200);
  });

  it('still scans a public repository, which is the point of the deployment', async () => {
    app = deployed({ 'a/one': { 'settings.json': LEAKY_SETTINGS } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { authorization: 'Bearer ' + TOKEN },
      payload: { target: 'https://github.com/a/one' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('a/one');
  });

  it('does not apply the loopback Host rule, which would reject every real request', async () => {
    app = deployed();

    const res = await app.inject({ url: '/api/health', headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a page on another origin', async () => {
    app = deployed();

    const res = await app.inject({
      url: '/api/health',
      headers: { host: HOST, origin: 'https://evil.example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts its own origin whatever hostname it is deployed under', async () => {
    app = deployed();

    for (const h of [HOST, 'wardline.fly.dev', 'audit.example.org', '127.0.0.1:8899']) {
      const res = await app.inject({
        url: '/api/health',
        headers: { host: h, origin: 'https://' + h },
      });
      expect(res.statusCode, h).toBe(200);
    }
  });
});

describe('the local build is unchanged', () => {
  it('still scans local paths when not hosted', async () => {
    app = buildServer({ store: memoryStore(), github: stubGitHub({}), insecureNoAuth: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { target: 'C:/definitely/not/here' },
    });

    // Rejected because the path does not exist, not because policy forbids it.
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBeUndefined();
  });
});

describe('finding the corpus snapshot', () => {
  it('always looks beside the module, not only where it was told', () => {
    const candidates = seedCandidates('/somewhere/wrong.json');

    expect(candidates[0]).toContain('wrong.json');
    expect(candidates.length).toBeGreaterThan(1);
    // The module-relative candidate is the one that holds on a deployment,
    // where the working directory is whatever the platform chose.
    expect(candidates.some((p) => p.includes('seed') && p.includes('corpus.json'))).toBe(true);
  });

  it('finds the snapshot with no configuration at all', () => {
    const store = memoryStore();
    const outcome = seedIfEmpty(store);

    expect(outcome.loaded).toBeGreaterThan(10);
    store.close();
  });

  it('lists everywhere it looked when it finds nothing', () => {
    const store = memoryStore();
    // Seeded first, so the real snapshot cannot rescue this case.
    seedIfEmpty(store);
    const outcome = seedIfEmpty(store, '/nope.json');

    expect(outcome.loaded).toBe(0);
    store.close();
  });
});

describe('the corpus seed', () => {
  it('restores a snapshot into an empty corpus', () => {
    const store = memoryStore();
    expect(store.corpusSize()).toBe(0);

    const outcome = seedIfEmpty(store, SEED_PATH);

    expect(outcome.loaded).toBeGreaterThan(10);
    expect(outcome.from).toBeTruthy();
    expect(store.corpusSize()).toBe(outcome.loaded);
    store.close();
  });

  it('never rewinds a corpus that already has repositories', () => {
    const store = memoryStore();
    seedIfEmpty(store, SEED_PATH);
    const before = store.corpusSize();

    // A second boot must not duplicate or reset what is already there.
    expect(seedIfEmpty(store, SEED_PATH).loaded).toBe(0);
    expect(store.corpusSize()).toBe(before);
    store.close();
  });

  it('shrugs off a missing snapshot rather than failing to start', () => {
    const store = memoryStore();
    // A bad explicit path must not stop the built-in locations from working.
    const outcome = seedIfEmpty(store, 'seed/does-not-exist.json');
    expect(outcome.loaded).toBeGreaterThan(10);
    store.close();
  });

  it('carries no evidence, so the snapshot cannot reintroduce credentials', () => {
    const seed = readSeed(SEED_PATH);
    expect(seed).not.toBeNull();

    const store = memoryStore();
    seedIfEmpty(store, SEED_PATH);

    const scan = store.latestCorpusScans()[0];
    expect(scan).toBeDefined();
    const findings = store.findings(scan!.id);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.evidence === null)).toBe(true);
    store.close();
  });

  it('produces a corpus the benchmark can actually use', () => {
    const store = memoryStore();
    seedIfEmpty(store, SEED_PATH);

    const stats = corpusStats(store);
    expect(stats.size).toBeGreaterThan(10);
    expect(stats.medians['overall']).toBeGreaterThan(0);
    expect(stats.topRules.length).toBeGreaterThan(0);
    store.close();
  });
});

describe('serving the dashboard itself', () => {
  it('treats the page and its assets as public', () => {
    // A deployment whose own page needs a token cannot be opened by anyone.
    expect(isPublicRead('GET', '/')).toBe(true);
    expect(isPublicRead('GET', '/assets/index-abc123.js')).toBe(true);
    expect(isPublicRead('GET', '/some/deep/spa/route')).toBe(true);
  });

  it('still protects the API endpoints that were never public', () => {
    expect(isPublicRead('GET', '/api/local/projects')).toBe(false);
    expect(isPublicRead('POST', '/')).toBe(false);
  });
});
