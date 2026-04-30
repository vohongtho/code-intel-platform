import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror the pagination logic from server.ts (search, file_symbols, list_exports, clusters, flows)
// The pattern is identical across all 5 list tools:
//   effectiveLimit = Math.min((a.limit ?? 50), 500)
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
