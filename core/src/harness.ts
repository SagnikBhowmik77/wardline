/**
 * Which coding agent does this file configure?
 *
 * The risks are the same everywhere - a permission that is too wide, something
 * that executes on its own, third-party tools inside the trust boundary,
 * instructions that remove oversight. Only the filenames differ. This registry
 * is the whole of the per-agent knowledge; every rule downstream is shared.
 *
 * Matching uses plain string predicates rather than patterns, so a misplaced
 * escape cannot silently stop recognising an agent.
 */

import type { FileKind } from './types.js';

export type HarnessId =
  | 'claude'
  | 'cursor'
  | 'copilot'
  | 'windsurf'
  | 'cline'
  | 'roo'
  | 'continue'
  | 'aider'
  | 'zed'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'vscode'
  | 'generic';

export const HARNESS_LABEL: Record<HarnessId, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  windsurf: 'Windsurf',
  cline: 'Cline',
  roo: 'Roo Code',
  continue: 'Continue',
  aider: 'Aider',
  zed: 'Zed',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  vscode: 'VS Code',
  generic: 'Cross-agent',
};

interface Surface {
  harness: HarnessId;
  kind: FileKind;
  /** Exact basenames, compared lowercase. */
  names?: string[];
  /** Basename endings, compared lowercase. */
  suffixes?: string[];
  /** Every one of these directories must appear somewhere in the path. */
  inDirs?: string[];
  /** With inDirs, the basename must also end with this. */
  ext?: string;
}

/**
 * Ordered: the first surface that matches wins, so specific paths must precede
 * the generic ones.
 */
const SURFACES: Surface[] = [
  // --- Claude Code -------------------------------------------------------
  {
    harness: 'claude',
    kind: 'settings',
    names: ['settings.json', 'settings.local.json'],
    inDirs: ['.claude'],
  },
  { harness: 'claude', kind: 'mcp', names: ['.mcp.json', '.claude.json'] },
  { harness: 'claude', kind: 'project-brief', names: ['claude.md', 'claude.local.md'] },
  { harness: 'claude', kind: 'hooks-manifest', names: ['hooks.json'] },

  // --- Cursor ------------------------------------------------------------
  { harness: 'cursor', kind: 'project-brief', names: ['.cursorrules'] },
  { harness: 'cursor', kind: 'agent-prompt', inDirs: ['.cursor', 'rules'], ext: '.mdc' },
  { harness: 'cursor', kind: 'agent-prompt', inDirs: ['.cursor', 'rules'], ext: '.md' },
  { harness: 'cursor', kind: 'mcp', names: ['mcp.json'], inDirs: ['.cursor'] },

  // --- GitHub Copilot ----------------------------------------------------
  { harness: 'copilot', kind: 'project-brief', names: ['copilot-instructions.md'] },
  { harness: 'copilot', kind: 'agent-prompt', suffixes: ['.instructions.md'] },
  { harness: 'copilot', kind: 'agent-prompt', suffixes: ['.prompt.md'] },
  { harness: 'copilot', kind: 'agent-prompt', suffixes: ['.chatmode.md'] },

  // --- Windsurf ----------------------------------------------------------
  { harness: 'windsurf', kind: 'project-brief', names: ['.windsurfrules'] },
  { harness: 'windsurf', kind: 'agent-prompt', inDirs: ['.windsurf', 'rules'], ext: '.md' },
  { harness: 'windsurf', kind: 'mcp', names: ['mcp_config.json'] },

  // --- Cline and Roo Code ------------------------------------------------
  { harness: 'cline', kind: 'project-brief', names: ['.clinerules'] },
  { harness: 'cline', kind: 'agent-prompt', inDirs: ['.clinerules'], ext: '.md' },
  { harness: 'cline', kind: 'mcp', names: ['cline_mcp_settings.json'] },
  { harness: 'roo', kind: 'project-brief', names: ['.roorules', '.roomodes'] },
  { harness: 'roo', kind: 'agent-prompt', inDirs: ['.roo', 'rules'], ext: '.md' },

  // --- Continue ----------------------------------------------------------
  {
    harness: 'continue',
    kind: 'settings',
    names: ['config.json', 'config.yaml'],
    inDirs: ['.continue'],
  },

  // --- Aider -------------------------------------------------------------
  { harness: 'aider', kind: 'settings', names: ['.aider.conf.yml', '.aider.conf.yaml'] },
  { harness: 'aider', kind: 'project-brief', names: ['conventions.md'] },

  // --- Zed ---------------------------------------------------------------
  { harness: 'zed', kind: 'settings', names: ['settings.json'], inDirs: ['.zed'] },
  { harness: 'zed', kind: 'ide-tasks', names: ['tasks.json'], inDirs: ['.zed'] },
  { harness: 'zed', kind: 'project-brief', names: ['.rules'] },

  // --- VS Code (hosts several agents, and opens folders on its own) -------
  { harness: 'vscode', kind: 'mcp', names: ['mcp.json'], inDirs: ['.vscode'] },
  { harness: 'vscode', kind: 'ide-tasks', names: ['tasks.json'], inDirs: ['.vscode'] },

  // --- Codex, Gemini, OpenCode -------------------------------------------
  { harness: 'codex', kind: 'settings', names: ['config.toml'], inDirs: ['.codex'] },
  { harness: 'gemini', kind: 'project-brief', names: ['gemini.md'] },
  { harness: 'gemini', kind: 'settings', names: ['settings.json'], inDirs: ['.gemini'] },
  { harness: 'opencode', kind: 'mcp', names: ['opencode.json', 'opencode.jsonc'] },

  // --- Cross-agent conventions -------------------------------------------
  // Last, so an agent-owned directory above always claims the file first.
  { harness: 'claude', kind: 'settings', names: ['settings.json', 'settings.local.json'] },
  { harness: 'generic', kind: 'project-brief', names: ['agents.md', 'agent.md'] },
  {
    harness: 'generic',
    kind: 'mcp',
    names: ['mcp.json', 'mcp-servers.json', 'mcp_servers.json'],
  },
];

/** Agent names, for telling a user what was actually looked for. */
export function knownHarnesses(): string[] {
  const seen = new Set<HarnessId>(SURFACES.map((s) => s.harness));
  return [...seen].map((id) => HARNESS_LABEL[id]);
}

export interface SurfaceMatch {
  kind: FileKind;
  harness: HarnessId;
}

/** Identify a path, or return null when Wardline has nothing to say about it. */
export function matchSurface(relPath: string): SurfaceMatch | null {
  const parts = relPath.split('/');
  const name = (parts[parts.length - 1] ?? '').toLowerCase();
  const dirs = parts.slice(0, -1).map((d) => d.toLowerCase());

  for (const surface of SURFACES) {
    if (surface.inDirs && !surface.inDirs.every((d) => dirs.includes(d))) continue;

    if (surface.names?.includes(name)) return { kind: surface.kind, harness: surface.harness };
    if (surface.suffixes?.some((s) => name.endsWith(s))) {
      return { kind: surface.kind, harness: surface.harness };
    }
    if (surface.inDirs && surface.ext && name.endsWith(surface.ext)) {
      return { kind: surface.kind, harness: surface.harness };
    }
  }

  return null;
}

/** Distinct harnesses present in a set of files, with how many files each owns. */
export function harnessesIn(
  files: { harness?: HarnessId }[],
): { id: HarnessId; label: string; files: number }[] {
  const counts = new Map<HarnessId, number>();

  for (const file of files) {
    if (!file.harness) continue;
    counts.set(file.harness, (counts.get(file.harness) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: HARNESS_LABEL[id], files: count }))
    .sort((a, b) => b.files - a.files || a.label.localeCompare(b.label));
}
