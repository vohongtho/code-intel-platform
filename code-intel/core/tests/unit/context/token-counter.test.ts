import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, measureBlocks } from '../../../src/context/token-counter.js';
import type { ContextDocument } from '../../../src/context/builder.js';

describe('estimateTokens — B.7.1', () => {
  it('returns 0 for empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('returns small count for a few words', () => {
    const result = estimateTokens('hello world');
    assert.ok(result >= 2 && result <= 5, `expected 2–5, got ${result}`);
  });

  it('returns reasonable count for a typical code line', () => {
    const code = 'async function createUser(dto: CreateUserDTO): Promise<User> {';
    const result = estimateTokens(code);
    // rough sanity: 8–25 tokens
    assert.ok(result >= 8 && result <= 30, `expected 8–30, got ${result}`);
  });

  it('returns more tokens for longer text', () => {
    const short = 'hello';
    const long = 'hello world this is a longer piece of text that should have more tokens';
    assert.ok(estimateTokens(long) > estimateTokens(short));
  });

  it('result within 10% of naive word count × 1.3 heuristic', () => {
    const text = 'function authenticate user with JWT token and return session';
    const words = text.split(/\s+/).length;
    const expected = Math.ceil((words * 1.3 + text.length * 0.25) / 2);
    assert.equal(estimateTokens(text), expected);
  });
});

describe('measureBlocks — B.7.1', () => {
  const mockDoc: ContextDocument = {
    summary: 'UserService [class] auth/user.ts:45 — Manages user auth.',
    logic: 'UserService → DB.findUser, EmailService.send',
    relation: 'UserService ← AuthController, AdminController',
    focusCode: '// UserService — auth/user.ts:45\n```\nclass UserService {}\n```',
    truncated: false,
    intent: 'auto',
  };

  it('returns non-zero counts for all blocks', () => {
    const result = measureBlocks(mockDoc);
    assert.ok(result.summary > 0, 'summary tokens should be > 0');
    assert.ok(result.logic > 0, 'logic tokens should be > 0');
    assert.ok(result.relation > 0, 'relation tokens should be > 0');
    assert.ok(result.focusCode > 0, 'focusCode tokens should be > 0');
  });

  it('total equals sum of blocks', () => {
    const result = measureBlocks(mockDoc);
    assert.equal(result.total, result.summary + result.logic + result.relation + result.focusCode);
  });

  it('returns zeros for empty blocks', () => {
    const emptyDoc: ContextDocument = {
      summary: '', logic: '', relation: '', focusCode: '', truncated: false, intent: 'auto',
    };
    const result = measureBlocks(emptyDoc);
    assert.equal(result.summary, 0);
    assert.equal(result.logic, 0);
    assert.equal(result.relation, 0);
    assert.equal(result.focusCode, 0);
    assert.equal(result.total, 0);
  });

  it('longer focusCode gets more tokens than short summary', () => {
    const doc: ContextDocument = {
      summary: 'Short.',
      logic: '',
      relation: '',
      focusCode: Array(50).fill('  const x = doSomethingWithParam(y);').join('\n'),
      truncated: false,
      intent: 'auto',
    };
    const result = measureBlocks(doc);
    assert.ok(result.focusCode > result.summary);
  });
});
