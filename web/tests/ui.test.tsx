import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Testing Library only auto-cleans when vitest globals are on, and they are
// off here; without this, one render leaks into the next assertion.
afterEach(cleanup);

import { Findings, Index, Ledger, Meters, gradeInk, levelInk, shortSlug } from '../src/ui';
import { isUnrated } from '../src/api';
import type { FindingRow, ScanRow } from '../src/api';

function scanRow(over: Partial<ScanRow>): ScanRow {
  return {
    id: 1,
    slug: 'owner/repo',
    source: 'github',
    created_at: '2026-09-11T00:00:00.000Z',
    grade: 'A',
    score: 100,
    secrets: 100,
    permissions: 100,
    hooks: 100,
    mcp: 100,
    agents: 100,
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    files_scanned: 3,
    config_bytes: 4000,
    evidence: 'sufficient',
    harnesses: [],
    truncated: 0,
    ...over,
  } as ScanRow;
}

describe('presentation helpers', () => {
  it('colours a grade by how bad it is', () => {
    expect(gradeInk('A')).toBe(gradeInk('B'));
    expect(gradeInk('F')).not.toBe(gradeInk('A'));
    expect(levelInk(95)).not.toBe(levelInk(20));
  });

  it('shortens a long Windows path to something readable', () => {
    expect(shortSlug('C:/Users/Sagnik Bhowmik/my-dashboard/aetherquant')).toBe(
      'my-dashboard/aetherquant',
    );
    expect(shortSlug('owner/repo')).toBe('owner/repo');
  });

  it('calls a thin scan with no findings unrated', () => {
    expect(isUnrated({ evidence: 'thin', total: 0 })).toBe(true);
    // Thin but with findings is still a real result.
    expect(isUnrated({ evidence: 'thin', total: 3 })).toBe(false);
    expect(isUnrated({ evidence: 'sufficient', total: 0 })).toBe(false);
  });
});

describe('the scan index', () => {
  it('shows a dash instead of a grade for an unrated scan', () => {
    const rows = [
      scanRow({ id: 1, slug: 'a/rated' }),
      scanRow({ id: 2, slug: 'b/empty', evidence: 'thin', total: 0, grade: 'A' }),
    ];

    render(<Index scans={rows} selected={1} onSelect={() => {}} />);

    expect(screen.getByText('A')).toBeDefined();
    // The empty repository must not present itself as an A.
    expect(screen.getByText('–')).toBeDefined();
  });

  it('says so when there is nothing to list', () => {
    render(<Index scans={[]} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/no scans yet/i)).toBeDefined();
  });
});

describe('the findings table', () => {
  const findings: FindingRow[] = [
    {
      id: 1,
      rule_id: 'WL-PRM-001',
      category: 'permissions',
      severity: 'critical',
      title: 'Shell access allowed without any command scope',
      rel_path: '.claude/settings.json',
      line: 4,
      trust: 'runtime',
      evidence: 'Bash(*)',
    },
    {
      id: 2,
      rule_id: 'WL-AGT-013',
      category: 'agents',
      severity: 'info',
      title: 'Agent definition has no description',
      rel_path: 'agents/worker.md',
      line: 1,
      trust: 'template',
      evidence: null,
    },
  ];

  it('lists every finding when nothing is filtered', () => {
    render(<Findings findings={findings} filter="all" onFilter={() => {}} />);

    expect(screen.getByText(/Shell access allowed/)).toBeDefined();
    expect(screen.getByText(/no description/)).toBeDefined();
  });

  it('shows only the chosen severity', () => {
    render(<Findings findings={findings} filter="critical" onFilter={() => {}} />);

    expect(screen.getByText(/Shell access allowed/)).toBeDefined();
    expect(screen.queryByText(/no description/)).toBeNull();
  });

  it('surfaces the source when a finding is not from live config', () => {
    render(<Findings findings={findings} filter="all" onFilter={() => {}} />);
    expect(screen.getByText(/template/)).toBeDefined();
  });
});

describe('the detected-agent pills', () => {
  // The API hands these over already parsed. When that contract slipped, the
  // dashboard rendered nothing at all, so the shape is asserted here.
  it('treats harnesses as a list, not a string', () => {
    const row = scanRow({ harnesses: ['Claude Code', 'Cursor'] });

    expect(Array.isArray(row.harnesses)).toBe(true);
    expect(row.harnesses.map((label) => label)).toEqual(['Claude Code', 'Cursor']);
  });
});

describe('benchmark panels', () => {
  it('renders a row per category with its verdict', () => {
    render(
      <Meters
        rows={[
          { category: 'secrets', score: 100, corpusMedian: 90, percentile: 80, verdict: 'top quartile' },
          { category: 'hooks', score: 40, corpusMedian: 70, percentile: 12, verdict: 'bottom quartile' },
        ]}
      />,
    );

    expect(screen.getByText('secrets')).toBeDefined();
    expect(screen.getByText('bottom quartile')).toBeDefined();
  });

  it('explains an empty ledger rather than rendering nothing', () => {
    render(<Ledger gaps={[]} mode="yours" />);
    expect(screen.getByText(/add repositories/i)).toBeDefined();
  });
});
