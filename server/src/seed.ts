/**
 * Corpus seed.
 *
 * A free host gives you no disk that survives a restart, so a corpus built by
 * ingesting fifty repositories would be empty again by morning and the
 * benchmark would have nothing to compare against. The snapshot is committed
 * instead, and loaded whenever the database comes up empty.
 *
 * It carries findings but never evidence: the store already refuses to keep
 * evidence for ingested repositories, and the snapshot must not become the
 * back door that reintroduces it.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Store } from './db.js';

export interface SeedScan {
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
}

export interface Seed {
  version: 1;
  capturedAt: string;
  scans: SeedScan[];
}

/** Capture the newest scan of every corpus repository. */
export function exportSeed(store: Store): Seed {
  const scans: SeedScan[] = [];

  for (const scan of store.latestCorpusScans()) {
    const repo = store.repos('github').find((r) => r.slug === scan.slug);

    scans.push({
      slug: scan.slug,
      stars: repo?.stars ?? 0,
      created_at: scan.created_at,
      grade: scan.grade,
      score: scan.score,
      secrets: scan.secrets,
      permissions: scan.permissions,
      hooks: scan.hooks,
      mcp: scan.mcp,
      agents: scan.agents,
      total: scan.total,
      critical: scan.critical,
      high: scan.high,
      medium: scan.medium,
      low: scan.low,
      info: scan.info,
      files_scanned: scan.files_scanned,
      config_bytes: scan.config_bytes,
      evidence: scan.evidence,
      harnesses: scan.harnesses,
      // Tuple rather than object: fifty repositories of findings is the bulk
      // of this file, and the keys would be two thirds of its size.
      findings: store
        .findings(scan.id)
        .map((f) => [f.rule_id, f.category, f.severity, f.title, f.rel_path]),
    });
  }

  return { version: 1, capturedAt: new Date().toISOString(), scans };
}

export function writeSeed(store: Store, path: string): number {
  const seed = exportSeed(store);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(seed), 'utf8');
  return seed.scans.length;
}

export function readSeed(path: string): Seed | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && (parsed as Seed).version === 1) {
      return parsed as Seed;
    }
  } catch {
    // No snapshot, or an unreadable one: the corpus simply starts empty.
  }
  return null;
}

/**
 * Load the snapshot, but only into an empty corpus. A running deployment that
 * has ingested new repositories must never be silently rewound.
 */
export function seedIfEmpty(store: Store, path: string): number {
  if (store.corpusSize() > 0) return 0;

  const seed = readSeed(path);
  if (!seed) return 0;

  for (const scan of seed.scans) {
    store.importSeedScan(scan);
  }

  return seed.scans.length;
}
