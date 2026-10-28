import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphQLSchemaModel } from '../../../src/multi-repo/schema-parsers/graphql-model.js';
import { graphqlContracts, graphqlConsumersForSchema, type ProtocolSnapshot, PROTOCOL_SNAPSHOT_VERSION } from '../../../src/multi-repo/protocol-contracts.js';
import { compareContractVersions } from '../../../src/multi-repo/contract-drift/comparator.js';
import { compareTypeRefs } from '../../../src/multi-repo/contract-drift/graphql-comparator.js';
import { extractDocumentOperations } from '../../../src/semantic/protocol-contracts/graphql-operations.js';
import type { Contract, ContractConsumerRef, GroupContractVersion } from '../../../src/multi-repo/types.js';

const MEMBER = { repoName: 'users-api', repoPath: '/repos/users', repositoryId: 'repo-users', snapshotId: 'snap' };

function snapshot(sdl: string, operations = ''): ProtocolSnapshot {
  return {
    version: PROTOCOL_SNAPSHOT_VERSION,
    graphql: {
      schema: buildGraphQLSchemaModel([{ filePath: 'schema.graphql', source: sdl }], 'users-api'),
      operations: operations ? extractDocumentOperations('client/ops.graphql', operations).operations : [],
      resolverBindings: [],
      boundaries: [],
    },
    grpc: { files: [], bindingSites: [], boundaries: [] },
  };
}

function version(contract: Contract): GroupContractVersion {
  return {
    contractId: contract.contractId!,
    kind: contract.kind,
    repositoryId: MEMBER.repositoryId,
    snapshotId: contract.snapshotId!,
    semanticFingerprint: contract.semanticFingerprint!,
    sourceCanonicalId: contract.sourceCanonicalId,
    role: 'producer',
    certainty: 'exact',
    coverage: { complete: true, examinedCount: 1, incompleteReasons: [] },
  };
}

/** Drift for one type between base and head SDL; consumers are `ops` mapped against the base schema. */
function drift(typeName: string, baseSdl: string, headSdl: string, ops = '') {
  const base = graphqlContracts(snapshot(baseSdl), MEMBER).find((contract) => contract.name === `type.${typeName}`);
  const head = graphqlContracts(snapshot(headSdl), MEMBER).find((contract) => contract.name === `type.${typeName}`);
  const contractIdByType = new Map(graphqlContracts(snapshot(baseSdl), MEMBER).map((contract) => [contract.name.slice(5), contract.contractId!] as const));
  const consumerSnapshot = snapshot(baseSdl, ops);
  const refs = graphqlConsumersForSchema(consumerSnapshot.graphql.schema!, contractIdByType, [{ repoId: 'repo-web', repoName: 'web', snapshot: consumerSnapshot }]);
  const contractId = (base ?? head)!.contractId!;
  return compareContractVersions({
    kind: 'graphql',
    baseContract: base,
    headContract: head,
    baseVersion: base ? version(base) : undefined,
    headVersion: head ? version(head) : undefined,
    affectedConsumers: refs.filter((ref) => ref.contractId === contractId).map((ref) => ref.ref),
  });
}

function summary(findings: ReturnType<typeof drift>) {
  return findings.map((finding) => [finding.changeKind, finding.compatibility, finding.affectedConsumers.length]);
}

const BASE = `
type Query { user(id: ID!): User users(limit: Int): [User!]! }
type User { id: ID! name: String email: String! }
`;

describe('GraphQL compatibility rules', () => {
  it('classifies wrapper changes structurally', () => {
    const named = (name: string) => ({ kind: 'named' as const, name });
    const nonNull = (ofType: Parameters<typeof compareTypeRefs>[0]) => ({ kind: 'non-null' as const, ofType });
    const list = (ofType: Parameters<typeof compareTypeRefs>[0]) => ({ kind: 'list' as const, ofType });
    assert.equal(compareTypeRefs(named('A'), nonNull(named('A'))), 'strengthened');
    assert.equal(compareTypeRefs(nonNull(named('A')), named('A')), 'weakened');
    assert.equal(compareTypeRefs(list(named('A')), named('A')), 'shape-changed');
    assert.equal(compareTypeRefs(named('A'), named('B')), 'named-type-changed');
    assert.equal(compareTypeRefs(nonNull(list(nonNull(named('A')))), nonNull(list(nonNull(named('A'))))), 'same');
  });

  it('selected field removed: breaking with the known operation listed', () => {
    const findings = drift('User', BASE, 'type Query { user(id: ID!): User } type User { id: ID! name: String }', 'query Q { user(id: 1) { id email } }');
    assert.deepEqual(summary(findings), [['graphql-field-removed', 'breaking', 1]]);
    assert.match(findings[0]!.affectedConsumers[0]!.sourceAnchor!, /^client\/ops\.graphql:1$/);
    assert.equal(findings[0]!.affectedConsumers[0]!.certainty, 'exact');
  });

  it('unselected field removed: schema-level potential break, no fabricated consumer', () => {
    const findings = drift('User', BASE, 'type Query { user(id: ID!): User } type User { id: ID! name: String }', 'query Q { user(id: 1) { id } }');
    assert.deepEqual(summary(findings), [['graphql-field-removed', 'potentially-breaking', 0]]);
  });

  it('nullable output field added: compatible and no affected consumer', () => {
    const findings = drift('User', BASE, `${BASE.replace('email: String!', 'email: String! nickname: String')}`, 'query Q { user(id: 1) { id } }');
    assert.deepEqual(summary(findings), [['graphql-field-added', 'compatible', 0]]);
  });

  it('required argument added without default: breaking for the operation calling the field', () => {
    const head = BASE.replace('user(id: ID!): User', 'user(id: ID!, tenant: String!): User');
    assert.deepEqual(summary(drift('Query', BASE, head, 'query Q { user(id: 1) { id } }')), [['graphql-required-argument-added', 'breaking', 1]]);
    const withDefault = BASE.replace('user(id: ID!): User', 'user(id: ID!, tenant: String! = "t"): User');
    assert.deepEqual(summary(drift('Query', BASE, withDefault, 'query Q { user(id: 1) { id } }')), [['graphql-optional-argument-added', 'compatible', 0]]);
  });

  it('argument removed or retyped: breaking for operations passing it, else potential', () => {
    const removed = BASE.replace('users(limit: Int)', 'users');
    assert.deepEqual(summary(drift('Query', BASE, removed, 'query Q { users(limit: 2) { id } }')), [['graphql-argument-removed', 'breaking', 1]]);
    assert.deepEqual(summary(drift('Query', BASE, removed, 'query Q { users { id } }')), [['graphql-argument-removed', 'potentially-breaking', 0]]);
    const retyped = BASE.replace('users(limit: Int)', 'users(limit: String)');
    assert.deepEqual(summary(drift('Query', BASE, retyped, 'query Q { users(limit: 2) { id } }')), [['graphql-input-type-changed', 'breaking', 1]]);
  });

  it('output nullability: strengthening is compatible, weakening potentially breaking, list shape breaking', () => {
    assert.deepEqual(summary(drift('User', BASE, BASE.replace('name: String', 'name: String!'), 'query Q { user(id: 1) { name } }')), [['graphql-field-became-non-null', 'compatible', 0]]);
    assert.deepEqual(summary(drift('User', BASE, BASE.replace('email: String!', 'email: String'), 'query Q { user(id: 1) { email } }')), [['graphql-field-became-nullable', 'potentially-breaking', 1]]);
    assert.deepEqual(summary(drift('User', BASE, BASE.replace('email: String!', 'email: [String!]'), 'query Q { user(id: 1) { email } }'))[0], ['graphql-field-type-changed', 'breaking', 1]);
  });

  it('input field newly required: breaking for operations sending the input type', () => {
    const base = 'type Query { a: Int } type Mutation { create(input: NewUser!): ID } input NewUser { name: String! email: String }';
    const head = base.replace('email: String', 'email: String!');
    const ops = 'mutation M($input: NewUser!) { create(input: $input) }';
    assert.deepEqual(summary(drift('NewUser', base, head, ops)), [['graphql-input-became-required', 'breaking', 1]]);
    const added = base.replace('email: String }', 'email: String org: ID! }');
    assert.deepEqual(summary(drift('NewUser', base, added, ops)), [['graphql-input-field-added-required', 'breaking', 1]]);
    const optional = base.replace('email: String }', 'email: String org: ID }');
    assert.deepEqual(summary(drift('NewUser', base, optional, ops)), [['graphql-input-field-added-optional', 'compatible', 0]]);
  });

  it('enum value removed: breaking when an operation sends it literally, potential otherwise', () => {
    const base = 'type Query { users(role: Role): [ID] } enum Role { ADMIN USER }';
    const head = 'type Query { users(role: Role): [ID] } enum Role { USER }';
    assert.deepEqual(summary(drift('Role', base, head, 'query Q { users(role: ADMIN) }')), [['graphql-enum-value-removed', 'breaking', 1]]);
    assert.deepEqual(summary(drift('Role', base, head, 'query Q($r: Role) { users(role: $r) }')), [['graphql-enum-value-removed', 'potentially-breaking', 1]]);
  });

  it('custom scalar and directive semantics stay unknown boundaries', () => {
    const scalar = drift('DateTime', 'type Query { a: DateTime } scalar DateTime @specifiedBy(url: "a")', 'type Query { a: DateTime } scalar DateTime @specifiedBy(url: "b")');
    assert.deepEqual(summary(scalar), [['graphql-custom-scalar-changed', 'unknown', 0]]);
    assert.ok(scalar[0]!.coverage.incompleteReasons.includes('custom-scalar-semantics'));
    const directive = drift('User', BASE, BASE.replace('email: String!', 'email: String! @auth(requires: ADMIN)'));
    assert.deepEqual(summary(directive), [['graphql-directive-changed', 'unknown', 0]]);
    assert.ok(directive[0]!.coverage.incompleteReasons.includes('directive-semantics-not-modeled'));
  });

  it('unchanged type produces no finding; removed type is breaking for its known consumers', () => {
    assert.deepEqual(drift('User', BASE, `\n${BASE}`), []);
    const removed = drift('User', BASE, 'type Query { users(limit: Int): [ID] }', 'query Q { user(id: 1) { id } }');
    assert.deepEqual(summary(removed), [['graphql-type-removed', 'breaking', 1]]);
  });
});

describe('GraphQL legacy fallback', () => {
  it('a v1.0.11 flat contract (no protocol payload) compares as unknown legacy-schema', () => {
    const legacy: Contract = { repoName: 'users-api', repoPath: '/r', kind: 'graphql', name: 'query.user', nodeId: 'graphql:query.user', nodeKind: 'graphql', filePath: 'schema.graphql', contractId: 'c1', snapshotId: 's', semanticFingerprint: 'f' };
    const findings = compareContractVersions({ kind: 'graphql', baseContract: legacy, headContract: legacy, baseVersion: version(legacy), headVersion: version(legacy) });
    assert.deepEqual(findings.map((finding) => [finding.changeKind, finding.compatibility, [...finding.coverage.incompleteReasons]]), [['graphql-legacy-schema', 'unknown', ['legacy-schema']]]);
  });

  it('a side whose snapshot has no protocol sidecar is legacy, not "added"', () => {
    const head = graphqlContracts(snapshot(BASE), MEMBER).find((contract) => contract.name === 'type.User')!;
    const findings = compareContractVersions({ kind: 'graphql', headContract: head, headVersion: version(head), protocolUnavailable: { base: true } });
    assert.deepEqual(findings.map((finding) => finding.changeKind), ['graphql-legacy-schema']);
  });

  it('contract ids are stable across formatting changes; fingerprints track structure only', () => {
    const a = graphqlContracts(snapshot(BASE), MEMBER).find((contract) => contract.name === 'type.User')!;
    const b = graphqlContracts(snapshot(`# moved\n\n${BASE}`), MEMBER).find((contract) => contract.name === 'type.User')!;
    const c = graphqlContracts(snapshot(BASE.replace('name: String', 'name: String!')), MEMBER).find((contract) => contract.name === 'type.User')!;
    assert.equal(a.contractId, b.contractId);
    assert.equal(a.semanticFingerprint, b.semanticFingerprint);
    assert.equal(a.contractId, c.contractId);
    assert.notEqual(a.semanticFingerprint, c.semanticFingerprint);
    assert.equal(a.sourceCanonicalId, 'graphql:users-api:type:User');
  });

  it('consumer refs carry canonical field evidence', () => {
    const snap = snapshot(BASE, 'query Q { user(id: 1) { id } }');
    const ids = new Map(graphqlContracts(snap, MEMBER).map((contract) => [contract.name.slice(5), contract.contractId!] as const));
    const refs: Array<{ contractId: string; ref: ContractConsumerRef }> = graphqlConsumersForSchema(snap.graphql.schema!, ids, [{ repoId: 'repo-web', repoName: 'web', snapshot: snap }]);
    assert.deepEqual(refs.map((entry) => [...(entry.ref.consumedFields ?? [])]).sort(), [['Query.user', 'Query.user(id)'], ['User.id']]);
  });
});
