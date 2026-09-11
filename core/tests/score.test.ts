import { describe, expect, it } from 'vitest';

import { findingWeight, gradeFor, scoreFindings } from '../src/report/score';
import type { Category, Finding, Severity, SourceTrust } from '../src/types';

function finding(
  overrides: Partial<Finding> & { category: Category; severity: Severity },
): Finding {
  return {
    id: 'WL-TST-001',
    title: 'test finding',
    detail: 'detail',
    remedy: 'remedy',
    relPath: 'settings.json',
    trust: 'runtime',
    ...overrides,
  } as Finding;
}

describe('grade thresholds', () => {
  it('maps scores to letters at the documented boundaries', () => {
    expect(gradeFor(100)).toBe('A');
    expect(gradeFor(90)).toBe('A');
    expect(gradeFor(89)).toBe('B');
    expect(gradeFor(80)).toBe('B');
    expect(gradeFor(70)).toBe('C');
    expect(gradeFor(60)).toBe('D');
    expect(gradeFor(59)).toBe('F');
  });
});

describe('finding weight', () => {
  it('discounts non-runtime sources', () => {
    const runtime = finding({ category: 'mcp', severity: 'critical', trust: 'runtime' });
    const template = finding({ category: 'mcp', severity: 'critical', trust: 'template' });

    expect(findingWeight(template)).toBeLessThan(findingWeight(runtime));
  });

  it('never discounts a secret, wherever it was committed', () => {
    const trusts: SourceTrust[] = ['runtime', 'template', 'docs', 'project-local'];
    const weights = trusts.map((trust) =>
      findingWeight(finding({ category: 'secrets', severity: 'critical', trust })),
    );

    expect(new Set(weights).size).toBe(1);
  });
});

describe('scorecard', () => {
  it('gives a clean config full marks', () => {
    const card = scoreFindings([]);

    expect(card.score).toBe(100);
    expect(card.grade).toBe('A');
    expect(card.categories.hooks.findings).toBe(0);
  });

  it('drops the grade for a single critical secret', () => {
    const card = scoreFindings([finding({ category: 'secrets', severity: 'critical' })]);

    expect(card.categories.secrets.score).toBe(75);
    expect(card.score).toBeLessThan(100);
  });

  it('caps how much one low-trust file can cost a category', () => {
    const many = Array.from({ length: 20 }, () =>
      finding({ category: 'mcp', severity: 'critical', trust: 'template', relPath: 'examples/catalog.json' }),
    );
    const card = scoreFindings(many);

    expect(card.categories.mcp.deducted).toBeLessThanOrEqual(10);
    expect(card.categories.mcp.findings).toBe(20);
  });

  it('lets two different low-trust files each contribute', () => {
    const spread = [
      ...Array.from({ length: 20 }, () =>
        finding({ category: 'mcp', severity: 'critical', trust: 'template', relPath: 'examples/a.json' }),
      ),
      ...Array.from({ length: 20 }, () =>
        finding({ category: 'mcp', severity: 'critical', trust: 'template', relPath: 'examples/b.json' }),
      ),
    ];

    expect(scoreFindings(spread).categories.mcp.deducted).toBeCloseTo(20, 1);
  });

  it('never reports a negative category score', () => {
    const many = Array.from({ length: 40 }, () =>
      finding({ category: 'hooks', severity: 'critical', relPath: 'hooks/a' + Math.random() + '.sh' }),
    );

    expect(scoreFindings(many).categories.hooks.score).toBe(0);
  });

  it('ignores info-level findings in the score but still counts them', () => {
    const card = scoreFindings([finding({ category: 'agents', severity: 'info' })]);

    expect(card.categories.agents.score).toBe(100);
    expect(card.categories.agents.findings).toBe(1);
  });
});

describe('plugin trust', () => {
  it('weighs installed plugin content between runtime and template', () => {
    const weightFor = (trust: SourceTrust) =>
      findingWeight(finding({ category: 'agents', severity: 'critical', trust }));

    expect(weightFor('plugin')).toBeLessThan(weightFor('runtime'));
    expect(weightFor('plugin')).toBeGreaterThan(weightFor('template'));
  });

  it('caps all installed plugin content as one bucket per category', () => {
    const many = Array.from({ length: 30 }, () =>
      finding({
        category: 'agents',
        severity: 'critical',
        trust: 'plugin',
        relPath: 'plugins/cache/vendor/agents/worker' + Math.random() + '.md',
      }),
    );

    expect(scoreFindings(many).categories.agents.deducted).toBeLessThanOrEqual(10);
  });
});

describe('secrets inside vendored plugin code', () => {
  it('caps them in the score but keeps them at full severity', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      finding({
        category: 'secrets',
        severity: 'critical',
        trust: 'plugin',
        relPath: 'plugins/cache/vendor/tests/fixture' + i + '.test.js',
      }),
    );
    const card = scoreFindings(many);

    expect(card.categories.secrets.deducted).toBeLessThanOrEqual(10);
    expect(card.categories.secrets.findings).toBe(30);
    expect(many[0]?.severity).toBe('critical');
  });

  it('still takes the full deduction for a secret in the user own files', () => {
    const card = scoreFindings([
      finding({ category: 'secrets', severity: 'critical', trust: 'docs', relPath: 'docs/setup.md' }),
    ]);

    expect(card.categories.secrets.deducted).toBe(25);
  });
});

describe('severity ceiling', () => {
  it('refuses to grade a live critical finding above F', () => {
    const card = scoreFindings([finding({ category: 'permissions', severity: 'critical' })]);

    expect(card.grade).toBe('F');
    expect(card.score).toBeLessThanOrEqual(59);
    expect(card.cappedBy).toBe('critical');
    // The average alone would have been an A: four clean categories out of five.
    expect(card.categories.secrets.score).toBe(100);
  });

  it('holds a live high finding to C and a medium to B', () => {
    const high = scoreFindings([finding({ category: 'hooks', severity: 'high' })]);
    const medium = scoreFindings([finding({ category: 'hooks', severity: 'medium' })]);

    expect(high.grade).toBe('C');
    expect(high.cappedBy).toBe('high');
    expect(medium.grade).toBe('B');
    expect(medium.cappedBy).toBe('medium');
  });

  it('leaves a clean configuration alone', () => {
    const card = scoreFindings([finding({ category: 'agents', severity: 'info' })]);

    expect(card.grade).toBe('A');
    expect(card.score).toBe(100);
    expect(card.cappedBy).toBeUndefined();
  });

  it('does not let vendored plugin content cap the grade', () => {
    const card = scoreFindings([
      finding({
        category: 'agents',
        severity: 'critical',
        trust: 'plugin',
        relPath: 'plugins/cache/vendor/agent.md',
      }),
    ]);

    expect(card.cappedBy).toBeUndefined();
    expect(card.grade).toBe('A');
  });

  it('caps on a project-local finding, which is live for that developer', () => {
    const card = scoreFindings([
      finding({ category: 'permissions', severity: 'high', trust: 'project-local' }),
    ]);

    expect(card.cappedBy).toBe('high');
    expect(card.score).toBeLessThanOrEqual(79);
  });

  it('takes the worst severity when several apply', () => {
    const card = scoreFindings([
      finding({ category: 'hooks', severity: 'medium' }),
      finding({ category: 'permissions', severity: 'critical' }),
      finding({ category: 'mcp', severity: 'high' }),
    ]);

    expect(card.cappedBy).toBe('critical');
  });
});
