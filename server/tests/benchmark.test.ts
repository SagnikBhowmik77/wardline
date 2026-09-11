import { afterEach, describe, expect, it } from 'vitest';

import { buildBenchmark, corpusStats, median, percentileOf, verdictFor } from '../src/benchmark';
import { LEAKY_SETTINGS, memoryStore, reportFor } from './support';
import type { Store } from '../src/db';

let store: Store;
afterEach(() => store?.close());

const TIGHT = JSON.stringify({
  permissions: {
    allow: ['Bash(npm test)'],
    deny: ['Bash(rm -rf *)', 'Bash(sudo *)', 'Bash(chmod 777 *)', 'Bash(dd if=*)'],
  },
  hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node guard.js', timeout: 5 }] }] },
});

describe('statistics', () => {
  it('computes a median for odd and even populations', () => {
    expect(median([1, 5, 9])).toBe(5);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBe(0);
  });

  it('places a value in its population with ties counted as half', () => {
    expect(percentileOf(100, [10, 20, 30])).toBe(100);
    expect(percentileOf(0, [10, 20, 30])).toBe(0);
    expect(percentileOf(20, [10, 20, 30])).toBe(50);
  });

  it('returns the midpoint when there is no population to compare with', () => {
    expect(percentileOf(77, [])).toBe(50);
  });

  it('describes a percentile in words', () => {
    expect(verdictFor(95)).toBe('best 10%');
    expect(verdictFor(50)).toBe('about median');
    expect(verdictFor(5)).toBe('worst 10%');
  });
});

describe('benchmark', () => {
  function seedCorpus(count: number, settings: string): Store {
    const s = memoryStore();
    for (let i = 0; i < count; i++) {
      const repo = s.upsertRepo({ source: 'github', slug: 'corp/repo' + i, inCorpus: true });
      s.recordScan(repo, reportFor('corp/repo' + i, { 'settings.json': settings }));
    }
    return s;
  }

  it('ranks a tight config above a corpus of loose ones', () => {
    store = seedCorpus(8, LEAKY_SETTINGS);
    const mine = store.upsertRepo({ source: 'local', slug: '/work/app', inCorpus: false });
    const id = store.recordScan(mine, reportFor('/work/app', { 'settings.json': TIGHT }));

    const bench = buildBenchmark(store, store.scan(id)!);

    expect(bench.corpusSize).toBe(8);
    expect(bench.overall.percentile).toBeGreaterThan(50);
    expect(bench.overall.score).toBeGreaterThan(bench.overall.corpusMedian);
  });

  it('never compares a scan against itself', () => {
    store = seedCorpus(4, LEAKY_SETTINGS);
    const corpusScan = store.recentScans(1)[0]!;

    expect(buildBenchmark(store, corpusScan).corpusSize).toBe(3);
  });

  it('lists common problems the config avoids', () => {
    store = seedCorpus(6, LEAKY_SETTINGS);
    const mine = store.upsertRepo({ source: 'local', slug: '/work/app', inCorpus: false });
    const id = store.recordScan(mine, reportFor('/work/app', { 'settings.json': TIGHT }));

    const bench = buildBenchmark(store, store.scan(id)!);
    const avoided = bench.avoidedIssues.map((g) => g.ruleId);

    expect(avoided).toContain('WL-PRM-001');
    expect(bench.avoidedIssues.every((g) => g.yours === 0)).toBe(true);
  });

  it('reports a stable corpus summary', () => {
    store = seedCorpus(5, LEAKY_SETTINGS);
    const stats = corpusStats(store);

    expect(stats.size).toBe(5);
    expect(Object.values(stats.grades).reduce((a, b) => a + b, 0)).toBe(5);
    expect(stats.topRules[0]?.share).toBe(100);
  });

  it('survives an empty corpus without dividing by zero', () => {
    store = memoryStore();
    const mine = store.upsertRepo({ source: 'local', slug: '/work/app' });
    const id = store.recordScan(mine, reportFor('/work/app', { 'settings.json': TIGHT }));

    const bench = buildBenchmark(store, store.scan(id)!);
    expect(bench.corpusSize).toBe(0);
    expect(bench.overall.percentile).toBe(50);
  });
});
