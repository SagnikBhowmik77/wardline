/**
 * Library surface.
 *
 * Everything exported here is what Wardline supports being imported. The CLI is
 * a consumer of this module, not the other way round.
 */

export { scan, scanFiles, analyzeFiles, resolveTarget, sortFindings } from './scanner/index.js';
export { discover, discoverWithMeta, configFileFrom, classify, trustOf } from './scanner/discovery.js';
export { readHooks, readMcpServers, readPermissions } from './scanner/extract.js';
export { ALL_RULES, rulesFor, ruleCounts } from './rules/index.js';
export { scoreFindings, gradeFor, gradeSummary, findingWeight } from './report/score.js';
export { renderTerminal } from './report/terminal.js';
export { renderJson, renderMarkdown } from './report/json.js';
export { renderHtml } from './report/html.js';
export { applyFixes } from './fix/index.js';
export { initConfig } from './init/index.js';
export { renderSarif } from './report/sarif.js';
export {
  BASELINE_VERSION,
  buildBaseline,
  compareToBaseline,
  fingerprint,
  parseBaseline,
} from './baseline.js';
export type { Baseline, BaselineComparison } from './baseline.js';
export { applySuppressions, readSuppressions } from './suppress.js';
export type { Suppression } from './suppress.js';
export { shannonEntropy, characterSpread, characterClasses, looksRandom } from './util/entropy.js';
export { changedFiles, isRepository } from './util/git.js';
export { HARNESS_LABEL, harnessesIn, knownHarnesses, matchSurface } from './harness.js';
export type { HarnessId } from './harness.js';
export { RULE_NOTES } from './rules/explain.js';
export type { RuleNote } from './rules/explain.js';
export { similarity } from './rules/drift.js';
export { VERSION } from './version.js';

export type {
  Category,
  CategoryScore,
  ConfigFile,
  FileKind,
  Finding,
  Rule,
  ScanContext,
  ScanReport,
  ScanSummary,
  Scorecard,
  Severity,
  SourceTrust,
} from './types.js';
