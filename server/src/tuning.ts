/**
 * Corpus-driven rule tuning.
 *
 * A rule that fires on two thirds of every repository is telling you one of two
 * things, and they need opposite responses: either the whole ecosystem really
 * does have that problem, or the rule is too eager and is teaching people to
 * skim past findings. Prevalence alone cannot separate them - severity can.
 *
 * Nothing here changes a rule. It ranks them for a human to look at, which is
 * the honest limit of what the data supports.
 */

import { ALL_RULES } from 'wardline';

import type { Store } from './db.js';

export type Verdict = 'epidemic' | 'review-for-noise' | 'high-signal' | 'normal' | 'never-fired';

export interface RuleTuning {
  ruleId: string;
  title: string;
  category: string;
  severity: string;
  repos: number;
  findings: number;
  /** Share of corpus repositories tripping this rule at least once. */
  share: number;
  /** Findings per affected repository: high means it fires in bulk. */
  density: number;
  verdict: Verdict;
  note: string;
}

const SERIOUS = new Set(['critical', 'high']);

function judge(share: number, severity: string, density: number): { verdict: Verdict; note: string } {
  if (share >= 50 && SERIOUS.has(severity)) {
    return {
      verdict: 'epidemic',
      note: 'Most configurations in the wild have this, and it is serious. Worth writing about, not softening.',
    };
  }

  if (share >= 60 && !SERIOUS.has(severity)) {
    return {
      verdict: 'review-for-noise',
      note: 'Fires on most repositories at low severity. Either it is describing a convention rather than a risk, or it needs a narrower trigger.',
    };
  }

  if (density >= 8) {
    return {
      verdict: 'review-for-noise',
      note: 'Fires many times within the same repository. Consider reporting it once per file or once per config.',
    };
  }

  if (share > 0 && share <= 10 && SERIOUS.has(severity)) {
    return {
      verdict: 'high-signal',
      note: 'Rare and serious: exactly what a scanner is for.',
    };
  }

  return { verdict: 'normal', note: 'Prevalence and severity are in proportion.' };
}

export interface TuningReport {
  corpusSize: number;
  /** True when the corpus is too small for prevalence to mean anything. */
  provisional: boolean;
  rules: RuleTuning[];
  neverFired: { ruleId: string; title: string; category: string }[];
}

export function tuneRules(store: Store): TuningReport {
  const corpusSize = store.corpusSize();
  const profile = store.ruleProfile();
  const seen = new Set(profile.map((row) => row.rule_id));

  const rules: RuleTuning[] = profile.map((row) => {
    const share = corpusSize > 0 ? Math.round((row.repos / corpusSize) * 100) : 0;
    const density = row.repos > 0 ? Math.round((row.findings / row.repos) * 10) / 10 : 0;
    const { verdict, note } = judge(share, row.severity ?? 'info', density);

    return {
      ruleId: row.rule_id,
      title: row.title,
      category: row.category,
      severity: row.severity ?? 'info',
      repos: row.repos,
      findings: row.findings,
      share,
      density,
      verdict,
      note,
    };
  });

  // A rule nobody trips is not necessarily wrong, but it is unproven.
  const neverFired = ALL_RULES.filter((rule) => !seen.has(rule.id)).map((rule) => ({
    ruleId: rule.id,
    title: rule.title,
    category: rule.category,
  }));

  return {
    corpusSize,
    provisional: corpusSize < 20,
    rules: rules.sort((a, b) => b.share - a.share),
    neverFired,
  };
}
