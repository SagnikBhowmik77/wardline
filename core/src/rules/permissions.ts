/**
 * Permission-surface rules.
 *
 * The allow list is the agent's blast radius. These rules look for entries that
 * are broader than they need to be, and for deny lists that leave the obvious
 * destructive commands unguarded.
 */

import { readPermissions } from '../scanner/extract.js';
import type { PermissionSet } from '../scanner/extract.js';
import { lineOf, oneLine } from '../util/text.js';
import { report } from './helpers.js';
import type { ConfigFile, Finding, Rule } from '../types.js';

interface ParsedEntry {
  raw: string;
  tool: string;
  arg: string;
}

/** Split `Bash(git status)` into its tool and argument halves. */
export function parseEntry(raw: string): ParsedEntry {
  const m = /^([A-Za-z_][\w-]*)\s*\((.*)\)\s*$/s.exec(raw.trim());
  if (!m) return { raw, tool: raw.trim(), arg: '' };
  return { raw, tool: m[1] ?? '', arg: (m[2] ?? '').trim() };
}

/** True when the argument names one concrete command with no wildcards. */
function isPinned(arg: string): boolean {
  return arg.length > 0 && !/[*?]|\$\{|\$\(/.test(arg);
}

function settingsFiles(files: ConfigFile[]): { file: ConfigFile; perms: PermissionSet }[] {
  const out: { file: ConfigFile; perms: PermissionSet }[] = [];
  for (const file of files) {
    const perms = readPermissions(file);
    if (perms) out.push({ file, perms });
  }
  return out;
}

function entryLine(file: ConfigFile, raw: string): number | undefined {
  return lineOf(file.content, '"' + raw + '"') ?? lineOf(file.content, raw);
}

const wildcardShell: Rule = {
  id: 'WL-PRM-001',
  category: 'permissions',
  title: 'Shell access allowed without any command scope',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      for (const raw of perms.allow) {
        const { tool, arg } = parseEntry(raw);
        if (tool !== 'Bash') continue;
        if (arg !== '' && arg !== '*' && arg !== '**') continue;

        findings.push(
          report(file, {
            id: 'WL-PRM-001',
            category: 'permissions',
            severity: 'critical',
            title: 'Shell access allowed without any command scope',
            detail:
              'An unscoped Bash allow entry lets the agent run any command on this machine without a prompt. Every other permission in the file becomes decorative, because the shell can do all of it.',
            remedy:
              'Replace with the commands you actually need, e.g. Bash(git status), Bash(npm test), Bash(npm run build).',
            line: entryLine(file, raw),
            evidence: raw,
          }),
        );
      }
    }

    return findings;
  },
};

const wildcardMutation: Rule = {
  id: 'WL-PRM-002',
  category: 'permissions',
  title: 'File-mutating tool allowed across the whole tree',
  run(ctx) {
    const mutators = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      for (const raw of perms.allow) {
        const { tool, arg } = parseEntry(raw);
        if (!mutators.has(tool)) continue;
        if (arg !== '' && arg !== '*' && arg !== '**' && arg !== '**/*') continue;

        findings.push(
          report(file, {
            id: 'WL-PRM-002',
            category: 'permissions',
            severity: 'high',
            title: 'File-mutating tool allowed across the whole tree',
            detail:
              tool +
              ' is allowed with no path restriction, so the agent can silently rewrite CI config, lockfiles, git hooks, or its own permission file.',
            remedy:
              'Scope the entry to the directories you work in, e.g. ' +
              tool +
              '(src/**), and deny writes to .github/** and .claude/**.',
            line: entryLine(file, raw),
            evidence: raw,
          }),
        );
      }
    }

    return findings;
  },
};

const noDenyList: Rule = {
  id: 'WL-PRM-003',
  category: 'permissions',
  title: 'No deny list defined',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      if (perms.deny.length > 0) continue;
      if (perms.allow.length === 0) continue;

      const everythingPinned = perms.allow.every((raw) => isPinned(parseEntry(raw).arg));

      findings.push(
        report(file, {
          id: 'WL-PRM-003',
          category: 'permissions',
          severity: everythingPinned ? 'medium' : 'high',
          title: 'No deny list defined',
          detail: everythingPinned
            ? 'Every allow entry is fully specified, which limits the exposure, but there is still no explicit deny list to stop a future broad entry from slipping in.'
            : 'Nothing is explicitly denied, so the only thing standing between the agent and a destructive command is the breadth of the allow list.',
          remedy:
            'Add a deny block covering at least: Bash(rm -rf *), Bash(sudo *), Read(./.env), Read(~/.ssh/**).',
          line: lineOf(file.content, '"permissions"'),
        }),
      );
    }

    return findings;
  },
};

const denyGaps: Rule = {
  id: 'WL-PRM-004',
  category: 'permissions',
  title: 'Deny list leaves destructive commands uncovered',
  run(ctx) {
    const required = [
      { label: 'recursive delete', test: /rm\s+-[a-z]*[rf]/i },
      { label: 'privilege escalation', test: /\bsudo\b|\bdoas\b|\brunas\b/i },
      { label: 'world-writable chmod', test: /chmod\s+(?:777|a\+w|-R\s+777)/i },
      { label: 'disk overwrite', test: /\b(?:mkfs|dd\s+if=|diskpart|format\s+[a-z]:)/i },
    ];
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      if (perms.deny.length === 0) continue; // WL-PRM-003 already covers this

      const joined = perms.deny.join('\n');
      const missing = required.filter((r) => !r.test.test(joined)).map((r) => r.label);
      if (missing.length === 0) continue;

      findings.push(
        report(file, {
          id: 'WL-PRM-004',
          category: 'permissions',
          severity: missing.length >= 3 ? 'high' : 'medium',
          title: 'Deny list leaves destructive commands uncovered',
          detail:
            'The deny list exists but has no entry for: ' +
            missing.join(', ') +
            '. A single mistaken tool call in that gap is unrecoverable.',
          remedy:
            'Extend the deny list with Bash(rm -rf *), Bash(sudo *), Bash(chmod 777 *) and Bash(dd if=*).',
          line: lineOf(file.content, '"deny"'),
        }),
      );
    }

    return findings;
  },
};

const bypassMode: Rule = {
  id: 'WL-PRM-005',
  category: 'permissions',
  title: 'Permission prompts are bypassed by default',
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      const perms = readPermissions(file);
      const mode = perms?.defaultMode?.toLowerCase();

      if (mode === 'bypasspermissions' || mode === 'bypass') {
        findings.push(
          report(file, {
            id: 'WL-PRM-005',
            category: 'permissions',
            severity: 'critical',
            title: 'Permission prompts are bypassed by default',
            detail:
              'defaultMode is set to bypass approvals, so the allow and deny lists are the only remaining control and the human is never asked.',
            remedy:
              'Remove defaultMode or set it to "default", and grant specific permissions instead.',
            line: lineOf(file.content, 'defaultMode'),
            evidence: 'defaultMode: ' + perms?.defaultMode,
          }),
        );
      }

      const lines = file.content.split('\n');
      const idx = lines.findIndex((l) => /--dangerously-skip-permissions|--yolo\b/i.test(l));
      if (idx === -1) continue;

      findings.push(
        report(file, {
          id: 'WL-PRM-005',
          category: 'permissions',
          severity: 'critical',
          title: 'Approval-skipping flag baked into config',
          detail:
            'A flag that disables permission prompts is committed into configuration, so every run of this project starts unguarded.',
          remedy:
            'Remove the flag. If one automation genuinely needs it, keep it in a local uncommitted invocation and sandbox what it runs in.',
          line: idx + 1,
          evidence: oneLine(lines[idx] ?? ''),
        }),
      );
    }

    return findings;
  },
};

const openNetwork: Rule = {
  id: 'WL-PRM-006',
  category: 'permissions',
  title: 'Unrestricted network command allowed',
  run(ctx) {
    const netCommands = /^(?:curl|wget|ssh|scp|sftp|nc|ncat|telnet|rsync|ftp)\b/i;
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      for (const raw of perms.allow) {
        const { tool, arg } = parseEntry(raw);

        if (tool === 'WebFetch' && (arg === '' || arg === '*' || arg === 'domain:*')) {
          findings.push(
            report(file, {
              id: 'WL-PRM-006',
              category: 'permissions',
              severity: 'high',
              title: 'Unrestricted network fetch allowed',
              detail:
                'The agent may fetch any URL. Retrieved content is untrusted input, and an unrestricted fetch is also a ready-made exfiltration channel.',
              remedy: 'Pin the domains you trust, e.g. WebFetch(domain:docs.python.org).',
              line: entryLine(file, raw),
              evidence: raw,
            }),
          );
          continue;
        }

        if (tool !== 'Bash' || !netCommands.test(arg)) continue;
        if (isPinned(arg)) continue; // an exact pinned command is a deliberate choice

        findings.push(
          report(file, {
            id: 'WL-PRM-006',
            category: 'permissions',
            severity: 'high',
            title: 'Unrestricted network command allowed',
            detail:
              'A network client is allowed with a wildcard argument, so the agent can reach any host. That covers both pulling unreviewed code in and sending local data out.',
            remedy:
              'Pin the exact command and destination, e.g. Bash(curl https://registry.npmjs.org/-/ping).',
            line: entryLine(file, raw),
            evidence: raw,
          }),
        );
      }
    }

    return findings;
  },
};

const destructiveGit: Rule = {
  id: 'WL-PRM-007',
  category: 'permissions',
  title: 'History-rewriting git command allowed',
  run(ctx) {
    const risky =
      /git\s+(?:push\s+.*--force(?!-with-lease)|reset\s+--hard|clean\s+-[a-z]*f|filter-branch|update-ref\s+-d)/i;
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      for (const raw of perms.allow) {
        const { tool, arg } = parseEntry(raw);
        if (tool !== 'Bash' || !risky.test(arg)) continue;

        findings.push(
          report(file, {
            id: 'WL-PRM-007',
            category: 'permissions',
            severity: 'medium',
            title: 'History-rewriting git command allowed',
            detail:
              'This entry pre-approves a git command that discards work irreversibly. Nothing prompts the human before local commits or uncommitted changes disappear.',
            remedy:
              'Drop the entry, or narrow it: prefer --force-with-lease and leave hard resets to a human.',
            line: entryLine(file, raw),
            evidence: raw,
          }),
        );
      }
    }

    return findings;
  },
};

const openInstall: Rule = {
  id: 'WL-PRM-008',
  category: 'permissions',
  title: 'Unscoped package installation allowed',
  run(ctx) {
    const installers =
      /^(?:npm\s+(?:i|install|add)|pnpm\s+add|yarn\s+add|npx|pip3?\s+install|uv\s+pip\s+install|gem\s+install|cargo\s+install|go\s+install|brew\s+install)\b/i;
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      for (const raw of perms.allow) {
        const { tool, arg } = parseEntry(raw);
        if (tool !== 'Bash' || !installers.test(arg)) continue;
        if (isPinned(arg)) continue;

        findings.push(
          report(file, {
            id: 'WL-PRM-008',
            category: 'permissions',
            severity: 'medium',
            title: 'Unscoped package installation allowed',
            detail:
              'The agent can install arbitrary packages without review. A typosquatted or compromised package runs its install scripts with the developer’s privileges.',
            remedy:
              'Remove the wildcard. Install dependencies yourself, or pin the exact packages the agent may add.',
            line: entryLine(file, raw),
            evidence: raw,
          }),
        );
      }
    }

    return findings;
  },
};

const inlineEval: Rule = {
  id: 'WL-PRM-009',
  category: 'permissions',
  title: 'Inline interpreter execution allowed',
  run(ctx) {
    const evalForms =
      /\b(?:node\s+-e|node\s+--eval|python3?\s+-c|ruby\s+-e|perl\s+-e|php\s+-r|bash\s+-c|sh\s+-c|powershell\s+-c|eval)\b/i;
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      for (const raw of perms.allow) {
        const { tool, arg } = parseEntry(raw);
        if (tool !== 'Bash' || !evalForms.test(arg)) continue;

        findings.push(
          report(file, {
            id: 'WL-PRM-009',
            category: 'permissions',
            severity: 'high',
            title: 'Inline interpreter execution allowed',
            detail:
              'An inline -e/-c form takes a whole program as its argument, so this entry is equivalent to unrestricted shell access no matter how narrowly it looks scoped.',
            remedy:
              'Allow the script files you actually run instead, e.g. Bash(node scripts/build.js).',
            line: entryLine(file, raw),
            evidence: raw,
          }),
        );
      }
    }

    return findings;
  },
};

const sensitiveReads: Rule = {
  id: 'WL-PRM-010',
  category: 'permissions',
  title: 'Credential path readable by the agent',
  run(ctx) {
    const sensitive =
      /(?:\.ssh|\.aws|\.gnupg|\.kube|\.docker\/config|id_rsa|\.env|credentials|\.netrc|\.npmrc|keychain)/i;
    const findings: Finding[] = [];

    for (const { file, perms } of settingsFiles(ctx.files)) {
      for (const raw of perms.allow) {
        const { tool, arg } = parseEntry(raw);
        if (tool !== 'Read' && tool !== 'Glob' && tool !== 'Grep') continue;
        if (!sensitive.test(arg)) continue;

        findings.push(
          report(file, {
            id: 'WL-PRM-010',
            category: 'permissions',
            severity: 'high',
            title: 'Credential path readable by the agent',
            detail:
              'This entry grants read access to a path that normally holds keys or tokens. Anything the agent reads can end up in a model prompt, a log, or an outbound tool call.',
            remedy: 'Remove the entry and add the same path to the deny list instead.',
            line: entryLine(file, raw),
            evidence: raw,
          }),
        );
      }
    }

    return findings;
  },
};

const unprotectedSecrets: Rule = {
  id: 'WL-PRM-011',
  category: 'permissions',
  title: 'Secret files not excluded from agent reads',
  run(ctx) {
    const findings: Finding[] = [];
    const hasEnvFile = ctx.files.some(
      (f) => f.kind === 'env' && !/\.(?:example|sample|template|dist)$/i.test(f.relPath),
    );
    if (!hasEnvFile) return findings;

    for (const { file, perms } of settingsFiles(ctx.files)) {
      if (perms.deny.some((d) => /\.env|\.ssh|credentials/i.test(d))) continue;

      findings.push(
        report(file, {
          id: 'WL-PRM-011',
          category: 'permissions',
          severity: 'medium',
          title: 'Secret files not excluded from agent reads',
          detail:
            'This project has a populated .env file, but nothing in the deny list keeps the agent out of it.',
          remedy: 'Add Read(./.env), Read(./.env.*) and Read(~/.ssh/**) to the deny list.',
          line: lineOf(file.content, '"deny"') ?? lineOf(file.content, '"permissions"'),
        }),
      );
    }

    return findings;
  },
};

export const permissionRules: Rule[] = [
  wildcardShell,
  wildcardMutation,
  noDenyList,
  denyGaps,
  bypassMode,
  openNetwork,
  destructiveGit,
  openInstall,
  inlineEval,
  sensitiveReads,
  unprotectedSecrets,
];
