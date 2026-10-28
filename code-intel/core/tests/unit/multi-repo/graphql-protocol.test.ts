import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { buildSymbolSpanIndex } from '../../../src/multi-repo/symbol-spans.js';
import { buildGraphQLSchemaModel, findGraphQLType, graphqlTypeFingerprint, parseGraphQLDocument } from '../../../src/multi-repo/schema-parsers/graphql-model.js';
import { parseGraphQLContracts } from '../../../src/multi-repo/schema-parsers/graphql-parser.js';
import { attributeImportedOperations, extractDocumentOperations, extractSourceOperations } from '../../../src/semantic/protocol-contracts/graphql-operations.js';
import { mapOperations, mapOperationToSchema } from '../../../src/semantic/protocol-contracts/graphql-matcher.js';
import { GRAPHQL_LIMITS, printTypeRef } from '../../../src/semantic/protocol-contracts/graphql-types.js';

const SCHEMA = `
schema { query: RootQuery mutation: Mutation }
"""A user"""
interface Node { id: ID! }
type User implements Node {
  id: ID!
  name: String
  email: String! @auth(requires: ADMIN)
  posts(first: Int = 10, after: String): [Post!]!
  legacy: String @deprecated(reason: "no")
}
type Post implements Node { id: ID! title: String! }
union SearchResult = User | Post
enum Role { ADMIN USER GUEST }
input CreateUserInput { name: String! role: Role = USER tags: [String!] }
scalar DateTime @specifiedBy(url: "https://example.com/datetime")
type RootQuery {
  user(id: ID!): User
  search(term: String!, roles: [Role!]): [SearchResult!]!
}
type Mutation { createUser(input: CreateUserInput!): User! }
extend type User { createdAt: DateTime }
`;

function schema(service = 'users-api', source = SCHEMA) {
  return buildGraphQLSchemaModel([{ filePath: 'schema.graphql', source }], service);
}

describe('GraphQL schema model', () => {
  it('models kinds, wrappers, args/defaults, enums, possible types, root types and anchors', () => {
    const model = schema();
    assert.equal(model.coverage.complete, true, model.coverage.boundaryReasons.join());
    assert.deepEqual(model.rootTypes, { query: 'RootQuery', mutation: 'Mutation' });
    assert.deepEqual(model.types.map((type) => `${type.name}:${type.kind}`), [
      'CreateUserInput:input', 'DateTime:scalar', 'Mutation:object', 'Node:interface', 'Post:object', 'Role:enum', 'RootQuery:object', 'SearchResult:union', 'User:object',
    ]);
    const user = findGraphQLType(model, 'User')!;
    assert.deepEqual(user.interfaces, ['Node']);
    assert.ok(user.fields!.some((field) => field.name === 'createdAt'), 'extension merged into the definition');
    const posts = user.fields!.find((field) => field.name === 'posts')!;
    assert.equal(printTypeRef(posts.type), '[Post!]!');
    assert.deepEqual(posts.args.map((arg) => [arg.name, printTypeRef(arg.type), arg.defaultValue]), [['after', 'String', undefined], ['first', 'Int', '10']]);
    assert.deepEqual(user.fields!.find((field) => field.name === 'email')!.directives, ['@auth(requires: ADMIN)']);
    assert.equal(user.fields!.find((field) => field.name === 'legacy')!.deprecated, true);
    assert.deepEqual(findGraphQLType(model, 'Node')!.possibleTypes, ['Post', 'User']);
    assert.deepEqual(findGraphQLType(model, 'SearchResult')!.possibleTypes, ['Post', 'User']);
    assert.deepEqual(findGraphQLType(model, 'Role')!.enumValues!.map((value) => value.name), ['ADMIN', 'GUEST', 'USER']);
    assert.deepEqual(findGraphQLType(model, 'CreateUserInput')!.inputFields!.map((field) => [field.name, printTypeRef(field.type), field.defaultValue]), [
      ['name', 'String!', undefined], ['role', 'Role', 'USER'], ['tags', '[String!]', undefined],
    ]);
    assert.equal(user.anchor.filePath, 'schema.graphql');
    assert.ok(user.anchor.line > 0);
  });

  it('defaults root types to Query/Mutation/Subscription without a schema definition', () => {
    const model = schema('svc', 'type Query { a: Int } type Subscription { b: Int }');
    assert.deepEqual(model.rootTypes, { query: 'Query', subscription: 'Subscription' });
  });

  it('fingerprints are insensitive to declaration order, formatting and anchors', () => {
    const a = findGraphQLType(schema('s', 'type T {\n  a: Int\n  b(x: Int = 1, y: String): String\n}'), 'T')!;
    const b = findGraphQLType(schema('s', '\n\n# comment\ntype T { b(y: String, x: Int = 1): String a: Int }'), 'T')!;
    const c = findGraphQLType(schema('s', 'type T { a: Int! b(x: Int = 1, y: String): String }'), 'T')!;
    assert.equal(graphqlTypeFingerprint(a), graphqlTypeFingerprint(b));
    assert.notEqual(graphqlTypeFingerprint(a), graphqlTypeFingerprint(c));
  });

  it('malformed documents, oversized files, token floods and deep wrappers become explicit boundaries', () => {
    const malformed = buildGraphQLSchemaModel([{ filePath: 'bad.graphql', source: 'type User { id: }' }, { filePath: 'ok.graphql', source: 'type Query { a: Int }' }], 's');
    assert.equal(malformed.coverage.complete, false);
    assert.ok(malformed.coverage.boundaryReasons.includes('malformed-document:bad.graphql'));
    assert.deepEqual(malformed.types.map((type) => type.name), ['Query'], 'the valid document still contributes');

    const huge = parseGraphQLDocument(`type Q { a: Int }\n${' '.repeat(GRAPHQL_LIMITS.maxFileBytes)}`);
    assert.deepEqual(huge.ok ? 'ok' : huge.reason, 'file-size-limit');
    // ~3 tokens per 6 bytes: exceeds the token cap while staying under the size cap.
    const flood = parseGraphQLDocument(`type Q { ${'a:Int '.repeat(Math.ceil(GRAPHQL_LIMITS.maxTokens / 3) + 10)} }`);
    assert.deepEqual(flood.ok ? 'ok' : flood.reason, 'token-limit');

    const deep = buildGraphQLSchemaModel([{ filePath: 'deep.graphql', source: `type Q { a: ${'['.repeat(GRAPHQL_LIMITS.maxDepth + 2)}Int${']'.repeat(GRAPHQL_LIMITS.maxDepth + 2)} }` }], 's');
    assert.ok(deep.coverage.boundaryReasons.includes('depth-limit:deep.graphql'));
  });

  it('reports duplicate definitions and extensions without a definition', () => {
    const model = buildGraphQLSchemaModel([
      { filePath: 'a.graphql', source: 'type A { x: Int } extend type Ghost { y: Int }' },
      { filePath: 'b.graphql', source: 'type A { z: Int }' },
    ], 's');
    assert.deepEqual([...model.coverage.boundaryReasons], ['duplicate-type-definition', 'extension-without-definition']);
  });

  it('keeps the v1.0.11 parseGraphQLContracts output shape (migration adapter)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gql-adapter-'));
    try {
      fs.writeFileSync(path.join(dir, 'schema.graphql'), 'type Query { user(id: ID!): User users: [User] }\ntype User { id: ID! name: String }\nenum Role { A }');
      fs.writeFileSync(path.join(dir, 'broken.graphql'), 'type Legacy { a: Int\n b: \n}');
      const contracts = await parseGraphQLContracts(dir);
      const names = contracts.map((contract) => contract.name).sort();
      assert.deepEqual(names, ['query.user', 'query.users', 'type.Legacy', 'type.User']);
      assert.deepEqual(contracts.find((contract) => contract.name === 'type.User')!.fields, ['id', 'name']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GraphQL operations', () => {
  it('extracts named/anonymous operations with variables, aliases, fragments and selected paths', () => {
    const { operations, boundaries } = extractDocumentOperations('ops.graphql', `
      query GetUser($id: ID!, $first: Int = 5) {
        me: user(id: $id) { ...UserFields posts(first: $first) { title } }
      }
      fragment UserFields on User { id name }
      { search(term: "x", roles: [ADMIN, GUEST]) { ... on Post { title } __typename } }
    `);
    assert.deepEqual(boundaries, []);
    assert.equal(operations.length, 2);
    const [named, anonymous] = operations;
    assert.equal(named!.name, 'GetUser');
    assert.match(named!.operationId, /^graphql-op:query:GetUser:[0-9a-f]{16}$/);
    assert.deepEqual(named!.variables.map((variable) => [variable.name, printTypeRef(variable.type), variable.defaultValue]), [['id', 'ID!', undefined], ['first', 'Int', '5']]);
    assert.deepEqual(named!.selectedPaths, ['user', 'user.id', 'user.name', 'user.posts', 'user.posts.title']);
    assert.equal(named!.selections[0]!.alias, 'me');
    assert.equal(named!.coverage.complete, true);
    assert.equal(anonymous!.name, undefined);
    assert.match(anonymous!.operationId, /^graphql-op:query:anonymous:[0-9a-f]{16}$/, 'anonymous operations are identified by fingerprint, not a fabricated name');
    assert.deepEqual(anonymous!.selections[0]!.argumentEnumLiterals, [{ argument: 'roles', value: 'ADMIN' }, { argument: 'roles', value: 'GUEST' }]);
    assert.equal(anonymous!.selections[0]!.selections[0]!.typeCondition, 'Post');
  });

  it('operation fingerprints ignore formatting but not structure', () => {
    const a = extractDocumentOperations('a.graphql', 'query Q { user(id: 1) { id } }').operations[0]!;
    const b = extractDocumentOperations('b.graphql', 'query Q {\n  user(id: 1) {\n    id # comment\n  }\n}').operations[0]!;
    const c = extractDocumentOperations('c.graphql', 'query Q { user(id: 1) { id name } }').operations[0]!;
    assert.equal(a.operationId, b.operationId);
    assert.notEqual(a.operationId, c.operationId);
  });

  it('reports unresolved fragments and the selection limit as boundaries', () => {
    const unresolved = extractDocumentOperations('a.graphql', 'query Q { user(id: 1) { ...Missing } }').operations[0]!;
    assert.deepEqual(unresolved.coverage.boundaryReasons, ['unresolved-fragment:Missing']);
    const many = Array.from({ length: GRAPHQL_LIMITS.maxSelectionsPerOperation + 5 }, (_, i) => `f${i}`).join(' ');
    const capped = extractDocumentOperations('b.graphql', `query Q { ${many} }`).operations[0]!;
    assert.ok(capped.coverage.boundaryReasons.includes('selection-limit'));
    assert.equal(capped.selections.length, GRAPHQL_LIMITS.maxSelectionsPerOperation);
  });

  it('extracts gql tagged templates attributed to the using function and follows .graphql imports', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({ id: 'src/api.ts#loadUser', identityId: 'sym:loadUser', kind: 'function', name: 'loadUser', filePath: 'src/api.ts', startLine: 6, endLine: 9 });
    graph.addNode({ id: 'src/api.ts#loadPosts', identityId: 'sym:loadPosts', kind: 'function', name: 'loadPosts', filePath: 'src/api.ts', startLine: 10, endLine: 12 });
    const source = [
      "import { gql } from '@apollo/client';",
      "import PostsDoc from '../graphql/posts.graphql';",
      'const USER_QUERY = gql`',
      '  query LoadUser($id: ID!) { user(id: $id) { id ${frag} } }',
      '`;',
      'export function loadUser(id: string) {',
      '  return client.query({ query: USER_QUERY, variables: { id } });',
      '}',
      '',
      'export function loadPosts() {',
      '  return client.query({ query: PostsDoc });',
      '}',
    ].join('\n');
    const extracted = extractSourceOperations('src/api.ts', source, buildSymbolSpanIndex(graph));
    assert.equal(extracted.operations.length, 1);
    assert.equal(extracted.operations[0]!.symbolId, 'sym:loadUser');
    assert.equal(extracted.operations[0]!.line, 4);
    assert.deepEqual(extracted.operations[0]!.coverage.boundaryReasons, ['template-interpolation']);
    assert.deepEqual(extracted.documentImports.map((use) => [use.documentPath, use.symbolId]), [['graphql/posts.graphql', 'sym:loadPosts']]);

    const doc = extractDocumentOperations('graphql/posts.graphql', 'query Posts { search(term: "a") { __typename } }').operations;
    const attributed = attributeImportedOperations(doc, extracted.documentImports);
    assert.deepEqual(attributed.map((operation) => operation.symbolId), ['sym:loadPosts']);
  });
});

describe('GraphQL operation -> schema mapping', () => {
  const ops = extractDocumentOperations('ops.graphql', `
    query GetUser($id: ID!) { user(id: $id) { id name posts(first: 2) { title } } }
    query Search { search(term: "x", roles: [ADMIN]) { ... on User { email } ... on Post { title } } }
    mutation Create($input: CreateUserInput!) { createUser(input: $input) { id } }
    query Stale { user(id: 1) { id nickname } }
    query Elsewhere { orders { total } }
  `).operations;
  const byName = new Map(ops.map((operation) => [operation.name, operation]));

  it('maps selected fields to canonical field ids by type context', () => {
    const mapping = mapOperationToSchema(byName.get('GetUser')!, schema());
    assert.equal(mapping.certainty, 'exact');
    assert.deepEqual(mapping.fieldIds, [
      'graphql:users-api:Post.title', 'graphql:users-api:RootQuery.user', 'graphql:users-api:User.id', 'graphql:users-api:User.name', 'graphql:users-api:User.posts',
    ]);
    assert.deepEqual(mapping.argumentRefs, ['RootQuery.user(id)', 'User.posts(first)']);
  });

  it('follows inline fragment type conditions, enum literals and input variable types', () => {
    const search = mapOperationToSchema(byName.get('Search')!, schema());
    assert.ok(search.fieldIds.includes('graphql:users-api:User.email'));
    assert.ok(search.fieldIds.includes('graphql:users-api:Post.title'));
    assert.deepEqual(search.enumRefs, ['Role.ADMIN']);
    const create = mapOperationToSchema(byName.get('Create')!, schema());
    assert.deepEqual(create.inputTypes, ['CreateUserInput', 'Role'], 'builtin scalars are not schema types');
  });

  it('is candidate when only part of the selection exists, unresolved when none does', () => {
    const stale = mapOperationToSchema(byName.get('Stale')!, schema());
    assert.equal(stale.certainty, 'candidate');
    assert.deepEqual(stale.unresolvedPaths, ['user.nickname']);
    assert.equal(mapOperationToSchema(byName.get('Elsewhere')!, schema()).certainty, 'unresolved');
  });

  it('is exact only for a unique fully-validating schema; two equal schemas make it a candidate', () => {
    const single = mapOperations([byName.get('GetUser')!], [schema('users-api'), schema('orders-api', 'type Query { orders: [Int] }')]);
    assert.deepEqual(single.map((mapping) => [mapping.service, mapping.certainty]), [['users-api', 'exact']]);
    const ambiguous = mapOperations([byName.get('GetUser')!], [schema('users-a'), schema('users-b')]);
    assert.deepEqual(ambiguous.map((mapping) => [mapping.service, mapping.certainty]), [['users-a', 'candidate'], ['users-b', 'candidate']]);
    assert.ok(ambiguous[0]!.coverage.boundaryReasons.includes('ambiguous-schema-match'));
    assert.deepEqual(mapOperations([byName.get('Elsewhere')!], [schema()]), [], 'unresolved mappings are dropped');
  });
});
