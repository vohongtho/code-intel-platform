import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGQL,
  isGQLParseError,
  type FindStatement,
  type TraverseStatement,
  type PathStatement,
  type CountStatement,
} from '../../../src/query/gql-parser.js';

describe('GQL Parser — FIND statements', () => {
  it('parses FIND with kind', () => {
    const ast = parseGQL('FIND function');
    assert.ok(!isGQLParseError(ast), `Should not be parse error: ${JSON.stringify(ast)}`);
    assert.equal(ast.type, 'FIND');
    assert.equal((ast as FindStatement).target, 'function');
  });

  it('parses FIND * (wildcard)', () => {
    const ast = parseGQL('FIND *');
    assert.ok(!isGQLParseError(ast));
    assert.equal((ast as FindStatement).target, '*');
  });

  it('parses FIND with WHERE CONTAINS', () => {
    const ast = parseGQL('FIND function WHERE name CONTAINS "auth"');
    assert.ok(!isGQLParseError(ast));
    const find = ast as FindStatement;
    assert.equal(find.target, 'function');
    assert.ok(find.where);
    assert.equal(find.where.exprs.length, 1);
    assert.equal(find.where.exprs[0].property, 'name');
    assert.equal(find.where.exprs[0].operator, 'CONTAINS');
    assert.equal(find.where.exprs[0].value, 'auth');
  });

  it('parses FIND with WHERE = operator', () => {
    const ast = parseGQL('FIND class WHERE name = "UserService"');
    assert.ok(!isGQLParseError(ast));
    const find = ast as FindStatement;
    assert.equal(find.where?.exprs[0].operator, '=');
    assert.equal(find.where?.exprs[0].value, 'UserService');
  });

  it('parses FIND with WHERE != operator', () => {
    const ast = parseGQL('FIND function WHERE exported != "false"');
    assert.ok(!isGQLParseError(ast));
    const find = ast as FindStatement;
    assert.equal(find.where?.exprs[0].operator, '!=');
  });

  it('parses FIND with WHERE STARTS_WITH', () => {
    const ast = parseGQL('FIND function WHERE name STARTS_WITH "handle"');
    assert.ok(!isGQLParseError(ast));
    const find = ast as FindStatement;
    assert.equal(find.where?.exprs[0].operator, 'STARTS_WITH');
    assert.equal(find.where?.exprs[0].value, 'handle');
  });

  it('parses FIND with WHERE IN list', () => {
    const ast = parseGQL('FIND * WHERE kind IN [function, method]');
    assert.ok(!isGQLParseError(ast), `Should not be parse error: ${JSON.stringify(ast)}`);
    const find = ast as FindStatement;
    assert.equal(find.where?.exprs[0].operator, 'IN');
    assert.deepEqual(find.where?.exprs[0].value, ['function', 'method']);
  });

  it('parses FIND with LIMIT', () => {
    const ast = parseGQL('FIND function LIMIT 50');
    assert.ok(!isGQLParseError(ast));
    assert.equal((ast as FindStatement).limit, 50);
  });

  it('parses FIND with WHERE and LIMIT', () => {
    const ast = parseGQL('FIND * WHERE kind IN [function, method] LIMIT 50');
    assert.ok(!isGQLParseError(ast), `Should not be parse error: ${JSON.stringify(ast)}`);
    const find = ast as FindStatement;
    assert.equal(find.limit, 50);
    assert.equal(find.where?.exprs[0].operator, 'IN');
  });

  it('parses FIND with LIMIT and OFFSET', () => {
    const ast = parseGQL('FIND function LIMIT 10 OFFSET 20');
    assert.ok(!isGQLParseError(ast));
    const find = ast as FindStatement;
    assert.equal(find.limit, 10);
    assert.equal(find.offset, 20);
  });

  it('parses FIND with multiple AND conditions', () => {
    const ast = parseGQL('FIND function WHERE name CONTAINS "auth" AND exported = "true"');
    assert.ok(!isGQLParseError(ast));
    const find = ast as FindStatement;
    assert.equal(find.where?.exprs.length, 2);
    assert.equal(find.where?.exprs[0].operator, 'CONTAINS');
    assert.equal(find.where?.exprs[1].operator, '=');
  });

  it('parses class kind', () => {
    const ast = parseGQL('FIND class WHERE name CONTAINS "Service"');
    assert.ok(!isGQLParseError(ast));
    assert.equal((ast as FindStatement).target, 'class');
  });

  it('parses FIND with single quotes', () => {
    const ast = parseGQL("FIND function WHERE name CONTAINS 'auth'");
    assert.ok(!isGQLParseError(ast));
    assert.equal((ast as FindStatement).where?.exprs[0].value, 'auth');
  });

  it('parses FIND with filePath property', () => {
    const ast = parseGQL('FIND function WHERE filePath CONTAINS "auth"');
    assert.ok(!isGQLParseError(ast));
    const find = ast as FindStatement;
    assert.equal(find.where?.exprs[0].property, 'filepath');
  });
});

describe('GQL Parser — TRAVERSE statements', () => {
  it('parses TRAVERSE CALLS FROM', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "handleLogin"');
    assert.ok(!isGQLParseError(ast), `Should not be parse error: ${JSON.stringify(ast)}`);
    assert.equal(ast.type, 'TRAVERSE');
    const trav = ast as TraverseStatement;
    assert.equal(trav.edgeKind, 'calls');
    assert.equal(trav.from, 'handleLogin');
  });

  it('parses TRAVERSE with DEPTH', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "handleLogin" DEPTH 3');
    assert.ok(!isGQLParseError(ast));
    const trav = ast as TraverseStatement;
    assert.equal(trav.depth, 3);
  });

  it('parses TRAVERSE IMPORTS', () => {
    const ast = parseGQL('TRAVERSE IMPORTS FROM "index"');
    assert.ok(!isGQLParseError(ast));
    assert.equal((ast as TraverseStatement).edgeKind, 'imports');
  });

  it('parses TRAVERSE without DEPTH uses default', () => {
    const ast = parseGQL('TRAVERSE CALLS FROM "main"');
    assert.ok(!isGQLParseError(ast));
    assert.equal((ast as TraverseStatement).depth, undefined);
  });
});

describe('GQL Parser — PATH statements', () => {
  it('parses PATH FROM ... TO ...', () => {
    const ast = parseGQL('PATH FROM "createUser" TO "sendEmail"');
    assert.ok(!isGQLParseError(ast), `Should not be parse error: ${JSON.stringify(ast)}`);
    assert.equal(ast.type, 'PATH');
    const pathStmt = ast as PathStatement;
    assert.equal(pathStmt.from, 'createUser');
    assert.equal(pathStmt.to, 'sendEmail');
  });

  it('parses PATH with identifier values', () => {
    const ast = parseGQL('PATH FROM createUser TO sendEmail');
    assert.ok(!isGQLParseError(ast));
    const pathStmt = ast as PathStatement;
    assert.equal(pathStmt.from, 'createUser');
    assert.equal(pathStmt.to, 'sendEmail');
  });
});

describe('GQL Parser — COUNT statements', () => {
  it('parses COUNT function GROUP BY cluster', () => {
    const ast = parseGQL('COUNT function GROUP BY cluster');
    assert.ok(!isGQLParseError(ast), `Should not be parse error: ${JSON.stringify(ast)}`);
    assert.equal(ast.type, 'COUNT');
    const count = ast as CountStatement;
    assert.equal(count.target, 'function');
    assert.equal(count.groupBy, 'cluster');
  });

  it('parses COUNT * GROUP BY kind', () => {
    const ast = parseGQL('COUNT * GROUP BY kind');
    assert.ok(!isGQLParseError(ast));
    const count = ast as CountStatement;
    assert.equal(count.target, '*');
    assert.equal(count.groupBy, 'kind');
  });

  it('parses COUNT without GROUP BY', () => {
    const ast = parseGQL('COUNT function');
    assert.ok(!isGQLParseError(ast));
    const count = ast as CountStatement;
    assert.equal(count.target, 'function');
    assert.equal(count.groupBy, undefined);
  });

  it('parses COUNT with WHERE clause', () => {
    const ast = parseGQL('COUNT function WHERE exported = "true" GROUP BY cluster');
    assert.ok(!isGQLParseError(ast));
    const count = ast as CountStatement;
    assert.ok(count.where);
    assert.equal(count.groupBy, 'cluster');
  });
});

describe('GQL Parser — parse errors', () => {
  it('returns error for empty input', () => {
    const ast = parseGQL('');
    assert.ok(isGQLParseError(ast));
  });

  it('returns error for unknown statement type', () => {
    const ast = parseGQL('SELECT * FROM nodes');
    assert.ok(isGQLParseError(ast));
  });

  it('error has position info', () => {
    const ast = parseGQL('FIND');
    // FIND without a kind — should fail since next token is EOF
    assert.ok(isGQLParseError(ast));
    assert.ok(typeof ast.pos === 'number');
  });

  it('error for unterminated string', () => {
    const ast = parseGQL('FIND function WHERE name CONTAINS "unterminated');
    assert.ok(isGQLParseError(ast));
    assert.ok(ast.message.includes('Unterminated'));
  });

  it('error for missing TO in PATH', () => {
    const ast = parseGQL('PATH FROM "createUser"');
    assert.ok(isGQLParseError(ast));
  });

  it('error for missing FROM in TRAVERSE', () => {
    const ast = parseGQL('TRAVERSE CALLS');
    assert.ok(isGQLParseError(ast));
  });

  it('error for unexpected token at end', () => {
    const ast = parseGQL('FIND function LIMIT 10 EXTRA');
    assert.ok(isGQLParseError(ast));
  });
});

describe('GQL Parser — extended valid queries', () => {
  const validQueries = [
    'FIND function WHERE name CONTAINS "auth"',
    'FIND * WHERE kind IN [function, method] LIMIT 50',
    'TRAVERSE CALLS FROM "handleLogin" DEPTH 3',
    'PATH FROM "createUser" TO "sendEmail"',
    'COUNT function GROUP BY cluster',
    'FIND class',
    'FIND *',
    'FIND method WHERE exported = "true"',
    'FIND interface WHERE name STARTS_WITH "I"',
    'COUNT * GROUP BY kind',
    'COUNT class',
    'FIND function LIMIT 100',
    'FIND function LIMIT 10 OFFSET 20',
    'TRAVERSE IMPORTS FROM "index"',
    'FIND function WHERE name CONTAINS "get" AND exported = "true"',
    'FIND * WHERE kind IN [class, interface]',
    'COUNT function WHERE name CONTAINS "auth" GROUP BY cluster',
  ];

  for (const q of validQueries) {
    it(`parses: ${q}`, () => {
      const ast = parseGQL(q);
      assert.ok(
        !isGQLParseError(ast),
        `Expected successful parse of "${q}" but got error: ${isGQLParseError(ast) ? (ast as import('../../../src/query/gql-parser.js').GQLParseError).message : ''}`
      );
    });
  }
});
