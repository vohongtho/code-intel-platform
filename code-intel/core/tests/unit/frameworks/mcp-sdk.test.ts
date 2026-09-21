import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mcpSdkFrameworkAdapter } from '../../../src/frameworks/adapters/mcp-sdk.js';

describe('mcp sdk framework adapter', () => {
  it('extracts tool, resource, and prompt registrations', () => {
    const source = [
      "import { Server } from '@modelcontextprotocol/sdk/server'",
      "server.tool('search', { inputSchema: {} }, searchHandler)",
      "server.resource('repo', { uri: 'repo://x' }, repoHandler)",
      "server.prompt('summarize', { argsSchema: {} }, promptHandler)",
    ].join('\n');

    const detection = mcpSdkFrameworkAdapter.detect({
      workspaceRoot: '/repo',
      filePaths: ['package.json', 'server.ts'],
      fileCache: new Map([
        ['package.json', '{"dependencies":{"@modelcontextprotocol/sdk":"^1.0.0"}}'],
        ['server.ts', source],
      ]),
    });
    assert.equal(detection.exact, true);

    const bundle = mcpSdkFrameworkAdapter.extract({
      workspaceRoot: '/repo',
      filePaths: ['server.ts'],
      fileCache: new Map([['server.ts', source]]),
    });

    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'mcp-tool'));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'mcp-resource'));
    assert.ok(bundle.facts.some((fact) => 'registrationKind' in fact && fact.registrationKind === 'mcp-prompt'));
  });
});
