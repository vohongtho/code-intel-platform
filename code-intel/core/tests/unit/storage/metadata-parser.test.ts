import { describe, expect, it } from 'vitest';
import { resolveParserForMetadata } from '../../../src/storage/metadata.js';

describe('resolveParserForMetadata', () => {
  it('uses parser provenance from the parse phase', () => {
    expect(resolveParserForMetadata('tree-sitter', {
      indexedAt: '2026-07-31T00:00:00.000Z',
      parser: 'regex',
      stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
    })).toBe('tree-sitter');
  });

  it('preserves tree-sitter metadata when a zero-change run skips parsing', () => {
    expect(resolveParserForMetadata(undefined, {
      indexedAt: '2026-07-31T00:00:00.000Z',
      parser: 'tree-sitter',
      stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
    })).toBe('tree-sitter');
  });

  it('preserves a legacy regex marker until a real rebuild runs', () => {
    expect(resolveParserForMetadata(undefined, {
      indexedAt: '2026-07-29T00:00:00.000Z',
      parser: 'regex',
      stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
    })).toBe('regex');
  });

  it('treats metadata without parser provenance as legacy regex', () => {
    expect(resolveParserForMetadata(undefined, {
      indexedAt: '2026-07-29T00:00:00.000Z',
      stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
    })).toBe('regex');
  });
});
