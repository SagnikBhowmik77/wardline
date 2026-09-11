/** Self-contained HTML report: one file, no assets, no network. */

import { CATEGORIES } from '../types.js';
import { escapeHtml } from '../util/text.js';
import { gradeSummary } from './score.js';
import type { Category, Finding, ScanReport } from '../types.js';

const CATEGORY_LABEL: Record<Category, string> = {
  secrets: 'Secrets',
  permissions: 'Permissions',
  hooks: 'Hooks',
  mcp: 'MCP servers',
  agents: 'Agent prompts',
};

const STYLE = [
  ':root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1a1a1a;--muted:#6b6b6b;',
  '--card:#ffffff;--line:#e4e4e1;--crit:#b3261e;--high:#c8500f;--med:#946200;',
  '--low:#1f6feb;--info:#6b6b6b;--ok:#1a7f4b}',
  '@media (prefers-color-scheme:dark){:root{--bg:#121211;--fg:#eceae5;--muted:#9a9a94;',
  '--card:#1c1c1a;--line:#2e2e2b;--crit:#ff6b5e;--high:#ff9d52;--med:#e0b341;',
  '--low:#6fb0ff;--info:#9a9a94;--ok:#4fd08a}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);',
  'font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
  '.wrap{max-width:900px;margin:0 auto;padding:40px 20px 80px}',
  'h1{font-size:24px;margin:0 0 4px}',
  '.root{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}',
  '.grade{display:flex;align-items:baseline;gap:14px;margin:28px 0 6px}',
  '.g{font-size:56px;font-weight:700;line-height:1}',
  '.score{font-size:20px;color:var(--muted)}',
  '.lede{color:var(--muted);margin:0 0 28px}',
  'table{width:100%;border-collapse:collapse;margin-bottom:32px}',
  'td,th{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);font-size:14px}',
  'th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}',
  'td.num{text-align:right;font-variant-numeric:tabular-nums}',
  '.bar{height:7px;border-radius:4px;background:var(--line);overflow:hidden;min-width:120px}',
  '.bar span{display:block;height:100%}',
  '.f{background:var(--card);border:1px solid var(--line);border-left-width:4px;',
  'border-radius:8px;padding:14px 16px;margin-bottom:12px}',
  '.f h3{margin:0 0 6px;font-size:15px}',
  '.tag{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-right:8px}',
  '.loc{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted)}',
  '.f p{margin:8px 0 0}',
  '.ev{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;',
  'background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:5px 8px;',
  'margin-top:8px;overflow-x:auto;white-space:pre}',
  '.fix{margin-top:8px;font-size:14px}.fix b{color:var(--ok)}',
  'footer{margin-top:40px;color:var(--muted);font-size:12px}',
].join('');

function severityColor(severity: Finding['severity']): string {
  if (severity === 'critical') return 'var(--crit)';
  if (severity === 'high') return 'var(--high)';
  if (severity === 'medium') return 'var(--med)';
  if (severity === 'low') return 'var(--low)';
  return 'var(--info)';
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--ok)';
  if (score >= 60) return 'var(--med)';
  return 'var(--crit)';
}

function location(finding: Finding): string {
  return finding.line ? finding.relPath + ':' + finding.line : finding.relPath;
}

function findingCard(finding: Finding): string {
  const color = severityColor(finding.severity);
  const parts = [
    '<article class="f" style="border-left-color:' + color + '">',
    '<h3><span class="tag" style="color:' + color + '">',
    escapeHtml(finding.severity),
    '</span>',
    escapeHtml(finding.title),
    '</h3>',
    '<div class="loc">',
    escapeHtml(location(finding)),
    ' &middot; ',
    escapeHtml(finding.id),
    ' &middot; ',
    escapeHtml(finding.trust),
    '</div>',
    '<p>',
    escapeHtml(finding.detail),
    '</p>',
  ];

  if (finding.evidence) {
    parts.push('<div class="ev">' + escapeHtml(finding.evidence) + '</div>');
  }

  parts.push('<div class="fix"><b>Fix:</b> ' + escapeHtml(finding.remedy) + '</div>');
  parts.push('</article>');
  return parts.join('');
}

export function renderHtml(report: ScanReport): string {
  const { scorecard, summary, findings } = report;
  const rows = CATEGORIES.map((category) => {
    const bucket = scorecard.categories[category];
    return [
      '<tr><td>',
      CATEGORY_LABEL[category],
      '</td><td><div class="bar"><span style="width:',
      String(bucket.score),
      '%;background:',
      scoreColor(bucket.score),
      '"></span></div></td><td class="num">',
      String(bucket.score),
      '</td><td class="num">',
      String(bucket.findings),
      '</td></tr>',
    ].join('');
  }).join('');

  const cards = findings.length
    ? findings.map(findingCard).join('')
    : '<p>No findings.</p>';

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Wardline report</title><style>',
    STYLE,
    '</style></head><body><div class="wrap">',
    '<h1>Wardline security report</h1>',
    '<div class="root">',
    escapeHtml(report.root),
    '</div>',
    '<div class="grade"><div class="g" style="color:',
    scoreColor(scorecard.score),
    '">',
    scorecard.grade,
    '</div><div class="score">',
    String(scorecard.score),
    ' / 100</div></div>',
    '<p class="lede">',
    escapeHtml(gradeSummary(scorecard)),
    '</p>',
    '<table><thead><tr><th>Category</th><th></th><th class="num">Score</th>',
    '<th class="num">Findings</th></tr></thead><tbody>',
    rows,
    '</tbody></table>',
    '<h2>Findings</h2>',
    cards,
    '<footer>',
    String(summary.filesScanned),
    ' file(s) scanned &middot; generated ',
    escapeHtml(report.generatedAt),
    ' by Wardline ',
    escapeHtml(report.version),
    '</footer></div></body></html>',
  ].join('');
}
