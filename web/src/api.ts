/** Typed client for the Wardline API. Mirrors the server response shapes. */

export interface ScanRow {
  id: number;
  slug: string;
  source: 'github' | 'local';
  created_at: string;
  grade: string;
  score: number;
  secrets: number;
  permissions: number;
  hooks: number;
  mcp: number;
  agents: number;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  files_scanned: number;
  config_bytes: number;
  evidence: 'sufficient' | 'thin';
  /** Agents detected in the scan, already parsed by the API. */
  harnesses: string[];
  truncated: number;
}

/**
 * A perfect score drawn from an empty configuration is not a perfect score.
 * Where there was nothing to read, the grade is withheld rather than invented.
 */
export function isUnrated(scan: { evidence?: string; total: number }): boolean {
  return scan.evidence === 'thin' && scan.total === 0;
}

export interface FindingRow {
  id: number;
  rule_id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  rel_path: string;
  line: number | null;
  trust: string;
  evidence: string | null;
}

export interface CategoryBenchmark {
  category: string;
  score: number;
  corpusMedian: number;
  percentile: number;
  verdict: string;
}

export interface RuleGap {
  ruleId: string;
  title: string;
  category: string;
  corpusRepos: number;
  corpusShare: number;
  yours: number;
}

export interface Benchmark {
  scanId: number;
  slug: string;
  corpusSize: number;
  overall: {
    score: number;
    grade: string;
    corpusMedian: number;
    percentile: number;
    verdict: string;
  };
  categories: CategoryBenchmark[];
  uncommonIssues: RuleGap[];
  avoidedIssues: RuleGap[];
}

export interface CorpusStats {
  size: number;
  grades: Record<string, number>;
  medians: Record<string, number>;
  topRules: { ruleId: string; title: string; category: string; repos: number; share: number }[];
  worstCategory: string | null;
}

export interface Health {
  ok: boolean;
  corpusSize: number;
  githubAuthenticated: boolean;
  rateRemaining: number | null;
}

export interface ScanResult {
  ok: boolean;
  scanId: number;
  slug: string;
  grade: string;
  score: number;
  configFiles: number;
  findings: number;
  truncated?: boolean;
}

/** Carries the server's machine-readable reason so the UI can style it. */
export class ApiError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiError(body.error ?? 'request failed with ' + res.status, body.code);
  }
  return body as T;
}

export const api = {
  health: () => request<Health>('/api/health'),
  scans: () => request<{ scans: ScanRow[] }>('/api/scans?limit=100'),
  scan: (id: number) => request<{ scan: ScanRow; findings: FindingRow[] }>('/api/scans/' + id),
  history: (slug: string) =>
    request<{ scans: ScanRow[] }>('/api/history?slug=' + encodeURIComponent(slug)),
  benchmark: (id: number) => request<Benchmark>('/api/benchmark/' + id),
  corpus: () => request<CorpusStats>('/api/corpus/stats'),
  /** One endpoint for both kinds of target; the server decides which it is. */
  scanTarget: (target: string) =>
    request<ScanResult>('/api/scans', { method: 'POST', body: JSON.stringify({ target }) }),
  ingest: (limit: number) =>
    request<{ ingested: number; skipped: number; corpusSize: number }>('/api/corpus/ingest', {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),
};
