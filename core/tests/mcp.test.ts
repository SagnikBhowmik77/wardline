import { describe, expect, it } from 'vitest';

import { mcpRules } from '../src/rules/mcp';
import { readMcpServers } from '../src/scanner/extract';
import { context, findingsFor, json, makeFile, runRules } from './support';

function mcp(mcpServers: Record<string, unknown>) {
  return makeFile({ relPath: '.mcp.json', kind: 'mcp', content: json({ mcpServers }) });
}

describe('MCP extraction', () => {
  it('reads servers nested under .claude.json projects', () => {
    const file = makeFile({
      relPath: '.claude.json',
      kind: 'mcp',
      content: json({ projects: { '/work/app': { mcpServers: { linter: { command: 'lint' } } } } }),
    });

    expect(readMcpServers(file).map((s) => s.name)).toEqual(['linter']);
  });
});

describe('MCP rules', () => {
  it('flags a shell server as critical', () => {
    const file = mcp({ 'shell-runner': { command: 'npx', args: ['@vendor/mcp-shell@1.0.0'] } });
    expect(findingsFor(mcpRules, context(file), 'WL-MCP-001')[0]?.severity).toBe('critical');
  });

  it('separates a root filesystem mount from a repo-scoped one', () => {
    const root = mcp({ filesystem: { command: 'server-filesystem', args: ['/'] } });
    const scoped = mcp({ filesystem: { command: 'server-filesystem', args: ['./src'] } });

    expect(findingsFor(mcpRules, context(root), 'WL-MCP-002')[0]?.severity).toBe('high');
    expect(findingsFor(mcpRules, context(scoped), 'WL-MCP-002')).toHaveLength(0);
  });

  it('accepts a database server that says it is read-only', () => {
    const write = mcp({ analytics: { command: 'mcp-postgres', args: [] } });
    const read = mcp({ analytics: { command: 'mcp-postgres', args: ['--read-only'] } });

    expect(findingsFor(mcpRules, context(write), 'WL-MCP-003')).toHaveLength(1);
    expect(findingsFor(mcpRules, context(read), 'WL-MCP-003')).toHaveLength(0);
  });

  it('flags auto-install and unpinned packages independently', () => {
    const file = mcp({ tools: { command: 'npx', args: ['-y', '@vendor/mcp-tools'] } });
    const ids = runRules(mcpRules, context(file)).map((f) => f.id);

    expect(ids).toContain('WL-MCP-005');
    expect(ids).toContain('WL-MCP-006');
  });

  it('accepts a pinned package', () => {
    const file = mcp({ tools: { command: 'npx', args: ['@vendor/mcp-tools@2.4.1'] } });
    expect(findingsFor(mcpRules, context(file), 'WL-MCP-006')).toHaveLength(0);
  });

  it('flags a literal token in the server environment but not an env reference', () => {
    const literal = mcp({ api: { command: 'mcp-api', env: { API_TOKEN: 'q7Xb2M9pLt4Rv0Ns' } } });
    const reference = mcp({ api: { command: 'mcp-api', env: { API_TOKEN: '${API_TOKEN}' } } });

    expect(findingsFor(mcpRules, context(literal), 'WL-MCP-007')).toHaveLength(1);
    expect(findingsFor(mcpRules, context(reference), 'WL-MCP-007')).toHaveLength(0);
  });

  it('rates plain HTTP above HTTPS and ignores localhost', () => {
    const insecure = mcp({ partner: { url: 'http://tools.partner.dev/mcp' } });
    const secure = mcp({ partner: { url: 'https://tools.partner.dev/mcp' } });
    const local = mcp({ partner: { url: 'http://localhost:8080/mcp' } });

    expect(findingsFor(mcpRules, context(insecure), 'WL-MCP-008')[0]?.severity).toBe('critical');
    expect(findingsFor(mcpRules, context(secure), 'WL-MCP-008')[0]?.severity).toBe('high');
    expect(findingsFor(mcpRules, context(local), 'WL-MCP-008')).toHaveLength(0);
  });

  it('flags auto-approved tools and sensitive file arguments', () => {
    const file = mcp({
      mailer: { command: 'mcp-mail', args: ['./config/credentials.json'], autoApprove: ['send'] },
    });
    const ids = runRules(mcpRules, context(file)).map((f) => f.id);

    expect(ids).toContain('WL-MCP-012');
    expect(ids).toContain('WL-MCP-010');
  });

  it('reports server sprawl once per file', () => {
    const servers: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) servers['srv' + i] = { command: 'mcp-thing' };

    expect(findingsFor(mcpRules, context(mcp(servers)), 'WL-MCP-015')).toHaveLength(1);
  });
});
