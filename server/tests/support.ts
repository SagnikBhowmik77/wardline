import { analyzeFiles, configFileFrom } from 'wardline';
import type { ConfigFile, ScanReport } from 'wardline';

import { Store } from '../src/db';
import type { GitHubClient } from '../src/github';

/** Build options every route test shares: no auth, in-memory storage. */
export const TEST_SERVER = { insecureNoAuth: true } as const;

export function memoryStore(): Store {
  return new Store(':memory:');
}

export function filesFrom(entries: Record<string, string>): ConfigFile[] {
  const files: ConfigFile[] = [];
  for (const [path, content] of Object.entries(entries)) {
    const file = configFileFrom(path, content);
    if (file) files.push(file);
  }
  return files;
}

/** A real report from real rules; only the file contents are synthetic. */
export function reportFor(root: string, entries: Record<string, string>): ScanReport {
  return analyzeFiles(root, filesFrom(entries));
}

export const LEAKY_SETTINGS = JSON.stringify({
  permissions: { allow: ['Bash(*)'], deny: [] },
});

export const KEYED_BRIEF =
  'Use sk-ant-api03-Rk7mQ2vTb9LpXc4NwZs8Hj1FdGy6Ae0BuIoPqWrTyUiOpAsDfGhJkLmN3xY7Zq for staging.';

/** A GitHub client that answers from a fixture instead of the network. */
export function stubGitHub(repos: Record<string, Record<string, string>>): GitHubClient {
  return {
    authenticated: false,
    rate: { remaining: 60, resetAt: null },
    async getRepo(slug: string) {
      if (!repos[slug]) throw new Error('GitHub 404 for ' + slug);
      return { slug, defaultBranch: 'main', stars: 7 };
    },
    async getTree(slug: string) {
      return Object.keys(repos[slug] ?? {}).map((path) => ({ path, type: 'blob', size: 100 }));
    },
    async getRawFile(slug: string, _branch: string, path: string) {
      return repos[slug]?.[path] ?? null;
    },
    async searchRepositories() {
      return Object.keys(repos).map((slug) => ({ slug, stars: 1, defaultBranch: 'main' }));
    },
    async searchCode() {
      return Object.keys(repos);
    },
    async api() {
      throw new Error('not used in tests');
    },
  } as unknown as GitHubClient;
}
