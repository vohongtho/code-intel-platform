import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror the suggested_next_tools logic from server.ts.
//
// The server builds hints inline inside each tool's case block. This helper
// centralises the same conditional logic so we can exercise it without
// standing up the full MCP stdio server.
//
// Rules (as implemented in server.ts):
//   search       → inspect + similar_symbols (only when results exist)
//   blast_radius → suggest_tests + pr_impact
//   inspect      → explain_relationship (when topCallerName present)
//              + cluster_summary (always — with cluster name or filePath)
//   pr_impact    → (not yet modelled here; server.ts does not emit hints yet)
//   any other    → undefined
//
// The flag corresponds to:
//   process.env['CODE_INTEL_SUGGEST_NEXT_TOOLS'] === 'true'  ← opt-IN since v1.0.1 (was opt-out)

interface Hint {
  tool: string;
  reason: string;
  input: Record<string, unknown>;
}

function buildSuggestedNextTools(
  enabled: boolean,
  toolName: string,
  context: {
    topResultName?: string;
    symbolName?: string;
    topCallerName?: string;
    cluster?: string;
    filePath?: string;
  },
): Hint[] | undefined {
  if (!enabled) return undefined;

  switch (toolName) {
    case 'search': {
      if (!context.topResultName) return undefined;
      return [
        {
          tool: 'inspect',
          reason: 'Inspect the top result in detail',
          input: { symbol: context.topResultName },
        },
        {
          tool: 'similar_symbols',
          reason: 'Find symbols similar to the top result',
          input: { symbol: context.topResultName },
        },
      ];
    }

    case 'blast_radius': {
      const highestRiskSymbol = context.symbolName ?? '';
      const firstFilePath = context.filePath ?? '';
      return [
        {
          tool: 'suggest_tests',
          reason: 'Generate tests for the highest-risk symbol',
          input: { symbol: highestRiskSymbol },
        },
        {
          tool: 'pr_impact',
          reason: 'Compute full PR impact for changed files',
          input: { changedFiles: [firstFilePath] },
        },
      ];
    }

    case 'inspect': {
      const hints: Hint[] = [];
      if (context.topCallerName) {
        hints.push({
          tool: 'explain_relationship',
          reason: 'Explain connection to a related symbol',
          input: { from: context.symbolName, to: context.topCallerName },
        });
      }
      // cluster_summary is always suggested (using cluster name or filePath as fallback)
      const clusterTarget = context.cluster ?? context.filePath ?? '';
      hints.push({
        tool: 'cluster_summary',
        reason: 'Summarize the module this symbol belongs to',
        input: { cluster: clusterTarget },
      });
      return hints.length > 0 ? hints : undefined;
    }

    default:
      return undefined;
  }
}

describe('Tool-chaining hints — Epic 3', () => {
  // ── search ───────────────────────────────────────────────────────────────

  it('search response includes suggested_next_tools when results are present', () => {
    const hints = buildSuggestedNextTools(true, 'search', { topResultName: 'handleLogin' });
    assert.ok(hints, 'hints should be defined');
    assert.equal(hints.length, 2);
  });

  it('search hint[0] is inspect with pre-filled symbol', () => {
    const hints = buildSuggestedNextTools(true, 'search', { topResultName: 'handleLogin' });
    assert.ok(hints);
    assert.equal(hints[0].tool, 'inspect');
    assert.deepEqual(hints[0].input, { symbol: 'handleLogin' });
  });

  it('search hint[1] is similar_symbols with pre-filled symbol', () => {
    const hints = buildSuggestedNextTools(true, 'search', { topResultName: 'handleLogin' });
    assert.ok(hints);
    assert.equal(hints[1].tool, 'similar_symbols');
    assert.deepEqual(hints[1].input, { symbol: 'handleLogin' });
  });

  it('search without results (no topResultName) returns undefined', () => {
    const hints = buildSuggestedNextTools(true, 'search', {});
    assert.equal(hints, undefined);
  });

  it('suggested_next_tools are omitted when flag is false (search)', () => {
    const hints = buildSuggestedNextTools(false, 'search', { topResultName: 'handleLogin' });
    assert.equal(hints, undefined);
  });

  // ── blast_radius ─────────────────────────────────────────────────────────

  it('blast_radius suggests suggest_tests with the target symbol', () => {
    const hints = buildSuggestedNextTools(true, 'blast_radius', {
      symbolName: 'getUser',
      filePath: 'src/api/users.ts',
    });
    assert.ok(hints);
    const h = hints.find((x) => x.tool === 'suggest_tests');
    assert.ok(h, 'suggest_tests hint should exist');
    assert.equal(h.input.symbol, 'getUser');
  });

  it('blast_radius suggests pr_impact with changedFiles array', () => {
    const hints = buildSuggestedNextTools(true, 'blast_radius', {
      symbolName: 'getUser',
      filePath: 'src/api/users.ts',
    });
    assert.ok(hints);
    const h = hints.find((x) => x.tool === 'pr_impact');
    assert.ok(h, 'pr_impact hint should exist');
    assert.ok(Array.isArray(h.input.changedFiles), 'changedFiles should be an array');
    assert.equal((h.input.changedFiles as string[])[0], 'src/api/users.ts');
  });

  it('blast_radius returns exactly 2 hints', () => {
    const hints = buildSuggestedNextTools(true, 'blast_radius', {
      symbolName: 'getUser',
      filePath: 'src/api/users.ts',
    });
    assert.ok(hints);
    assert.equal(hints.length, 2);
  });

  it('suggested_next_tools are omitted when flag is false (blast_radius)', () => {
    const hints = buildSuggestedNextTools(false, 'blast_radius', {
      symbolName: 'getUser',
      filePath: 'src/api/users.ts',
    });
    assert.equal(hints, undefined);
  });

  // ── inspect ──────────────────────────────────────────────────────────────

  it('inspect suggests explain_relationship with pre-filled from/to', () => {
    const hints = buildSuggestedNextTools(true, 'inspect', {
      symbolName: 'UserService',
      topCallerName: 'AuthController',
      cluster: 'src/auth',
    });
    assert.ok(hints);
    const h = hints.find((x) => x.tool === 'explain_relationship');
    assert.ok(h, 'explain_relationship hint should exist');
    assert.deepEqual(h.input, { from: 'UserService', to: 'AuthController' });
  });

  it('inspect suggests cluster_summary with the correct cluster', () => {
    const hints = buildSuggestedNextTools(true, 'inspect', {
      symbolName: 'UserService',
      topCallerName: 'AuthController',
      cluster: 'src/auth',
    });
    assert.ok(hints);
    const h = hints.find((x) => x.tool === 'cluster_summary');
    assert.ok(h, 'cluster_summary hint should exist');
    assert.deepEqual(h.input, { cluster: 'src/auth' });
  });

  it('inspect without topCallerName still emits cluster_summary', () => {
    const hints = buildSuggestedNextTools(true, 'inspect', {
      symbolName: 'UserService',
      cluster: 'src/auth',
    });
    assert.ok(hints);
    assert.ok(
      hints.some((h) => h.tool === 'cluster_summary'),
      'cluster_summary should be present even without topCallerName',
    );
    assert.ok(
      !hints.some((h) => h.tool === 'explain_relationship'),
      'explain_relationship should be absent when topCallerName is missing',
    );
  });

  it('inspect falls back to filePath when cluster is absent', () => {
    const hints = buildSuggestedNextTools(true, 'inspect', {
      symbolName: 'UserService',
      filePath: 'src/auth/user.service.ts',
    });
    assert.ok(hints);
    const h = hints.find((x) => x.tool === 'cluster_summary');
    assert.ok(h);
    assert.equal(h.input.cluster, 'src/auth/user.service.ts');
  });

  it('suggested_next_tools are omitted when flag is false (inspect)', () => {
    const hints = buildSuggestedNextTools(false, 'inspect', {
      symbolName: 'UserService',
      topCallerName: 'AuthController',
      cluster: 'src/auth',
    });
    assert.equal(hints, undefined);
  });

  // ── unknown tool ─────────────────────────────────────────────────────────

  it('unknown tool returns undefined hints', () => {
    const hints = buildSuggestedNextTools(true, 'overview', {});
    assert.equal(hints, undefined);
  });

  // ── hint shape invariants ─────────────────────────────────────────────────

  it('every hint has tool, reason, and input fields', () => {
    const hints = buildSuggestedNextTools(true, 'search', { topResultName: 'foo' });
    assert.ok(hints);
    for (const h of hints) {
      assert.ok(typeof h.tool === 'string', 'tool must be a string');
      assert.ok(typeof h.reason === 'string', 'reason must be a string');
      assert.ok(typeof h.input === 'object' && h.input !== null, 'input must be an object');
    }
  });
});
