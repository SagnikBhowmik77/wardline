import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { applyFixes } from '../src/fix/index';
import { initConfig } from '../src/init/index';
import { scan } from '../src/scanner/index';

const DEMO = resolve(__dirname, '..', 'examples', 'insecure-config');
const temps: string[] = [];

function sandbox(seedFromDemo = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'wardline-test-'));
  temps.push(dir);
  if (seedFromDemo) cpSync(DEMO, dir, { recursive: true });
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('auto-fix', () => {
  it('replaces a committed key with an environment reference', () => {
    const dir = sandbox(true);
    const result = applyFixes({ path: dir });

    expect(result.replacements.length).toBeGreaterThan(0);
    const brief = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');

    expect(brief).toContain('${ANTHROPIC_API_KEY}');
    expect(brief).not.toContain('sk-ant-api03-Zx8Qv2NmTr5KpLd9WjYs4Hb1FgAe6Cu0');
  });

  it('records the variable names in .env.example', () => {
    const dir = sandbox(true);
    applyFixes({ path: dir });

    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toContain('ANTHROPIC_API_KEY=');
  });

  it('leaves the .env file itself untouched', () => {
    const dir = sandbox(true);
    const before = readFileSync(join(dir, '.env'), 'utf8');
    applyFixes({ path: dir });

    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(before);
  });

  it('changes nothing on a dry run', () => {
    const dir = sandbox(true);
    const before = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    const result = applyFixes({ path: dir, dryRun: true });

    expect(result.replacements.length).toBeGreaterThan(0);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(before);
  });

  it('gives two distinct secrets two distinct variable names', () => {
    const dir = sandbox();
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      'staging sk-ant-api03-AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQrrSS\n' +
        'prod sk-ant-api03-ZZyyXXwwVVuuTTssRRqqPPooNNmmLLkkJJhhGG\n',
      'utf8',
    );

    const names = applyFixes({ path: dir }).replacements.map((r) => r.envVar);
    expect(new Set(names).size).toBe(2);
    expect(names).toContain('ANTHROPIC_API_KEY');
  });

  it('removes the secret findings it fixed', () => {
    const dir = sandbox(true);
    const before = scan({ path: dir }).findings.filter((f) => f.id === 'WL-SEC-001');
    applyFixes({ path: dir });
    const after = scan({ path: dir }).findings.filter((f) => f.id === 'WL-SEC-001');

    expect(before.length).toBeGreaterThan(after.length);
  });
});

describe('init', () => {
  it('writes a configuration that scores well under its own rules', () => {
    const dir = sandbox();
    const result = initConfig(dir);

    expect(result.created.length).toBe(3);

    const report = scan({ path: dir });
    expect(report.summary.critical).toBe(0);
    expect(report.scorecard.score).toBeGreaterThanOrEqual(90);
  });

  it('never overwrites a file that already exists', () => {
    const dir = sandbox();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"mine": true}', 'utf8');

    const result = initConfig(dir);

    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')).toBe('{"mine": true}');
    expect(result.skipped.some((p) => p.endsWith('settings.json'))).toBe(true);
  });
});
