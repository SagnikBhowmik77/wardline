import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ignoreMatches, readIgnoreFile } from '../src/scanner/discovery';
import { scan } from '../src/scanner/index';

const temps: string[] = [];

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wardline-ignore-'));
  temps.push(dir);

  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }

  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const LEAKY = '{"permissions":{"allow":["Bash(*)"],"deny":[]}}';

describe('ignore patterns', () => {
  it('matches a directory prefix, with or without the trailing slash', () => {
    expect(ignoreMatches('examples/app/settings.json', 'examples/')).toBe(true);
    expect(ignoreMatches('examples/app/settings.json', 'examples')).toBe(true);
    expect(ignoreMatches('examples', 'examples')).toBe(true);
  });

  it('does not match a directory that merely starts with the same letters', () => {
    expect(ignoreMatches('examples-live/settings.json', 'examples')).toBe(false);
  });

  it('matches by suffix when the pattern leads with a star', () => {
    expect(ignoreMatches('a/b/fixture.json', '*.json')).toBe(true);
    expect(ignoreMatches('a/b/fixture.md', '*.json')).toBe(false);
  });

  it('reads patterns and skips comments and blank lines', () => {
    const dir = project({ '.wardlineignore': '# a note\n\nfixtures/\n*.sample.json\n' });
    expect(readIgnoreFile(dir)).toEqual(['fixtures/', '*.sample.json']);
  });

  it('returns nothing when there is no ignore file', () => {
    expect(readIgnoreFile(project({}))).toEqual([]);
  });
});

describe('ignored paths during a scan', () => {
  it('skips a deliberately vulnerable fixture directory', () => {
    const dir = project({
      '.wardlineignore': 'fixtures/\n',
      'fixtures/insecure/settings.json': LEAKY,
      '.claude/settings.json': '{"permissions":{"allow":["Bash(npm test)"],"deny":["Bash(sudo *)"]}}',
    });

    const report = scan({ path: dir });

    expect(report.findings.every((f) => !f.relPath.startsWith('fixtures/'))).toBe(true);
    expect(report.summary.filesScanned).toBe(1);
  });

  it('still scans everything when nothing is ignored', () => {
    const dir = project({
      'fixtures/insecure/settings.json': LEAKY,
      '.claude/settings.json': LEAKY,
    });

    expect(scan({ path: dir }).summary.filesScanned).toBe(2);
  });

  it('does not apply an ignore file that belongs to a parent directory', () => {
    const dir = project({
      '.wardlineignore': 'fixtures/\n',
      'fixtures/insecure/settings.json': LEAKY,
    });

    // Scanning the fixture directly is how its own tests work; the ignore file
    // at the project root must not follow it.
    const direct = scan({ path: join(dir, 'fixtures', 'insecure') });
    expect(direct.summary.filesScanned).toBe(1);
    expect(direct.findings.some((f) => f.id === 'WL-PRM-001')).toBe(true);
  });
});
