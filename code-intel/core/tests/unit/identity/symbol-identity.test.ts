import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Language } from '../../../src/shared/languages.js';
import { generateCallSiteId, generateDeclarationFragmentId } from '../../../src/identity/callsite-identity.js';
import { generateSymbolId } from '../../../src/identity/symbol-identity.js';

describe('symbol identity v2', () => {
  it('is deterministic across repeated runs', () => {
    const identity = {
      version: 2 as const,
      language: Language.TypeScript,
      kind: 'function' as const,
      filePath: 'src/auth.ts',
      qualifiedName: 'AuthService.login',
      lexicalOwner: 'AuthService',
      signatureDiscriminator: '(email:string,password:string):Promise<User>',
    };
    assert.equal(generateSymbolId(identity), generateSymbolId(identity));
  });

  it('survives body-only edits because body is excluded', () => {
    const before = generateSymbolId({
      version: 2 as const,
      language: Language.TypeScript,
      kind: 'function' as const,
      filePath: 'src/auth.ts',
      qualifiedName: 'login',
      signatureDiscriminator: '():void',
    });
    const after = generateSymbolId({
      version: 2 as const,
      language: Language.TypeScript,
      kind: 'function' as const,
      filePath: 'src/auth.ts',
      qualifiedName: 'login',
      signatureDiscriminator: '():void',
    });
    assert.equal(before, after);
  });

  it('changes when declaration identity changes', () => {
    const left = generateSymbolId({
      version: 2 as const,
      language: Language.TypeScript,
      kind: 'function' as const,
      filePath: 'src/auth.ts',
      qualifiedName: 'login',
      signatureDiscriminator: '():void',
    });
    const right = generateSymbolId({
      version: 2 as const,
      language: Language.TypeScript,
      kind: 'function' as const,
      filePath: 'src/auth.ts',
      qualifiedName: 'login',
      signatureDiscriminator: '(token:string):void',
    });
    assert.notEqual(left, right);
  });
});

describe('callsite identity v1', () => {
  it('distinguishes repeated call sites by range', () => {
    const left = generateCallSiteId({
      version: 1,
      filePath: 'src/a.ts',
      callerSymbolId: 'sym:v2:function:caller',
      calleeText: 'run',
      range: { filePath: 'src/a.ts', startLine: 10, startColumn: 2, endLine: 10, endColumn: 7 },
    });
    const right = generateCallSiteId({
      version: 1,
      filePath: 'src/a.ts',
      callerSymbolId: 'sym:v2:function:caller',
      calleeText: 'run',
      range: { filePath: 'src/a.ts', startLine: 12, startColumn: 2, endLine: 12, endColumn: 7 },
    });
    assert.notEqual(left, right);
  });

  it('creates deterministic fragment ids', () => {
    const fragment = {
      symbolId: 'sym:v2:function:abc',
      filePath: 'src/a.ts',
      range: { filePath: 'src/a.ts', startLine: 1, startColumn: 0, endLine: 2, endColumn: 1 },
      partial: false,
      hasBody: true,
      role: 'primary' as const,
    };
    assert.equal(generateDeclarationFragmentId(fragment), generateDeclarationFragmentId(fragment));
  });
});
