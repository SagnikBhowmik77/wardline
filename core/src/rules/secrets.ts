/**
 * Committed-credential rules.
 *
 * Secrets are the one family Wardline never discounts by source trust: a live
 * key pasted into a tutorial is just as revoked-worthy as one in settings.json.
 */

import { looksRandom } from '../util/entropy.js';
import { lineAt, oneLine, redact } from '../util/text.js';
import { looksLikePlaceholder, matchAll, report } from './helpers.js';
import type { ConfigFile, Finding, Rule, Severity } from '../types.js';

interface SecretPattern {
  id: string;
  title: string;
  severity: Severity;
  vendor: string;
  /** Suggested environment variable name used by `--fix`. */
  envVar: string;
  regex: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'WL-SEC-001',
    title: 'Hardcoded Anthropic API key',
    severity: 'critical',
    vendor: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    regex: /sk-ant-[A-Za-z0-9_-]{24,}/,
  },
  {
    id: 'WL-SEC-002',
    title: 'Hardcoded OpenAI API key',
    severity: 'critical',
    vendor: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    regex: /sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{24,}/,
  },
  {
    id: 'WL-SEC-003',
    title: 'Hardcoded AWS access key id',
    severity: 'critical',
    vendor: 'AWS',
    envVar: 'AWS_ACCESS_KEY_ID',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'WL-SEC-004',
    title: 'Hardcoded Google API key',
    severity: 'critical',
    vendor: 'Google',
    envVar: 'GOOGLE_API_KEY',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'WL-SEC-005',
    title: 'Hardcoded GitHub token',
    severity: 'critical',
    vendor: 'GitHub',
    envVar: 'GITHUB_TOKEN',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  {
    id: 'WL-SEC-006',
    title: 'Hardcoded Stripe secret key',
    severity: 'critical',
    vendor: 'Stripe',
    envVar: 'STRIPE_SECRET_KEY',
    regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  {
    id: 'WL-SEC-007',
    title: 'Hardcoded Slack token',
    severity: 'high',
    vendor: 'Slack',
    envVar: 'SLACK_TOKEN',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/,
  },
  {
    id: 'WL-SEC-008',
    title: 'Hardcoded third-party model provider key',
    severity: 'critical',
    vendor: 'model provider',
    envVar: 'MODEL_PROVIDER_API_KEY',
    regex: /\b(?:xai-[A-Za-z0-9]{24,}|gsk_[A-Za-z0-9]{24,}|sk-or-v1-[A-Za-z0-9]{24,})\b/,
  },
  {
    id: 'WL-SEC-009',
    title: 'Hardcoded JSON Web Token',
    severity: 'high',
    vendor: 'JWT',
    envVar: 'AUTH_TOKEN',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  {
    id: 'WL-SEC-010',
    title: 'Private key material committed to config',
    severity: 'critical',
    vendor: 'PKI',
    envVar: 'PRIVATE_KEY',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'WL-SEC-011',
    title: 'Database connection string with inline credentials',
    severity: 'critical',
    vendor: 'database',
    envVar: 'DATABASE_URL',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s:@/'"]+:[^\s:@/'"]+@[^\s'"]+/,
  },
];

const ASSIGNMENT =
  /(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{10,})["']/gi;

const ENV_LEAK =
  /(?:echo|printf|curl|wget|nc|http)\b[^\n]*\$\{?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\}?/i;

const ENV_DUMP = /\b(?:env|printenv|set)\s*(?:\|\s*(?:curl|nc|wget|base64)|>\s*\/)/i;

function scannable(files: ConfigFile[]): ConfigFile[] {
  return files.filter((f) => f.content.length > 0);
}

/** One rule object per vendor pattern, so findings stay individually citable. */
const patternRules: Rule[] = SECRET_PATTERNS.map((pattern) => ({
  id: pattern.id,
  category: 'secrets' as const,
  title: pattern.title,
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of scannable(ctx.files)) {
      for (const hit of matchAll(file.content, pattern.regex)) {
        if (looksLikePlaceholder(hit.text)) continue;

        findings.push(
          report(file, {
            id: pattern.id,
            category: 'secrets',
            severity: pattern.severity,
            title: pattern.title,
            detail:
              'A live-looking ' +
              pattern.vendor +
              ' credential is stored in plain text. Anyone with read access to this repository or config directory can use it.',
            remedy:
              'Revoke and rotate the credential, then reference it as ${' +
              pattern.envVar +
              '} and load it from the environment.',
            line: lineAt(file.content, hit.index),
            evidence: redact(hit.text),
            autoFixable: file.kind !== 'env',
          }),
        );
      }
    }

    return findings;
  },
}));

const assignmentRule: Rule = {
  id: 'WL-SEC-012',
  category: 'secrets',
  title: 'Credential assigned as a literal value',
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of scannable(ctx.files)) {
      if (file.kind === 'env') continue;

      for (const hit of matchAll(file.content, ASSIGNMENT)) {
        const value = hit.groups[0] ?? '';
        if (looksLikePlaceholder(value)) continue;
        // The vendor patterns above catch known key shapes. For everything else
        // randomness is the signal: a literal with no entropy is documentation.
        if (!looksRandom(value)) continue;
        // Vendor patterns already reported these with better attribution.
        if (SECRET_PATTERNS.some((p) => new RegExp(p.regex.source).test(value))) continue;

        findings.push(
          report(file, {
            id: 'WL-SEC-012',
            category: 'secrets',
            severity: 'high',
            title: 'Credential assigned as a literal value',
            detail:
              'A secret-shaped key is assigned a literal string rather than an environment reference, so the value travels with the file.',
            remedy:
              'Move the value into your environment or secret manager and reference it as ${VAR_NAME}.',
            line: lineAt(file.content, hit.index),
            evidence: oneLine(hit.text.replace(value, redact(value))),
          }),
        );
      }
    }

    return findings;
  },
};

const envLeakRule: Rule = {
  id: 'WL-SEC-013',
  category: 'secrets',
  title: 'Secret-bearing environment variable piped into a command',
  run(ctx) {
    const findings: Finding[] = [];
    const kinds = new Set(['hook-script', 'settings', 'hooks-manifest']);

    for (const file of scannable(ctx.files)) {
      if (!kinds.has(file.kind)) continue;

      file.content.split('\n').forEach((raw, i) => {
        const text = raw.trim();
        if (text.startsWith('#') || text.length === 0) return;

        const leak = ENV_LEAK.test(text);
        const dump = ENV_DUMP.test(text);
        if (!leak && !dump) return;

        findings.push(
          report(file, {
            id: 'WL-SEC-013',
            category: 'secrets',
            severity: dump ? 'critical' : 'high',
            title: dump
              ? 'Whole environment dumped into an outbound command'
              : 'Secret-bearing environment variable piped into a command',
            detail: dump
              ? 'The full process environment is written somewhere it can leave the machine. Every credential the agent holds goes with it.'
              : 'A variable whose name suggests a credential is interpolated into a command that can print or transmit it.',
            remedy:
              'Never echo or transmit credential variables. Pass secrets directly to the tool that needs them and keep them out of logs and network calls.',
            line: i + 1,
            evidence: oneLine(text),
          }),
        );
      });
    }

    return findings;
  },
};

const committedEnvRule: Rule = {
  id: 'WL-SEC-014',
  category: 'secrets',
  title: 'Environment file with real values sits alongside the config',
  run(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.kind !== 'env') continue;
      if (/\.env\.(?:example|sample|template|dist)$/i.test(file.relPath)) continue;

      const populated = file.content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
        .filter((l) => {
          const value = l.split('=').slice(1).join('=').replace(/^["']|["']$/g, '');
          return value.length >= 12 && !looksLikePlaceholder(value);
        });

      if (populated.length === 0) continue;

      findings.push(
        report(file, {
          id: 'WL-SEC-014',
          category: 'secrets',
          severity: 'high',
          title: 'Environment file with real values sits alongside the config',
          detail:
            populated.length +
            ' variable(s) hold live-looking values. Agents routinely read files in this directory, and one over-broad Read permission is enough to exfiltrate all of them.',
          remedy:
            'Add this file to .gitignore, keep only a .env.example with blank values, and deny agent reads of **/.env.',
          line: 1,
        }),
      );
    }

    return findings;
  },
};

export const secretRules: Rule[] = [
  ...patternRules,
  assignmentRule,
  envLeakRule,
  committedEnvRule,
];
