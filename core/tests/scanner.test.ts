import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { classify, discover, discoverWithMeta, trustOf } from '../src/scanner/discovery';
import { analyzeFiles, scan, sortFindings } from '../src/scanner/index';
import { renderHtml } from '../src/report/html';
import { renderJson, renderMarkdown } from '../src/report/json';
import { renderTerminal } from '../src/report/terminal';
import { ALL_RULES } from '../src/rules/index';
import type { Finding } from '../src/types';
import { makeFile } from './support';

const DEMO = resolve(__dirname, '..', 'examples', 'insecure-config');

describe('file classification', () => {
  it('recognises the files an agent actually loads', () => {
    expect(classify('.claude/settings.json')).toBe('settings');
    expect(classify('.mcp.json')).toBe('mcp');
    expect(classify('CLAUDE.md')).toBe('project-brief');
    expect(classify('agents/reviewer.md')).toBe('agent-prompt');
    expect(classify('hooks/guard.sh')).toBe('hook-script');
    expect(classify('.env.local')).toBe('env');
  });

  it('ignores files that are none of its business', () => {
    expect(classify('src/index.ts')).toBeNull();
    expect(classify('README.md')).toBeNull();
    expect(classify('package.json')).toBeNull();
  });

  it('reads authority from the path', () => {
    expect(trustOf('.claude/settings.json', 'settings')).toBe('runtime');
    expect(trustOf('.claude/settings.local.json', 'settings')).toBe('project-local');
    expect(trustOf('examples/demo/settings.json', 'settings')).toBe('template');
    expect(trustOf('docs/guide/settings.json', 'settings')).toBe('docs');
  });
});

describe('discovery', () => {
  it('finds every config file in the demo tree', () => {
    const found = discover(DEMO).map((f) => f.relPath).sort();

    expect(found).toContain('settings.json');
    expect(found).toContain('.mcp.json');
    expect(found).toContain('CLAUDE.md');
    expect(found).toContain('agents/release-bot.md');
    expect(found).toContain('hooks/notify.sh');
  });

  it('parses JSON it discovers', () => {
    const settings = discover(DEMO).find((f) => f.relPath === 'settings.json');
    expect(settings?.data).toBeDefined();
    expect(settings?.parseError).toBeUndefined();
  });
});

describe('scan', () => {
  const report = scan({ path: DEMO });

  it('grades the deliberately insecure fixture as F', () => {
    expect(report.scorecard.grade).toBe('F');
    expect(report.summary.critical).toBeGreaterThan(5);
  });

  it('finds something in every category', () => {
    for (const category of ['secrets', 'permissions', 'hooks', 'mcp', 'agents'] as const) {
      expect(report.scorecard.categories[category].findings).toBeGreaterThan(0);
    }
  });

  it('never prints a full credential in any finding', () => {
    const key = 'sk-ant-api03-Rk7mQ2vTb9LpXc4NwZs8Hj1FdGy6Ae0BuIoPqWrTyUiOpAsDfGhJkLmN3xY7Zq';
    const serialised = JSON.stringify(report);

    expect(serialised).not.toContain(key);
  });

  it('honours the minimum severity filter', () => {
    const criticalOnly = scan({ path: DEMO, minSeverity: 'critical' });

    expect(criticalOnly.findings.every((f) => f.severity === 'critical')).toBe(true);
    expect(criticalOnly.findings.length).toBeLessThan(report.findings.length);
  });

  it('emits no duplicate rule/location/evidence triples', () => {
    const keys = report.findings.map((f) => [f.id, f.relPath, f.line, f.evidence].join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every finding a remedy and a known rule id', () => {
    const known = new Set(ALL_RULES.map((r) => r.id));

    for (const finding of report.findings) {
      expect(finding.remedy.length).toBeGreaterThan(10);
      expect(known.has(finding.id)).toBe(true);
    }
  });
});

describe('sorting', () => {
  it('puts the most severe finding first', () => {
    const base = { title: 't', detail: 'd', remedy: 'r', trust: 'runtime' } as const;
    const input = [
      { ...base, id: 'a', category: 'hooks', severity: 'low', relPath: 'a' },
      { ...base, id: 'b', category: 'hooks', severity: 'critical', relPath: 'b' },
      { ...base, id: 'c', category: 'hooks', severity: 'medium', relPath: 'c' },
    ] as Finding[];

    expect(sortFindings(input).map((f) => f.severity)).toEqual(['critical', 'medium', 'low']);
  });
});

describe('reporters', () => {
  const report = scan({ path: DEMO });

  it('produces valid JSON', () => {
    const parsed = JSON.parse(renderJson(report));
    expect(parsed.tool).toBe('wardline');
    expect(parsed.findings.length).toBe(report.findings.length);
  });

  it('produces markdown with a findings table', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('# Wardline security report');
    expect(md).toContain('| Severity | Rule | Location | Issue |');
  });

  it('produces a self-contained HTML document with no remote references', () => {
    const html = renderHtml(report);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
  });

  it('escapes HTML so evidence cannot break the report', () => {
    const html = renderHtml({
      ...report,
      findings: [
        {
          ...(report.findings[0] as Finding),
          evidence: '<script>alert(1)</script>',
        },
      ],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a terminal report without colour when asked', () => {
    const text = renderTerminal(report, true);
    expect(text).toContain('Wardline');
    expect(text).toContain('Grade F');
  });
});

describe('plugin and truncation awareness', () => {
  it('treats installed plugin content as plugin, not runtime', () => {
    expect(trustOf('plugins/cache/vendor/toolpack/1.4.0/agents/worker.md', 'agent-prompt')).toBe('plugin');
    expect(trustOf('plugins/marketplaces/vendor/.mcp.json', 'mcp')).toBe('plugin');
    expect(trustOf('.claude/settings.json', 'settings')).toBe('runtime');
  });

  it('treats a references directory as documentation', () => {
    expect(trustOf('.agents/skills/prisma/references/setup.md', 'agent-prompt')).toBe('docs');
  });

  it('reports whether the scan was complete', () => {
    const result = discoverWithMeta(DEMO);

    expect(result.truncated).toBe(false);
    expect(scan({ path: DEMO }).summary.truncated).toBe(false);
  });

});

describe('evidence weighting', () => {
  it('marks a near-empty configuration as thin', () => {
    const files = [
      makeFile({ relPath: 'CLAUDE.md', kind: 'project-brief', content: '# Frontend\n' }),
      makeFile({ relPath: 'AGENTS.md', kind: 'project-brief', content: 'Use the design tokens.\n' }),
    ];
    const report = analyzeFiles('/work/app', files);

    expect(report.summary.evidence).toBe('thin');
    expect(report.summary.configBytes).toBeLessThan(200);
    expect(report.summary.total).toBe(0);
  });

  it('treats a real configuration as sufficient evidence', () => {
    const report = scan({ path: DEMO });

    expect(report.summary.evidence).toBe('sufficient');
    expect(report.summary.configBytes).toBeGreaterThan(1200);
  });

  it('counts the bytes it actually read', () => {
    const content = 'x'.repeat(4000);
    const report = analyzeFiles('/work/app', [
      makeFile({ relPath: 'CLAUDE.md', kind: 'project-brief', content }),
    ]);

    expect(report.summary.configBytes).toBe(4000);
    expect(report.summary.evidence).toBe('sufficient');
  });

  it('withholds the grade line when there was nothing to read', () => {
    const files = [makeFile({ relPath: 'CLAUDE.md', kind: 'project-brief', content: '# app\n' })];
    const text = renderTerminal(analyzeFiles('/work/app', files), true);

    expect(text).toContain('not enough configuration to rate');
    expect(text).not.toContain('Grade A');
  });
});
