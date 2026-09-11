/**
 * Structural readers.
 *
 * Rules should never have to guess which of several config shapes they are
 * looking at. These helpers normalise settings files, MCP manifests and hook
 * declarations into flat records with line anchors already attached.
 */

import { lineOf } from '../util/text.js';
import type { ConfigFile } from '../types.js';

export interface PermissionSet {
  allow: string[];
  deny: string[];
  ask: string[];
  defaultMode?: string;
}

export interface HookEntry {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
  line?: number;
}

export interface McpServerEntry {
  name: string;
  command?: string;
  args: string[];
  url?: string;
  type?: string;
  env: Record<string, string>;
  timeout?: number;
  autoApprove: string[];
  line?: number;
  raw: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Permission block from a settings file, tolerating the legacy flat shape. */
export function readPermissions(file: ConfigFile): PermissionSet | undefined {
  if (!isRecord(file.data)) return undefined;

  const block = isRecord(file.data.permissions) ? file.data.permissions : undefined;
  const legacyAllow = asStringArray(file.data.allowedTools);

  if (!block && legacyAllow.length === 0) return undefined;

  return {
    allow: [...asStringArray(block?.allow), ...legacyAllow],
    deny: asStringArray(block?.deny),
    ask: asStringArray(block?.ask),
    defaultMode:
      typeof block?.defaultMode === 'string' ? block.defaultMode : undefined,
  };
}

/**
 * Flatten every hook command in a settings file or hooks manifest.
 *
 * Handles both the nested matcher form
 *   `{ PreToolUse: [ { matcher, hooks: [ { command } ] } ] }`
 * and the flat form
 *   `{ PreToolUse: [ { command } ] }`.
 */
export function readHooks(file: ConfigFile): HookEntry[] {
  if (!isRecord(file.data)) return [];

  const block = isRecord(file.data.hooks) ? file.data.hooks : file.data;
  const entries: HookEntry[] = [];

  for (const [event, value] of Object.entries(block)) {
    if (!Array.isArray(value)) continue;

    for (const group of value) {
      if (!isRecord(group)) continue;

      const matcher = typeof group.matcher === 'string' ? group.matcher : undefined;
      const inner = Array.isArray(group.hooks) ? group.hooks : [group];

      for (const hook of inner) {
        if (!isRecord(hook)) continue;
        const command = hook.command;
        if (typeof command !== 'string' || command.length === 0) continue;

        entries.push({
          event,
          matcher,
          command,
          timeout: typeof hook.timeout === 'number' ? hook.timeout : undefined,
          line: lineOf(file.content, command.slice(0, 60)),
        });
      }
    }
  }

  return entries;
}

/**
 * Every MCP server declared by a file, including the per-project buckets that
 * `.claude.json` nests under `projects`.
 */
export function readMcpServers(file: ConfigFile): McpServerEntry[] {
  if (!isRecord(file.data)) return [];

  const buckets: Record<string, unknown>[] = [];
  const collect = (value: unknown): void => {
    if (isRecord(value)) buckets.push(value);
  };

  collect(file.data.mcpServers);
  collect(file.data.servers);

  if (isRecord(file.data.projects)) {
    for (const project of Object.values(file.data.projects)) {
      if (isRecord(project)) collect(project.mcpServers);
    }
  }

  const servers: McpServerEntry[] = [];

  for (const bucket of buckets) {
    for (const [name, value] of Object.entries(bucket)) {
      if (!isRecord(value)) continue;

      const env: Record<string, string> = {};
      if (isRecord(value.env)) {
        for (const [k, v] of Object.entries(value.env)) {
          if (typeof v === 'string') env[k] = v;
        }
      }

      servers.push({
        name,
        command: typeof value.command === 'string' ? value.command : undefined,
        args: asStringArray(value.args),
        url: typeof value.url === 'string' ? value.url : undefined,
        type: typeof value.type === 'string' ? value.type : undefined,
        env,
        timeout: typeof value.timeout === 'number' ? value.timeout : undefined,
        autoApprove: [
          ...asStringArray(value.autoApprove),
          ...asStringArray(value.alwaysAllow),
        ],
        line: lineOf(file.content, `"${name}"`),
        raw: value,
      });
    }
  }

  return servers;
}

/** Full command line for an MCP server, used by shell-shape rules. */
export function serverCommandLine(server: McpServerEntry): string {
  return [server.command ?? '', ...server.args].join(' ').trim();
}
