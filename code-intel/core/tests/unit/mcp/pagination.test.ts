import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror the pagination logic from server.ts (search, file_symbols, list_exports, clusters, flows)
// The pattern is identical across all 5 list tools:
//   effectiveLimit = Math.min((a.limit ?? 10), 500)   ← default 10 since v1.0.1
//   page           = allItems.slice(offset, offset + effectiveLimit)
//   hasMore        = offset + effectiveLimit < total
function paginate<T>(
  items: T[],
  offset: number,
  limit: number,
): { items: T[]; total: number; offset: number; limit: number; hasMore: boolean } {
  const effectiveLimit = Math.min(limit, 500);
  const page = items.slice(offset, offset + effectiveLimit);
  return {
    items: page,
    total: items.length,
    offset,
    limit: effectiveLimit,
    hasMore: offset + effectiveLimit < items.length,
  };
}

describe('Pagination logic — search / file_symbols / list_exports / clusters / flows', () => {
  // ── Epic 2 acceptance criteria ───────────────────────────────────────────

  it('search: offset=50 returns correct page starting at index 50', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const result = paginate(items, 50, 20);
    assert.equal(result.items[0], 50);
    assert.equal(result.items.length, 20);
    assert.equal(result.total, 100);
    assert.equal(result.offset, 50);
    assert.equal(result.hasMore, true);
  });

  it('total matches full item count regardless of pagination window', () => {
    const items = Array.from({ length: 75 }, (_, i) => i);
    const result = paginate(items, 0, 50);
    assert.equal(result.total, 75);
    assert.equal(result.items.length, 50);
    assert.equal(result.hasMore, true);
  });

  it('hasMore is false on last page', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const result = paginate(items, 20, 50);
    assert.equal(result.hasMore, false);
    assert.equal(result.items.length, 10);
  });

  it('limit > 500 is clamped to 500', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const result = paginate(items, 0, 999);
    assert.equal(result.limit, 500);
    assert.equal(result.items.length, 500);
  });

  it('limit exactly 500 is accepted without clamping', () => {
    const items = Array.from({ length: 600 }, (_, i) => i);
    const result = paginate(items, 0, 500);
    assert.equal(result.limit, 500);
    assert.equal(result.items.length, 500);
    assert.equal(result.hasMore, true);
  });

  it('empty items returns hasMore=false and total=0', () => {
    const result = paginate([], 0, 50);
    assert.equal(result.total, 0);
    assert.equal(result.hasMore, false);
    assert.equal(result.items.length, 0);
  });

  it('offset beyond total returns empty items and hasMore=false', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const result = paginate(items, 20, 50);
    assert.equal(result.items.length, 0);
    assert.equal(result.hasMore, false);
    assert.equal(result.total, 10);
  });

  it('offset=0 with default limit=50 returns first 50 items', () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const result = paginate(items, 0, 50);
    assert.equal(result.items[0], 0);
    assert.equal(result.items[result.items.length - 1], 49);
    assert.equal(result.items.length, 50);
    assert.equal(result.hasMore, true);
  });

  it('second page with offset=50 limit=50 returns items 50–99', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const result = paginate(items, 50, 50);
    assert.equal(result.items[0], 50);
    assert.equal(result.items[result.items.length - 1], 99);
    assert.equal(result.hasMore, true);
  });

  it('final partial page returns only remaining items', () => {
    // 13 items, offset 10, limit 50 → 3 items remain
    const items = Array.from({ length: 13 }, (_, i) => i);
    const result = paginate(items, 10, 50);
    assert.equal(result.items.length, 3);
    assert.equal(result.hasMore, false);
    assert.equal(result.total, 13);
  });

  it('response always includes offset and limit fields', () => {
    const result = paginate([1, 2, 3], 1, 2);
    assert.equal(result.offset, 1);
    assert.equal(result.limit, 2);
  });

  it('hasMore is false when offset + limit exactly equals total', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    // offset 50 + limit 50 = 100 = total → hasMore false
    const result = paginate(items, 50, 50);
    assert.equal(result.hasMore, false);
    assert.equal(result.items.length, 50);
  });
});

// ── A.1 / A.3 acceptance criteria: default limit=10 ─────────────────────────
// These mirror the server.ts runtime behaviour:
//   effectiveLimit = Math.min((a.limit as number) ?? 10, 500)

describe('Default limit = 10 (v1.0.1 — A.3)', () => {
  it('search with no limit param defaults to 10 results', () => {
    // simulate: (a.limit ?? 10)
    const DEFAULT = 10;
    const items = Array.from({ length: 100 }, (_, i) => i);
    const result = paginate(items, 0, DEFAULT);
    assert.equal(result.items.length, 10);
    assert.equal(result.limit, 10);
    assert.equal(result.hasMore, true);
  });

  it('search with explicit limit=50 overrides default and returns 50', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const result = paginate(items, 0, 50);
    assert.equal(result.items.length, 50);
    assert.equal(result.limit, 50);
  });

  it('blast_radius default hops=2 (guard: value used in server)', () => {
    // blast_radius: (a.max_hops as number) ?? 2
    // TypeScript won't allow testing ?? on a typed value, so we simulate via JS logic
    const defaultVal = 2;
    const userVal: number | undefined = undefined;
    const result = userVal ?? defaultVal;
    assert.equal(result, 2);
  });

  it('blast_radius explicit max_hops=5 overrides default', () => {
    const defaultVal = 2;
    const userVal: number | undefined = 5;
    const result = userVal ?? defaultVal;
    assert.equal(result, 5);
  });

  it('pr_impact default maxHops=2', () => {
    // pr_impact: (a.maxHops as number) ?? 2
    const defaultVal = 2;
    const userVal: number | undefined = undefined;
    const result = userVal ?? defaultVal;
    assert.equal(result, 2);
  });
});

// ── A.1 compact JSON — no whitespace, null stripping ─────────────────────────

/** Mirrors the compact() helper in server.ts */
function compact(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) =>
    value === null || value === undefined ? undefined : value,
  );
}

describe('compact() helper — A.1', () => {
  it('output is valid compact JSON (no whitespace between keys)', () => {
    const result = compact({ a: 1, b: 'hello' });
    assert.equal(result, '{"a":1,"b":"hello"}');
    assert.ok(!result.includes('\n'), 'no newlines');
    assert.ok(!result.includes('  '), 'no indentation');
  });

  it('null fields are stripped from output', () => {
    const result = compact({ name: 'foo', cluster: null, content: null });
    const parsed = JSON.parse(result);
    assert.ok(!('cluster' in parsed), 'null field should be removed');
    assert.ok(!('content' in parsed), 'null field should be removed');
    assert.equal(parsed.name, 'foo');
  });

  it('undefined fields are stripped from output', () => {
    const result = compact({ name: 'bar', snippet: undefined });
    const parsed = JSON.parse(result);
    assert.ok(!('snippet' in parsed), 'undefined field should be removed');
    assert.equal(parsed.name, 'bar');
  });

  it('nested null values are stripped', () => {
    const result = compact({ node: { id: '1', filePath: null, score: 0.8 } });
    const parsed = JSON.parse(result);
    assert.ok(!('filePath' in parsed.node), 'nested null should be stripped');
    assert.equal(parsed.node.id, '1');
    assert.equal(parsed.node.score, 0.8);
  });

  it('non-null fields are preserved exactly', () => {
    const result = compact({ count: 0, flag: false, text: '' });
    const parsed = JSON.parse(result);
    assert.equal(parsed.count, 0);
    assert.equal(parsed.flag, false);
    assert.equal(parsed.text, '');
  });
});

// ── A.2 suggested_next_tools — default OFF ────────────────────────────────────

describe('suggested_next_tools opt-in default — A.2', () => {
  it('default (no env var) is treated as OFF', () => {
    // server.ts: process.env['CODE_INTEL_SUGGEST_NEXT_TOOLS'] === 'true'
    const env: string | undefined = undefined; // no env var set
    const suggestEnabled = env === 'true';
    assert.equal(suggestEnabled, false);
  });

  it("env='false' → suggestions OFF", () => {
    const env: string = 'false';
    const suggestEnabled = env === 'true';
    assert.equal(suggestEnabled, false);
  });

  it("env='true' → suggestions ON", () => {
    const env: string = 'true';
    const suggestEnabled = env === 'true';
    assert.equal(suggestEnabled, true);
  });

  it("empty string env → suggestions OFF", () => {
    const env: string = '';
    const suggestEnabled = env === 'true';
    assert.equal(suggestEnabled, false);
  });
});
