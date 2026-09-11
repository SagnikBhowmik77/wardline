/**
 * Scan orchestrator: discover files, run every rule over them, sort what comes
 * back, and score it.
 *
 * The rule engine never touches the filesystem itself, so the same pipeline
 * serves a local directory scan and a set of files fetched from a remote host.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { ALL_RULES } from '../rules/index.js';
import { scoreFindings } from '../report/score.js';
import { SEVERITY_ORDER, THIN_EVIDENCE_BYTES } from '../types.js';
import { VERSION } from '../version.js';
import { harnessesIn } from '../harness.js';
import { applySuppressions } from '../suppress.js';
import { configFileFrom, discover, discoverWithMeta } from './discovery.js';
import type {
  ConfigFile,
  Finding,
  ScanContext,
  ScanReport,
  ScanSummary,
  Severity,
  SuppressedFinding,
} from '../types.js';

export interface ScanOptions {
  /** Explicit directory or file to scan. */
  path?: string;
  /** Drop findings below this severity before reporting. */
  minSeverity?: Severity;
  /** Ignore wardline-ignore directives. */
  noSuppress?: boolean;
  /** Restrict the scan to these relative paths, as --diff does. */
  only?: string[];
}

export interface AnalyzeOptions {
  minSeverity?: Severity;
  /** Ignore wardline-ignore directives, to see what is being excused. */
  noSuppress?: boolean;
  /** Mark the report as partial, when the caller knows it did not read everything. */
  truncated?: boolean;
}

/**
 * Where to scan when the user did not say.
 *
 * A project directory wins over the user-level config, because the project is
 * almost always what you are asking about.
 */
export function resolveTarget(explicit?: string, cwd = process.cwd()): string {
  if (explicit) {
    return isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
  }
  if (existsSync(join(cwd, '.claude'))) return cwd;

  const userConfig = join(homedir(), '.claude');
  if (existsSync(userConfig)) return userConfig;

  return cwd;
}

function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** Most severe first, then by file, then by line, so output is stable. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;

    const byPath = a.relPath.localeCompare(b.relPath);
    if (byPath !== 0) return byPath;

    const byLine = (a.line ?? 0) - (b.line ?? 0);
    if (byLine !== 0) return byLine;

    return a.id.localeCompare(b.id);
  });
}

/**
 * Two rules can legitimately notice the same thing in the same place. Keep the
 * first, drop exact repeats.
 */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];

  for (const finding of findings) {
    const key = [finding.id, finding.relPath, finding.line ?? '', finding.evidence ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }

  return out;
}

function summarise(
  findings: Finding[],
  files: ConfigFile[],
  truncated: boolean,
  suppressed: number,
): ScanSummary {
  const configBytes = files.reduce((total, file) => total + file.content.length, 0);

  const summary: ScanSummary = {
    filesScanned: files.length,
    configBytes,
    // A clean grade earned from almost no configuration is not a clean grade.
    evidence: configBytes < THIN_EVIDENCE_BYTES ? 'thin' : 'sufficient',
    suppressed,
    truncated,
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    autoFixable: 0,
  };

  for (const finding of findings) {
    summary[finding.severity] += 1;
    if (finding.autoFixable) summary.autoFixable += 1;
  }

  return summary;
}

/**
 * Run every rule over a set of files that are already in memory.
 *
 * This is the seam the platform uses: config fetched over HTTP never touches
 * disk, but it is analysed by exactly the same rules as a local scan.
 */
export function analyzeFiles(
  root: string,
  files: ConfigFile[],
  options: AnalyzeOptions = {},
): ScanReport {
  const ctx: ScanContext = { root, files };

  let findings: Finding[] = [];
  for (const rule of ALL_RULES) {
    try {
      findings.push(...rule.run(ctx));
    } catch (err) {
      // One broken rule must never take the scan down with it.
      const reason = err instanceof Error ? err.message : String(err);
      process.emitWarning('Rule ' + rule.id + ' failed: ' + reason);
    }
  }

  findings = sortFindings(dedupe(findings));

  let suppressions: SuppressedFinding[] = [];
  if (!options.noSuppress) {
    const result = applySuppressions(findings, files);
    findings = result.kept;
    suppressions = result.suppressed.map(({ finding, reason }) => ({
      id: finding.id,
      relPath: finding.relPath,
      line: finding.line,
      title: finding.title,
      severity: finding.severity,
      reason,
    }));
  }

  if (options.minSeverity) {
    const floor = severityRank(options.minSeverity);
    findings = findings.filter((f) => severityRank(f.severity) <= floor);
  }

  return {
    tool: 'wardline',
    suppressions,
    harnesses: harnessesIn(files),
    version: VERSION,
    generatedAt: new Date().toISOString(),
    root,
    scorecard: scoreFindings(findings),
    summary: summarise(findings, files, options.truncated ?? false, suppressions.length),
    findings,
  };
}

export function scan(options: ScanOptions = {}): ScanReport {
  const root = resolveTarget(options.path);

  if (!existsSync(root)) {
    throw new Error('Nothing to scan at ' + root);
  }

  const { files, truncated } = discoverWithMeta(root);

  // --diff narrows the scan to what a commit touched. Filtering after discovery
  // keeps one code path: the same classification, the same rules, fewer files.
  const selected = options.only
    ? files.filter((f) => options.only?.includes(f.relPath))
    : files;

  return analyzeFiles(root, selected, {
    minSeverity: options.minSeverity,
    noSuppress: options.noSuppress,
    truncated,
  });
}

/** Convenience for tests and library consumers that already have files. */
export function scanFiles(ctx: ScanContext): Finding[] {
  const findings: Finding[] = [];
  for (const rule of ALL_RULES) findings.push(...rule.run(ctx));
  return sortFindings(dedupe(findings));
}

export { configFileFrom, discover };
