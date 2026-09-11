import { afterEach, describe, expect, it } from 'vitest';

import { tuneRules } from '../src/tuning';
import { LEAKY_SETTINGS, memoryStore, reportFor } from './support';
import type { Store } from '../src/db';

let store: Store;
afterEach(() => store?.close());

function corpus(count: number, files: Record<string, string>): Store {
  const s = memoryStore();
  for (let i = 0; i < count; i++) {
    const repo = s.upsertRepo({ source: 'github', slug: 'corp/r' + i, inCorpus: true });
    s.recordScan(repo, reportFor('corp/r' + i, files));
  }
  return s;
}

describe('rule tuning', () => {
  it('says nothing confident about an empty corpus', () => {
    store = memoryStore();
    const report = tuneRules(store);

    expect(report.corpusSize).toBe(0);
    expect(report.provisional).toBe(true);
    expect(report.rules).toHaveLength(0);
  });

  it('marks a widespread serious rule as an epidemic', () => {
    store = corpus(25, { 'settings.json': LEAKY_SETTINGS });
    const report = tuneRules(store);

    const wildcard = report.rules.find((r) => r.ruleId === 'WL-PRM-001');
    expect(wildcard?.share).toBe(100);
    expect(wildcard?.severity).toBe('critical');
    expect(wildcard?.verdict).toBe('epidemic');
  });

  it('flags a widespread low-severity rule for review instead', () => {
    store = corpus(25, {
      'settings.json': LEAKY_SETTINGS,
      'agents/worker.md': '---\nname: worker\ntools: Read\n---\n\nRead things.\n',
    });

    const missingDescription = tuneRules(store).rules.find((r) => r.ruleId === 'WL-AGT-013');
    expect(missingDescription?.severity).toBe('info');
    expect(missingDescription?.verdict).toBe('review-for-noise');
  });

  it('calls a rare serious rule high signal', () => {
    store = corpus(24, { 'CLAUDE.md': 'Keep the build green and the tests fast.\n' });

    const odd = store.upsertRepo({ source: 'github', slug: 'corp/odd', inCorpus: true });
    store.recordScan(odd, reportFor('corp/odd', { 'settings.json': LEAKY_SETTINGS }));

    const wildcard = tuneRules(store).rules.find((r) => r.ruleId === 'WL-PRM-001');
    expect(wildcard?.share).toBeLessThanOrEqual(10);
    expect(wildcard?.verdict).toBe('high-signal');
  });

  it('lists rules the corpus has never exercised', () => {
    store = corpus(3, { 'settings.json': LEAKY_SETTINGS });
    const report = tuneRules(store);

    expect(report.neverFired.length).toBeGreaterThan(0);
    const fired = new Set(report.rules.map((r) => r.ruleId));
    for (const rule of report.neverFired) expect(fired.has(rule.ruleId)).toBe(false);
  });

  it('warns that a small corpus is provisional', () => {
    store = corpus(5, { 'settings.json': LEAKY_SETTINGS });
    expect(tuneRules(store).provisional).toBe(true);

    store.close();
    store = corpus(25, { 'settings.json': LEAKY_SETTINGS });
    expect(tuneRules(store).provisional).toBe(false);
  });
});
