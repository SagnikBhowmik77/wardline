/** Machine-readable reporters: JSON for pipelines, Markdown for humans in PRs. */

import { CATEGORIES } from '../types.js';
import { gradeSummary } from './score.js';
import type { Category, Finding, ScanReport } from '../types.js';

const CATEGORY_LABEL: Record<Category, string> = {
  secrets: 'Secrets',
  permissions: 'Permissions',
  hooks: 'Hooks',
  mcp: 'MCP servers',
  agents: 'Agent prompts',
};

export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2) + '\n';
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\|').replace(/\n/g, ' ');
}

function location(finding: Finding): string {
  return finding.line ? finding.relPath + ':' + finding.line : finding.relPath;
}

export function renderMarkdown(report: ScanReport): string {
  const { scorecard, summary, findings } = report;
  const out: string[] = [];

  out.push('# Wardline security report');
  out.push('');
  out.push('**Grade ' + scorecard.grade + '** - ' + scorecard.score + '/100');
  out.push('');
  out.push(gradeSummary(scorecard));
  out.push('');
  out.push('| Category | Score | Findings |');
  out.push('| --- | ---: | ---: |');

  for (const category of CATEGORIES) {
    const bucket = scorecard.categories[category];
    out.push(
      '| ' + CATEGORY_LABEL[category] + ' | ' + bucket.score + ' | ' + bucket.findings + ' |',
    );
  }

  out.push('');
  out.push(
    'Scanned ' +
      summary.filesScanned +
      ' file(s): ' +
      summary.critical +
      ' critical, ' +
      summary.high +
      ' high, ' +
      summary.medium +
      ' medium, ' +
      summary.low +
      ' low, ' +
      summary.info +
      ' info.',
  );
  out.push('');

  if (findings.length === 0) {
    out.push('No findings.');
    out.push('');
    return out.join('\n');
  }

  out.push('## Findings');
  out.push('');
  out.push('| Severity | Rule | Location | Issue |');
  out.push('| --- | --- | --- | --- |');

  for (const finding of findings) {
    out.push(
      '| ' +
        finding.severity +
        ' | `' +
        finding.id +
        '` | `' +
        escapeCell(location(finding)) +
        '` | ' +
        escapeCell(finding.title) +
        ' |',
    );
  }

  out.push('');
  out.push('## Detail');
  out.push('');

  for (const finding of findings) {
    out.push('### ' + finding.id + ' - ' + finding.title);
    out.push('');
    out.push('- **Severity:** ' + finding.severity);
    out.push('- **Location:** `' + location(finding) + '`');
    out.push('- **Source:** ' + finding.trust);
    if (finding.evidence) out.push('- **Evidence:** `' + escapeCell(finding.evidence) + '`');
    out.push('');
    out.push(finding.detail);
    out.push('');
    out.push('**Fix:** ' + finding.remedy);
    out.push('');
  }

  return out.join('\n');
}
