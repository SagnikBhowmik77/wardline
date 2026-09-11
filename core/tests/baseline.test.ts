import { describe, expect, it } from 'vitest';

import { buildBaseline, compareToBaseline, fingerprint, parseBaseline } from '../src/baseline';
import { analyzeFiles } from '../src/scanner/index';
import { makeFile } from './support';

const LOOSE = JSON.stringify({ permissions: { allow: ['Bash(*)'], deny: [] } });
const LOOSER = JSON.stringify({
  permissions: { allow: ['Bash(*)', 'Write(*)', 'Bash(curl *)'], deny: [] },
});

function reportFor(content: string) {
  return analyzeFiles('/app', [makeFile({ relPath: 'settings.json', kind: 'settings', content })]);
}

describe('fingerprints', () => {
  it('are stable for the same finding', () => {
    const a = reportFor(LOOSE).findings[0]!;
    const b = reportFor(LOOSE).findings[0]!;

    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('ignore the line a finding moved to', () => {
    const finding = reportFor(LOOSE).findings[0]!;
    const moved = { ...finding, line: (finding.line ?? 1) + 40 };

    expect(fingerprint(moved)).toBe(fingerprint(finding));
  });

  it('never contain the evidence itself', () => {
    const finding = { ...reportFor(LOOSE).findings[0]!, evidence: 'sk-ant-verysecretvalue' };
    const id = fingerprint(finding);

    expect(id).not.toContain('sk-ant');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('baseline comparison', () => {
  it('reports no regression against itself', () => {
    const report = reportFor(LOOSE);
    const comparison = compareToBaseline(report, buildBaseline(report));

    expect(comparison.added).toHaveLength(0);
    expect(comparison.resolved).toBe(0);
    expect(comparison.regressed).toBe(false);
    expect(comparison.scoreDelta).toBe(0);
  });

  it('flags a new finding as a regression', () => {
    const baseline = buildBaseline(reportFor(LOOSE));
    const comparison = compareToBaseline(reportFor(LOOSER), baseline);

    expect(comparison.added.length).toBeGreaterThan(0);
    expect(comparison.regressed).toBe(true);
  });

  it('counts a fixed finding as resolved, not a regression', () => {
    const baseline = buildBaseline(reportFor(LOOSER));
    const comparison = compareToBaseline(reportFor(LOOSE), baseline);

    expect(comparison.resolved).toBeGreaterThan(0);
    expect(comparison.added).toHaveLength(0);
    expect(comparison.regressed).toBe(false);
  });

  it('round-trips through JSON', () => {
    const baseline = buildBaseline(reportFor(LOOSE));
    const parsed = parseBaseline(JSON.stringify(baseline));

    expect(parsed.fingerprints).toEqual(baseline.fingerprints);
  });

  it('refuses a file that is not a baseline', () => {
    expect(() => parseBaseline('{"hello":true}')).toThrow(/not a Wardline baseline/);
    expect(() => parseBaseline('not json')).toThrow(/valid JSON/);
    expect(() => parseBaseline('{"tool":"wardline","version":99,"fingerprints":[]}')).toThrow(
      /not supported/,
    );
  });
});
