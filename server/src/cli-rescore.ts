/**
 * Recompute every stored score against the current rules.
 *
 * Findings are already persisted with the fields scoring needs, so a change to
 * the scoring model does not require re-fetching a single repository. Rows that
 * predate the evidence columns are reported so they can be re-ingested.
 */

import { scoreFindings } from 'wardline';
import type { Finding } from 'wardline';

import { Store } from './db.js';

const store = new Store(process.env['DB_PATH'] ?? '.data/wardline.db');
const scans = store.recentScans(1000);

let changed = 0;
const needsRefetch: string[] = [];

for (const scan of scans) {
  const findings = store.findings(scan.id).map(
    (row) =>
      ({
        id: row.rule_id,
        category: row.category,
        severity: row.severity,
        title: row.title,
        detail: '',
        remedy: '',
        relPath: row.rel_path,
        line: row.line ?? undefined,
        trust: row.trust,
      }) as Finding,
  );

  const card = scoreFindings(findings);

  if (card.grade !== scan.grade || card.score !== scan.score) {
    process.stdout.write(
      '  ' +
        scan.slug.slice(0, 46).padEnd(48) +
        scan.grade +
        '/' +
        String(scan.score).padStart(3) +
        '  ->  ' +
        card.grade +
        '/' +
        String(card.score).padStart(3) +
        (card.cappedBy ? '   capped by ' + card.cappedBy : '') +
        '\n',
    );
    changed++;
  }

  store.rescoreScan(scan.id, card);
  if (scan.total === 0 && scan.config_bytes === 0) needsRefetch.push(scan.slug);
}

process.stdout.write('\n  rescored ' + scans.length + ' scans, ' + changed + ' changed grade\n');

if (needsRefetch.length > 0) {
  process.stdout.write(
    '  ' +
      needsRefetch.length +
      ' scan(s) predate the evidence columns and need re-ingesting:\n' +
      needsRefetch.map((s) => '    ' + s).join('\n') +
      '\n',
  );
}

store.close();
