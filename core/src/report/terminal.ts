/** Human-facing terminal report. */

import { style } from '../util/color.js';
import { CATEGORIES } from '../types.js';
import { gradeSummary } from './score.js';
import type { Category, Finding, ScanReport, Severity } from '../types.js';

const CATEGORY_LABEL: Record<Category, string> = {
  secrets: 'Secrets',
  permissions: 'Permissions',
  hooks: 'Hooks',
  mcp: 'MCP servers',
  agents: 'Agent prompts',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
};

function paintSeverity(severity: Severity, text: string): string {
  switch (severity) {
    case 'critical':
      return style.red(style.bold(text));
    case 'high':
      return style.red(text);
    case 'medium':
      return style.yellow(text);
    case 'low':
      return style.cyan(text);
    default:
      return style.gray(text);
  }
}

function paintGrade(grade: string, text: string): string {
  if (grade === 'A' || grade === 'B') return style.green(style.bold(text));
  if (grade === 'C') return style.yellow(style.bold(text));
  return style.red(style.bold(text));
}

/** Fixed-width meter, so the five category rows line up. */
function meter(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const bar = '#'.repeat(filled) + '.'.repeat(width - filled);
  if (score >= 80) return style.green(bar);
  if (score >= 60) return style.yellow(bar);
  return style.red(bar);
}

function trustNote(finding: Finding): string {
  switch (finding.trust) {
    case 'template':
      return ' ' + style.gray('(template - shipped, not necessarily enabled)');
    case 'docs':
      return ' ' + style.gray('(docs example)');
    case 'project-local':
      return ' ' + style.gray('(local override)');
    case 'plugin':
      return ' ' + style.gray('(installed plugin, not your own config)');
    default:
      return '';
  }
}

function location(finding: Finding): string {
  return finding.line ? finding.relPath + ':' + finding.line : finding.relPath;
}

function renderFinding(finding: Finding): string[] {
  const lines: string[] = [];
  const head =
    '  ' +
    paintSeverity(finding.severity, SEVERITY_LABEL[finding.severity].padEnd(8)) +
    ' ' +
    style.bold(finding.title) +
    ' ' +
    style.gray(finding.id);

  lines.push(head);
  lines.push('    ' + style.cyan(location(finding)) + trustNote(finding));
  lines.push('    ' + finding.detail);

  if (finding.evidence) {
    lines.push('    ' + style.gray('evidence: ') + finding.evidence);
  }

  const fixable = finding.autoFixable ? ' ' + style.green('[--fix]') : '';
  lines.push('    ' + style.gray('fix: ') + finding.remedy + fixable);
  lines.push('');

  return lines;
}

export function renderTerminal(report: ScanReport, verbose = false): string {
  const out: string[] = [];
  const { scorecard, summary, findings } = report;

  out.push('');
  out.push('  ' + style.bold('Wardline') + style.gray(' security report'));
  out.push('  ' + style.gray(report.root));

  if (report.harnesses.length > 0) {
    out.push(
      '  ' +
        style.gray('agents: ') +
        report.harnesses.map((h) => h.label + ' (' + h.files + ')').join(style.gray('  ')),
    );
  }

  out.push('');

  // A clean score drawn from almost no configuration is not a clean score, and
  // printing it as an A is the most misleading thing this tool could do.
  const unrated = summary.evidence === 'thin' && summary.total === 0;

  if (unrated) {
    out.push('  Grade ' + style.gray('--') + '  ' + style.bold('not enough configuration to rate'));
    out.push(
      '  ' +
        style.gray(
          'Only ' +
            summary.configBytes +
            ' bytes across ' +
            summary.filesScanned +
            ' file(s). Nothing was flagged because there was almost nothing to read.',
        ),
    );
  } else {
    out.push(
      '  Grade ' +
        paintGrade(scorecard.grade, scorecard.grade) +
        '  ' +
        style.bold(String(scorecard.score)) +
        style.gray('/100'),
    );
    out.push('  ' + style.gray(gradeSummary(scorecard)));
    if (summary.evidence === 'thin') {
      out.push(
        '  ' +
          style.yellow('THIN EVIDENCE') +
          style.gray('  only ' + summary.configBytes + ' bytes of configuration were read'),
      );
    }
  }

  out.push('');

  // Perfect category bars drawn from an empty config carry the same false
  // reassurance as the grade, so they are withheld on the same condition.
  for (const category of unrated ? [] : CATEGORIES) {
    const bucket = scorecard.categories[category];
    out.push(
      '  ' +
        CATEGORY_LABEL[category].padEnd(14) +
        meter(bucket.score) +
        ' ' +
        String(bucket.score).padStart(3) +
        style.gray('  ' + bucket.findings + ' finding' + (bucket.findings === 1 ? '' : 's')),
    );
  }
  out.push('');

  if (findings.length === 0) {
    out.push(
      '  ' +
        (unrated
          ? style.gray('Add real configuration, then scan again.')
          : style.green('Nothing flagged across ' + summary.filesScanned + ' file(s).')),
    );
    out.push('');
    return out.join('\n');
  }

  const shown = verbose ? findings : findings.filter((f) => f.severity !== 'info').slice(0, 40);

  for (const finding of shown) out.push(...renderFinding(finding));

  if (shown.length < findings.length) {
    out.push(
      '  ' +
        style.gray(
          (findings.length - shown.length) +
            ' more finding(s) not shown. Use --verbose, or --format json for the full set.',
        ),
    );
    out.push('');
  }

  out.push('  ' + style.bold('Summary'));
  out.push(
    '  ' +
      style.gray('examined       ') +
      summary.filesScanned +
      ' file(s), ' +
      summary.configBytes +
      ' bytes of configuration',
  );

  if (summary.truncated) {
    out.push(
      '  ' +
        style.yellow('PARTIAL SCAN') +
        style.gray(
          '   the file ceiling was reached, so some files were never read. ' +
            'Scan a narrower --path for complete results.',
        ),
    );
  }

  out.push(
    '  ' +
      style.gray('findings       ') +
      summary.total +
      '  ' +
      paintSeverity('critical', summary.critical + ' critical') +
      ', ' +
      paintSeverity('high', summary.high + ' high') +
      ', ' +
      paintSeverity('medium', summary.medium + ' medium') +
      ', ' +
      paintSeverity('low', summary.low + ' low') +
      ', ' +
      paintSeverity('info', summary.info + ' info'),
  );

  // A suppressed finding is a decision someone made, and it belongs in the
  // report. Silenced is not the same as clean.
  if (summary.suppressed > 0) {
    out.push(
      '  ' +
        style.gray('suppressed     ') +
        summary.suppressed +
        style.gray('  (wardline-ignore; re-run with --no-suppress to audit them)'),
    );

    for (const item of report.suppressions.slice(0, 10)) {
      const where = item.line ? item.relPath + ':' + item.line : item.relPath;
      out.push(
        '    ' +
          style.gray(item.id + '  ' + where) +
          (item.reason ? style.gray('  - ' + item.reason) : ''),
      );
    }
  }

  if (summary.autoFixable > 0) {
    out.push(
      '  ' +
        style.gray('auto-fixable   ') +
        summary.autoFixable +
        style.gray('  run: wardline scan --fix'),
    );
  }

  out.push('');
  return out.join('\n');
}
