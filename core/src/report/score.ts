/**
 * Scoring.
 *
 * The grade has one job: tell you whether this configuration is safe to hand a
 * shell. So severity drives the deduction, source trust scales it, and no single
 * template file is allowed to dominate the result.
 */

import { CATEGORIES, TRUST_WEIGHT } from '../types.js';
import type { Category, CategoryScore, Finding, Scorecard, Severity } from '../types.js';

/** Deduction, in points out of 100, for one finding at full weight. */
const SEVERITY_POINTS: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 6,
  low: 2,
  info: 0,
};

/**
 * How much each category contributes to the headline number. Secrets weigh most
 * because a leaked credential is already an incident, not a risk.
 */
const CATEGORY_WEIGHT: Record<Category, number> = {
  secrets: 0.3,
  permissions: 0.2,
  hooks: 0.2,
  mcp: 0.15,
  agents: 0.15,
};

/**
 * Cap on what one file can deduct from one category when its findings are not
 * active runtime config. A catalog of 40 example servers is worth reading; it
 * is not worth the same grade as 40 enabled ones.
 */
const LOW_TRUST_FILE_CAP = 10;

/** Deduction for a single finding, after the source-trust discount. */
export function findingWeight(finding: Finding): number {
  const base = SEVERITY_POINTS[finding.severity];
  // A real credential is a real credential wherever *you* committed it. The one
  // exception is vendored plugin code: that key is not yours to rotate, and in
  // practice it is the vendor's test fixture. It still reports as critical.
  if (finding.category === 'secrets' && finding.trust !== 'plugin') return base;
  return base * TRUST_WEIGHT[finding.trust];
}

function emptyCategoryScore(): CategoryScore {
  return { score: 100, deducted: 0, findings: 0 };
}

export function scoreFindings(findings: Finding[]): Scorecard {
  const categories = {} as Record<Category, CategoryScore>;
  for (const category of CATEGORIES) categories[category] = emptyCategoryScore();

  // Track per-file totals so the low-trust cap can be applied per category.
  const capped = new Map<string, number>();

  for (const finding of findings) {
    const bucket = categories[finding.category];
    bucket.findings += 1;

    let weight = findingWeight(finding);
    const lowTrust =
      finding.trust !== 'runtime' &&
      (finding.category !== 'secrets' || finding.trust === 'plugin');

    if (lowTrust) {
      // Installed plugin content is one decision ("I installed this plugin"),
      // not one decision per file. Without a shared bucket a large plugin cache
      // sets the grade on its own and buries the config the user actually
      // wrote - which is exactly what a real ~/.claude scan showed.
      const key =
        finding.trust === 'plugin'
          ? finding.category + '::<installed plugins>'
          : finding.category + '::' + finding.relPath;
      const used = capped.get(key) ?? 0;
      const room = Math.max(0, LOW_TRUST_FILE_CAP - used);
      weight = Math.min(weight, room);
      capped.set(key, used + weight);
    }

    bucket.deducted += weight;
  }

  let overall = 0;
  for (const category of CATEGORIES) {
    const bucket = categories[category];
    bucket.deducted = Math.round(bucket.deducted * 10) / 10;
    bucket.score = Math.max(0, Math.min(100, Math.round(100 - bucket.deducted)));
    overall += bucket.score * CATEGORY_WEIGHT[category];
  }

  const averaged = Math.max(0, Math.min(100, Math.round(overall)));
  const { ceiling, cappedBy } = severityCeiling(findings);
  const score = Math.min(averaged, ceiling);

  return { grade: gradeFor(score), score, categories, cappedBy };
}

/** The best grade a configuration can hold while a finding of this severity stands. */
const SEVERITY_CEILING: Partial<Record<Severity, number>> = {
  critical: 59, // F
  high: 79, // C
  medium: 89, // B
};

/**
 * A weighted average lets four clean categories bury one catastrophic finding:
 * an unscoped `Bash(*)` used to score 91, an A. The grade answers one question,
 * "is this safe to hand a shell", so the worst live finding sets a ceiling the
 * average cannot climb past.
 *
 * Only findings that represent live exposure count. Vendored plugin content is
 * already capped in its deduction and must not drag the grade down for code the
 * user cannot edit.
 */
function severityCeiling(findings: Finding[]): { ceiling: number; cappedBy?: Severity } {
  let ceiling = 100;
  let cappedBy: Severity | undefined;

  for (const finding of findings) {
    if (finding.trust !== 'runtime' && finding.trust !== 'project-local') continue;

    const cap = SEVERITY_CEILING[finding.severity];
    if (cap === undefined || cap >= ceiling) continue;

    ceiling = cap;
    cappedBy = finding.severity;
  }

  return { ceiling, cappedBy };
}

export function gradeFor(score: number): Scorecard['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** One-line reading of the grade, printed under the score. */
export function gradeSummary(card: Scorecard): string {
  switch (card.grade) {
    case 'A':
      return 'No material exposure found. Re-scan when the config changes.';
    case 'B':
      return 'Broadly sound. A few entries are wider than they need to be.';
    case 'C':
      return 'Real gaps. Work through the high-severity findings before the next session.';
    case 'D':
      return 'This configuration is not safe to run unattended.';
    default:
      return 'Critical exposure. Rotate anything leaked and fix before running the agent again.';
  }
}
