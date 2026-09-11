#!/usr/bin/env node
/**
 * Wardline command line.
 *
 * Argument parsing is hand-rolled on purpose: the package ships with zero
 * runtime dependencies, which is the least a security tool can do.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { applyFixes } from './fix/index.js';
import { initConfig } from './init/index.js';
import { ALL_RULES, ruleCounts } from './rules/index.js';
import { scan } from './scanner/index.js';
import { buildBaseline, compareToBaseline, parseBaseline } from './baseline.js';
import { RULE_NOTES } from './rules/explain.js';
import { changedFiles } from './util/git.js';
import { renderHtml } from './report/html.js';
import { renderSarif } from './report/sarif.js';
import { renderJson, renderMarkdown } from './report/json.js';
import { renderTerminal } from './report/terminal.js';
import { setColorEnabled, style } from './util/color.js';
import { SEVERITY_ORDER } from './types.js';
import { VERSION } from './version.js';
import type { Severity } from './types.js';

type Format = 'terminal' | 'json' | 'markdown' | 'html' | 'sarif';

interface Args {
  command: string;
  flags: Map<string, string | boolean>;
  /** Bare words after the command, e.g. the rule id for `explain`. */
  positional: string[];
}

const FLAG_ALIASES: Record<string, string> = {
  p: 'path',
  f: 'format',
  o: 'output',
  v: 'verbose',
  h: 'help',
};

const VALUE_FLAGS = new Set(['path', 'format', 'output', 'min-severity', 'baseline', 'save-baseline', 'diff']);

function splitFlag(text: string): [string, string | undefined] {
  const eq = text.indexOf('=');
  if (eq === -1) return [text, undefined];
  return [text.slice(0, eq), text.slice(eq + 1)];
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let command = '';

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;

    if (token.startsWith('--')) {
      const [name, inlineValue] = splitFlag(token.slice(2));
      if (VALUE_FLAGS.has(name)) flags.set(name, inlineValue ?? (argv[++i] ?? ''));
      else flags.set(name, inlineValue ?? true);
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const name = FLAG_ALIASES[token.slice(1)] ?? token.slice(1);
      if (VALUE_FLAGS.has(name)) flags.set(name, argv[++i] ?? '');
      else flags.set(name, true);
      continue;
    }

    if (!command) command = token;
    else positional.push(token);
  }

  return { command: command || 'scan', flags, positional };
}

function str(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bool(args: Args, name: string): boolean {
  return args.flags.get(name) === true;
}

const HELP = [
  '',
  '  wardline - security auditor for AI coding-agent configurations',
  '',
  '  Usage',
  '    wardline <command> [options]',
  '',
  '  Commands',
  '    scan              Audit a configuration directory (default)',
  '    init              Write a hardened .claude/ starting point',
  '    rules             List every rule Wardline can report',
  '    explain <rule>    Why a rule exists and what it prevents',
  '',
  '  Scan options',
  '    -p, --path <path>        Directory or file to scan',
  '    -f, --format <format>    terminal | json | markdown | html | sarif',
  '    -o, --output <path>      Write the report to a file instead of stdout',
  '        --min-severity <s>   critical | high | medium | low | info',
  '        --diff [ref]         Scan only what changed against ref (default HEAD)',
  '        --fix                Replace committed credentials with env refs',
  '        --dry-run            With --fix, report changes without writing',
  '        --no-suppress        Ignore wardline-ignore directives',
  '    -v, --verbose            Show every finding, including info level',
  '        --no-color           Disable ANSI colour',
  '',
  '  Baselines',
  '        --save-baseline <p>  Accept the current findings as the baseline',
  '        --baseline <path>    Compare against a saved baseline',
  '        --gate               Exit 2 on any regression from the baseline',
  '',
  '  Suppress a finding next to the thing it excuses:',
  '    # wardline-ignore WL-MCP-006 pinned by our lockfile',
  '    # wardline-ignore-file WL-AGT-013',
  '',
  '  Exit codes',
  '    0  no critical findings',
  '    1  usage or runtime error',
  '    2  a critical finding, or a regression when --gate is set',
  '',
].join('\n');

function fail(message: string): never {
  process.stderr.write(style.red('error: ') + message + '\n');
  process.exit(1);
}

function runScan(args: Args): number {
  const format = (str(args, 'format') ?? 'terminal') as Format;
  if (!['terminal', 'json', 'markdown', 'html', 'sarif'].includes(format)) {
    fail('unknown format "' + format + '". Use terminal, json, markdown, html or sarif.');
  }

  const minSeverity = str(args, 'min-severity') as Severity | undefined;
  if (minSeverity && !SEVERITY_ORDER.includes(minSeverity)) {
    fail('unknown severity "' + minSeverity + '".');
  }

  if (bool(args, 'fix')) {
    const dryRun = bool(args, 'dry-run');
    const result = applyFixes({ path: str(args, 'path'), dryRun });
    const verb = dryRun ? 'would replace' : 'replaced';

    if (result.replacements.length === 0) {
      process.stdout.write('  No auto-fixable credentials found.\n');
    } else {
      process.stdout.write(
        '\n  ' + style.bold(verb + ' ' + result.replacements.length + ' credential(s)') + '\n',
      );
      for (const r of result.replacements) {
        process.stdout.write(
          '    ' + style.cyan(r.relPath) + '  ' + r.redacted + ' -> ' + r.envVar + '\n',
        );
      }
      if (result.envExamplePath) {
        process.stdout.write('  ' + style.gray('variable names recorded in .env.example') + '\n');
      }
      process.stdout.write(
        '  ' +
          style.yellow('Rotate every credential listed above; it is still valid until you do.') +
          '\n\n',
      );
    }
  }

  // --diff narrows the scan to what changed, which is what makes a pre-commit
  // hook viable on a large tree.
  let only: string[] | undefined;
  const diff = args.flags.get('diff');
  if (diff !== undefined) {
    const ref = typeof diff === 'string' && diff.length > 0 ? diff : 'HEAD';
    try {
      only = changedFiles(str(args, 'path') ?? process.cwd(), ref);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    if (only && only.length === 0) {
      process.stdout.write('  Nothing changed against ' + ref + '.\n');
      return 0;
    }
  }

  const report = scan({
    path: str(args, 'path'),
    minSeverity,
    noSuppress: bool(args, 'no-suppress'),
    only,
  });

  const savePath = str(args, 'save-baseline');
  if (savePath) {
    writeFileSync(savePath, JSON.stringify(buildBaseline(report), null, 2) + '\n', 'utf8');
    process.stdout.write(
      '  Baseline written to ' + savePath + style.gray('  (' + report.findings.length + ' findings accepted)') + '\n',
    );
  }

  let regressed = false;
  const baselinePath = str(args, 'baseline');
  if (baselinePath) {
    let comparison;
    try {
      comparison = compareToBaseline(report, parseBaseline(readFileSync(baselinePath, 'utf8')));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }

    regressed = comparison.regressed;
    renderDrift(comparison);
  }

  let body: string;
  if (format === 'json') body = renderJson(report);
  else if (format === 'markdown') body = renderMarkdown(report);
  else if (format === 'html') body = renderHtml(report);
  else if (format === 'sarif') body = renderSarif(report);
  else body = renderTerminal(report, bool(args, 'verbose')) + '\n';

  const output = str(args, 'output');
  if (output) {
    writeFileSync(output, body, 'utf8');
    process.stdout.write('  Report written to ' + output + '\n');
  } else {
    process.stdout.write(body);
  }

  if (bool(args, 'gate') && regressed) return 2;
  return report.summary.critical > 0 ? 2 : 0;
}

/** Print what changed against a baseline, before the report itself. */
function renderDrift(comparison: {
  added: { id: string; severity: string; relPath: string; title: string }[];
  resolved: number;
  unchanged: number;
  scoreDelta: number;
  regressed: boolean;
}): void {
  const delta =
    comparison.scoreDelta === 0
      ? 'unchanged'
      : (comparison.scoreDelta > 0 ? '+' : '') + comparison.scoreDelta;

  process.stdout.write(
    '\n  ' +
      style.bold('Against the baseline') +
      style.gray(
        '  ' +
          comparison.added.length +
          ' new, ' +
          comparison.resolved +
          ' resolved, ' +
          comparison.unchanged +
          ' unchanged, score ' +
          delta,
      ) +
      '\n',
  );

  for (const finding of comparison.added.slice(0, 20)) {
    process.stdout.write(
      '    ' + style.red('NEW') + ' ' + finding.id + '  ' + finding.relPath + '  ' + finding.title + '\n',
    );
  }
}

function runExplain(args: Args): number {
  const wanted = (args.positional[0] ?? '').toUpperCase();
  if (!wanted) fail('usage: wardline explain WL-HOK-001');

  const rule = ALL_RULES.find((r) => r.id === wanted);
  if (!rule) fail('no rule with id "' + wanted + '". Run: wardline rules');

  const note = RULE_NOTES[rule.id];
  const out: string[] = ['', '  ' + style.cyan(rule.id) + '  ' + style.bold(rule.title)];

  out.push('  ' + style.gray(rule.category), '');

  if (note) {
    out.push('  ' + style.bold('What can happen'), '  ' + note.attack, '');
    out.push('  ' + style.bold('Why the fix works'), '  ' + note.why, '');
  } else {
    out.push(
      '  ' +
        style.gray(
          'No long-form note yet. Scan a configuration that trips this rule to see its detail and fix.',
        ),
      '',
    );
  }

  out.push(
    '  ' + style.gray('To silence it deliberately: wardline-ignore ' + rule.id + ' <reason>'),
    '',
  );

  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

function runInit(args: Args): number {
  const result = initConfig(str(args, 'path'));

  process.stdout.write('\n  ' + style.bold('wardline init') + '\n');
  for (const path of result.created) {
    process.stdout.write('    ' + style.green('created ') + path + '\n');
  }
  for (const path of result.skipped) {
    process.stdout.write('    ' + style.gray('kept    ') + path + '\n');
  }

  process.stdout.write(
    result.created.length === 0
      ? '\n  Nothing to write; every file already exists.\n\n'
      : '\n  Review the allow list before your next session.\n\n',
  );

  return 0;
}

function runRules(args: Args): number {
  if (str(args, 'format') === 'json') {
    const payload = ALL_RULES.map((r) => ({ id: r.id, category: r.category, title: r.title }));
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  process.stdout.write('\n  ' + style.bold(ALL_RULES.length + ' rules') + '\n\n');

  for (const rule of ALL_RULES) {
    process.stdout.write(
      '  ' + style.cyan(rule.id.padEnd(12)) + style.gray(rule.category.padEnd(13)) + rule.title + '\n',
    );
  }

  const counts = ruleCounts();
  process.stdout.write(
    '\n  ' +
      Object.entries(counts)
        .map(([k, v]) => k + ' ' + v)
        .join('   ') +
      '\n\n',
  );
  return 0;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.get('no-color') === true) setColorEnabled(false);

  if (bool(args, 'help') || args.command === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (bool(args, 'version') || args.command === 'version') {
    process.stdout.write('wardline ' + VERSION + '\n');
    process.exit(0);
  }

  try {
    if (args.command === 'scan') process.exit(runScan(args));
    if (args.command === 'init') process.exit(runInit(args));
    if (args.command === 'rules') process.exit(runRules(args));
    if (args.command === 'explain') process.exit(runExplain(args));
    fail('unknown command "' + args.command + '". Try: wardline --help');
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

main();
