/**
 * Storage.
 *
 * Uses node:sqlite, which ships with Node 22+, so persistence costs the project
 * zero dependencies and zero native builds.
 *
 * One rule governs this schema: the database never holds credential material.
 * Findings record that a secret exists and where, never what it is. Redacted
 * evidence is kept only for repositories the operator scanned locally, and
 * never for anything ingested from a public source - a table of "which public
 * repo leaks which key" is a liability, not a feature.
 */

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/**
 * node:sqlite is newer than the bundler Vitest runs on, which rewrites the bare
 * specifier and then cannot find it. Loading it through require keeps the module
 * out of the transform pipeline; the type import is erased at compile time, so
 * the API stays fully typed either way.
 */
type SqliteModule = typeof import('node:sqlite');
type Database = InstanceType<SqliteModule['DatabaseSync']>;

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as SqliteModule;

import type { ScanReport, Scorecard } from 'wardline';

export type RepoSource = 'github' | 'local';

export interface RepoRow {
  id: number;
  source: RepoSource;
  slug: string;
  owner: string | null;
  name: string | null;
  stars: number;
  default_branch: string | null;
  in_corpus: number;
  first_seen: string;
  last_scanned: string | null;
}

export interface ScanRow {
  id: number;
  repo_id: number;
  slug: string;
  source: RepoSource;
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
  evidence: string;
  harnesses: string;
  truncated: number;
}

export interface FindingRow {
  id: number;
  scan_id: number;
  rule_id: string;
  category: string;
  severity: string;
  title: string;
  rel_path: string;
  line: number | null;
  trust: string;
  evidence: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner TEXT,
  name TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  default_branch TEXT,
  in_corpus INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_scanned TEXT
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  wardline_version TEXT NOT NULL,
  grade TEXT NOT NULL,
  score INTEGER NOT NULL,
  secrets INTEGER NOT NULL,
  permissions INTEGER NOT NULL,
  hooks INTEGER NOT NULL,
  mcp INTEGER NOT NULL,
  agents INTEGER NOT NULL,
  total INTEGER NOT NULL,
  critical INTEGER NOT NULL,
  high INTEGER NOT NULL,
  medium INTEGER NOT NULL,
  low INTEGER NOT NULL,
  info INTEGER NOT NULL,
  files_scanned INTEGER NOT NULL,
  config_bytes INTEGER NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL DEFAULT 'sufficient',
  harnesses TEXT NOT NULL DEFAULT '',
  truncated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  line INTEGER,
  trust TEXT NOT NULL,
  evidence TEXT
);

CREATE INDEX IF NOT EXISTS idx_scans_repo ON scans(repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_findings_rule ON findings(rule_id);
CREATE INDEX IF NOT EXISTS idx_repos_corpus ON repos(in_corpus);
`;

export class Store {
  private db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * CREATE TABLE IF NOT EXISTS leaves an existing database on the old shape, so
   * columns added later have to be applied separately.
   */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(scans)').all() as unknown as {
      name: string;
    }[];
    const have = new Set(columns.map((c) => c.name));

    if (!have.has('config_bytes')) {
      this.db.exec('ALTER TABLE scans ADD COLUMN config_bytes INTEGER NOT NULL DEFAULT 0');
    }
    if (!have.has('evidence')) {
      this.db.exec("ALTER TABLE scans ADD COLUMN evidence TEXT NOT NULL DEFAULT 'sufficient'");
    }
    if (!have.has('harnesses')) {
      this.db.exec("ALTER TABLE scans ADD COLUMN harnesses TEXT NOT NULL DEFAULT ''");
    }
  }

  close(): void {
    this.db.close();
  }

  /** Insert or fetch a repository row, keeping the newest metadata. */
  upsertRepo(input: {
    source: RepoSource;
    slug: string;
    stars?: number;
    defaultBranch?: string;
    inCorpus?: boolean;
  }): RepoRow {
    const [owner, name] = input.slug.includes('/') ? input.slug.split('/') : [null, input.slug];

    this.db
      .prepare(
        `INSERT INTO repos (source, slug, owner, name, stars, default_branch, in_corpus, first_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           stars = MAX(excluded.stars, repos.stars),
           default_branch = COALESCE(excluded.default_branch, repos.default_branch),
           in_corpus = MAX(excluded.in_corpus, repos.in_corpus)`,
      )
      .run(
        input.source,
        input.slug,
        owner ?? null,
        name ?? null,
        input.stars ?? 0,
        input.defaultBranch ?? null,
        input.inCorpus ? 1 : 0,
        new Date().toISOString(),
      );

    return this.db.prepare('SELECT * FROM repos WHERE slug = ?').get(input.slug) as unknown as RepoRow;
  }

  /**
   * Persist a report. Evidence is dropped for anything not scanned locally,
   * so the corpus can never become a directory of exploitable repositories.
   */
  recordScan(repo: RepoRow, report: ScanReport): number {
    const card = report.scorecard;
    const s = report.summary;

    const result = this.db
      .prepare(
        `INSERT INTO scans (
           repo_id, created_at, wardline_version, grade, score,
           secrets, permissions, hooks, mcp, agents,
           total, critical, high, medium, low, info,
           files_scanned, config_bytes, evidence, harnesses, truncated
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        repo.id,
        report.generatedAt,
        report.version,
        card.grade,
        card.score,
        card.categories.secrets.score,
        card.categories.permissions.score,
        card.categories.hooks.score,
        card.categories.mcp.score,
        card.categories.agents.score,
        s.total,
        s.critical,
        s.high,
        s.medium,
        s.low,
        s.info,
        s.filesScanned,
        s.configBytes,
        s.evidence,
        JSON.stringify(report.harnesses.map((h) => h.label)),
        s.truncated ? 1 : 0,
      );

    const scanId = Number(result.lastInsertRowid);
    const keepEvidence = repo.source === 'local';

    const insert = this.db.prepare(
      `INSERT INTO findings (scan_id, rule_id, category, severity, title, rel_path, line, trust, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const f of report.findings) {
      insert.run(
        scanId,
        f.id,
        f.category,
        f.severity,
        f.title,
        f.relPath,
        f.line ?? null,
        f.trust,
        keepEvidence ? (f.evidence ?? null) : null,
      );
    }

    this.db.prepare('UPDATE repos SET last_scanned = ? WHERE id = ?').run(report.generatedAt, repo.id);
    this.pruneScans(repo.id);

    return scanId;
  }

  /** Overwrite a stored score after a change to the scoring model. */
  rescoreScan(scanId: number, card: Scorecard): void {
    this.db
      .prepare(
        `UPDATE scans SET grade = ?, score = ?,
           secrets = ?, permissions = ?, hooks = ?, mcp = ?, agents = ?
         WHERE id = ?`,
      )
      .run(
        card.grade,
        card.score,
        card.categories.secrets.score,
        card.categories.permissions.score,
        card.categories.hooks.score,
        card.categories.mcp.score,
        card.categories.agents.score,
        scanId,
      );
  }

  /** Take a repository out of the benchmark population without deleting it. */
  setInCorpus(slug: string, inCorpus: boolean): void {
    this.db.prepare('UPDATE repos SET in_corpus = ? WHERE slug = ?').run(inCorpus ? 1 : 0, slug);
  }

  /**
   * Keep a bounded history per repository.
   *
   * Re-scanning in a loop would otherwise grow the database without bound,
   * and a trend line needs the recent shape, not every scan ever run.
   */
  pruneScans(repoId: number, keep = 25): void {
    const doomed = this.db
      .prepare(
        `SELECT id FROM scans WHERE repo_id = ?
          ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`,
      )
      .all(repoId, keep) as unknown as { id: number }[];

    const remove = this.db.prepare('DELETE FROM scans WHERE id = ?');
    for (const row of doomed) remove.run(row.id);
  }

  /**
   * Restore one scan from the committed snapshot.
   *
   * Separate from recordScan because a seed carries no ScanReport and no
   * evidence: it replays a result that was already stripped, and must not be
   * able to write evidence back in.
   */
  importSeedScan(scan: {
    slug: string;
    stars: number;
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
    evidence: string;
    harnesses: string;
    findings: [string, string, string, string, string][];
  }): number {
    const repo = this.upsertRepo({
      source: 'github',
      slug: scan.slug,
      stars: scan.stars,
      inCorpus: true,
    });

    const result = this.db
      .prepare(
        `INSERT INTO scans (
           repo_id, created_at, wardline_version, grade, score,
           secrets, permissions, hooks, mcp, agents,
           total, critical, high, medium, low, info,
           files_scanned, config_bytes, evidence, harnesses, truncated
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        repo.id,
        scan.created_at,
        'seed',
        scan.grade,
        scan.score,
        scan.secrets,
        scan.permissions,
        scan.hooks,
        scan.mcp,
        scan.agents,
        scan.total,
        scan.critical,
        scan.high,
        scan.medium,
        scan.low,
        scan.info,
        scan.files_scanned,
        scan.config_bytes,
        scan.evidence,
        scan.harnesses,
      );

    const scanId = Number(result.lastInsertRowid);
    const insert = this.db.prepare(
      `INSERT INTO findings (scan_id, rule_id, category, severity, title, rel_path, line, trust, evidence)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'runtime', NULL)`,
    );

    for (const [ruleId, category, severity, title, relPath] of scan.findings) {
      insert.run(scanId, ruleId, category, severity, title, relPath);
    }

    this.db
      .prepare('UPDATE repos SET last_scanned = ? WHERE id = ?')
      .run(scan.created_at, repo.id);

    return scanId;
  }

  recentScans(limit = 50): ScanRow[] {
    return this.db
      .prepare(
        `SELECT s.*, r.slug, r.source FROM scans s
         JOIN repos r ON r.id = s.repo_id
         ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
      )
      .all(limit) as unknown as ScanRow[];
  }

  scan(id: number): ScanRow | undefined {
    return this.db
      .prepare(
        `SELECT s.*, r.slug, r.source FROM scans s
         JOIN repos r ON r.id = s.repo_id WHERE s.id = ?`,
      )
      .get(id) as unknown as ScanRow | undefined;
  }

  scansForRepo(slug: string, limit = 100): ScanRow[] {
    return this.db
      .prepare(
        `SELECT s.*, r.slug, r.source FROM scans s
         JOIN repos r ON r.id = s.repo_id
         WHERE r.slug = ? ORDER BY s.created_at ASC, s.id ASC LIMIT ?`,
      )
      .all(slug, limit) as unknown as ScanRow[];
  }

  findings(scanId: number): FindingRow[] {
    return this.db
      .prepare('SELECT * FROM findings WHERE scan_id = ? ORDER BY id')
      .all(scanId) as unknown as FindingRow[];
  }

  /** Newest scan per repository, which is what the corpus statistics use. */
  latestCorpusScans(): ScanRow[] {
    return this.db
      .prepare(
        `SELECT s.*, r.slug, r.source FROM scans s
         JOIN repos r ON r.id = s.repo_id
         WHERE r.in_corpus = 1
           AND s.id = (SELECT id FROM scans WHERE repo_id = r.id ORDER BY created_at DESC LIMIT 1)`,
      )
      .all() as unknown as ScanRow[];
  }

  /** How many corpus repositories tripped each rule at least once. */
  rulePrevalence(): { rule_id: string; title: string; category: string; repos: number }[] {
    return this.db
      .prepare(
        `SELECT f.rule_id, f.title, f.category, COUNT(DISTINCT s.repo_id) AS repos
         FROM findings f
         JOIN scans s ON s.id = f.scan_id
         JOIN repos r ON r.id = s.repo_id
         WHERE r.in_corpus = 1
         GROUP BY f.rule_id
         ORDER BY repos DESC`,
      )
      .all() as unknown as { rule_id: string; title: string; category: string; repos: number }[];
  }

  /**
   * Per rule: how many corpus repositories trip it, how often, and the severity
   * it usually carries. Enough to judge whether a rule is finding a real
   * epidemic or simply firing too readily.
   */
  ruleProfile(): {
    rule_id: string;
    title: string;
    category: string;
    repos: number;
    findings: number;
    severity: string;
  }[] {
    return this.db
      .prepare(
        `SELECT f.rule_id, f.title, f.category,
                COUNT(DISTINCT s.repo_id) AS repos,
                COUNT(*) AS findings,
                (SELECT severity FROM findings f2
                   JOIN scans s2 ON s2.id = f2.scan_id
                   JOIN repos r2 ON r2.id = s2.repo_id
                  WHERE f2.rule_id = f.rule_id AND r2.in_corpus = 1
                  GROUP BY f2.severity ORDER BY COUNT(*) DESC LIMIT 1) AS severity
           FROM findings f
           JOIN scans s ON s.id = f.scan_id
           JOIN repos r ON r.id = s.repo_id
          WHERE r.in_corpus = 1
          GROUP BY f.rule_id
          ORDER BY repos DESC`,
      )
      .all() as unknown as {
      rule_id: string;
      title: string;
      category: string;
      repos: number;
      findings: number;
      severity: string;
    }[];
  }

  repos(source?: RepoSource): RepoRow[] {
    if (source) {
      return this.db
        .prepare('SELECT * FROM repos WHERE source = ? ORDER BY last_scanned DESC')
        .all(source) as unknown as RepoRow[];
    }
    return this.db.prepare('SELECT * FROM repos ORDER BY last_scanned DESC').all() as unknown as RepoRow[];
  }

  corpusSize(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM repos WHERE in_corpus = 1 AND last_scanned IS NOT NULL')
      .get() as { n: number };
    return row.n;
  }
}
