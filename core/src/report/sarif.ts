/**
 * SARIF 2.1.0.
 *
 * This is what puts a finding on the line that caused it, inside a pull request
 * diff, via GitHub code scanning. The shape is fixed by the specification, so
 * the only judgement here is which severity maps to which level and how to say
 * "this came from a template, not your live config".
 */

import { ALL_RULES } from '../rules/index.js';
import type { Finding, ScanReport, Severity } from '../types.js';

/** SARIF has three levels; five severities have to fold into them. */
function levelFor(severity: Severity): string {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

/** Code scanning ranks by this, and it wants 0 to 10. */
function securitySeverity(severity: Severity): string {
  const scale: Record<Severity, string> = {
    critical: '9.0',
    high: '7.0',
    medium: '5.0',
    low: '3.0',
    info: '1.0',
  };
  return scale[severity];
}

function resultFor(finding: Finding): Record<string, unknown> {
  const message =
    finding.detail + (finding.remedy ? ' Fix: ' + finding.remedy : '');

  return {
    ruleId: finding.id,
    level: levelFor(finding.severity),
    message: { text: message },
    properties: {
      severity: finding.severity,
      category: finding.category,
      trust: finding.trust,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.relPath, uriBaseId: '%SRCROOT%' },
          region: finding.line ? { startLine: finding.line } : { startLine: 1 },
        },
      },
    ],
  };
}

export function renderSarif(report: ScanReport): string {
  // Only rules that actually fired need to be declared, but declaring all of
  // them lets a reviewer see the full catalogue in the code scanning UI.
  const rules = ALL_RULES.map((rule) => ({
    id: rule.id,
    name: rule.id.replace(/-/g, ''),
    shortDescription: { text: rule.title },
    fullDescription: { text: rule.title },
    defaultConfiguration: { level: 'warning' },
    properties: {
      category: rule.category,
      tags: ['security', 'ai-agent', rule.category],
    },
  }));

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Wardline',
            informationUri: 'https://github.com/SagnikBhowmik77/wardline',
            version: report.version,
            rules,
          },
        },
        results: report.findings.map((finding) => ({
          ...resultFor(finding),
          properties: {
            ...(resultFor(finding).properties as Record<string, unknown>),
            'security-severity': securitySeverity(finding.severity),
          },
        })),
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: report.generatedAt,
          },
        ],
      },
    ],
  };

  return JSON.stringify(sarif, null, 2) + '\n';
}
