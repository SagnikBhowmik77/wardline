/**
 * Auto-fix.
 *
 * Deliberately narrow: it only replaces committed credentials with environment
 * references. Permission and hook findings change behaviour, so a human decides
 * those. The credential still has to be rotated by hand - this stops it
 * spreading further, it does not un-leak it.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { discover } from '../scanner/discovery.js';
import { resolveTarget } from '../scanner/index.js';
import { SECRET_PATTERNS } from '../rules/secrets.js';
import { looksLikePlaceholder, matchAll } from '../rules/helpers.js';
import { redact } from '../util/text.js';

export interface Replacement {
  relPath: string;
  envVar: string;
  redacted: string;
}

export interface FixResult {
  root: string;
  dryRun: boolean;
  replacements: Replacement[];
  filesChanged: string[];
  envExamplePath?: string;
}

export interface FixOptions {
  path?: string;
  /** Report what would change without touching any file. */
  dryRun?: boolean;
}

/** Give each distinct secret its own variable name: KEY, KEY_2, KEY_3. */
function nameFor(base: string, taken: Map<string, string>, value: string): string {
  const existing = taken.get(value);
  if (existing) return existing;

  let candidate = base;
  let n = 1;
  const used = new Set(taken.values());
  while (used.has(candidate)) {
    n += 1;
    candidate = base + '_' + n;
  }

  taken.set(value, candidate);
  return candidate;
}

export function applyFixes(options: FixOptions = {}): FixResult {
  const root = resolveTarget(options.path);
  const dryRun = options.dryRun ?? false;

  const replacements: Replacement[] = [];
  const filesChanged: string[] = [];
  const envVars = new Map<string, string>();

  for (const file of discover(root)) {
    if (file.kind === 'env') continue; // never rewrite the file that is meant to hold values

    let content = file.content;
    let touched = false;

    for (const pattern of SECRET_PATTERNS) {
      // Private key blocks are multi-line material; swapping in a variable
      // would silently corrupt the file, so leave them for a human.
      if (pattern.id === 'WL-SEC-010') continue;

      for (const hit of matchAll(content, pattern.regex)) {
        if (looksLikePlaceholder(hit.text)) continue;

        const envVar = nameFor(pattern.envVar, envVars, hit.text);
        content = content.split(hit.text).join('${' + envVar + '}');
        touched = true;

        replacements.push({
          relPath: file.relPath,
          envVar,
          redacted: redact(hit.text),
        });
      }
    }

    if (!touched) continue;
    filesChanged.push(file.relPath);
    if (!dryRun) writeFileSync(file.path, content, 'utf8');
  }

  const result: FixResult = { root, dryRun, replacements, filesChanged };
  if (envVars.size > 0) {
    result.envExamplePath = writeEnvExample(root, [...envVars.values()], dryRun);
  }

  return result;
}

/**
 * Record the variable names the config now expects. Existing keys are left
 * alone so a hand-written example file is never clobbered.
 */
function writeEnvExample(root: string, names: string[], dryRun: boolean): string {
  const path = join(root, '.env.example');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const already = new Set(
    existing
      .split('\n')
      .map((l) => l.split('=')[0]?.trim())
      .filter((k): k is string => Boolean(k)),
  );

  const additions = names.filter((n) => !already.has(n));
  if (additions.length === 0) return path;

  const header = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block =
    (existing.length === 0 ? '# Values referenced by this agent configuration.\n' : '') +
    additions.map((n) => n + '=').join('\n') +
    '\n';

  if (!dryRun) writeFileSync(path, existing + header + block, 'utf8');
  return path;
}
