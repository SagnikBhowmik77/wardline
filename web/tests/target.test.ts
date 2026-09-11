import { describe, expect, it } from 'vitest';

import { readTarget } from '../src/target';

describe('reading what the user typed', () => {
  it('recognises a pasted GitHub URL', () => {
    const reading = readTarget('https://github.com/SagnikBhowmik77/BNPL-Simulator');

    expect(reading.kind).toBe('repo');
    if (reading.kind === 'repo') {
      expect(reading.slug).toBe('SagnikBhowmik77/BNPL-Simulator');
      expect(reading.say).toContain('GitHub');
    }
  });

  it('tolerates the decoration a browser leaves behind', () => {
    for (const value of [
      'https://github.com/owner/repo.git',
      'https://github.com/owner/repo/',
      'http://www.github.com/owner/repo',
      'github.com/owner/repo',
      'https://github.com/owner/repo/tree/main/src',
      '  https://github.com/owner/repo  ',
    ]) {
      const reading = readTarget(value);
      expect(reading.kind, value).toBe('repo');
      if (reading.kind === 'repo') expect(reading.slug, value).toBe('owner/repo');
    }
  });

  it('reads a bare slug as a repository', () => {
    const reading = readTarget('anthropics/claude-code');
    expect(reading.kind).toBe('repo');
  });

  it('reads a filesystem path as a path', () => {
    for (const value of ['C:/Users/me/project', './my-app', '/home/me/app']) {
      expect(readTarget(value).kind, value).toBe('path');
    }
  });

  it('refuses a host it cannot fetch from rather than guessing', () => {
    const reading = readTarget('https://gitlab.com/owner/repo');

    expect(reading.kind).toBe('invalid');
    if (reading.kind === 'invalid') expect(reading.say).toContain('github.com');
  });

  it('treats an empty box as empty, not invalid', () => {
    expect(readTarget('   ').kind).toBe('empty');
  });
});
