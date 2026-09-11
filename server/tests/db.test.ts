import { afterEach, describe, expect, it } from 'vitest';

import { KEYED_BRIEF, LEAKY_SETTINGS, memoryStore, reportFor } from './support';
import type { Store } from '../src/db';

let store: Store;
afterEach(() => store?.close());

describe('storage', () => {
  it('upserts a repository without duplicating it', () => {
    store = memoryStore();
    const a = store.upsertRepo({ source: 'github', slug: 'owner/name', stars: 3 });
    const b = store.upsertRepo({ source: 'github', slug: 'owner/name', stars: 9 });

    expect(b.id).toBe(a.id);
    expect(b.stars).toBe(9);
    expect(store.repos()).toHaveLength(1);
  });

  it('keeps redacted evidence for a local scan', () => {
    store = memoryStore();
    const repo = store.upsertRepo({ source: 'local', slug: '/work/app' });
    const id = store.recordScan(repo, reportFor('/work/app', { 'CLAUDE.md': KEYED_BRIEF }));

    const secret = store.findings(id).find((f) => f.rule_id === 'WL-SEC-001');
    expect(secret).toBeDefined();
    expect(secret?.evidence).toBeTruthy();
    expect(secret?.evidence).not.toContain('Rk7mQ2vTb9LpXc4NwZs8Hj1FdGy6Ae0Bu');
  });

  it('never stores evidence for an ingested public repository', () => {
    store = memoryStore();
    const repo = store.upsertRepo({ source: 'github', slug: 'someone/leaky', inCorpus: true });
    const id = store.recordScan(repo, reportFor('someone/leaky', { 'CLAUDE.md': KEYED_BRIEF }));

    const findings = store.findings(id);
    expect(findings.some((f) => f.rule_id === 'WL-SEC-001')).toBe(true);
    expect(findings.every((f) => f.evidence === null)).toBe(true);
  });

  it('counts only ingested corpus repositories', () => {
    store = memoryStore();
    const mine = store.upsertRepo({ source: 'local', slug: '/work/app', inCorpus: false });
    const theirs = store.upsertRepo({ source: 'github', slug: 'a/b', inCorpus: true });

    store.recordScan(mine, reportFor('/work/app', { 'settings.json': LEAKY_SETTINGS }));
    expect(store.corpusSize()).toBe(0);

    store.recordScan(theirs, reportFor('a/b', { 'settings.json': LEAKY_SETTINGS }));
    expect(store.corpusSize()).toBe(1);
  });

  it('returns a repository history oldest first', () => {
    store = memoryStore();
    const repo = store.upsertRepo({ source: 'local', slug: '/work/app' });
    store.recordScan(repo, reportFor('/work/app', { 'settings.json': LEAKY_SETTINGS }));
    store.recordScan(repo, reportFor('/work/app', { 'settings.json': '{"permissions":{"allow":[],"deny":["Bash(rm -rf *)"]}}' }));

    const history = store.scansForRepo('/work/app');
    expect(history).toHaveLength(2);
    expect(history[0]!.score).toBeLessThanOrEqual(history[1]!.score);
  });
});

describe('history growth', () => {
  it('keeps only the most recent scans for a repository', () => {
    store = memoryStore();
    const repo = store.upsertRepo({ source: 'local', slug: '/work/app' });

    for (let i = 0; i < 40; i++) {
      store.recordScan(repo, reportFor('/work/app', { 'settings.json': LEAKY_SETTINGS }));
    }

    expect(store.scansForRepo('/work/app', 500).length).toBeLessThanOrEqual(25);
  });

  it('does not prune another repository while trimming one', () => {
    store = memoryStore();
    const mine = store.upsertRepo({ source: 'local', slug: '/work/app' });
    const other = store.upsertRepo({ source: 'local', slug: '/work/other' });

    store.recordScan(other, reportFor('/work/other', { 'settings.json': LEAKY_SETTINGS }));
    for (let i = 0; i < 30; i++) {
      store.recordScan(mine, reportFor('/work/app', { 'settings.json': LEAKY_SETTINGS }));
    }

    expect(store.scansForRepo('/work/other', 500)).toHaveLength(1);
  });

  it('stores the detected agents as a list', () => {
    store = memoryStore();
    const repo = store.upsertRepo({ source: 'local', slug: '/work/app' });
    const id = store.recordScan(repo, reportFor('/work/app', { '.cursorrules': 'Be careful.\n' }));

    expect(JSON.parse(store.scan(id)!.harnesses)).toContain('Cursor');
  });
});
