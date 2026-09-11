/**
 * Cross-agent drift.
 *
 * A project that configures several agents has several places to say the same
 * thing, and they rot apart. Somebody hardens CLAUDE.md and never touches
 * .cursorrules; the guard exists, the team believes it is enforced, and half
 * the tools ignore it. Nothing catches this except comparing the files, which
 * only a scanner that reads every agent can do.
 */

import { HARNESS_LABEL } from '../harness.js';
import { report } from './helpers.js';
import type { HarnessId } from '../harness.js';
import type { ConfigFile, Finding, Rule } from '../types.js';

/** Words that carry meaning, for comparing two documents by content. */
function meaningfulWords(text: string): Set<string> {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'is', 'are', 'be',
    'this', 'that', 'it', 'you', 'your', 'we', 'with', 'on', 'at', 'as', 'by',
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/[^a-z0-9-]+/)
      .filter((w) => w.length > 2 && !stop.has(w)),
  );
}

/** Overlap of two word sets: 1 means identical, 0 means nothing in common. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;

  const union = a.size + b.size - shared;
  return union === 0 ? 1 : shared / union;
}

/**
 * Two documents have to say something before they can disagree. Comparing a
 * one-line placeholder against another proves nothing, so a brief has to carry
 * real instruction before it counts.
 */
const MIN_MEANINGFUL_WORDS = 25;

/** The largest brief each agent owns; that is the one people actually edit. */
function briefsByHarness(files: ConfigFile[]): Map<HarnessId, ConfigFile> {
  const chosen = new Map<HarnessId, ConfigFile>();

  for (const file of files) {
    if (file.kind !== 'project-brief' || !file.harness) continue;
    if (file.trust !== 'runtime' && file.trust !== 'project-local') continue;
    if (meaningfulWords(file.content).size < MIN_MEANINGFUL_WORDS) continue;

    const existing = chosen.get(file.harness);
    if (!existing || file.content.length > existing.content.length) {
      chosen.set(file.harness, file);
    }
  }

  return chosen;
}

const GUARDS: { id: string; label: string; test: RegExp }[] = [
  {
    id: 'untrusted-input',
    label: 'treating external content as untrusted',
    test: /\b(?:untrusted|prompt injection|never follow (?:any )?instructions|not (?:as )?instructions)\b/i,
  },
  {
    id: 'ask-first',
    label: 'asking before destructive actions',
    test: /\b(?:ask (?:first|before)|confirm before|require (?:approval|confirmation)|do not commit without)\b/i,
  },
  {
    id: 'secret-handling',
    label: 'keeping credentials out of output',
    test: /\b(?:never (?:print|log|echo|commit) (?:the )?(?:secret|credential|key|token)|do not (?:log|print) secrets)\b/i,
  },
];

const divergentBriefs: Rule = {
  id: 'WL-AGT-014',
  category: 'agents',
  title: 'Agent instructions have drifted apart',
  run(ctx) {
    const briefs = briefsByHarness(ctx.files);
    if (briefs.size < 2) return [];

    const entries = [...briefs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const findings: Finding[] = [];

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [leftId, left] = entries[i] as [HarnessId, ConfigFile];
        const [rightId, right] = entries[j] as [HarnessId, ConfigFile];

        const score = similarity(meaningfulWords(left.content), meaningfulWords(right.content));
        if (score >= 0.4) continue;

        findings.push(
          report(left, {
            id: 'WL-AGT-014',
            category: 'agents',
            severity: 'low',
            title: 'Agent instructions have drifted apart',
            detail:
              'The instructions for ' +
              HARNESS_LABEL[leftId] +
              ' and ' +
              HARNESS_LABEL[rightId] +
              ' share only ' +
              Math.round(score * 100) +
              '% of their content. Whatever was added to one is not governing the other, and both are loaded by people who assume the project has one policy.',
            remedy:
              'Keep one source of truth - AGENTS.md is the cross-agent convention - and have the others reference it rather than restate it.',
            line: 1,
            evidence: left.relPath + ' vs ' + right.relPath,
          }),
        );
      }
    }

    return findings;
  },
};

const guardGap: Rule = {
  id: 'WL-AGT-015',
  category: 'agents',
  title: 'A safety instruction is missing from one agent',
  run(ctx) {
    const briefs = briefsByHarness(ctx.files);
    if (briefs.size < 2) return [];

    const entries = [...briefs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const findings: Finding[] = [];

    for (const guard of GUARDS) {
      const withGuard = entries.filter(([, file]) => guard.test.test(file.content));
      const without = entries.filter(([, file]) => !guard.test.test(file.content));

      if (withGuard.length === 0 || without.length === 0) continue;

      const present = withGuard.map(([id]) => HARNESS_LABEL[id]).join(', ');

      for (const [id, file] of without) {
        findings.push(
          report(file, {
            id: 'WL-AGT-015',
            category: 'agents',
            severity: 'medium',
            title: 'A safety instruction is missing from one agent',
            detail:
              'This project tells ' +
              present +
              ' about ' +
              guard.label +
              ', but the instructions for ' +
              HARNESS_LABEL[id] +
              ' say nothing about it. The rule is only as good as the least-configured agent that can act on the repository.',
            remedy:
              'Copy the instruction into this file, or point every agent at one shared AGENTS.md.',
            line: 1,
            evidence: 'missing: ' + guard.id,
          }),
        );
      }
    }

    return findings;
  },
};

export const driftRules: Rule[] = [divergentBriefs, guardGap];
