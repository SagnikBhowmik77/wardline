/**
 * Hook rules.
 *
 * Hooks are the only part of an agent config that executes on its own. Whatever
 * a hook does, it does without a prompt, so this family is deliberately the
 * broadest one in Wardline.
 */

import { readHooks } from '../scanner/extract.js';
import { executableLines, oneLine } from '../util/text.js';
import { report } from './helpers.js';
import type { ConfigFile, Finding, Rule, ScanContext, Severity } from '../types.js';

/** One executable command, wherever it was declared. */
interface Surface {
  file: ConfigFile;
  text: string;
  line?: number;
  event?: string;
}

/**
 * Every command Wardline can see: hook declarations in settings and manifests,
 * plus the live lines of any hook script on disk. Comments are dropped, so a
 * commented-out example never reads as behaviour.
 */
export function hookSurfaces(ctx: ScanContext): Surface[] {
  const surfaces: Surface[] = [];

  for (const file of ctx.files) {
    if (file.kind === 'settings' || file.kind === 'hooks-manifest') {
      for (const hook of readHooks(file)) {
        surfaces.push({ file, text: hook.command, line: hook.line, event: hook.event });
      }
    }

    if (file.kind === 'hook-script') {
      for (const { line, text } of shellCommands(file.content)) {
        surfaces.push({ file, text, line });
      }
    }
  }

  return surfaces;
}

/**
 * Executable lines of a shell script, with `case` labels removed.
 *
 * A `case` pattern is a string being matched against, not a command being run,
 * so a guard script that refuses `rm -rf /` must not be read as running it.
 */
export function shellCommands(script: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let caseDepth = 0;

  for (const { line, text } of executableLines(script)) {
    const t = text.trim();

    if (/^case\b/.test(t)) {
      caseDepth += 1;
      continue;
    }
    if (/^esac\b/.test(t)) {
      caseDepth = Math.max(0, caseDepth - 1);
      continue;
    }
    if (t === ';;') continue;
    // Inside a case block, a line ending in `)` is a pattern label.
    if (caseDepth > 0 && /\)$/.test(t) && !/^(?:if|for|while|until|function)\b/.test(t)) {
      continue;
    }

    out.push({ line, text });
  }

  return out;
}

interface PatternRule {
  id: string;
  title: string;
  severity: Severity;
  pattern: RegExp;
  detail: string;
  remedy: string;
}

const PATTERN_RULES: PatternRule[] = [
  {
    id: 'WL-HOK-002',
    title: 'Remote script piped straight into an interpreter',
    severity: 'critical',
    pattern:
      /(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z|k|d)?sh\b|(?:curl|wget)\b[^\n]*\|\s*(?:python3?|node|perl|ruby)\b/i,
    detail:
      'The hook downloads code and executes it in one step. Whoever controls that URL, or anyone able to intercept the request, controls this machine, and the content is never reviewed.',
    remedy:
      'Vendor the script into the repository, review it, pin it by checksum, and run the local copy.',
  },
  {
    id: 'WL-HOK-003',
    title: 'Hook sends local data to an external endpoint',
    severity: 'critical',
    pattern:
      /(?:curl|wget|Invoke-RestMethod)\b(?=[^\n]*(?:-X\s*POST|--data|--data-binary|-d\s|--upload-file|-T\s|-F\s))(?=[^\n]*\$)[^\n]*/i,
    detail:
      'An outbound request carries interpolated local values. Whatever the agent was working on, including file contents and tokens, leaves the machine on every trigger.',
    remedy:
      'Remove the call. If telemetry is genuinely required, send a fixed, non-sensitive payload to an endpoint you control and document it.',
  },
  {
    id: 'WL-HOK-004',
    title: 'Hook failures are silenced',
    severity: 'medium',
    pattern:
      /2>\s*\/dev\/null|>\s*\/dev\/null\s+2>&1|\|\|\s*true\b|\|\|\s*exit\s+0\b|-ErrorAction\s+SilentlyContinue/i,
    detail:
      'Errors are discarded, so a hook meant to block something will pass silently once it breaks. A guard that cannot fail loudly is not a guard.',
    remedy:
      'Let the hook exit non-zero on failure, and log the error somewhere a human will see it.',
  },
  {
    id: 'WL-HOK-006',
    title: 'Reverse shell primitive in a hook',
    severity: 'critical',
    pattern:
      /\/dev\/tcp\/|mkfifo[^\n]*\|\s*n(?:c|cat)\b|\bn(?:c|cat)\s+-[a-z]*e\b|socket\.socket\([^\n]*connect|Invoke-Shellcode|System\.Net\.Sockets\.TCPClient/i,
    detail:
      'This is the shape of an interactive callback to a remote host. There is no legitimate reason for a config hook to open one.',
    remedy:
      'Remove it and treat the machine as compromised: rotate every credential the agent could reach.',
  },
  {
    id: 'WL-HOK-007',
    title: 'Hook reads a credential store',
    severity: 'critical',
    pattern:
      /\.ssh\/id_[a-z0-9]+|\.aws\/credentials|\/etc\/shadow|security\s+find-(?:generic|internet)-password|secret-tool\s+lookup|\.netrc\b|\.docker\/config\.json|gnome-keyring/i,
    detail:
      'The hook touches a file or service that exists to hold secrets. Anything it reads is available to every later step of the session.',
    remedy:
      'Remove the access. If a credential is genuinely needed, inject exactly that one value through the environment.',
  },
  {
    id: 'WL-HOK-008',
    title: 'Hook reads or writes the system clipboard',
    severity: 'high',
    pattern:
      /\b(?:pbcopy|pbpaste|xclip|xsel|wl-copy|wl-paste|clip\.exe|Get-Clipboard|Set-Clipboard)\b/i,
    detail:
      'The clipboard routinely holds passwords and tokens in transit. A hook with clipboard access can read them without any prompt.',
    remedy: 'Remove clipboard access from automated hooks.',
  },
  {
    id: 'WL-HOK-009',
    title: 'Hook erases its own traces',
    severity: 'critical',
    pattern:
      /history\s+-c\b|unset\s+HISTFILE|HISTFILE=\/dev\/null|rm\s+-rf?\s+\/var\/log|journalctl\s+--vacuum|Clear-EventLog|wevtutil\s+cl\b/i,
    detail:
      'The hook destroys shell history or system logs. That is anti-forensics, not maintenance: it exists to make later steps unreviewable.',
    remedy: 'Remove it, and audit what else this configuration does.',
  },
  {
    id: 'WL-HOK-010',
    title: 'Hook installs packages automatically',
    severity: 'high',
    pattern:
      /\b(?:npm\s+i(?:nstall)?\s+(?:-g|--global)|pnpm\s+add\s+-g|yarn\s+global\s+add|pip3?\s+install|uv\s+pip\s+install|gem\s+install|cargo\s+install|go\s+install|brew\s+install)\b/i,
    detail:
      'Package installation runs arbitrary lifecycle scripts from the registry. On a hook, that means unreviewed third-party code executes every time the hook fires.',
    remedy: 'Install dependencies explicitly during setup with a lockfile, not from a hook.',
  },
  {
    id: 'WL-HOK-011',
    title: 'Container isolation disabled in a hook',
    severity: 'critical',
    pattern:
      /docker\s+run[^\n]*(?:--privileged|--pid=host|--network=host|--ipc=host|--cap-add[= ]SYS_ADMIN|-v\s+\/:(?:\/|\s))/i,
    detail:
      'These container flags hand the container the host. Anything that escapes the agent sandbox lands with full host access.',
    remedy:
      'Drop the flag, mount only the specific directory needed, and keep the default namespaces.',
  },
  {
    id: 'WL-HOK-013',
    title: 'Recursive delete rooted outside the project',
    severity: 'critical',
    pattern: /\brm\s+-[a-z]*[rf][a-z]*\s+(?:"?\$|\/|~|\.\.)/i,
    detail:
      'A recursive delete whose target starts at the filesystem root, the home directory, a parent directory, or a variable. If that variable is ever empty, the target becomes the root.',
    remedy:
      'Delete a fixed path inside the project, and quote the target so an empty variable cannot widen it.',
  },
  {
    id: 'WL-HOK-014',
    title: 'Obfuscated payload decoded and executed',
    severity: 'critical',
    pattern:
      /base64\s+(?:-d|-D|--decode)[^\n]*\|\s*(?:ba|z)?sh|\|\s*base64\s+(?:-d|--decode)[^\n]*\|\s*(?:python3?|node|perl)|FromBase64String/i,
    detail:
      'Encoded content is decoded and run. The encoding has no functional purpose here; it exists so a reader cannot tell what the command does.',
    remedy: 'Decode the payload, read it, and inline the plain command if it is legitimate.',
  },
  {
    id: 'WL-HOK-015',
    title: 'Hook installs itself for persistence',
    severity: 'critical',
    pattern:
      />>?\s*~?\/?\.(?:bashrc|zshrc|profile|bash_profile|zprofile)\b|LaunchAgents|crontab\s+-|systemctl\s+(?:--user\s+)?enable|schtasks\s+\/create|reg\s+add[^\n]*\\Run\b/i,
    detail:
      'The hook writes into a startup surface, so its effect outlives the agent session and survives the config being removed.',
    remedy:
      'Remove the write. Startup configuration belongs in a reviewed, version-controlled dotfile, not in an agent hook.',
  },
];

/** Everything driven purely by a pattern match against a hook surface. */
const patternRules: Rule[] = PATTERN_RULES.map((spec) => ({
  id: spec.id,
  category: 'hooks' as const,
  title: spec.title,
  run(ctx) {
    const findings: Finding[] = [];

    for (const surface of hookSurfaces(ctx)) {
      if (!spec.pattern.test(surface.text)) continue;

      findings.push(
        report(surface.file, {
          id: spec.id,
          category: 'hooks',
          severity: spec.severity,
          title: spec.title,
          detail: surface.event
            ? spec.detail + ' Triggered on ' + surface.event + '.'
            : spec.detail,
          remedy: spec.remedy,
          line: surface.line,
          evidence: oneLine(surface.text, 120),
        }),
      );
    }

    return findings;
  },
}));

/**
 * Report `$VAR` interpolations that sit outside any quote on their line.
 * Filenames, branch names and prompt text all reach hooks as variables, and an
 * unquoted one is a shell metacharacter injection point.
 */
export function unquotedVariables(command: string): string[] {
  const out: string[] = [];
  let single = false;
  let double = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === "'" && !double) single = !single;
    else if (ch === '"' && !single) double = !double;
    else if (ch === '$' && !single && !double) {
      const m = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(command.slice(i));
      if (m) out.push(m[0]);
    }
  }

  return out;
}

const injectionRule: Rule = {
  id: 'WL-HOK-001',
  category: 'hooks',
  title: 'Unquoted variable interpolated into a shell command',
  run(ctx) {
    const findings: Finding[] = [];

    for (const surface of hookSurfaces(ctx)) {
      // A bare assignment or export is not an execution point.
      if (/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(surface.text)) continue;

      const vars = unquotedVariables(surface.text);
      if (vars.length === 0) continue;

      findings.push(
        report(surface.file, {
          id: 'WL-HOK-001',
          category: 'hooks',
          severity: 'high',
          title: 'Unquoted variable interpolated into a shell command',
          detail:
            'The value of ' +
            vars.join(', ') +
            ' is spliced into a command without quoting. Hook inputs come from filenames, prompts and tool arguments, so an attacker-chosen value becomes shell syntax rather than data.',
          remedy:
            'Quote every expansion ("$VAR"), or read the value on stdin and pass it as a single argument.',
          line: surface.line,
          evidence: oneLine(surface.text, 120),
        }),
      );
    }

    return findings;
  },
};

const missingPreToolUse: Rule = {
  id: 'WL-HOK-005',
  category: 'hooks',
  title: 'No PreToolUse hook guards tool calls',
  run(ctx) {
    // PreToolUse is a Claude Code concept. Asking an Aider or Continue config
    // why it has no PreToolUse hook is noise, not a finding.
    const runtimeConfigs = ctx.files.filter(
      (f) =>
        f.harness === 'claude' &&
        (f.kind === 'settings' || f.kind === 'hooks-manifest') &&
        (f.trust === 'runtime' || f.trust === 'project-local'),
    );
    if (runtimeConfigs.length === 0) return [];

    const events = new Set<string>();
    for (const file of runtimeConfigs) {
      for (const hook of readHooks(file)) events.add(hook.event);
    }
    if (events.has('PreToolUse')) return [];

    const anchor = runtimeConfigs.find((f) => f.kind === 'settings') ?? runtimeConfigs[0];
    if (!anchor) return [];

    return [
      report(anchor, {
        id: 'WL-HOK-005',
        category: 'hooks',
        severity: events.size === 0 ? 'medium' : 'low',
        title: 'No PreToolUse hook guards tool calls',
        detail:
          'Nothing inspects a tool call before it runs, so the permission list is the only line of defence and there is no record of what was attempted.',
        remedy:
          'Add a PreToolUse hook that logs the tool call and rejects the patterns you never want: writes to .git, reads of .env, network calls to unknown hosts.',
      }),
    ];
  },
};

const sessionStartFetch: Rule = {
  id: 'WL-HOK-012',
  category: 'hooks',
  title: 'Session startup reaches out to the network',
  run(ctx) {
    const findings: Finding[] = [];

    for (const surface of hookSurfaces(ctx)) {
      if (surface.event !== 'SessionStart') continue;
      if (!/(?:curl|wget|iwr|Invoke-WebRequest|npx\s+-y|git\s+clone)\b/i.test(surface.text)) {
        continue;
      }

      findings.push(
        report(surface.file, {
          id: 'WL-HOK-012',
          category: 'hooks',
          severity: 'high',
          title: 'Session startup reaches out to the network',
          detail:
            'Every session begins by fetching remote content before the user has done anything, which makes that endpoint a silent dependency of the whole environment.',
          remedy:
            'Fetch during an explicit, reviewed setup step instead, and pin whatever you fetch.',
          line: surface.line,
          evidence: oneLine(surface.text, 120),
        }),
      );
    }

    return findings;
  },
};

const missingTimeout: Rule = {
  id: 'WL-HOK-016',
  category: 'hooks',
  title: 'Long-running hook declared without a timeout',
  run(ctx) {
    const slow = /\b(?:curl|wget|npm|pnpm|yarn|pip3?|docker|git\s+clone|gradle|mvn)\b/i;
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.kind !== 'settings' && file.kind !== 'hooks-manifest') continue;

      for (const hook of readHooks(file)) {
        if (hook.timeout !== undefined) continue;
        if (!slow.test(hook.command)) continue;

        findings.push(
          report(file, {
            id: 'WL-HOK-016',
            category: 'hooks',
            severity: 'low',
            title: 'Long-running hook declared without a timeout',
            detail:
              'This hook shells out to a command that can block indefinitely on a slow network or a prompt. With no timeout the session hangs with no explanation.',
            remedy: 'Add an explicit "timeout" to the hook definition.',
            line: hook.line,
            evidence: oneLine(hook.command, 100),
          }),
        );
      }
    }

    return findings;
  },
};

export const hookRules: Rule[] = [
  injectionRule,
  ...patternRules,
  missingPreToolUse,
  sessionStartFetch,
  missingTimeout,
];
