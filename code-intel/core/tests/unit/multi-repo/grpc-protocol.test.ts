import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { buildSymbolSpanIndex } from '../../../src/multi-repo/symbol-spans.js';
import { parseProtoFile, protoDefinitionFingerprint, resolveProtoTypes } from '../../../src/multi-repo/schema-parsers/proto-model.js';
import { grpcContracts, buildProtocolConsumerRefs, PROTOCOL_SNAPSHOT_VERSION, type ProtocolSnapshot } from '../../../src/multi-repo/protocol-contracts.js';
import { compareContractVersions } from '../../../src/multi-repo/contract-drift/comparator.js';
import { aggregateDimensions } from '../../../src/multi-repo/contract-drift/grpc-comparator.js';
import { extractGrpcBindingSites, resolveGrpcBindings, GRPC_BINDING_CAPABILITIES } from '../../../src/semantic/protocol-contracts/grpc-bindings.js';
import { PROTO_LIMITS } from '../../../src/semantic/protocol-contracts/grpc-types.js';
import type { Contract, GroupContractVersion } from '../../../src/multi-repo/types.js';

const USERS_PROTO = `
syntax = "proto3";
package acme.users.v1;
import "google/protobuf/timestamp.proto";
option java_package = "com.acme.users"; // options are skipped, never evaluated

/* block comment with { braces } */
message User {
  string id = 1;
  string name = 2 [(validate.rules).string.min_len = 1];
  repeated string tags = 3;
  map<string, Address> addresses = 4;
  oneof contact { string email = 5; string phone = 6; }
  optional int32 age = 7;
  Status status = 8;
  reserved 9, 15 to 20;
  reserved "legacy";
  message Address { string city = 1; }
  enum Status { STATUS_UNSPECIFIED = 0; ACTIVE = 1; reserved 2; }
}
message GetUserRequest { string id = 1; }
service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc Watch(GetUserRequest) returns (stream User) { option deprecated = true; }
  rpc Upload(stream User) returns (GetUserRequest);
  rpc Chat(stream User) returns (stream User);
}
`;

function model(source = USERS_PROTO, filePath = 'proto/users.proto') {
  return resolveProtoTypes([parseProtoFile(filePath, source)])[0]!;
}

describe('protobuf model', () => {
  it('parses package, imports, messages, nesting, fields, map/oneof, enums, reserved and services', () => {
    const file = model();
    assert.equal(file.syntax, 'proto3');
    assert.equal(file.package, 'acme.users.v1');
    assert.deepEqual(file.imports, ['google/protobuf/timestamp.proto']);
    assert.deepEqual(file.messages.map((message) => message.fullName), ['acme.users.v1.GetUserRequest', 'acme.users.v1.User', 'acme.users.v1.User.Address']);
    const user = file.messages.find((message) => message.name === 'User')!;
    assert.deepEqual(user.fields.map((field) => [field.number, field.name, field.cardinality, field.oneof ?? null]), [
      [1, 'id', 'singular', null], [2, 'name', 'singular', null], [3, 'tags', 'repeated', null], [4, 'addresses', 'map', null],
      [5, 'email', 'singular', 'contact'], [6, 'phone', 'singular', 'contact'], [7, 'age', 'optional', null], [8, 'status', 'singular', null],
    ]);
    assert.equal(user.fields.find((field) => field.name === 'addresses')!.mapValueType, 'acme.users.v1.User.Address');
    assert.deepEqual([user.fields.find((field) => field.name === 'status')!.resolvedType, user.fields.find((field) => field.name === 'status')!.typeKind], ['acme.users.v1.User.Status', 'enum']);
    assert.deepEqual(user.reserved, { ranges: [[9, 9], [15, 20]], names: ['legacy'] });
    assert.deepEqual(user.oneofs, ['contact']);
    const status = file.enums[0]!;
    assert.equal(status.fullName, 'acme.users.v1.User.Status');
    assert.deepEqual(status.values.map((value) => [value.name, value.number]), [['STATUS_UNSPECIFIED', 0], ['ACTIVE', 1]]);
    assert.deepEqual(status.reserved.ranges, [[2, 2]]);
    const service = file.services[0]!;
    assert.equal(service.fullName, 'acme.users.v1.UserService');
    assert.deepEqual(service.rpcs.map((rpc) => [rpc.name, rpc.streaming, rpc.requestType, rpc.responseType]), [
      ['Chat', 'bidi-stream', 'acme.users.v1.User', 'acme.users.v1.User'],
      ['GetUser', 'unary', 'acme.users.v1.GetUserRequest', 'acme.users.v1.User'],
      ['Upload', 'client-stream', 'acme.users.v1.User', 'acme.users.v1.GetUserRequest'],
      ['Watch', 'server-stream', 'acme.users.v1.GetUserRequest', 'acme.users.v1.User'],
    ]);
    assert.equal(file.coverage.complete, true, file.coverage.boundaryReasons.join());
  });

  it('resolves relative and fully-qualified names across files; unresolved names are boundaries', () => {
    const [common, orders] = resolveProtoTypes([
      parseProtoFile('common.proto', 'syntax = "proto3"; package acme.common; message Money { int64 units = 1; }'),
      parseProtoFile('orders.proto', 'syntax = "proto3"; package acme.orders; message Order { .acme.common.Money total = 1; Missing gone = 2; }'),
    ]);
    assert.equal(common!.coverage.complete, true);
    assert.equal(orders!.messages[0]!.fields[0]!.resolvedType, 'acme.common.Money');
    assert.equal(orders!.messages[0]!.fields[1]!.resolvedType, undefined);
    assert.deepEqual([...orders!.coverage.boundaryReasons], ['unresolved-type:Missing']);
  });

  it('malformed documents and limits yield an empty, explicitly incomplete model', () => {
    assert.deepEqual([...parseProtoFile('a.proto', 'message A { string id = ; }').coverage.boundaryReasons], ['malformed-document']);
    assert.deepEqual([...parseProtoFile('b.proto', 'message A { string id = 1;').coverage.boundaryReasons], ['malformed-document']);
    assert.deepEqual([...parseProtoFile('c.proto', 'message A { string s = 0; }').coverage.boundaryReasons], ['malformed-document'], 'field numbers start at 1');
    const deep = `${'message M { '.repeat(PROTO_LIMITS.maxDepth + 2)}${'} '.repeat(PROTO_LIMITS.maxDepth + 2)}`;
    assert.deepEqual([...parseProtoFile('d.proto', deep).coverage.boundaryReasons], ['depth-limit']);
    assert.deepEqual([...parseProtoFile('e.proto', ' '.repeat(PROTO_LIMITS.maxFileBytes + 1)).coverage.boundaryReasons], ['file-size-limit']);
    assert.deepEqual([...parseProtoFile('f.proto', 'message A { string id = 1; extensions 100 to 199; }').coverage.boundaryReasons], ['extensions-not-modeled']);
    assert.equal(parseProtoFile('g.proto', 'message A { string s = 1; } // "unterminated\n').coverage.complete, true, 'quotes inside comments are ignored');
  });

  it('fingerprints ignore declaration order and anchors', () => {
    const a = model('syntax = "proto3"; message A { string x = 1; int32 y = 2; }').messages[0]!;
    const b = model('syntax = "proto3";\n\nmessage A {\n int32 y = 2;\n string x = 1;\n}').messages[0]!;
    const c = model('syntax = "proto3"; message A { string x = 1; int64 y = 2; }').messages[0]!;
    assert.equal(protoDefinitionFingerprint(a), protoDefinitionFingerprint(b));
    assert.notEqual(protoDefinitionFingerprint(a), protoDefinitionFingerprint(c));
  });
});

const MEMBER = { repoName: 'users', repoPath: '/r', repositoryId: 'repo-users', snapshotId: 's' };

function snapshot(source: string): ProtocolSnapshot {
  return { version: PROTOCOL_SNAPSHOT_VERSION, graphql: { operations: [], resolverBindings: [], boundaries: [] }, grpc: { files: [model(source)], bindingSites: [], boundaries: [] } };
}

function version(contract: Contract): GroupContractVersion {
  return { contractId: contract.contractId!, kind: 'grpc', repositoryId: 'repo-users', snapshotId: 's', semanticFingerprint: contract.semanticFingerprint!, role: 'producer', certainty: 'exact', coverage: { complete: true, examinedCount: 1, incompleteReasons: [] } };
}

function drift(name: string, baseProto: string, headProto: string) {
  const base = grpcContracts(snapshot(baseProto), MEMBER).find((contract) => contract.name === name);
  const head = grpcContracts(snapshot(headProto), MEMBER).find((contract) => contract.name === name);
  return compareContractVersions({ kind: 'grpc', baseContract: base, headContract: head, baseVersion: base && version(base), headVersion: head && version(head) })
    .map((finding) => [finding.changeKind, finding.protocolDimensions?.wire, finding.protocolDimensions?.source, finding.compatibility]);
}

const MSG = (body: string) => `syntax = "proto3"; package p; message M { ${body} }`;

describe('gRPC wire/source compatibility rules', () => {
  it('aggregates dimensions conservatively', () => {
    assert.equal(aggregateDimensions({ wire: 'compatible', source: 'breaking' }), 'breaking');
    assert.equal(aggregateDimensions({ wire: 'breaking', source: 'compatible' }), 'breaking');
    assert.equal(aggregateDimensions({ wire: 'unknown', source: 'compatible' }), 'unknown');
    assert.equal(aggregateDimensions({ wire: 'compatible', source: 'potentially-breaking' }), 'potentially-breaking');
    assert.equal(aggregateDimensions({ wire: 'compatible', source: 'compatible' }), 'compatible');
  });

  it('rename with same number/type: wire compatible, source breaking', () => {
    assert.deepEqual(drift('p.M', MSG('string name = 1;'), MSG('string full_name = 1;')), [['proto-field-renamed', 'compatible', 'breaking', 'breaking']]);
  });

  it('number reused by an incompatible field: wire breaking', () => {
    assert.deepEqual(drift('p.M', MSG('string name = 1;'), MSG('int64 count = 1;')), [['proto-field-number-reused', 'breaking', 'breaking', 'breaking']]);
  });

  it('number changed: wire breaking, source compatible', () => {
    assert.deepEqual(drift('p.M', MSG('string name = 1;'), MSG('string name = 2;')), [['proto-field-number-changed', 'breaking', 'compatible', 'breaking']]);
  });

  it('type change: same wire group compatible, other group breaking', () => {
    assert.deepEqual(drift('p.M', MSG('int32 n = 1;'), MSG('int64 n = 1;')), [['proto-field-type-changed', 'compatible', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.M', MSG('int32 n = 1;'), MSG('sint32 n = 1;')), [['proto-field-type-changed', 'breaking', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.M', MSG('string n = 1;'), MSG('bytes n = 1;')), [['proto-field-type-changed', 'compatible', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.M', MSG('fixed32 n = 1;'), MSG('fixed64 n = 1;')), [['proto-field-type-changed', 'breaking', 'breaking', 'breaking']]);
  });

  it('removal with reservation vs without', () => {
    assert.deepEqual(drift('p.M', MSG('string a = 1; string b = 2;'), MSG('string a = 1; reserved 2; reserved "b";')), [['proto-field-removed-reserved', 'compatible', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.M', MSG('string a = 1; string b = 2;'), MSG('string a = 1;')), [['proto-field-removed-unreserved', 'unknown', 'breaking', 'breaking']]);
  });

  it('additions: new number compatible; reusing a reserved number breaking', () => {
    assert.deepEqual(drift('p.M', MSG('string a = 1;'), MSG('string a = 1; string b = 2;')), [['proto-field-added', 'compatible', 'compatible', 'compatible']]);
    assert.deepEqual(drift('p.M', MSG('string a = 1; reserved 2;'), MSG('string a = 1; string b = 2;')), [['proto-reserved-field-reused', 'breaking', 'breaking', 'breaking']]);
  });

  it('oneof membership and cardinality changes are conservative', () => {
    assert.deepEqual(drift('p.M', MSG('string a = 1;'), MSG('oneof o { string a = 1; }')), [['proto-field-oneof-changed', 'unknown', 'potentially-breaking', 'potentially-breaking']]);
    assert.deepEqual(drift('p.M', MSG('string a = 1;'), MSG('repeated string a = 1;')), [['proto-field-cardinality-changed', 'unknown', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.M', MSG('string a = 1;'), MSG('optional string a = 1;')), [['proto-field-cardinality-changed', 'compatible', 'potentially-breaking', 'potentially-breaking']]);
  });

  it('enum numbers: change/reuse breaking, rename source-only, addition compatible on the wire', () => {
    const E = (body: string) => `syntax = "proto3"; package p; enum E { ${body} }`;
    assert.deepEqual(drift('p.E', E('A = 0; B = 1;'), E('A = 0; B = 2;')), [['proto-enum-number-changed', 'breaking', 'compatible', 'breaking']]);
    assert.deepEqual(drift('p.E', E('A = 0; B = 1;'), E('A = 0; C = 1;')), [['proto-enum-value-renamed', 'compatible', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.E', E('A = 0; reserved 1;'), E('A = 0; B = 1;')), [['proto-enum-reserved-number-reused', 'breaking', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.E', E('A = 0;'), E('A = 0; B = 1;')), [['proto-enum-value-added', 'compatible', 'potentially-breaking', 'potentially-breaking']]);
  });

  it('service: RPC removal, message identity change and streaming change are breaking', () => {
    const S = (body: string) => `syntax = "proto3"; package p; message A {} message B {} service S { ${body} }`;
    assert.deepEqual(drift('p.S', S('rpc Get(A) returns (B); rpc Del(A) returns (B);'), S('rpc Get(A) returns (B);')), [['grpc-rpc-removed', 'breaking', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.S', S('rpc Get(A) returns (B);'), S('rpc Get(A) returns (A);')), [['grpc-rpc-message-changed', 'breaking', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.S', S('rpc Get(A) returns (B);'), S('rpc Get(A) returns (stream B);')), [['grpc-rpc-streaming-changed', 'breaking', 'breaking', 'breaking']]);
    assert.deepEqual(drift('p.S', S('rpc Get(A) returns (B);'), S('rpc Get(A) returns (B); rpc Put(A) returns (B);')), [['grpc-rpc-added', 'compatible', 'compatible', 'compatible']]);
  });

  it('legacy flat gRPC contracts compare as unknown legacy-schema', () => {
    const legacy: Contract = { repoName: 'users', repoPath: '/r', kind: 'grpc', name: 'UserService.GetUser', nodeId: 'grpc:UserService:GetUser', nodeKind: 'grpc', filePath: 'u.proto', contractId: 'c', snapshotId: 's', semanticFingerprint: 'f' };
    const findings = compareContractVersions({ kind: 'grpc', baseContract: legacy, headContract: legacy, baseVersion: version(legacy), headVersion: version(legacy) });
    assert.deepEqual(findings.map((finding) => [finding.changeKind, finding.compatibility, finding.protocolDimensions]), [['grpc-legacy-schema', 'unknown', { wire: 'unknown', source: 'unknown' }]]);
  });
});

describe('gRPC provider/consumer bindings', () => {
  const protos = resolveProtoTypes([
    parseProtoFile('users.proto', 'syntax = "proto3"; package acme.users.v1; message R {} service UserService { rpc GetUser(R) returns (R); }'),
    parseProtoFile('admin.proto', 'syntax = "proto3"; package acme.admin.v1; message R {} service AdminService { rpc GetUser(R) returns (R); } service UserService { rpc GetUser(R) returns (R); }'),
  ]);

  function sites(filePath: string, source: string, defs: Array<[string, number, number]>) {
    const graph = createKnowledgeGraph();
    for (const [name, startLine, endLine] of defs) graph.addNode({ id: `${filePath}#${name}`, identityId: `sym:${name}`, kind: 'function', name, filePath, startLine, endLine });
    return extractGrpcBindingSites([{ filePath, source }], buildSymbolSpanIndex(graph));
  }

  it('grpc-js client with a proven package path binds exactly to package.Service/Rpc', () => {
    const found = sites('src/client.ts', [
      "import * as grpc from '@grpc/grpc-js';",
      'const proto = grpc.loadPackageDefinition(definition);',
      "const client = new proto.acme.users.v1.UserService('localhost:50051', creds);",
      'export function loadUser(id: string) {',
      '  return client.getUser({ id }, cb);',
      '}',
    ].join('\n'), [['loadUser', 4, 6]]);
    const bindings = resolveGrpcBindings(found, protos);
    assert.deepEqual(bindings.map((binding) => [binding.role, binding.rpcIds, binding.certainty, binding.symbolId]), [['consumer', ['grpc:acme.users.v1.UserService/GetUser'], 'exact', 'sym:loadUser']]);
  });

  it('same RPC method name in two services: method-name equality alone never binds', () => {
    const found = sites('src/client.ts', [
      "import * as grpc from '@grpc/grpc-js';",
      'const users = grpc.loadPackageDefinition(definition).acme.users.v1;',
      "const client = new users.UserService('h', creds);",
      'export function f() { return client.GetUser({}, cb); }',
    ].join('\n'), [['f', 4, 5]]);
    const bindings = resolveGrpcBindings(found, protos);
    assert.deepEqual(bindings.map((binding) => binding.rpcIds), [['grpc:acme.users.v1.UserService/GetUser']], 'not AdminService/GetUser, not admin UserService');
  });

  it('unknown package: candidate across same-named services, never exact', () => {
    const found = sites('src/nest.ts', [
      "@Controller() export class C {",
      "  constructor(@Inject('USERS') private client: ClientGrpc) {}",
      "  onModuleInit() { this.users = this.client.getService<UsersClient>('UserService'); }",
      '  find() { return this.users.getUser({ id: 1 }); }',
      '}',
    ].join('\n'), [['find', 4, 5]]);
    const bindings = resolveGrpcBindings(found, protos);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0]!.certainty, 'candidate');
    assert.deepEqual([...bindings[0]!.rpcIds].sort(), ['grpc:acme.admin.v1.UserService/GetUser', 'grpc:acme.users.v1.UserService/GetUser']);
    assert.deepEqual(bindings[0]!.boundaryReasons, ['ambiguous-service-package']);
  });

  it('NestJS provider binds exactly with the repository Transport.GRPC package', () => {
    const found = sites('src/users.controller.ts', [
      "const options = { transport: Transport.GRPC, options: { package: 'acme.users.v1', protoPath } };",
      'export class UsersController {',
      "  @GrpcMethod('UserService', 'GetUser')",
      '  getUser(data: R) {',
      '    return {};',
      '  }',
      '}',
    ].join('\n'), [['getUser', 4, 6]]);
    const bindings = resolveGrpcBindings(found, protos);
    assert.deepEqual(bindings.map((binding) => [binding.role, binding.rpcIds, binding.certainty]), [['provider', ['grpc:acme.users.v1.UserService/GetUser'], 'exact']]);
  });

  it('an RPC the service does not declare produces no binding', () => {
    const found = sites('src/client.ts', [
      'const proto = grpc.loadPackageDefinition(d);',
      "const client = new proto.acme.users.v1.UserService('h', c);",
      'export function f() { return client.deleteUser({}); }',
    ].join('\n'), [['f', 3, 4]]);
    assert.deepEqual(resolveGrpcBindings(found, protos), []);
  });

  it('publishes supported and unsupported capability rows', () => {
    assert.ok(GRPC_BINDING_CAPABILITIES.some((row) => row.language === 'go' && row.status === 'unsupported'));
    assert.ok(GRPC_BINDING_CAPABILITIES.some((row) => row.framework === '@grpc/grpc-js' && row.role === 'consumer' && row.status === 'supported'));
  });

  it('consumer refs reach the service contract and every message reachable from the RPC', () => {
    const server: ProtocolSnapshot = { version: PROTOCOL_SNAPSHOT_VERSION, graphql: { operations: [], resolverBindings: [], boundaries: [] }, grpc: { files: [model()], bindingSites: [], boundaries: [] } };
    const client: ProtocolSnapshot = {
      ...server,
      grpc: { files: [], boundaries: [], bindingSites: [{ role: 'consumer', pkg: 'acme.users.v1', service: 'UserService', rpc: 'getUser', framework: 'grpc-js', pattern: 'client-call', filePath: 'web/api.ts', line: 3, symbolId: 'sym:load' }] },
    };
    const contracts = grpcContracts(server, MEMBER);
    const refs = buildProtocolConsumerRefs(contracts, [{ repoId: 'repo-users', repoName: 'users', snapshot: server }, { repoId: 'repo-web', repoName: 'web', snapshot: client }]);
    const byContract = new Map(contracts.map((contract) => [contract.contractId!, contract.name]));
    assert.deepEqual(refs.map((entry) => byContract.get(entry.contractId)).sort(), [
      'acme.users.v1.GetUserRequest', 'acme.users.v1.User', 'acme.users.v1.User.Address', 'acme.users.v1.User.Status', 'acme.users.v1.UserService',
    ]);
    assert.ok(refs.every((entry) => entry.ref.certainty === 'exact' && entry.ref.repositoryId === 'repo-web'));
  });
});
