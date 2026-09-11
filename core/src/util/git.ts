/**
 * The changed-files list, for scanning only what a commit touches.
 *
 * A full scan is fine in CI and too slow for a pre-commit hook. Git is asked
 * directly rather than through a library: one process, no dependency, and it
 * fails softly when the directory is not a repository.
 */

import { spawnSync } from 'node:child_process';

function git(root: string, args: string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0 || typeof result.stdout !== 'string') return [];

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isRepository(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree'])[0] === 'true';
}

/**
 * Paths changed against `ref`, including files that are new and not yet staged.
 * Git already reports forward slashes, so these compare directly to relPath.
 */
export function changedFiles(root: string, ref = 'HEAD'): string[] {
  if (!isRepository(root)) {
    throw new Error('not a git repository: ' + root);
  }

  const tracked = git(root, ['diff', '--name-only', ref]);
  const staged = git(root, ['diff', '--name-only', '--cached', ref]);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);

  return [...new Set([...tracked, ...staged, ...untracked])];
}
