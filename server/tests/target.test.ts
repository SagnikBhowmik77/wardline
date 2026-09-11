import { describe, expect, it } from 'vitest';

import { parseTarget } from '../src/target';

describe('target parsing', () => {
  it('reads a pasted GitHub URL', () => {
    expect(parseTarget('https://github.com/SagnikBhowmik77/BNPL-Simulator')).toEqual({
      kind: 'repo',
      slug: 'SagnikBhowmik77/BNPL-Simulator',
    });
  });

  it('tolerates the decoration a browser leaves on a URL', () => {
    const cases = [
      'https://github.com/owner/repo.git',
      'https://github.com/owner/repo/',
      'http://www.github.com/owner/repo',
      'github.com/owner/repo',
      'https://github.com/owner/repo/tree/main/src',
    ];

    for (const value of cases) {
      expect(parseTarget(value)).toEqual({ kind: 'repo', slug: 'owner/repo' });
    }
  });

  it('reads a bare slug', () => {
    expect(parseTarget('anthropics/claude-code')).toEqual({
      kind: 'repo',
      slug: 'anthropics/claude-code',
    });
  });

  it('treats a filesystem path as a path, not a slug', () => {
    expect(parseTarget('C:/Users/me/project')).toMatchObject({ kind: 'path' });
    expect(parseTarget('./my-app')).toMatchObject({ kind: 'path' });
    expect(parseTarget('/home/me/app')).toMatchObject({ kind: 'path' });
  });

  it('refuses a host it cannot fetch from instead of guessing', () => {
    const result = parseTarget('https://gitlab.com/owner/repo');

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('github.com');
  });

  it('rejects an empty box', () => {
    expect(parseTarget('   ').kind).toBe('invalid');
  });
});
