import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelectorIndex, selectFromIndex } from '../../../src/identity/selector-index.js';
import { attachLegacyAliases, resolveLegacyAlias } from '../../../src/identity/legacy-alias.js';

describe('selector index', () => {
  it('preserves multiple same-name candidates', () => {
    const index = buildSelectorIndex([
      { id: 'a', kind: 'function', name: 'login', filePath: 'src/a.ts', metadata: { semantic: { qualifiedName: 'src/a.ts:login' } } },
      { id: 'b', kind: 'function', name: 'login', filePath: 'src/b.ts', metadata: { semantic: { qualifiedName: 'src/b.ts:login' } } },
    ]);
    const result = selectFromIndex(index, 'login');
    assert.equal(result.kind, 'ambiguous');
    if (result.kind === 'ambiguous') assert.deepEqual(result.candidates, ['a', 'b']);
  });

  it('resolves exact qualified name', () => {
    const index = buildSelectorIndex([
      { id: 'a', kind: 'function', name: 'login', filePath: 'src/a.ts', metadata: { semantic: { qualifiedName: 'src/a.ts:login' } } },
    ]);
    assert.deepEqual(selectFromIndex(index, 'src/a.ts:login'), { kind: 'exact', id: 'a' });
  });
});

describe('legacy alias', () => {
  it('maps legacy selector to ambiguous v2 candidates instead of first match', () => {
    const nodes = [
      attachLegacyAliases({ id: 'a', kind: 'function', name: 'login', filePath: 'src/a.ts', metadata: { semantic: { qualifiedName: 'src/a.ts:login' } } }, ['function:src/shared.ts:login']),
      attachLegacyAliases({ id: 'b', kind: 'function', name: 'login', filePath: 'src/b.ts', metadata: { semantic: { qualifiedName: 'src/b.ts:login' } } }, ['function:src/shared.ts:login']),
    ];
    const result = resolveLegacyAlias(nodes, 'function:src/shared.ts:login');
    assert.equal(result.kind, 'ambiguous');
    if (result.kind === 'ambiguous') assert.deepEqual(result.candidates, ['a', 'b']);
  });
});
