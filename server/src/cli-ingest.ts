/**
 * Corpus ingestion from the command line.
 *
 *   npm run ingest -- --limit 40
 *   npm run ingest -- owner/name another/repo
 */

import { GitHubClient } from './github.js';
import { Store } from './db.js';
import { discoverCandidates, ingestMany } from './ingest.js';
import { corpusStats } from './benchmark.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitFlag = args.indexOf('--limit');
  const limit = limitFlag === -1 ? 25 : Number(args[limitFlag + 1] ?? 25);
  const explicit = args.filter((a) => a.includes('/') && !a.startsWith('-'));

  const store = new Store(process.env['DB_PATH'] ?? '.data/wardline.db');
  const github = new GitHubClient();

  process.stdout.write(
    'github: ' +
      (github.authenticated ? 'authenticated' : 'anonymous (60 req/hr)') +
      '\n',
  );

  let slugs = explicit;
  if (slugs.length === 0) {
    process.stdout.write('discovering candidate repositories...\n');
    slugs = await discoverCandidates(github, limit);
  }

  process.stdout.write('ingesting ' + slugs.length + ' repositories\n\n');

  await ingestMany(store, github, slugs.slice(0, limit), { inCorpus: true }, (result, i, total) => {
    const prefix = '  [' + String(i).padStart(3) + '/' + total + '] ' + result.slug.padEnd(42);
    if (result.ok) {
      process.stdout.write(
        prefix +
          result.grade +
          '/' +
          String(result.score).padStart(3) +
          '  ' +
          String(result.configFiles).padStart(3) +
          ' files  ' +
          String(result.findings).padStart(4) +
          ' findings\n',
      );
    } else {
      process.stdout.write(prefix + 'skipped: ' + result.reason + '\n');
    }
  });

  const stats = corpusStats(store);
  process.stdout.write(
    '\ncorpus: ' +
      stats.size +
      ' repositories, median score ' +
      stats.medians['overall'] +
      ', grades ' +
      JSON.stringify(stats.grades) +
      '\n',
  );

  store.close();
}

main().catch((err) => {
  process.stderr.write('ingest failed: ' + (err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
});
