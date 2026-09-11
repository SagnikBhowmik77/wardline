import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';

import { matchSurface } from '../harness.js';
import { stripJsonComments } from '../util/text.js';
import type { HarnessId, SurfaceMatch } from '../harness.js';
import type { ConfigFile, FileKind, SourceTrust } from '../types.js';

/** Directories that only ever contain generated or vendored copies. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'target',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
]);

/** Directory names whose markdown files are agent or command prompts. */
const PROMPT_DIRS = new Set([
  'agents',
  'subagents',
  'commands',
  'skills',
  'prompts',
  'rules',
]);

const TEMPLATE_DIRS = new Set([
  'examples',
  'example',
  'samples',
  'sample',
  'templates',
  'template',
  'fixtures',
  'demo',
  'demos',
  'playground',
  'mcp-configs',
]);

const DOC_DIRS = new Set([
  'docs',
  'doc',
  'guide',
  'guides',
  'tutorial',
  'tutorials',
  'cookbook',
  'recipes',
  'reference',
  'references',
]);

const HOOK_SCRIPT_EXT = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
]);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 4000;

export interface DiscoverOptions {
  /** Stop walking below this depth. Guards against pathological trees. */
  maxDepth?: number;
}

/** Decide what a discovered path is, or `null` if Wardline does not care. */
export function classify(relPath: string): FileKind | null {
  return classifySurface(relPath)?.kind ?? null;
}

/**
 * Classification, with the agent it belongs to.
 *
 * The harness registry is consulted first because it knows exact filenames.
 * What follows are shape-based fallbacks for conventions no single agent owns:
 * environment files, anything MCP-shaped, hook scripts, and prompt directories.
 */
export function classifySurface(relPath: string): SurfaceMatch | null {
  const parts = relPath.split('/');
  const name = (parts[parts.length - 1] ?? '').toLowerCase();
  const dirs = parts.slice(0, -1).map((d) => d.toLowerCase());
  const ext = extname(name);

  if (name.startsWith('.env')) return { kind: 'env', harness: 'generic' };

  const known = matchSurface(relPath);
  if (known) return known;

  if (ext === '.json' && name.includes('mcp')) return { kind: 'mcp', harness: 'generic' };

  if (dirs.includes('hooks') && HOOK_SCRIPT_EXT.has(ext)) {
    return { kind: 'hook-script', harness: dirs.includes('.claude') ? 'claude' : 'generic' };
  }

  if (ext === '.md' && dirs.some((d) => PROMPT_DIRS.has(d))) {
    return { kind: 'agent-prompt', harness: harnessOfDir(dirs) };
  }

  return null;
}

/** Attribute a prompt directory to whichever agent owns the folder above it. */
function harnessOfDir(dirs: string[]): HarnessId {
  if (dirs.includes('.claude')) return 'claude';
  if (dirs.includes('.cursor')) return 'cursor';
  if (dirs.includes('.windsurf')) return 'windsurf';
  if (dirs.includes('.roo')) return 'roo';
  if (dirs.includes('.github')) return 'copilot';
  return 'generic';
}

/**
 * How much authority a file has over the running agent, inferred from where it
 * sits. Findings keep their severity either way; only the score is weighted.
 */
export function trustOf(relPath: string, kind: FileKind): SourceTrust {
  const parts = relPath.split('/');
  const name = (parts[parts.length - 1] ?? '').toLowerCase();
  const dirs = parts.slice(0, -1).map((d) => d.toLowerCase());

  // Installed plugin and marketplace content is third-party code sitting on
  // disk. It is worth reporting, but it is not the user's own configuration,
  // and at full weight a large plugin cache buries everything they wrote.
  const pluginIdx = dirs.indexOf('plugins');
  if (pluginIdx !== -1) {
    const next = dirs[pluginIdx + 1];
    if (next === 'cache' || next === 'marketplaces' || next === 'repos') return 'plugin';
  }

  if (dirs.some((d) => TEMPLATE_DIRS.has(d))) return 'template';
  if (dirs.some((d) => DOC_DIRS.has(d))) return 'docs';
  if (name === 'settings.local.json' || name === 'claude.local.md') {
    return 'project-local';
  }
  if (kind === 'json' || kind === 'markdown') return 'unknown';
  return 'runtime';
}

/**
 * Patterns from a .wardlineignore at the scan root.
 *
 * Every project has directories that exist to be broken: fixtures, attack
 * corpora, vendored samples. Counting them says nothing about the project.
 */
export function readIgnoreFile(root: string): string[] {
  try {
    return readFileSync(join(root, '.wardlineignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Match a relative path against one pattern. Two forms, both without regex so
 * an escaping mistake cannot silently widen or narrow the match: a leading
 * star matches by suffix, anything else matches a path prefix.
 */
export function ignoreMatches(relPath: string, pattern: string): boolean {
  if (pattern.startsWith('*')) return relPath.endsWith(pattern.slice(1));

  const prefix = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  return relPath === prefix || relPath.startsWith(prefix + '/');
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

export interface DiscoveryResult {
  files: ConfigFile[];
  /** True when the file ceiling was reached, so these results are partial. */
  truncated: boolean;
}

/** Recursively collect every config file Wardline knows how to reason about. */
export function discover(root: string, options: DiscoverOptions = {}): ConfigFile[] {
  return discoverWithMeta(root, options).files;
}

/**
 * Discovery with the detail the reporter needs. A silently truncated scan is
 * worse than a slow one: it reads as a clean bill of health for files nobody
 * ever opened.
 */
export function discoverWithMeta(root: string, options: DiscoverOptions = {}): DiscoveryResult {
  const maxDepth = options.maxDepth ?? 12;
  const found: ConfigFile[] = [];
  const ignored = readIgnoreFile(root);

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || found.length >= MAX_FILES) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip rather than abort the whole scan
    }

    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      const abs = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const relPath = toRel(root, abs);
      if (ignored.some((pattern) => ignoreMatches(relPath, pattern))) continue;

      const surface = classifySurface(relPath);
      if (!surface) continue;

      let size = 0;
      try {
        size = statSync(abs).size;
      } catch {
        continue;
      }
      if (size > MAX_FILE_BYTES) continue;

      let content: string;
      try {
        content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }

      found.push(makeConfigFile(abs, relPath, surface.kind, content, surface.harness));
    }
  };

  let rootStat;
  try {
    rootStat = statSync(root);
  } catch {
    return { files: found, truncated: false };
  }

  if (rootStat.isFile()) {
    const relPath = basename(root);
    const surface = classifySurface(relPath);
    return {
      files: [
        makeConfigFile(
          root,
          relPath,
          surface?.kind ?? 'markdown',
          readFileSync(root, 'utf8'),
          surface?.harness,
        ),
      ],
      truncated: false,
    };
  }

  walk(root, 0);

  return {
    files: found.sort((a, b) => a.relPath.localeCompare(b.relPath)),
    truncated: found.length >= MAX_FILES,
  };
}

/**
 * Build a ConfigFile from content that never came from this filesystem - a file
 * fetched over HTTP, or one held in a database. Returns null when the path is
 * not something Wardline reasons about, so callers can filter cheaply.
 */
export function configFileFrom(
  relPath: string,
  content: string,
  kind?: FileKind,
): ConfigFile | null {
  const surface = classifySurface(relPath);
  const resolved = kind ?? surface?.kind;
  if (!resolved) return null;
  return makeConfigFile(relPath, relPath, resolved, content, surface?.harness);
}

function makeConfigFile(
  abs: string,
  relPath: string,
  kind: FileKind,
  content: string,
  harness?: HarnessId,
): ConfigFile {
  const file: ConfigFile = {
    path: abs,
    relPath,
    kind,
    harness,
    trust: trustOf(relPath, kind),
    content,
  };

  if (extname(relPath) === '.json') {
    try {
      file.data = JSON.parse(stripJsonComments(content));
    } catch (err) {
      file.parseError = err instanceof Error ? err.message : String(err);
    }
  }

  return file;
}
