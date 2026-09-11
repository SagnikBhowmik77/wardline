/**
 * Inline suppressions.
 *
 * Every real configuration has a finding that is genuinely fine, and a scanner
 * with no escape hatch is one people stop running. The bargain here is that a
 * suppression must be written next to the thing it excuses, must name the rule,
 * and is always counted in the report - silenced is not the same as clean.
 *
 * Parsing is deliberately regex-light so no escaping mistake can quietly stop a
 * directive from being recognised.
 *
 *   # wardline-ignore WL-MCP-006 pinned by our lockfile
 *   // wardline-ignore-file WL-AGT-013
 *   <!-- wardline-ignore-all vendored upstream sample -->
 */

import type { ConfigFile, Finding } from './types.js';

const LINE_DIRECTIVE = 'wardline-ignore';
const FILE_DIRECTIVE = 'wardline-ignore-file';
const ALL_DIRECTIVE = 'wardline-ignore-all';

/** Rule ids look like WL-SEC-001; anything else on the line is the reason. */
function looksLikeRuleId(token: string): boolean {
  const parts = token.split('-');
  if (parts.length !== 3) return false;
  if (parts[0]?.toUpperCase() !== 'WL') return false;
  const tail = parts[2] ?? '';
  return tail.length > 0 && !Number.isNaN(Number(tail));
}

export interface Suppression {
  relPath: string;
  ruleIds: string[];
  /** Absent when the directive covers the whole file. */
  line?: number;
  scope: 'line' | 'file';
  reason: string;
}

function parseDirective(text: string): { ruleIds: string[]; reason: string } {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const ruleIds: string[] = [];
  const words: string[] = [];

  for (const token of tokens) {
    // Directives sit inside JSON strings and HTML comments as often as shell
    // comments, so the surrounding punctuation is never part of the reason.
    const clean = token.replace(/-->$/, '').replace(/[:'"()<>,;]+$/, '').replace(/^[:'"(<]+/, '');
    if (clean.length === 0) continue;

    if (looksLikeRuleId(clean)) ruleIds.push(clean.toUpperCase());
    else words.push(clean);
  }

  return { ruleIds, reason: words.join(' ').trim() };
}

/** Read every suppression directive a file declares. */
export function readSuppressions(file: ConfigFile): Suppression[] {
  const out: Suppression[] = [];

  file.content.split('\n').forEach((raw, index) => {
    const lower = raw.toLowerCase();
    const at = lower.indexOf(LINE_DIRECTIVE);
    if (at === -1) return;

    const isAll = lower.startsWith(ALL_DIRECTIVE, at);
    const isFile = lower.startsWith(FILE_DIRECTIVE, at);
    const directive = isAll ? ALL_DIRECTIVE : isFile ? FILE_DIRECTIVE : LINE_DIRECTIVE;

    const { ruleIds, reason } = parseDirective(raw.slice(at + directive.length));

    out.push({
      relPath: file.relPath,
      ruleIds: isAll ? ['*'] : ruleIds,
      scope: isAll || isFile ? 'file' : 'line',
      line: isAll || isFile ? undefined : index + 1,
      reason,
    });
  });

  // A bare `wardline-ignore` with no rule id excuses nothing: it would be an
  // invisible blanket, and the directive is meant to be specific.
  return out.filter((s) => s.ruleIds.length > 0);
}

export interface SuppressionResult {
  kept: Finding[];
  suppressed: { finding: Finding; reason: string }[];
}

/**
 * Drop findings a file has excused. A line directive covers its own line and
 * the one after it, so it can sit above or beside the offending entry.
 */
export function applySuppressions(findings: Finding[], files: ConfigFile[]): SuppressionResult {
  const byPath = new Map<string, Suppression[]>();

  for (const file of files) {
    const found = readSuppressions(file);
    if (found.length > 0) byPath.set(file.relPath, found);
  }

  if (byPath.size === 0) return { kept: findings, suppressed: [] };

  const kept: Finding[] = [];
  const suppressed: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const rules = byPath.get(finding.relPath);
    const match = rules?.find((s) => {
      const named = s.ruleIds.includes('*') || s.ruleIds.includes(finding.id);
      if (!named) return false;
      if (s.scope === 'file') return true;
      if (finding.line === undefined || s.line === undefined) return false;
      return finding.line === s.line || finding.line === s.line + 1;
    });

    if (match) suppressed.push({ finding, reason: match.reason });
    else kept.push(finding);
  }

  return { kept, suppressed };
}
