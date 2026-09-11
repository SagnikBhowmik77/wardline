import type { HarnessId } from './harness.js';

/**
 * Core type system for Wardline.
 *
 * Everything downstream - rules, scoring, reporters, the fixer - speaks in
 * terms of `ConfigFile` (what we read) and `Finding` (what we concluded).
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_ORDER: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const;

export type Category = 'secrets' | 'permissions' | 'hooks' | 'mcp' | 'agents';

export const CATEGORIES: readonly Category[] = [
  'secrets',
  'permissions',
  'hooks',
  'mcp',
  'agents',
] as const;

/**
 * How much a file tells us about what is *actually running*.
 *
 * A risky MCP server in `settings.json` is live exposure. The same server in
 * `examples/` is a risky sample someone might copy. Both are worth printing;
 * only the first should dominate the grade.
 */
export type SourceTrust =
  | 'runtime'
  | 'project-local'
  | 'plugin'
  | 'template'
  | 'docs'
  | 'unknown';

export const TRUST_WEIGHT: Record<SourceTrust, number> = {
  runtime: 1,
  'project-local': 0.75,
  plugin: 0.5,
  template: 0.25,
  docs: 0.25,
  unknown: 0.5,
};

export type FileKind =
  | 'settings'
  /** VS Code or Zed task definitions, which can run on folder open. */
  | 'ide-tasks'
  | 'mcp'
  | 'hooks-manifest'
  | 'hook-script'
  | 'project-brief'
  | 'agent-prompt'
  | 'env'
  | 'json'
  | 'markdown';

export interface ConfigFile {
  /** Absolute path on disk. */
  path: string;
  /** Which coding agent this file configures. */
  harness?: HarnessId;
  /** Path relative to the scan root, always with forward slashes. */
  relPath: string;
  kind: FileKind;
  trust: SourceTrust;
  content: string;
  /** Parsed JSON body, when the file is JSON and parsed cleanly. */
  data?: unknown;
  /** Set when the file looked like JSON but would not parse. */
  parseError?: string;
}

export interface Finding {
  /** Stable rule identifier, e.g. `WL-SEC-001`. */
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  /** One or two sentences on why this matters here. */
  detail: string;
  relPath: string;
  line?: number;
  /** Redacted snippet proving the match. Never a full credential. */
  evidence?: string;
  /** What to do about it. */
  remedy: string;
  trust: SourceTrust;
  /** True when `wardline scan --fix` can rewrite this safely. */
  autoFixable?: boolean;
}

export interface ScanContext {
  root: string;
  files: ConfigFile[];
}

export interface Rule {
  id: string;
  category: Category;
  title: string;
  run(ctx: ScanContext): Finding[];
}

export interface CategoryScore {
  score: number;
  deducted: number;
  findings: number;
}

export interface Scorecard {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  categories: Record<Category, CategoryScore>;
  /**
   * Set when the worst live finding held the grade below what the category
   * average alone would have produced.
   */
  cappedBy?: Severity;
}

/**
 * How much there was to look at.
 *
 * `thin` means the scan examined so little configuration that its score says
 * more about the absence of files than about the safety of what is there. A
 * repository holding an 11-byte CLAUDE.md is not an A; it is unrated.
 */
export type Evidence = 'sufficient' | 'thin';

/** Below this many bytes of agent configuration, a clean score proves nothing. */
export const THIN_EVIDENCE_BYTES = 1200;

export interface ScanSummary {
  filesScanned: number;
  /** Total bytes of agent configuration actually read. */
  configBytes: number;
  /** Whether there was enough configuration for the score to mean anything. */
  evidence: Evidence;
  /** Findings a file explicitly excused with a wardline-ignore directive. */
  suppressed: number;
  /** True when discovery hit its file ceiling, so the scan is partial. */
  truncated: boolean;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  autoFixable: number;
}

export interface HarnessPresence {
  id: HarnessId;
  label: string;
  files: number;
}

export interface SuppressedFinding {
  id: string;
  relPath: string;
  line?: number;
  title: string;
  severity: Severity;
  reason: string;
}

export interface ScanReport {
  tool: 'wardline';
  /** What was excused, and why. Silenced is never the same as clean. */
  suppressions: SuppressedFinding[];
  /** Every coding agent this configuration was found to target. */
  harnesses: HarnessPresence[];
  version: string;
  generatedAt: string;
  root: string;
  scorecard: Scorecard;
  summary: ScanSummary;
  findings: Finding[];
}
