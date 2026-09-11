/**
 * Rank the rules by what the corpus says about them.
 *
 *   npm run tuning
 */

import { Store } from './db.js';
import { tuneRules } from './tuning.js';

const store = new Store(process.env['DB_PATH'] ?? '.data/wardline.db');
const report = tuneRules(store);

const line = (a: string, b: string, c: string, d: string): void => {
  process.stdout.write('  ' + a.padEnd(12) + b.padEnd(6) + c.padEnd(18) + d + '\n');
};

process.stdout.write('\n  Rule tuning against ' + report.corpusSize + ' repositories\n');
if (report.provisional) {
  process.stdout.write('  Corpus is small; treat these as provisional.\n');
}
process.stdout.write('\n');

line('RULE', 'SHARE', 'VERDICT', 'TITLE');

for (const rule of report.rules) {
  if (rule.verdict === 'normal') continue;
  line(rule.ruleId, rule.share + '%', rule.verdict, rule.title.slice(0, 48));
}

const normal = report.rules.filter((r) => r.verdict === 'normal').length;
process.stdout.write(
  '\n  ' +
    normal +
    ' rule(s) in proportion, ' +
    report.neverFired.length +
    ' never fired in this corpus\n\n',
);

store.close();
