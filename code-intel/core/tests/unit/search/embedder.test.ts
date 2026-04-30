import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildText } from '../../../src/search/embedder.js';

describe('buildText (Epic 2.1 — Richer Embeddings)', () => {
  it('uses summary when metadata.summary is present', () => {
    const node = {
      id: 'n1',
      kind: 'function',
      name: 'authenticate',
      filePath: 'src/auth.ts',
      content: 'function authenticate() { /* long code */ }',
      metadata: {
        summary: 'Authenticates a user by verifying the provided credentials.',
      },
    };
    const { text, embeddingSource } = buildText(node);
    assert.ok(text.includes('[function]'), 'should include kind in brackets');
    assert.ok(text.includes('authenticate'), 'should include name');
    assert.ok(text.includes('Authenticates a user'), 'should include summary');
    assert.equal(embeddingSource, 'summary');
  });

  it('includes signature in summary-based text when signature is present', () => {
    const node = {
      id: 'n2',
      kind: 'function',
      name: 'parseToken',
      filePath: 'src/jwt.ts',
      content: null,
      metadata: {
        signature: '(token: string): Payload',
        summary: 'Parses a JWT token and returns the payload.',
      },
    };
    const { text, embeddingSource } = buildText(node);
    assert.ok(text.includes('(token: string): Payload'), 'should include signature');
    assert.ok(text.includes('Parses a JWT token'), 'should include summary');
    assert.equal(embeddingSource, 'summary');
  });

  it('falls back to code-based text when no summary is present', () => {
    const node = {
      id: 'n3',
      kind: 'class',
      name: 'UserService',
      filePath: 'src/user.ts',
      content: 'class UserService { constructor() {} }',
      metadata: {},
    };
    const { text, embeddingSource } = buildText(node);
    assert.ok(text.includes('UserService'), 'should include name');
    assert.ok(text.includes('src/user.ts'), 'should include filePath in code-based text');
    assert.ok(!text.startsWith('[class]'), 'should NOT use bracket format when no summary');
    assert.equal(embeddingSource, 'code');
  });

  it('falls back to code-based text when metadata is null', () => {
    const node = {
      id: 'n4',
      kind: 'interface',
      name: 'ILogger',
      filePath: 'src/logger.ts',
      content: 'interface ILogger { log(msg: string): void; }',
      metadata: null,
    };
    const { text, embeddingSource } = buildText(node);
    assert.ok(text.includes('ILogger'), 'should include name');
    assert.equal(embeddingSource, 'code');
  });

  it('falls back to code-based text when metadata.summary is undefined', () => {
    const node = {
      id: 'n5',
      kind: 'method',
      name: 'save',
      filePath: 'src/repo.ts',
      content: 'save(entity: Entity) { db.save(entity); }',
      metadata: { signature: '(entity: Entity): Promise<void>' },
    };
    const { text, embeddingSource } = buildText(node);
    assert.ok(text.includes('(entity: Entity): Promise<void>'), 'should include signature in code-based text');
    assert.equal(embeddingSource, 'code');
  });

  it('caps summary-based text at 512 chars', () => {
    const node = {
      id: 'n6',
      kind: 'function',
      name: 'complexFunc',
      filePath: 'src/complex.ts',
      content: null,
      metadata: {
        summary: 'A'.repeat(600),
      },
    };
    const { text } = buildText(node);
    assert.ok(text.length <= 512, `text length ${text.length} should be <= 512`);
  });

  it('embeddingSource is "summary" when summary exists', () => {
    const node = {
      id: 'n7',
      kind: 'function',
      name: 'withSummary',
      filePath: 'a.ts',
      content: null,
      metadata: { summary: 'Does something useful.' },
    };
    const { embeddingSource } = buildText(node);
    assert.equal(embeddingSource, 'summary');
  });

  it('embeddingSource is "code" when no summary exists', () => {
    const node = {
      id: 'n8',
      kind: 'function',
      name: 'withoutSummary',
      filePath: 'b.ts',
      content: 'function withoutSummary() {}',
      metadata: {},
    };
    const { embeddingSource } = buildText(node);
    assert.equal(embeddingSource, 'code');
  });
});
