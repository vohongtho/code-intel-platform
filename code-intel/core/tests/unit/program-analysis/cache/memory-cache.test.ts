import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryProgramAnalysisCache } from '../../../../src/program-analysis/cache/memory-cache.js';
import { getOrComputeArtifact } from '../../../../src/program-analysis/cache/get-or-compute.js';
import { PROGRAM_ANALYSIS_VERSION, type ProgramAnalysisFingerprint } from '../../../../src/program-analysis/contracts.js';
import type { FunctionIr } from '../../../../src/program-analysis/ir/contracts.js';
import { Language } from '../../../../src/shared/languages.js';

const FINGERPRINT: ProgramAnalysisFingerprint = {
  programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
  languageLoweringVersion: 'typescript-lowering-v1',
  resolverVersion: 'evidence-based-v1',
};

function validIr(): FunctionIr {
  return {
    version: 'ir-v1',
    functionId: 'sym:v2:function:test',
    language: Language.TypeScript,
    entryStatementId: null,
    statements: {},
    expressions: {},
    order: [],
    truncated: false,
  };
}

describe('MemoryProgramAnalysisCache', () => {
  it('misses on an unknown key and hits after a set', () => {
    const cache = new MemoryProgramAnalysisCache();
    assert.equal(cache.get('missing'), undefined);
    cache.set('id-1', 'taint-findings', { functionId: 'f', findings: [], truncated: false, version: 'taint-v1' });
    const hit = cache.get<{ findings: unknown[] }>('id-1');
    assert.ok(hit);
    assert.deepEqual(hit!.findings, []);
    const stats = cache.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
  });

  it('treats a structurally invalid stored ir/cfg artifact as a miss on read-back and evicts it', () => {
    const cache = new MemoryProgramAnalysisCache();
    const corruptIr = { ...validIr(), entryStatementId: 'ghost-statement' }; // references a statement that doesn't exist
    cache.set('ir-1', 'ir', corruptIr);
    assert.equal(cache.has('ir-1'), true);
    assert.equal(cache.get('ir-1'), undefined);
    assert.equal(cache.has('ir-1'), false);
    assert.equal(cache.stats().invalidReadBacks, 1);
  });

  it('serves a structurally valid ir artifact normally', () => {
    const cache = new MemoryProgramAnalysisCache();
    cache.set('ir-1', 'ir', validIr());
    const hit = cache.get<FunctionIr>('ir-1');
    assert.ok(hit);
    assert.equal(hit!.functionId, 'sym:v2:function:test');
  });

  it('evicts the least-recently-used entry once maxEntries is exceeded', () => {
    const cache = new MemoryProgramAnalysisCache({ maxEntries: 2 });
    cache.set('a', 'taint-findings', { n: 1, truncated: false });
    cache.set('b', 'taint-findings', { n: 2, truncated: false });
    cache.get('a'); // bump 'a' more recently than 'b'
    cache.set('c', 'taint-findings', { n: 3, truncated: false }); // should evict 'b', the LRU entry
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('c'), true);
    assert.equal(cache.stats().evictions, 1);
  });

  it('evicts entries once the total-byte budget is exceeded', () => {
    const cache = new MemoryProgramAnalysisCache({ maxEntries: 100, maxTotalBytes: 50 });
    cache.set('a', 'taint-findings', { text: 'x'.repeat(40), truncated: false });
    cache.set('b', 'taint-findings', { text: 'y'.repeat(40), truncated: false });
    assert.equal(cache.has('a'), false);
    assert.equal(cache.has('b'), true);
  });

  it('clear() empties the cache', () => {
    const cache = new MemoryProgramAnalysisCache();
    cache.set('a', 'taint-findings', { n: 1, truncated: false });
    cache.clear();
    assert.equal(cache.has('a'), false);
    assert.equal(cache.stats().size, 0);
  });
});

describe('getOrComputeArtifact', () => {
  it('calls compute exactly once and serves the cache on the second call', () => {
    const cache = new MemoryProgramAnalysisCache();
    let computeCalls = 0;
    const key = { kind: 'function-summary' as const, canonicalFunctionId: 'sym:v2:function:test', bodyHash: 'hash-1', fingerprint: FINGERPRINT };
    const compute = () => {
      computeCalls += 1;
      return { functionId: key.canonicalFunctionId, computedAt: computeCalls, truncated: false };
    };
    const first = getOrComputeArtifact(cache, key, compute);
    const second = getOrComputeArtifact(cache, key, compute);
    assert.equal(computeCalls, 1);
    assert.deepEqual(first, second);
  });

  it('recomputes when the body hash changes (a different artifact id)', () => {
    const cache = new MemoryProgramAnalysisCache();
    let computeCalls = 0;
    const compute = () => {
      computeCalls += 1;
      return { computedAt: computeCalls, truncated: false };
    };
    getOrComputeArtifact(cache, { kind: 'function-summary', canonicalFunctionId: 'sym:v2:function:test', bodyHash: 'hash-1', fingerprint: FINGERPRINT }, compute);
    getOrComputeArtifact(cache, { kind: 'function-summary', canonicalFunctionId: 'sym:v2:function:test', bodyHash: 'hash-2', fingerprint: FINGERPRINT }, compute);
    assert.equal(computeCalls, 2);
  });

  it('recomputes when the fingerprint changes (e.g. a stale semantic graph) rather than serving a false hit', () => {
    const cache = new MemoryProgramAnalysisCache();
    let computeCalls = 0;
    const compute = () => {
      computeCalls += 1;
      return { computedAt: computeCalls, truncated: false };
    };
    const key1 = { kind: 'function-summary' as const, canonicalFunctionId: 'sym:v2:function:test', bodyHash: 'hash-1', fingerprint: FINGERPRINT };
    const key2 = { ...key1, fingerprint: { ...FINGERPRINT, semanticGraphFingerprint: 'graph-v2' } };
    getOrComputeArtifact(cache, key1, compute);
    getOrComputeArtifact(cache, key2, compute);
    assert.equal(computeCalls, 2);
  });
});
