/**
 * Baselines.
 *
 * Nobody adopts a scanner that fails on day one against an imperfect
 * repository. A baseline records what was already there so CI can fail on
 * regressions only, which is the difference between a gate people keep and one
 * they disable within a week.
 *
 * Fingerprints are hashed, never raw: a baseline lives in version control for
 * months, and must not become the place a token-shaped string is preserved.
 */

import { createHash } from 'node:crypto';

import type { Finding, ScanReport } from './types.js';

export const BASELINE_VERSION = 1;

export interface Baseline {
  tool: 'wardline';
  version: number;
  createdAt: string;
  root: string;
  grade: string;
  score: number;
  fingerprints: string[];
}

/**
 * A stable identity for a finding.
 *
 * The line number is deliberately excluded: code moves, and a finding that slid
 * down three lines is the same finding, not a new one.
 */
export function fingerprint(finding: Finding): string {
  const material = [finding.id, finding.relPath, finding.evidence ?? ''].join(' ');
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

export function buildBaseline(report: ScanReport): Baseline {
  const fingerprints = [...new Set(report.findings.map(fingerprint))].sort();

  return {
    tool: 'wardline',
    version: BASELINE_VERSION,
    createdAt: report.generatedAt,
    root: report.root,
    grade: report.scorecard.grade,
    score: report.scorecard.score,
    fingerprints,
  };
}

export interface BaselineComparison {
  /** Findings that were not in the baseline. */
  added: Finding[];
  /** Baseline entries no longer present. */
  resolved: number;
  unchanged: number;
  scoreDelta: number;
  /** True when something got worse: a new finding, or a lower score. */
  regressed: boolean;
}

export function compareToBaseline(report: ScanReport, baseline: Baseline): BaselineComparison {
  const known = new Set(baseline.fingerprints);
  const seen = new Set<string>();
  const added: Finding[] = [];

  for (const finding of report.findings) {
    const id = fingerprint(finding);
    seen.add(id);
    if (!known.has(id)) added.push(finding);
  }

  const unchanged = [...known].filter((id) => seen.has(id)).length;
  const scoreDelta = report.scorecard.score - baseline.score;

  return {
    added,
    resolved: known.size - unchanged,
    unchanged,
    scoreDelta,
    regressed: added.length > 0 || scoreDelta < 0,
  };
}

/** Parse a baseline file, rejecting anything that is not one. */
export function parseBaseline(text: string): Baseline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('baseline file is not valid JSON');
  }

  const b = data as Partial<Baseline>;
  if (b.tool !== 'wardline' || !Array.isArray(b.fingerprints)) {
    throw new Error('that file is not a Wardline baseline');
  }
  if (b.version !== BASELINE_VERSION) {
    throw new Error('baseline version ' + String(b.version) + ' is not supported');
  }

  return b as Baseline;
}
