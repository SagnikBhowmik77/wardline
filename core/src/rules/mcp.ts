/**
 * MCP server rules.
 *
 * Every MCP server is a set of tools the agent can call without you seeing the
 * implementation. These rules look at what each server can reach, where its
 * code comes from, and whether its calls are approved by anyone.
 */

import { readMcpServers, serverCommandLine } from '../scanner/extract.js';
import type { McpServerEntry } from '../scanner/extract.js';
import { oneLine, redact } from '../util/text.js';
import { looksLikePlaceholder, report } from './helpers.js';
import type { ConfigFile, Finding, Rule, ScanContext } from '../types.js';

interface ServerRef {
  file: ConfigFile;
  server: McpServerEntry;
}

function allServers(ctx: ScanContext): ServerRef[] {
  const out: ServerRef[] = [];
  for (const file of ctx.files) {
    for (const server of readMcpServers(file)) out.push({ file, server });
  }
  return out;
}

/** Everything a rule wants to grep: name, command, args, url. */
function fingerprint(server: McpServerEntry): string {
  return [server.name, serverCommandLine(server), server.url ?? ''].join(' ').toLowerCase();
}

const shellServer: Rule = {
  id: 'WL-MCP-001',
  category: 'mcp',
  title: 'Server exposes arbitrary command execution',
  run(ctx) {
    const shellish =
      /\b(?:shell|exec|terminal|command-runner|run-command|bash|cmd|subprocess|desktop-commander)\b/;
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      if (!shellish.test(fingerprint(server))) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-001',
          category: 'mcp',
          severity: 'critical',
          title: 'Server exposes arbitrary command execution',
          detail:
            'The "' +
            server.name +
            '" server offers shell execution as a tool. Once it is connected, your Bash permission list no longer bounds what the agent can run, because the tool call goes around it.',
          remedy:
            'Remove the server, or replace it with one exposing only the operations you need. If you keep it, restrict its tools and require approval on every call.',
          line: server.line,
          evidence: server.name,
        }),
      );
    }

    return findings;
  },
};

const filesystemScope: Rule = {
  id: 'WL-MCP-002',
  category: 'mcp',
  title: 'Filesystem server mounted above the project',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      if (!/\bfile(?:system)?\b|\bfs\b/.test(fingerprint(server))) continue;

      const paths = server.args.filter((a) => /^[~/]|^[A-Za-z]:[\\/]|^\.{1,2}\//.test(a));
      if (paths.length === 0) continue;

      const broad = paths.filter((p) =>
        /^\/$|^~\/?$|^\/(?:home|Users|etc|var|root)\/?$|^[A-Za-z]:[\\/]?$|^~\/(?:\.ssh|\.aws|Documents|Desktop)/.test(
          p,
        ),
      );
      const repoScoped = paths.every((p) => p.startsWith('./'));
      if (broad.length === 0 && repoScoped) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-002',
          category: 'mcp',
          severity: broad.length > 0 ? 'high' : 'medium',
          title: 'Filesystem server mounted above the project',
          detail:
            broad.length > 0
              ? 'The "' +
                server.name +
                '" server is mounted at ' +
                broad.join(', ') +
                ', so it can read and write anywhere in that tree: SSH keys, browser profiles, every other project on the machine.'
              : 'The "' +
                server.name +
                '" server is mounted outside the current project directory, widening what the agent can reach beyond the work at hand.',
          remedy:
            'Mount only the repository directory, and prefer a read-only mount when the agent does not need to write.',
          line: server.line,
          evidence: oneLine(serverCommandLine(server), 100),
        }),
      );
    }

    return findings;
  },
};

const databaseServer: Rule = {
  id: 'WL-MCP-003',
  category: 'mcp',
  title: 'Database server connected without a read-only scope',
  run(ctx) {
    const dbish =
      /\b(?:postgres|postgresql|mysql|mariadb|mongo|mongodb|sqlite|redis|clickhouse|snowflake|bigquery|supabase)\b/;
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      const print = fingerprint(server) + ' ' + Object.values(server.env).join(' ').toLowerCase();
      if (!dbish.test(print)) continue;
      if (/read[-_]?only|--readonly|\breader\b/.test(print)) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-003',
          category: 'mcp',
          severity: 'high',
          title: 'Database server connected without a read-only scope',
          detail:
            'The "' +
            server.name +
            '" server issues queries with whatever privileges its connection string carries. One mistaken or injected tool call can drop or exfiltrate real data.',
          remedy:
            'Connect with a read-only role scoped to the schemas the agent needs, and keep migrations and writes on a separate reviewed path.',
          line: server.line,
          evidence: server.name,
        }),
      );
    }

    return findings;
  },
};

const browserServer: Rule = {
  id: 'WL-MCP-004',
  category: 'mcp',
  title: 'Browser automation server connected',
  run(ctx) {
    const browserish = /\b(?:puppeteer|playwright|selenium|browser|chrome-devtools|webdriver)\b/;
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      if (!browserish.test(fingerprint(server))) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-004',
          category: 'mcp',
          severity: 'medium',
          title: 'Browser automation server connected',
          detail:
            'The "' +
            server.name +
            '" server drives a browser, so page content becomes agent input. Attached to your real profile, it also inherits every logged-in session you have.',
          remedy:
            'Point it at a disposable profile with no saved credentials, and treat everything it returns as untrusted text.',
          line: server.line,
          evidence: server.name,
        }),
      );
    }

    return findings;
  },
};

const autoInstall: Rule = {
  id: 'WL-MCP-005',
  category: 'mcp',
  title: 'Server auto-installs its package on launch',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      const cmd = serverCommandLine(server);
      if (!/\b(?:npx\s+(?:-y|--yes)|uvx|pipx\s+run|bunx)\b/i.test(cmd)) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-005',
          category: 'mcp',
          severity: 'high',
          title: 'Server auto-installs its package on launch',
          detail:
            'The "' +
            server.name +
            '" server fetches and runs its package from a public registry with the confirmation prompt suppressed. A hijacked or typosquatted package executes before anyone sees a diff.',
          remedy:
            'Install the package as a normal dependency with a lockfile, then launch it from node_modules.',
          line: server.line,
          evidence: oneLine(cmd, 100),
        }),
      );
    }

    return findings;
  },
};

const unpinnedPackage: Rule = {
  id: 'WL-MCP-006',
  category: 'mcp',
  title: 'Server package is not version-pinned',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      const cmd = serverCommandLine(server);
      if (!/\b(?:npx|uvx|pipx|bunx)\b/i.test(cmd)) continue;

      const pkg = server.args.find((a) => !a.startsWith('-') && /[a-z]/i.test(a));
      if (!pkg) continue;
      if (/@\d|==\d|@[0-9a-f]{7,40}$/.test(pkg)) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-006',
          category: 'mcp',
          severity: 'medium',
          title: 'Server package is not version-pinned',
          detail:
            'The "' +
            server.name +
            '" server resolves "' +
            pkg +
            '" to whatever the registry serves at launch, so its behaviour can change between two runs with no local change.',
          remedy: 'Pin an exact version, e.g. ' + pkg + '@1.2.3.',
          line: server.line,
          evidence: pkg,
        }),
      );
    }

    return findings;
  },
};

const secretInEnv: Rule = {
  id: 'WL-MCP-007',
  category: 'mcp',
  title: 'Credential hardcoded in server environment',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      for (const [key, value] of Object.entries(server.env)) {
        if (!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|DSN|URI|URL/i.test(key)) continue;
        if (value.length < 12) continue;
        if (/^\$\{?[A-Za-z_]/.test(value)) continue; // a proper env reference
        if (looksLikePlaceholder(value)) continue;
        if (/^https?:\/\//i.test(value) && !/:[^@/]+@/.test(value)) continue; // plain URL

        findings.push(
          report(file, {
            id: 'WL-MCP-007',
            category: 'mcp',
            severity: 'critical',
            title: 'Credential hardcoded in server environment',
            detail:
              'The "' +
              server.name +
              '" server carries a literal value for ' +
              key +
              '. It ships with the config to every machine and every fork.',
            remedy: 'Replace the value with ${' + key + '} and provide it from the environment.',
            line: server.line,
            evidence: key + '=' + redact(value),
          }),
        );
      }
    }

    return findings;
  },
};

const remoteTransport: Rule = {
  id: 'WL-MCP-008',
  category: 'mcp',
  title: 'Server reached over a remote transport',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      const url = server.url;
      if (!url || !/^https?:\/\//i.test(url)) continue;
      if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(url)) continue;

      const insecure = /^http:\/\//i.test(url);

      findings.push(
        report(file, {
          id: 'WL-MCP-008',
          category: 'mcp',
          severity: insecure ? 'critical' : 'high',
          title: insecure
            ? 'Server reached over unencrypted HTTP'
            : 'Server reached over a remote transport',
          detail: insecure
            ? 'The "' +
              server.name +
              '" server is contacted over plain HTTP, so tool arguments and results, including anything read from your files, cross the network in the clear.'
            : 'The "' +
              server.name +
              '" server runs on infrastructure you do not control. Everything the agent passes to its tools is sent to that operator.',
          remedy: insecure
            ? 'Use HTTPS, or run the server locally.'
            : 'Confirm you trust the operator, and avoid passing repository contents or credentials through its tools.',
          line: server.line,
          evidence: url,
        }),
      );
    }

    return findings;
  },
};

const shellMetacharacters: Rule = {
  id: 'WL-MCP-009',
  category: 'mcp',
  title: 'Shell metacharacters in the server launch command',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      const cmd = serverCommandLine(server);
      if (!/[;&|`]|\$\(|>\s*\/|<\s*\//.test(cmd)) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-009',
          category: 'mcp',
          severity: 'high',
          title: 'Shell metacharacters in the server launch command',
          detail:
            'The launch line for "' +
            server.name +
            '" chains or redirects commands. That is a second command running under the name of a server definition, where nobody looks for one.',
          remedy:
            'Launch a single executable with plain arguments. Put any orchestration in a reviewed script and point the server at that.',
          line: server.line,
          evidence: oneLine(cmd, 100),
        }),
      );
    }

    return findings;
  },
};

const sensitiveArgs: Rule = {
  id: 'WL-MCP-010',
  category: 'mcp',
  title: 'Sensitive file passed to a server as an argument',
  run(ctx) {
    const sensitive =
      /(?:\.env(?:\.|$)|\.pem$|\.key$|id_rsa|credentials(?:\.json)?$|\.netrc|\.npmrc|service-account.*\.json)/i;
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      for (const arg of server.args) {
        if (!sensitive.test(arg)) continue;

        findings.push(
          report(file, {
            id: 'WL-MCP-010',
            category: 'mcp',
            severity: 'critical',
            title: 'Sensitive file passed to a server as an argument',
            detail:
              'The "' +
              server.name +
              '" server is handed a path that normally holds secret material, which puts the file contents inside the tool boundary.',
            remedy:
              'Pass only the one value the server needs, through the environment, and keep the file itself out of reach.',
            line: server.line,
            evidence: arg,
          }),
        );
      }
    }

    return findings;
  },
};

const publicBind: Rule = {
  id: 'WL-MCP-011',
  category: 'mcp',
  title: 'Server listens on all network interfaces',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      const print = serverCommandLine(server) + ' ' + (server.url ?? '');
      if (!/0\.0\.0\.0|\[::\]|--host\s+\*/.test(print)) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-011',
          category: 'mcp',
          severity: 'high',
          title: 'Server listens on all network interfaces',
          detail:
            'Binding "' +
            server.name +
            '" to 0.0.0.0 exposes its tools to anything that can reach this machine, including other devices on a shared network.',
          remedy: 'Bind to 127.0.0.1 and use an SSH tunnel if remote access is genuinely required.',
          line: server.line,
          evidence: oneLine(print, 100),
        }),
      );
    }

    return findings;
  },
};

const autoApprove: Rule = {
  id: 'WL-MCP-012',
  category: 'mcp',
  title: 'Server tool calls are auto-approved',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      if (server.autoApprove.length === 0) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-012',
          category: 'mcp',
          severity: 'high',
          title: 'Server tool calls are auto-approved',
          detail:
            server.autoApprove.length +
            ' tool(s) on "' +
            server.name +
            '" run without confirmation. Approval is the control that catches a tool call the model was talked into making.',
          remedy:
            'Auto-approve only genuinely read-only tools, and keep confirmation on anything that writes, deletes or sends.',
          line: server.line,
          evidence: server.autoApprove.join(', '),
        }),
      );
    }

    return findings;
  },
};

const missingTimeout: Rule = {
  id: 'WL-MCP-013',
  category: 'mcp',
  title: 'Networked server declared without a timeout',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      if (server.timeout !== undefined) continue;
      if (!server.url && !/\b(?:npx|uvx|docker)\b/i.test(serverCommandLine(server))) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-013',
          category: 'mcp',
          severity: 'low',
          title: 'Networked server declared without a timeout',
          detail:
            'The "' +
            server.name +
            '" server can block on the network with no bound, which stalls the session and holds resources open.',
          remedy: 'Add an explicit "timeout" to the server definition.',
          line: server.line,
          evidence: server.name,
        }),
      );
    }

    return findings;
  },
};

const environmentPassthrough: Rule = {
  id: 'WL-MCP-014',
  category: 'mcp',
  title: 'Server inherits the whole environment',
  run(ctx) {
    const findings: Finding[] = [];

    for (const { file, server } of allServers(ctx)) {
      const inherits =
        server.raw.inheritEnv === true ||
        server.raw.passEnv === true ||
        Object.values(server.env).some((v) => v.trim() === '${*}' || v.trim() === '*');
      if (!inherits) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-014',
          category: 'mcp',
          severity: 'high',
          title: 'Server inherits the whole environment',
          detail:
            'Third-party server code under "' +
            server.name +
            '" receives every variable in your shell, which in practice means every credential on the machine.',
          remedy: 'List the exact variables the server needs and pass only those.',
          line: server.line,
          evidence: server.name,
        }),
      );
    }

    return findings;
  },
};

const serverSprawl: Rule = {
  id: 'WL-MCP-015',
  category: 'mcp',
  title: 'Large number of servers enabled at once',
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      const servers = readMcpServers(file);
      if (servers.length < 10) continue;

      findings.push(
        report(file, {
          id: 'WL-MCP-015',
          category: 'mcp',
          severity: 'info',
          title: 'Large number of servers enabled at once',
          detail:
            servers.length +
            ' servers are declared here. Each one is third-party code inside the trust boundary, and the tool descriptions they inject all compete for the model attention budget.',
          remedy:
            'Enable the servers a given project actually needs, and keep the rest in a template you opt into.',
          line: servers[0]?.line,
        }),
      );
    }

    return findings;
  },
};

export const mcpRules: Rule[] = [
  shellServer,
  filesystemScope,
  databaseServer,
  browserServer,
  autoInstall,
  unpinnedPackage,
  secretInEnv,
  remoteTransport,
  shellMetacharacters,
  sensitiveArgs,
  publicBind,
  autoApprove,
  missingTimeout,
  environmentPassthrough,
  serverSprawl,
];
