/**
 * Scan a local path and print how it compares with the ingested corpus.
 *
 *   npm run bench -- "C:/path/to/project"
 */

import { scan } from 'wardline';

import { buildBenchmark } from './benchmark.js';
import { Store } from './db.js';

const target = process.argv[2];
if (!target) {
  process.stderr.write('usage: npm run bench -- <path>\n');
  process.exit(1);
}

const store = new Store(process.env['DB_PATH'] ?? '.data/wardline.db');
const report = scan({ path: target });
const repo = store.upsertRepo({ source: 'local', slug: report.root, inCorpus: false });
const scanId = store.recordScan(repo, report);
const bench = buildBenchmark(store, store.scan(scanId)!);

const line = (label: string, body: string): void => {
  process.stdout.write('  ' + label.padEnd(16) + body + '\n');
};

process.stdout.write('\n  ' + report.root + '\n\n');
line('grade', bench.overall.grade + '  ' + bench.overall.score + '/100');
line(
  'vs corpus',
  bench.overall.verdict +
    '  (' +
    bench.overall.percentile +
    'th percentile of ' +
    bench.corpusSize +
    ' real repos, median ' +
    bench.overall.corpusMedian +
    ')',
);
process.stdout.write('\n');

for (const c of bench.categories) {
  line(
    c.category,
    String(c.score).padStart(3) +
      '   corpus median ' +
      String(c.corpusMedian).padStart(3) +
      '   ' +
      c.verdict,
  );
}

if (bench.uncommonIssues.length > 0) {
  process.stdout.write('\n  issues rare in the corpus (most actionable)\n');
  for (const g of bench.uncommonIssues.slice(0, 5)) {
    line('  ' + g.ruleId, g.title + '  [only ' + g.corpusShare + '% of repos]');
  }
}

if (bench.avoidedIssues.length > 0) {
  process.stdout.write('\n  common problems you do not have\n');
  for (const g of bench.avoidedIssues.slice(0, 4)) {
    line('  ' + g.ruleId, g.title + '  [' + g.corpusShare + '% of repos have it]');
  }
}

process.stdout.write('\n');
store.close();
