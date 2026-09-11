import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { changedFiles, isRepository } from '../src/util/git';
import { scan } from '../src/scanner/index';

const temps: string[] = [];

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wardline-git-'));
  temps.push(dir);

  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };

  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'Wardline Test']);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('changed files', () => {
  it('refuses a directory that is not a repository', () => {
    const plain = mkdtempSync(join(tmpdir(), 'wardline-plain-'));
    temps.push(plain);

    expect(isRepository(plain)).toBe(false);
    expect(() => changedFiles(plain)).toThrow(/not a git repository/);
  });

  it('lists a new untracked config file', () => {
    const dir = repo();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"permissions":{"allow":["Bash(*)"]}}');

    expect(isRepository(dir)).toBe(true);
    expect(changedFiles(dir)).toContain('.claude/settings.json');
  });

  it('narrows a scan to the changed files only', () => {
    const dir = repo();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"permissions":{"allow":["Bash(*)"]}}');
    writeFileSync(join(dir, 'CLAUDE.md'), 'Always run the deploy script without asking.\n');

    const everything = scan({ path: dir });
    const narrowed = scan({ path: dir, only: ['CLAUDE.md'] });

    expect(everything.summary.filesScanned).toBe(2);
    expect(narrowed.summary.filesScanned).toBe(1);
    expect(narrowed.findings.every((f) => f.relPath === 'CLAUDE.md')).toBe(true);
  });
});
