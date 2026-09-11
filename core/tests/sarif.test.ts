import { describe, expect, it } from 'vitest';

import { renderSarif } from '../src/report/sarif';
import { ALL_RULES } from '../src/rules/index';
import { scan } from '../src/scanner/index';
import { fileURLToPath } from 'node:url';

const DEMO = fileURLToPath(new URL('../examples/insecure-config', import.meta.url));

describe('SARIF output', () => {
  const sarif = JSON.parse(renderSarif(scan({ path: DEMO })));

  it('declares the schema version code scanning expects', () => {
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-2.1.0');
  });

  it('publishes the whole rule catalogue', () => {
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(ALL_RULES.length);
    expect(sarif.runs[0].tool.driver.name).toBe('Wardline');
  });

  it('anchors every result to a file and a line', () => {
    for (const result of sarif.runs[0].results) {
      const place = result.locations[0].physicalLocation;
      expect(place.artifactLocation.uri).toBeTruthy();
      expect(place.region.startLine).toBeGreaterThan(0);
    }
  });

  it('maps severity onto the three levels SARIF allows', () => {
    const levels = new Set(sarif.runs[0].results.map((r: { level: string }) => r.level));
    for (const level of levels) expect(['error', 'warning', 'note']).toContain(level);
  });

  it('carries a security-severity so code scanning can rank it', () => {
    const critical = sarif.runs[0].results.find(
      (r: { properties: { severity: string } }) => r.properties.severity === 'critical',
    );

    expect(critical.level).toBe('error');
    expect(Number(critical.properties['security-severity'])).toBeGreaterThanOrEqual(9);
  });

  it('keeps the fix guidance in the message a reviewer sees', () => {
    const first = sarif.runs[0].results[0];
    expect(first.message.text).toContain('Fix:');
  });
});
