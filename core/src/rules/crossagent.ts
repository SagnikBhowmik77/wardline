/**
 * Rules for surfaces that only exist outside Claude Code.
 *
 * These are written with plain string matching rather than patterns, because
 * they have to read JSON, YAML and TOML alike and none of them is worth a
 * parser. The risk in each case is one the other families already name; it just
 * lives under a different key in a different agent.
 */

import { oneLine } from '../util/text.js';
import { report } from './helpers.js';
import type { ConfigFile, Finding, Rule } from '../types.js';

/** Keys that, when switched on, stop an agent asking before it acts. */
const AUTO_APPROVE_KEYS = [
  'yes-always',
  'yes_always',
  'autoapprove',
  'auto_approve',
  'auto-approve',
  'alwaysallow',
  'always_allow',
  'autoaccept',
  'auto_accept',
  'auto-accept',
  'autorun',
  'auto_run',
  'auto-run',
  'autoexecute',
  'auto_execute',
  'skipconfirmation',
  'skip_confirmation',
  'bypassapproval',
  'dangerously',
];

const TRUTHY = ['true', 'yes', 'on', '1', 'always'];

/** The value half of `key: value`, `key = value` or `"key": value`. */
function valueAfter(line: string, key: string): string {
  const at = line.indexOf(key);
  if (at === -1) return '';

  const rest = line.slice(at + key.length);
  const sep = rest.search(/[:=]/);
  if (sep === -1) return '';

  return rest
    .slice(sep + 1)
    .replace(/[",;]/g, ' ')
    .trim()
    .toLowerCase();
}

const CONFIGURABLE = new Set<ConfigFile['kind']>(['settings', 'mcp', 'ide-tasks', 'hooks-manifest']);

const autoApprove: Rule = {
  id: 'WL-PRM-012',
  category: 'permissions',
  title: 'Agent configured to act without confirmation',
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!CONFIGURABLE.has(file.kind)) continue;

      file.content.split('\n').forEach((raw, index) => {
        const line = raw.toLowerCase();
        if (line.trim().startsWith('#') || line.trim().startsWith('//')) return;

        const key = AUTO_APPROVE_KEYS.find((k) => line.includes(k));
        if (!key) return;

        const value = valueAfter(line, key);
        // An empty list is the opposite of a problem: it approves nothing.
        if (value.startsWith('[]') || value.startsWith('[ ]')) return;
        if (!TRUTHY.some((t) => value.startsWith(t)) && !value.startsWith('[')) return;

        findings.push(
          report(file, {
            id: 'WL-PRM-012',
            category: 'permissions',
            severity: 'high',
            title: 'Agent configured to act without confirmation',
            detail:
              'This setting removes the confirmation step before the agent acts. Approval is the control that catches a tool call the model was talked into making, and it is the one control that spans every tool at once.',
            remedy:
              'Turn it off, and grant specific permissions for the operations you genuinely want unattended.',
            line: index + 1,
            evidence: oneLine(raw, 100),
          }),
        );
      });
    }

    return findings;
  },
};

const folderOpenTask: Rule = {
  id: 'WL-HOK-017',
  category: 'hooks',
  title: 'Task runs automatically when the folder is opened',
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.kind !== 'ide-tasks') continue;
      if (!file.content.toLowerCase().includes('folderopen')) continue;

      const lines = file.content.split('\n');
      const index = lines.findIndex((l) => l.toLowerCase().includes('folderopen'));

      findings.push(
        report(file, {
          id: 'WL-HOK-017',
          category: 'hooks',
          severity: 'critical',
          title: 'Task runs automatically when the folder is opened',
          detail:
            'This task executes as soon as the editor opens the project, before anyone reads a line of it. Cloning the repository and opening it is enough to run whatever the task calls.',
          remedy:
            'Remove runOn: folderOpen and start the task deliberately, or move the work into a reviewed script that a human invokes.',
          line: index >= 0 ? index + 1 : 1,
          evidence: oneLine(lines[index] ?? '', 100),
        }),
      );
    }

    return findings;
  },
};

const ideTaskShell: Rule = {
  id: 'WL-HOK-018',
  category: 'hooks',
  title: 'Editor task pipes remote content into a shell',
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.kind !== 'ide-tasks') continue;

      file.content.split('\n').forEach((raw, index) => {
        const line = raw.toLowerCase();
        const fetches = line.includes('curl ') || line.includes('wget ') || line.includes('iwr ');
        if (!fetches) return;
        if (!line.includes('| sh') && !line.includes('|sh') && !line.includes('| bash')) return;

        findings.push(
          report(file, {
            id: 'WL-HOK-018',
            category: 'hooks',
            severity: 'critical',
            title: 'Editor task pipes remote content into a shell',
            detail:
              'An editor task downloads code and runs it in one step. Whoever controls that URL controls this machine, and nothing about the task definition invites review.',
            remedy: 'Vendor the script, review it, pin it, and run the local copy.',
            line: index + 1,
            evidence: oneLine(raw, 100),
          }),
        );
      });
    }

    return findings;
  },
};

export const crossAgentRules: Rule[] = [autoApprove, folderOpenTask, ideTaskShell];
