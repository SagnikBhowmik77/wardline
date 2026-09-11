import { describe, expect, it } from 'vitest';

import { RULE_NOTES } from '../src/rules/explain';
import { ALL_RULES } from '../src/rules/index';

describe('rule explanations', () => {
  it('documents every rule it claims to', () => {
    const known = new Set(ALL_RULES.map((r) => r.id));

    for (const id of Object.keys(RULE_NOTES)) {
      expect(known.has(id), id + ' has a note but no rule').toBe(true);
    }
  });

  it('covers the rules most likely to matter', () => {
    const mustExplain = [
      'WL-SEC-001',
      'WL-PRM-001',
      'WL-PRM-012',
      'WL-HOK-001',
      'WL-HOK-002',
      'WL-HOK-017',
      'WL-HOK-018',
      'WL-MCP-001',
      'WL-AGT-007',
      'WL-AGT-014',
      'WL-AGT-015',
    ];

    for (const id of mustExplain) {
      expect(RULE_NOTES[id], id + ' needs an explanation').toBeDefined();
    }
  });

  it('says what happens, not just what the policy is', () => {
    for (const [id, note] of Object.entries(RULE_NOTES)) {
      expect(note.attack.length, id).toBeGreaterThan(60);
      expect(note.why.length, id).toBeGreaterThan(30);
      // A note that only restates the title teaches nothing.
      expect(note.attack, id).not.toBe(note.why);
    }
  });

  it('explains every rule, leaving no gap to grow back', () => {
    const missing = ALL_RULES.filter((rule) => !RULE_NOTES[rule.id]).map((rule) => rule.id);
    expect(missing, 'rules with no explanation').toEqual([]);
  });
});
