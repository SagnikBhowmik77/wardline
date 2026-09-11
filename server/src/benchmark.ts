/**
 * Benchmarking.
 *
 * A grade tells you how your configuration scores. A percentile tells you
 * whether that score is normal, which is the question people actually have.
 * Both come from the same corpus of real public configurations.
 */

import type { ScanRow, Store } from './db.js';

const CATEGORIES = ['secrets', 'permissions', 'hooks', 'mcp', 'agents'] as const;
export type CategoryKey = (typeof CATEGORIES)[number];

export interface CategoryBenchmark {
  category: CategoryKey;
  score: number;
  corpusMedian: number;
  percentile: number;
  verdict: string;
}

export interface RuleGap {
  ruleId: string;
  title: string;
  category: string;
  corpusRepos: number;
  corpusShare: number;
  yours: number;
}

export interface Benchmark {
  scanId: number;
  slug: string;
  corpusSize: number;
  overall: { score: number; grade: string; corpusMedian: number; percentile: number; verdict: string };
  categories: CategoryBenchmark[];
  /** Rules you trip that most of the corpus does not - the unusual risks. */
  uncommonIssues: RuleGap[];
  /** Rules most of the corpus trips that you do not - where you are ahead. */
  avoidedIssues: RuleGap[];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

/**
 * Share of the population this value beats, counting ties as half. Standard
 * mid-rank percentile, so a config identical to every other lands at 50.
 */
export function percentileOf(value: number, population: number[]): number {
  if (population.length === 0) return 50;

  let below = 0;
  let equal = 0;
  for (const p of population) {
    if (p < value) below++;
    else if (p === value) equal++;
  }

  return Math.round(((below + equal / 2) / population.length) * 100);
}

export function verdictFor(percentile: number): string {
  if (percentile >= 90) return 'best 10%';
  if (percentile >= 75) return 'top quartile';
  if (percentile >= 55) return 'above median';
  if (percentile > 45) return 'about median';
  if (percentile >= 25) return 'below median';
  if (percentile >= 10) return 'bottom quartile';
  return 'worst 10%';
}

export function buildBenchmark(store: Store, scan: ScanRow): Benchmark {
  const corpus = store.latestCorpusScans().filter((row) => row.id !== scan.id);
  const corpusSize = corpus.length;

  const overallScores = corpus.map((c) => c.score);
  const overallPercentile = percentileOf(scan.score, overallScores);

  const categories: CategoryBenchmark[] = CATEGORIES.map((category) => {
    const population = corpus.map((c) => c[category]);
    const percentile = percentileOf(scan[category], population);

    return {
      category,
      score: scan[category],
      corpusMedian: median(population),
      percentile,
      verdict: verdictFor(percentile),
    };
  });

  const prevalence = store.rulePrevalence();
  const yourFindings = store.findings(scan.id);

  const yourCounts = new Map<string, number>();
  for (const f of yourFindings) {
    yourCounts.set(f.rule_id, (yourCounts.get(f.rule_id) ?? 0) + 1);
  }

  const toGap = (row: { rule_id: string; title: string; category: string; repos: number }): RuleGap => ({
    ruleId: row.rule_id,
    title: row.title,
    category: row.category,
    corpusRepos: row.repos,
    corpusShare: corpusSize > 0 ? Math.round((row.repos / corpusSize) * 100) : 0,
    yours: yourCounts.get(row.rule_id) ?? 0,
  });

  const known = new Set(prevalence.map((p) => p.rule_id));

  // Something you trip that few others do is the most actionable signal here.
  const uncommonIssues = prevalence
    .map(toGap)
    .filter((g) => g.yours > 0 && g.corpusShare <= 25)
    .sort((a, b) => a.corpusShare - b.corpusShare)
    .slice(0, 8);

  // Rules you trip that the corpus has never produced at all still count.
  for (const [ruleId, count] of yourCounts) {
    if (known.has(ruleId)) continue;
    const first = yourFindings.find((f) => f.rule_id === ruleId);
    if (!first) continue;

    uncommonIssues.push({
      ruleId,
      title: first.title,
      category: first.category,
      corpusRepos: 0,
      corpusShare: 0,
      yours: count,
    });
  }

  const avoidedIssues = prevalence
    .map(toGap)
    .filter((g) => g.yours === 0 && g.corpusShare >= 40)
    .sort((a, b) => b.corpusShare - a.corpusShare)
    .slice(0, 6);

  return {
    scanId: scan.id,
    slug: scan.slug,
    corpusSize,
    overall: {
      score: scan.score,
      grade: scan.grade,
      corpusMedian: median(overallScores),
      percentile: overallPercentile,
      verdict: verdictFor(overallPercentile),
    },
    categories,
    uncommonIssues: uncommonIssues.slice(0, 10),
    avoidedIssues,
  };
}

export interface CorpusStats {
  size: number;
  grades: Record<string, number>;
  medians: Record<string, number>;
  topRules: { ruleId: string; title: string; category: string; repos: number; share: number }[];
  worstCategory: string | null;
}

export function corpusStats(store: Store): CorpusStats {
  const corpus = store.latestCorpusScans();
  const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const scan of corpus) grades[scan.grade] = (grades[scan.grade] ?? 0) + 1;

  const medians: Record<string, number> = { overall: median(corpus.map((c) => c.score)) };
  for (const category of CATEGORIES) {
    medians[category] = median(corpus.map((c) => c[category]));
  }

  const worstCategory =
    CATEGORIES.length > 0
      ? [...CATEGORIES].sort((a, b) => (medians[a] ?? 0) - (medians[b] ?? 0))[0] ?? null
      : null;

  const topRules = store
    .rulePrevalence()
    .slice(0, 12)
    .map((r) => ({
      ruleId: r.rule_id,
      title: r.title,
      category: r.category,
      repos: r.repos,
      share: corpus.length > 0 ? Math.round((r.repos / corpus.length) * 100) : 0,
    }));

  return { size: corpus.length, grades, medians, topRules, worstCategory };
}
