import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScope, resolveBinding, addBinding } from '../../../src/scope-analysis/scope-builder.js';

describe('Scope Builder', () => {
  it('should resolve bindings in current scope', () => {
    const scope = createScope('module', 'module');
    addBinding(scope, { name: 'x', nodeId: 'n1', kind: 'variable' });
    const binding = resolveBinding('x', scope);
    assert.equal(binding?.nodeId, 'n1');
  });

  it('should resolve bindings from parent scope', () => {
    const parent = createScope('module', 'module');
    addBinding(parent, { name: 'x', nodeId: 'n1', kind: 'variable' });
    const child = createScope('func', 'function', parent);
    const binding = resolveBinding('x', child);
    assert.equal(binding?.nodeId, 'n1');
  });

  it('should prefer inner scope over outer', () => {
    const parent = createScope('module', 'module');
    addBinding(parent, { name: 'x', nodeId: 'outer', kind: 'variable' });
    const child = createScope('func', 'function', parent);
    addBinding(child, { name: 'x', nodeId: 'inner', kind: 'variable' });
    const binding = resolveBinding('x', child);
    assert.equal(binding?.nodeId, 'inner');
  });

  it('should return null for unresolved bindings', () => {
    const scope = createScope('module', 'module');
    const binding = resolveBinding('nonexistent', scope);
    assert.equal(binding, null);
  });
});
