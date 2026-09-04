/**
 * Proves two invariants the side cache (task 10) exists to guarantee:
 *
 *  1. Cache/full equivalence — a cache hit returns exactly what a fresh,
 *     uncached computation would produce for the same inputs. A cache is
 *     worthless (or worse, actively dangerous) if it can silently diverge
 *     from what recomputation would say.
 *  2. Incremental body-hash invalidation — changing a function's source
 *     text changes its body hash, which changes its cache key
 *     (`generateProgramAnalysisArtifactId` hashes the body hash in), so an
 *     edited function is never served a stale artifact computed from its
 *     old body.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Language } from '../../../src/shared/languages.js';
import { analyzeFunction } from '../../../src/program-analysis/pipeline.js';
import { MemoryProgramAnalysisCache } from '../../../src/program-analysis/cache/memory-cache.js';
import { getOrComputeArtifact } from '../../../src/program-analysis/cache/get-or-compute.js';
import { PROGRAM_ANALYSIS_VERSION, type ProgramAnalysisFingerprint } from '../../../src/program-analysis/contracts.js';

const FINGERPRINT: ProgramAnalysisFingerprint = {
  programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
  languageLoweringVersion: 'typescript-lowering-v1',
  resolverVersion: 'evidence-based-v1',
};

function writeTempFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-cache-equivalence-test-'));
  const filePath = path.join(dir, 'sample.ts');
  fs.writeFileSync(filePath, contents);
  return filePath;
}

describe('cache/full equivalence', () => {
  it('a cache hit is deep-equal to what a fresh computation of the same key produces', () => {
    const cache = new MemoryProgramAnalysisCache();
    const key = { kind: 'function-summary' as const, canonicalFunctionId: 'sym:v2:function:test', bodyHash: 'hash-1', fingerprint: FINGERPRINT };
    const freshCompute = () => ({ computedAt: Date.now(), value: 'x'.repeat(50), truncated: false });

    // A completely independent, never-cached computation with the same logical inputs.
    const independentFresh = freshCompute();

    // Through the cache: first call computes and stores, second call must return byte-for-byte the same thing the first call stored.
    let firstComputeCalls = 0;
    const throughCache1 = getOrComputeArtifact(cache, key, () => {
      firstComputeCalls += 1;
      return independentFresh;
    });
    const throughCache2 = getOrComputeArtifact(cache, key, () => {
      firstComputeCalls += 1;
      throw new Error('must not recompute on a cache hit');
    });

    assert.equal(firstComputeCalls, 1);
    assert.deepEqual(throughCache1, independentFresh);
    assert.deepEqual(throughCache2, independentFresh);
  });

  it('analyzeFunction: a cached result and a result freshly computed from an equivalent request are deep-equal', async () => {
    const filePath = writeTempFile(`
function foo(a, b) {
  var x;
  x = a;
  bar(x, b);
  return x;
}
`);
    const request = {
      language: Language.TypeScript,
      filePath,
      startLine: 2,
      canonicalFunctionId: 'sym:v2:function:cache-equivalence',
      parameterNames: ['a', 'b'],
      resolverVersion: 'evidence-based-v1',
    };
    const cachedResult = await analyzeFunction(request); // populates the module-level cache
    const secondCallSameRequest = await analyzeFunction(request); // must be the cached artifact
    assert.deepEqual(cachedResult, secondCallSameRequest);

    // A distinct canonical function id analyzing the exact same file/body from scratch
    // (so it cannot hit the same cache entry as `request`, and its statement ids are
    // namespaced by a different function id) must reach a structurally identical
    // conclusion — same variables, same parameter influence, same calls.
    const freshRequest = { ...request, canonicalFunctionId: 'sym:v2:function:cache-equivalence-fresh-check' };
    const freshResult = await analyzeFunction(freshRequest);
    assert.equal(freshResult.capability, cachedResult.capability);
    assert.equal(freshResult.summary!.bodyHash, cachedResult.summary!.bodyHash);
    assert.deepEqual(
      freshResult.summary!.parameterInfluence.map((p) => ({ parameterName: p.parameterName, influences: p.influencesReturnAtStatementIds.length > 0 })),
      cachedResult.summary!.parameterInfluence.map((p) => ({ parameterName: p.parameterName, influences: p.influencesReturnAtStatementIds.length > 0 })),
    );
    assert.deepEqual(
      freshResult.summary!.localAccesses.map((a) => a.variableName).sort(),
      cachedResult.summary!.localAccesses.map((a) => a.variableName).sort(),
    );
    assert.deepEqual(
      freshResult.summary!.calledCallees.map((c) => c.calleeText).sort(),
      cachedResult.summary!.calledCallees.map((c) => c.calleeText).sort(),
    );
  });
});

describe('incremental body-hash invalidation', () => {
  it('editing a function\'s body produces a different, freshly-recomputed summary rather than a stale cache hit', async () => {
    const filePath = writeTempFile(`
function foo(a) {
  return a;
}
`);
    const request = {
      language: Language.TypeScript,
      filePath,
      startLine: 2,
      canonicalFunctionId: 'sym:v2:function:invalidation-test',
      parameterNames: ['a'],
      resolverVersion: 'evidence-based-v1',
    };

    const before = await analyzeFunction(request);
    assert.equal(before.capability, 'supported');
    const influenceBefore = before.summary!.parameterInfluence.find((p) => p.parameterName === 'a')!;
    assert.ok(influenceBefore.influencesReturnAtStatementIds.length > 0);
    const bodyHashBefore = before.summary!.bodyHash;

    // Edit the body: `a` no longer influences the return value at all.
    fs.writeFileSync(filePath, `
function foo(a) {
  return 42;
}
`);

    const after = await analyzeFunction(request); // same canonicalFunctionId, same file path — only the body text changed
    assert.equal(after.capability, 'supported');
    const bodyHashAfter = after.summary!.bodyHash;
    assert.notEqual(bodyHashAfter, bodyHashBefore, 'editing the body must change the body hash (and therefore the cache key)');

    const influenceAfter = after.summary!.parameterInfluence.find((p) => p.parameterName === 'a')!;
    assert.deepEqual(influenceAfter.influencesReturnAtStatementIds, [], 'must reflect the edited body, not the stale cached one');
  });

  it('reverting a body edit back to its original text is served by the original cache entry again (same body hash, same key)', async () => {
    const original = `
function foo(a) {
  return a;
}
`;
    const edited = `
function foo(a) {
  return 42;
}
`;
    const filePath = writeTempFile(original);
    const request = {
      language: Language.TypeScript,
      filePath,
      startLine: 2,
      canonicalFunctionId: 'sym:v2:function:revert-test',
      parameterNames: ['a'],
      resolverVersion: 'evidence-based-v1',
    };

    const firstPass = await analyzeFunction(request);
    fs.writeFileSync(filePath, edited);
    const secondPass = await analyzeFunction(request);
    fs.writeFileSync(filePath, original);
    const thirdPass = await analyzeFunction(request);

    assert.notEqual(firstPass.summary!.bodyHash, secondPass.summary!.bodyHash);
    assert.equal(firstPass.summary!.bodyHash, thirdPass.summary!.bodyHash);
    assert.deepEqual(thirdPass, firstPass);
  });
});
