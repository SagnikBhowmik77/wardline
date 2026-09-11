import { classifySurface } from '../src/scanner/discovery';
import { stripJsonComments } from '../src/util/text';
import type { HarnessId } from '../src/harness';
import type { ConfigFile, Finding, FileKind, Rule, ScanContext, SourceTrust } from '../src/types';

export interface FileSpec {
  relPath: string;
  kind: FileKind;
  content: string;
  trust?: SourceTrust;
  harness?: HarnessId;
}

/** Build an in-memory ConfigFile without touching the filesystem. */
export function makeFile(spec: FileSpec): ConfigFile {
  const file: ConfigFile = {
    path: '/scan/' + spec.relPath,
    relPath: spec.relPath,
    kind: spec.kind,
    // Derived the same way discovery does it, so fixtures behave like real files.
    harness: spec.harness ?? classifySurface(spec.relPath)?.harness,
    trust: spec.trust ?? 'runtime',
    content: spec.content,
  };

  if (spec.relPath.endsWith('.json')) {
    try {
      file.data = JSON.parse(stripJsonComments(spec.content));
    } catch (err) {
      file.parseError = String(err);
    }
  }

  return file;
}

export function context(...files: ConfigFile[]): ScanContext {
  return { root: '/scan', files };
}

/** Run a set of rules and return every finding they produce. */
export function runRules(rules: Rule[], ctx: ScanContext): Finding[] {
  return rules.flatMap((rule) => rule.run(ctx));
}

/** Findings for one rule id, which is what most assertions care about. */
export function findingsFor(rules: Rule[], ctx: ScanContext, id: string): Finding[] {
  return runRules(rules, ctx).filter((f) => f.id === id);
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
