/**
 * Rule registry.
 *
 * Rules are plain objects, so the registry is just a list. Order here is the
 * order categories appear in reports.
 */

import { agentRules } from './agents.js';
import { crossAgentRules } from './crossagent.js';
import { driftRules } from './drift.js';
import { hookRules } from './hooks.js';
import { mcpRules } from './mcp.js';
import { permissionRules } from './permissions.js';
import { secretRules } from './secrets.js';
import type { Category, Rule } from '../types.js';

export const ALL_RULES: Rule[] = [
  ...secretRules,
  ...permissionRules,
  ...hookRules,
  ...mcpRules,
  ...agentRules,
  ...crossAgentRules,
  ...driftRules,
];

/** Rules belonging to one category, in registry order. */
export function rulesFor(category: Category): Rule[] {
  return ALL_RULES.filter((r) => r.category === category);
}

/** Count of registered rules per category, used by `wardline rules`. */
export function ruleCounts(): Record<Category, number> {
  const counts = { secrets: 0, permissions: 0, hooks: 0, mcp: 0, agents: 0 };
  for (const rule of ALL_RULES) counts[rule.category] += 1;
  return counts;
}

export { agentRules, crossAgentRules, driftRules, hookRules, mcpRules, permissionRules, secretRules };
