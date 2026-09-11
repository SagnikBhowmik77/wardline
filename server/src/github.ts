/**
 * GitHub client.
 *
 * The cheap path matters here. Listing a repository costs one authenticated
 * API call for its tree; every file after that comes from
 * raw.githubusercontent.com, which needs no token and does not count against
 * the rate limit. So a repository costs ~1 API call regardless of how many
 * config files it holds.
 *
 * A token in GITHUB_TOKEN raises the limit from 60 to 5000 requests an hour.
 * Without one the client still works, just slower - it is never required, and
 * this module never reads a credential from anywhere but the environment.
 */

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export interface RepoMeta {
  slug: string;
  defaultBranch: string;
  stars: number;
}

export interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

export interface RateState {
  remaining: number | null;
  resetAt: number | null;
}

export class GitHubClient {
  readonly authenticated: boolean;
  readonly rate: RateState = { remaining: null, resetAt: null };

  private token: string | undefined;
  private userAgent = 'wardline-corpus/0.1 (+security research; aggregate statistics only)';

  constructor(token = process.env['GITHUB_TOKEN']) {
    this.token = token && token.trim().length > 0 ? token.trim() : undefined;
    this.authenticated = this.token !== undefined;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': this.userAgent,
      'x-github-api-version': '2022-11-28',
    };
    if (this.token) h['authorization'] = 'Bearer ' + this.token;
    return h;
  }

  private noteRate(res: Response): void {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining !== null) this.rate.remaining = Number(remaining);
    if (reset !== null) this.rate.resetAt = Number(reset) * 1000;
  }

  /**
   * A GET against the JSON API. Waits out a rate-limit response once rather
   * than failing the whole ingest run, then gives up so a caller can report it.
   */
  async api<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : API + path;

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, { headers: this.headers() });
      this.noteRate(res);

      if (res.ok) return (await res.json()) as T;

      const limited =
        (res.status === 403 || res.status === 429) && this.rate.remaining === 0;

      if (limited && attempt === 0) {
        const waitMs = Math.max(1000, (this.rate.resetAt ?? Date.now() + 60_000) - Date.now());
        // Cap the wait so an ingest run cannot hang for an hour unattended.
        if (waitMs > 90_000) {
          throw new Error(
            'GitHub rate limit exhausted; resets in ' + Math.round(waitMs / 60_000) + ' min',
          );
        }
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      throw new Error('GitHub ' + res.status + ' for ' + url);
    }

    throw new Error('GitHub request failed after retry: ' + url);
  }

  async getRepo(slug: string): Promise<RepoMeta> {
    const data = await this.api<{ default_branch: string; stargazers_count: number }>(
      '/repos/' + slug,
    );
    return {
      slug,
      defaultBranch: data.default_branch,
      stars: data.stargazers_count ?? 0,
    };
  }

  /** Every path in the repository, in one call. */
  async getTree(slug: string, branch: string): Promise<TreeEntry[]> {
    const data = await this.api<{ tree?: TreeEntry[]; truncated?: boolean }>(
      '/repos/' + slug + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1',
    );
    return data.tree ?? [];
  }

  /**
   * File contents, straight off the CDN. No token, no rate-limit cost.
   * Returns null for anything that has moved or is not plain text.
   */
  async getRawFile(slug: string, branch: string, path: string): Promise<string | null> {
    const url = RAW + '/' + slug + '/' + branch + '/' + path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(url, { headers: { 'user-agent': this.userAgent } });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') ?? '';
    if (type.includes('image/') || type.includes('application/octet-stream')) return null;

    return await res.text();
  }

  /** Repository search, paged up to `limit` results. */
  async searchRepositories(
    query: string,
    limit = 100,
  ): Promise<{ slug: string; stars: number; defaultBranch: string }[]> {
    const out: { slug: string; stars: number; defaultBranch: string }[] = [];
    const perPage = Math.min(100, limit);

    for (let page = 1; out.length < limit && page <= 10; page++) {
      const data = await this.api<{
        items?: { full_name: string; stargazers_count: number; default_branch: string }[];
      }>(
        '/search/repositories?q=' +
          encodeURIComponent(query) +
          '&sort=stars&order=desc&per_page=' +
          perPage +
          '&page=' +
          page,
      );

      const items = data.items ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        out.push({
          slug: item.full_name,
          stars: item.stargazers_count ?? 0,
          defaultBranch: item.default_branch ?? 'main',
        });
        if (out.length >= limit) break;
      }
    }

    return out;
  }

  /**
   * Code search finds repositories by the files they contain, which is far more
   * precise than repository search for this corpus. It requires a token.
   */
  async searchCode(query: string, limit = 100): Promise<string[]> {
    if (!this.authenticated) {
      throw new Error('GitHub code search requires GITHUB_TOKEN to be set');
    }

    const slugs = new Set<string>();
    const perPage = Math.min(100, limit);

    for (let page = 1; slugs.size < limit && page <= 10; page++) {
      const data = await this.api<{ items?: { repository: { full_name: string } }[] }>(
        '/search/code?q=' + encodeURIComponent(query) + '&per_page=' + perPage + '&page=' + page,
      );

      const items = data.items ?? [];
      if (items.length === 0) break;
      for (const item of items) slugs.add(item.repository.full_name);

      // Code search is limited to 10 requests a minute even with a token.
      await new Promise((r) => setTimeout(r, 6500));
    }

    return [...slugs].slice(0, limit);
  }
}
