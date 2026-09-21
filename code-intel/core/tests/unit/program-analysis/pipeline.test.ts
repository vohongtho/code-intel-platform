import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Language } from '../../../src/shared/languages.js';
import { analyzeFunction } from '../../../src/program-analysis/pipeline.js';

function writeTempFile(contents: string, extension = '.ts'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-pipeline-test-'));
  const filePath = path.join(dir, `sample${extension}`);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

describe('analyzeFunction (pipeline orchestration)', () => {
  it('returns a full function summary for a supported language and a real source range', async () => {
    const filePath = writeTempFile(`
function foo(a, b) {
  var x;
  x = a;
  return x;
}
`);
    const result = await analyzeFunction({
      language: Language.TypeScript,
      filePath,
      startLine: 2,
      canonicalFunctionId: 'sym:v2:function:foo',
      parameterNames: ['a', 'b'],
      resolverVersion: 'evidence-based-v1',
    });
    assert.equal(result.capability, 'supported');
    assert.ok(result.summary);
    assert.equal(result.summary!.functionId, 'sym:v2:function:foo');
    const influenceA = result.summary!.parameterInfluence.find((p) => p.parameterName === 'a')!;
    assert.ok(influenceA.influencesReturnAtStatementIds.length > 0);
  });

  it('locates the body even when the declaration is wrapped (e.g. `export function ...`, body two levels below the landing point)', async () => {
    const filePath = writeTempFile(`export function computeTotal(price, quantity) {
  var total;
  total = price;
  callHelper(total);
  return total;
}
`);
    const result = await analyzeFunction({
      language: Language.TypeScript,
      filePath,
      startLine: 1,
      canonicalFunctionId: 'sym:v2:function:computeTotal',
      parameterNames: ['price', 'quantity'],
      resolverVersion: 'evidence-based-v1',
    });
    assert.equal(result.capability, 'supported');
    assert.ok(result.summary);
    assert.equal(result.summary!.calledCallees.some((c) => c.calleeText.startsWith('callHelper')), true);
  });

  it('returns unsupported for a language with no lowering table (HTML)', async () => {
    const filePath = writeTempFile('<html></html>', '.html');
    const result = await analyzeFunction({
      language: Language.HTML,
      filePath,
      startLine: 1,
      canonicalFunctionId: 'sym:v2:function:foo',
      resolverVersion: 'evidence-based-v1',
    });
    assert.equal(result.capability, 'unsupported');
    assert.ok(result.reason?.includes('no program-analysis lowering table'));
    assert.equal(result.summary, undefined);
  });

  it('returns unsupported (not throws) when the file does not exist', async () => {
    const result = await analyzeFunction({
      language: Language.TypeScript,
      filePath: '/nonexistent/path/does-not-exist.ts',
      startLine: 1,
      canonicalFunctionId: 'sym:v2:function:foo',
      resolverVersion: 'evidence-based-v1',
    });
    assert.equal(result.capability, 'unsupported');
    assert.ok(result.reason?.includes('could not read source file'));
  });

  it('returns unsupported (not throws) when the given line has no locatable function body', async () => {
    const filePath = writeTempFile('const x = 1;\n');
    const result = await analyzeFunction({
      language: Language.TypeScript,
      filePath,
      startLine: 1,
      canonicalFunctionId: 'sym:v2:function:foo',
      resolverVersion: 'evidence-based-v1',
    });
    assert.equal(result.capability, 'unsupported');
  });

  it('caches across repeated calls for the same function/body/fingerprint', async () => {
    const filePath = writeTempFile(`
function foo(a) {
  return a;
}
`);
    const request = {
      language: Language.TypeScript,
      filePath,
      startLine: 2,
      canonicalFunctionId: 'sym:v2:function:foo-cache-test',
      parameterNames: ['a'],
      resolverVersion: 'evidence-based-v1',
    };
    const first = await analyzeFunction(request);
    const second = await analyzeFunction(request);
    assert.deepEqual(first, second);
  });

  it('never throws even for a genuinely malformed request', async () => {
    await assert.doesNotReject(() =>
      analyzeFunction({
        language: Language.TypeScript,
        filePath: '',
        startLine: -5,
        canonicalFunctionId: '',
        resolverVersion: '',
      }),
    );
  });
});
