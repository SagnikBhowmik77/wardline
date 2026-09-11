import { describe, expect, it } from 'vitest';

import { parseEntry, permissionRules } from '../src/rules/permissions';
import { context, findingsFor, json, makeFile, runRules } from './support';

function settings(permissions: unknown, relPath = 'settings.json') {
  return makeFile({ relPath, kind: 'settings', content: json({ permissions }) });
}

describe('permission entry parsing', () => {
  it('splits a tool from its argument', () => {
    expect(parseEntry('Bash(git status)')).toMatchObject({ tool: 'Bash', arg: 'git status' });
    expect(parseEntry('Bash(*)')).toMatchObject({ tool: 'Bash', arg: '*' });
    expect(parseEntry('WebSearch')).toMatchObject({ tool: 'WebSearch', arg: '' });
  });
});

describe('permission rules', () => {
  it('flags an unscoped shell allow entry as critical', () => {
    const file = settings({ allow: ['Bash(*)'], deny: ['Bash(sudo *)'] });
    const found = findingsFor(permissionRules, context(file), 'WL-PRM-001');

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('critical');
  });

  it('leaves a pinned shell command alone', () => {
    const file = settings({ allow: ['Bash(git status)'], deny: ['Bash(rm -rf *)'] });
    const ids = runRules(permissionRules, context(file)).map((f) => f.id);

    expect(ids).not.toContain('WL-PRM-001');
    expect(ids).not.toContain('WL-PRM-006');
  });

  it('does not flag a pinned curl but does flag a wildcard one', () => {
    const pinned = settings({ allow: ['Bash(curl https://registry.npmjs.org/-/ping)'] });
    const wild = settings({ allow: ['Bash(curl *)'] });

    expect(findingsFor(permissionRules, context(pinned), 'WL-PRM-006')).toHaveLength(0);
    expect(findingsFor(permissionRules, context(wild), 'WL-PRM-006')).toHaveLength(1);
  });

  it('softens the missing-deny-list finding when every allow entry is pinned', () => {
    const pinned = settings({ allow: ['Bash(npm test)', 'Read(src/index.ts)'] });
    const broad = settings({ allow: ['Bash(npm *)'] });

    expect(findingsFor(permissionRules, context(pinned), 'WL-PRM-003')[0]?.severity).toBe('medium');
    expect(findingsFor(permissionRules, context(broad), 'WL-PRM-003')[0]?.severity).toBe('high');
  });

  it('names the destructive commands a deny list is missing', () => {
    const file = settings({ allow: ['Bash(npm *)'], deny: ['Bash(rm -rf *)'] });
    const found = findingsFor(permissionRules, context(file), 'WL-PRM-004');

    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toContain('privilege escalation');
    expect(found[0]?.detail).not.toContain('recursive delete');
  });

  it('flags bypass mode and inline interpreter access', () => {
    const file = settings({
      defaultMode: 'bypassPermissions',
      allow: ['Bash(node -e *)'],
      deny: ['Bash(sudo *)'],
    });
    const ids = runRules(permissionRules, context(file)).map((f) => f.id);

    expect(ids).toContain('WL-PRM-005');
    expect(ids).toContain('WL-PRM-009');
  });

  it('carries the source trust of the file it came from', () => {
    const local = makeFile({
      relPath: 'settings.local.json',
      kind: 'settings',
      trust: 'project-local',
      content: json({ permissions: { allow: ['Bash(*)'] } }),
    });

    expect(findingsFor(permissionRules, context(local), 'WL-PRM-001')[0]?.trust).toBe(
      'project-local',
    );
  });

  it('asks for .env to be denied only when a populated .env exists', () => {
    const file = settings({ allow: ['Bash(npm test)'], deny: ['Bash(sudo *)'] });
    const env = makeFile({ relPath: '.env', kind: 'env', content: 'TOKEN=9f2be71cc0a4\n' });

    expect(findingsFor(permissionRules, context(file), 'WL-PRM-011')).toHaveLength(0);
    expect(findingsFor(permissionRules, context(file, env), 'WL-PRM-011')).toHaveLength(1);
  });
});
