/**
 * Corpus ingestion.
 *
 * Pulls real agent configuration out of public repositories and runs the same
 * 69 rules over it that a local scan uses. Nothing is cloned and nothing is
 * written to disk: files are fetched into memory, analysed, and only the
 * findings survive.
 */

import { analyzeFiles, classify, configFileFrom, knownHarnesses } from 'wardline';
import type { ConfigFile } from 'wardline';

import type { GitHubClient, TreeEntry } from './github.js';
import type { Store } from './db.js';

/** Generated or vendored trees never describe what a repository actually runs. */
const SKIP_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '.next',
  'venv',
  '.venv',
  'site-packages',
]);

const MAX_FILES_PER_REPO = 120;
const MAX_FILE_BYTES = 512 * 1024;
const FETCH_CONCURRENCY = 6;

export interface IngestResult {
  slug: string;
  ok: boolean;
  reason?: string;
  /**
   * Why it did not produce a scan. `no-config` is not a fault: the repository
   * simply ships no agent configuration, so Wardline has nothing to say about
   * it. Callers should present that differently from a real failure.
   */
  code?: 'no-config' | 'unreadable' | 'error';
  scanId?: number;
  grade?: string;
  score?: number;
  configFiles?: number;
  configBytes?: number;
  /** Too little configuration for the score to mean anything. */
  unrated?: boolean;
  findings?: number;
}

export interface IngestOptions {
  /** Count this repository in the benchmark population. */
  inCorpus?: boolean;
}

function isCandidate(entry: TreeEntry): boolean {
  if (entry.type !== 'blob') return false;
  if ((entry.size ?? 0) > MAX_FILE_BYTES) return false;

  const segments = entry.path.split('/');
  if (segments.some((s) => SKIP_SEGMENTS.has(s))) return false;

  return classify(entry.path) !== null;
}

/** Fetch with a small concurrency window so one repo cannot swamp the CDN. */
async function fetchAll(
  gh: GitHubClient,
  slug: string,
  branch: string,
  paths: string[],
): Promise<ConfigFile[]> {
  const files: ConfigFile[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < paths.length) {
      const path = paths[cursor++];
      if (path === undefined) return;

      try {
        const content = await gh.getRawFile(slug, branch, path);
        if (content === null) continue;

        const file = configFileFrom(path, content);
        if (file) files.push(file);
      } catch {
        // A single unreadable file must not abandon the repository.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, paths.length) }, () => worker()),
  );

  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Ingest one repository: list it, fetch its config, analyse, store. */
export async function ingestRepo(
  store: Store,
  gh: GitHubClient,
  slug: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  try {
    const meta = await gh.getRepo(slug);
    const tree = await gh.getTree(slug, meta.defaultBranch);
    const paths = tree.filter(isCandidate).map((e) => e.path);

    if (paths.length === 0) {
      return {
        slug,
        ok: false,
        code: 'no-config',
        // Naming what was searched for matters: without it this reads as a
        // limitation of the scanner rather than a fact about the repository.
        reason:
          'No agent configuration found for any of the ' +
          knownHarnesses().length +
          ' agents Wardline reads (' +
          knownHarnesses().slice(0, 6).join(', ') +
          ' and more). This repository has none of their files, so there is nothing to audit.',
      };
    }

    const truncated = paths.length > MAX_FILES_PER_REPO;
    const files = await fetchAll(gh, slug, meta.defaultBranch, paths.slice(0, MAX_FILES_PER_REPO));

    if (files.length === 0) {
      return { slug, ok: false, code: 'unreadable', reason: 'Its configuration files could not be read.' };
    }

    const report = analyzeFiles(slug, files, { truncated });

    // A repository with almost no configuration and therefore no findings is
    // not a well-configured repository; letting it into the benchmark would
    // pull the median up and rank empty repos above hardened ones.
    const unrated = report.summary.evidence === 'thin' && report.summary.total === 0;

    const repo = store.upsertRepo({
      source: 'github',
      slug,
      stars: meta.stars,
      defaultBranch: meta.defaultBranch,
      inCorpus: (options.inCorpus ?? true) && !unrated,
    });

    const scanId = store.recordScan(repo, report);

    return {
      slug,
      ok: true,
      scanId,
      grade: unrated ? '--' : report.scorecard.grade,
      score: report.scorecard.score,
      configFiles: files.length,
      configBytes: report.summary.configBytes,
      unrated,
      findings: report.summary.total,
    };
  } catch (err) {
    return { slug, ok: false, code: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function ingestMany(
  store: Store,
  gh: GitHubClient,
  slugs: string[],
  options: IngestOptions = {},
  onProgress?: (result: IngestResult, index: number, total: number) => void,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];

  for (const [index, slug] of slugs.entries()) {
    const result = await ingestRepo(store, gh, slug, options);
    results.push(result);
    onProgress?.(result, index + 1, slugs.length);
  }

  return results;
}

/**
 * Queries that actually surface agent configuration.
 *
 * With a token, code search finds repositories by the files they contain, which
 * is exact. Without one, repository search is the fallback: broader, noisier,
 * and many candidates turn out to have no config at all - which ingestion
 * reports rather than hides.
 */
export const CODE_QUERIES = [
  'path:.claude filename:settings.json',
  'filename:.mcp.json',
  'path:.claude/agents extension:md',
];

export const REPO_QUERIES = [
  'topic:claude-code',
  'topic:mcp-server',
  'topic:model-context-protocol',
  '"claude code" in:readme stars:>3',
];

export async function discoverCandidates(gh: GitHubClient, limit = 60): Promise<string[]> {
  const slugs = new Set<string>();
  const queries = gh.authenticated ? CODE_QUERIES : REPO_QUERIES;

  for (const query of queries) {
    if (slugs.size >= limit) break;

    try {
      const found = gh.authenticated
        ? await gh.searchCode(query, limit - slugs.size)
        : (await gh.searchRepositories(query, limit - slugs.size)).map((r) => r.slug);

      for (const slug of found) slugs.add(slug);
    } catch {
      // One failing query should not stop discovery from trying the others.
    }
  }

  return [...slugs].slice(0, limit);
}
