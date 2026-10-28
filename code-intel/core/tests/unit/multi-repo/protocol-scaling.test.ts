import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphQLSchemaModel } from '../../../src/multi-repo/schema-parsers/graphql-model.js';
import { parseProtoFile, resolveProtoTypes } from '../../../src/multi-repo/schema-parsers/proto-model.js';
import { extractDocumentOperations } from '../../../src/semantic/protocol-contracts/graphql-operations.js';
import { mapOperations } from '../../../src/semantic/protocol-contracts/graphql-matcher.js';
import { GRAPHQL_LIMITS, PROTO_LIMITS } from '../../../src/semantic/protocol-contracts/index.js';
import { graphqlContracts, grpcContracts, PROTOCOL_SNAPSHOT_VERSION, type ProtocolSnapshot } from '../../../src/multi-repo/protocol-contracts.js';
import { compareContractVersions } from '../../../src/multi-repo/contract-drift/comparator.js';

/**
 * Scaling benchmark for the protocol parsers/matcher/comparators on large-but-bounded inputs.
 * Timings are printed as evidence; the asserted ceilings are deliberately generous (CI noise)
 * and exist to catch accidental quadratic behavior, not to pin exact numbers.
 */

function timed<T>(label: string, fn: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = fn();
  const ms = performance.now() - started;
  console.log(`  [protocol-bench] ${label}: ${ms.toFixed(1)}ms`);
  return { value, ms };
}

const TYPES = 1500;
const FIELDS = 12;
const OPERATIONS = 1500;

function largeSchema(seed = 0): string {
  const types: string[] = [];
  for (let t = 0; t < TYPES; t += 1) {
    const fields = Array.from({ length: FIELDS }, (_, f) => `f${f}(a: Int, b: String = "x"): ${f === 0 && t + 1 < TYPES ? `T${t + 1}` : 'String'}`);
    if (seed && t % 100 === 0) fields.pop();
    types.push(`type T${t} { ${fields.join(' ')} }`);
  }
  return `type Query { root: T0 ${Array.from({ length: 50 }, (_, i) => `q${i}(id: ID!): T${i}`).join(' ')} }\n${types.join('\n')}`;
}

function largeOperations(): string {
  return Array.from({ length: OPERATIONS }, (_, i) => `query Op${i}($id: ID!) { q${i % 50}(id: $id) { f1 f2 f0 { f3 f4 f0 { f5 } } } }`).join('\n');
}

function largeProto(seed = 0): string {
  const messages = Array.from({ length: 800 }, (_, m) => `message M${m} { ${Array.from({ length: 15 }, (_, f) => `${seed && m % 50 === 0 && f === 3 ? 'int64' : 'string'} f${f} = ${f + 1};`).join(' ')} }`);
  const rpcs = Array.from({ length: 200 }, (_, r) => `rpc R${r}(M${r}) returns (M${r + 1});`);
  return `syntax = "proto3"; package bench.v1;\n${messages.join('\n')}\nservice Bench { ${rpcs.join(' ')} }`;
}

describe('protocol contract scaling (bounded large inputs)', () => {
  it('parses a large schema and maps many operations against several schemas without blow-up', () => {
    const sdl = largeSchema();
    const { value: schema, ms: parseMs } = timed(`schema ${TYPES} types x ${FIELDS} fields`, () => buildGraphQLSchemaModel([{ filePath: 'schema.graphql', source: sdl }], 'svc'));
    assert.equal(schema.coverage.complete, true);
    assert.equal(schema.types.length, TYPES + 1);

    const { value: operations } = timed(`${OPERATIONS} operations`, () => extractDocumentOperations('ops.graphql', largeOperations()).operations);
    assert.equal(operations.length, OPERATIONS);

    const others = [buildGraphQLSchemaModel([{ filePath: 'a.graphql', source: 'type Query { x: Int }' }], 'a'), buildGraphQLSchemaModel([{ filePath: 'b.graphql', source: 'type Query { y: Int }' }], 'b')];
    const { value: mappings, ms: mapMs } = timed(`map ${OPERATIONS} operations x 3 schemas`, () => mapOperations(operations, [schema, ...others]));
    assert.equal(mappings.length, OPERATIONS);
    assert.ok(mappings.every((mapping) => mapping.certainty === 'exact'));
    assert.ok(parseMs < 20_000, `schema parse took ${parseMs}ms`);
    assert.ok(mapMs < 20_000, `mapping took ${mapMs}ms`);
  });

  it('builds and compares contracts for a large schema and proto set', () => {
    const snapshotOf = (sdl: string, proto: string): ProtocolSnapshot => ({
      version: PROTOCOL_SNAPSHOT_VERSION,
      graphql: { schema: buildGraphQLSchemaModel([{ filePath: 's.graphql', source: sdl }], 'svc'), operations: [], resolverBindings: [], boundaries: [] },
      grpc: { files: resolveProtoTypes([parseProtoFile('b.proto', proto)]), bindingSites: [], boundaries: [] },
    });
    const member = { repoName: 'svc', repoPath: '/r', repositoryId: 'repo', snapshotId: 's' };
    const { value: [base, head], ms: buildMs } = timed('build base+head contracts', () => [snapshotOf(largeSchema(), largeProto()), snapshotOf(largeSchema(1), largeProto(1))].map((snapshot) => [...graphqlContracts(snapshot, member), ...grpcContracts(snapshot, member)]));
    const headById = new Map(head!.map((contract) => [contract.contractId!, contract]));
    const version = (contract: (typeof base)[number]) => ({ contractId: contract.contractId!, kind: contract.kind, repositoryId: 'repo', snapshotId: 's', semanticFingerprint: contract.semanticFingerprint!, role: 'producer' as const, certainty: 'exact' as const, coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } });
    const { value: findings, ms: compareMs } = timed(`compare ${base!.length} contracts`, () => base!.flatMap((contract) => {
      const other = headById.get(contract.contractId!);
      if (other && other.semanticFingerprint === contract.semanticFingerprint) return [];
      return compareContractVersions({ kind: contract.kind, baseContract: contract, headContract: other, baseVersion: version(contract), headVersion: other && version(other) });
    }));
    assert.equal(findings.filter((finding) => finding.changeKind === 'graphql-field-removed').length, TYPES / 100);
    assert.equal(findings.filter((finding) => finding.changeKind === 'proto-field-type-changed').length, 800 / 50);
    assert.ok(buildMs < 30_000, `contract build took ${buildMs}ms`);
    assert.ok(compareMs < 10_000, `comparison took ${compareMs}ms`);
  });

  it('caps oversized inputs with explicit boundaries instead of unbounded work', () => {
    const tooManyTypes = Array.from({ length: GRAPHQL_LIMITS.maxTypesPerSchema + 10 }, (_, i) => `scalar S${i}`).join('\n');
    const capped = timed('schema over type cap', () => buildGraphQLSchemaModel([{ filePath: 'cap.graphql', source: tooManyTypes }], 'svc')).value;
    assert.equal(capped.types.length, GRAPHQL_LIMITS.maxTypesPerSchema);
    assert.ok(capped.coverage.boundaryReasons.includes('type-count-limit'));

    const tooManyDefinitions = Array.from({ length: PROTO_LIMITS.maxDefinitionsPerFile + 1 }, (_, i) => `message M${i} {}`).join('\n');
    assert.deepEqual([...timed('proto over definition cap', () => parseProtoFile('cap.proto', tooManyDefinitions)).value.coverage.boundaryReasons], ['definition-limit']);
  });
});
