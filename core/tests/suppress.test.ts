import { describe, expect, it } from 'vitest';

import { readSuppressions } from '../src/suppress';
import { analyzeFiles } from '../src/scanner/index';
import { makeFile } from './support';

const LEAKY = ['{', '  "permissions": {', '    "allow": ["Bash(*)"],', '    "deny": []', '  }', '}'].join('\n');

function settings(content: string) {
  return makeFile({ relPath: 'settings.json', kind: 'settings', content });
}

describe('directive parsing', () => {
  it('reads a rule id and the reason beside it', () => {
    const file = settings('# wardline-ignore WL-PRM-001 sandboxed container only\n' + LEAKY);
    const [found] = readSuppressions(file);

    expect(found).toMatchObject({ ruleIds: ['WL-PRM-001'], scope: 'line', line: 1 });
    expect(found?.reason).toBe('sandboxed container only');
  });

  it('accepts several rule ids on one directive', () => {
    const file = settings('// wardline-ignore-file WL-PRM-001, WL-PRM-003 reviewed\n' + LEAKY);
    expect(readSuppressions(file)[0]?.ruleIds).toEqual(['WL-PRM-001', 'WL-PRM-003']);
  });

  it('reads the html comment form', () => {
    const file = makeFile({
      relPath: 'CLAUDE.md',
      kind: 'project-brief',
      content: '<!-- wardline-ignore-all vendored upstream sample -->\n',
    });
    const [found] = readSuppressions(file);

    expect(found?.ruleIds).toEqual(['*']);
    expect(found?.reason).toBe('vendored upstream sample');
  });

  it('ignores a bare directive that names no rule', () => {
    expect(readSuppressions(settings('# wardline-ignore\n' + LEAKY))).toHaveLength(0);
  });
});

describe('applying suppressions', () => {
  it('silences the named rule and nothing else', () => {
    const plain = analyzeFiles('/app', [settings(LEAKY)]);
    const excused = analyzeFiles('/app', [
      settings('{ "_c": "wardline-ignore-file WL-PRM-001 container only",\n' + LEAKY.slice(1)),
    ]);

    expect(plain.findings.some((f) => f.id === 'WL-PRM-001')).toBe(true);
    expect(excused.findings.some((f) => f.id === 'WL-PRM-001')).toBe(false);
    expect(excused.findings.some((f) => f.id === 'WL-PRM-003')).toBe(true);
  });

  it('records what was excused rather than hiding it', () => {
    const report = analyzeFiles('/app', [
      settings('{ "_c": "wardline-ignore-file WL-PRM-001 container only",\n' + LEAKY.slice(1)),
    ]);

    expect(report.summary.suppressed).toBe(1);
    expect(report.suppressions[0]).toMatchObject({
      id: 'WL-PRM-001',
      reason: 'container only',
      severity: 'critical',
    });
  });

  it('lifts the severity ceiling once the critical finding is excused', () => {
    const plain = analyzeFiles('/app', [settings(LEAKY)]);
    const excused = analyzeFiles('/app', [
      settings('{ "_c": "wardline-ignore-file WL-PRM-001 container only",\n' + LEAKY.slice(1)),
    ]);

    expect(plain.scorecard.grade).toBe('F');
    expect(excused.scorecard.score).toBeGreaterThan(plain.scorecard.score);
  });

  it('honours --no-suppress so the excuses can be audited', () => {
    const content = '{ "_c": "wardline-ignore-file WL-PRM-001 container only",\n' + LEAKY.slice(1);
    const audited = analyzeFiles('/app', [settings(content)], { noSuppress: true });

    expect(audited.findings.some((f) => f.id === 'WL-PRM-001')).toBe(true);
    expect(audited.summary.suppressed).toBe(0);
  });

  it('scopes a line directive to the line it sits on and the next', () => {
    const brief = makeFile({
      relPath: 'CLAUDE.md',
      kind: 'project-brief',
      content: [
        '# Notes',
        '<!-- wardline-ignore WL-AGT-002 deliberate for the release bot -->',
        'Always run the deploy script.',
        'Always run the smoke tests.',
      ].join('\n'),
    });

    const report = analyzeFiles('/app', [brief]);
    // Line 3 is excused; line 4 trips the same rule and is not.
    expect(report.summary.suppressed).toBe(1);
    expect(report.findings.filter((f) => f.id === 'WL-AGT-002')).toHaveLength(1);
  });
});
