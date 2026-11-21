/**
 * protocol-contracts.ts
 *
 * Rich GraphQL / protobuf-gRPC contracts for repository groups: per-repository extraction
 * (schemas, client operations, binding sites), a persisted snapshot sidecar so drift can compare
 * refs whose worktree no longer exists, contract construction (one contract per GraphQL type and
 * per proto service/message/enum) and group-wide consumer references keyed by canonical
 * identity. Extends — never replaces — the existing Contract / consumer index / drift model.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { Contract, ContractConsumerRef } from './types.js';
import { extractProtocolFacts, isProtocolSourceFile, PROTOCOL_FACT_LIMITS } from './protocol-facts.js';
import { buildSymbolSpanIndex, type SymbolSpanIndex } from './symbol-spans.js';
import { contractIdentityFromContract, getStableContractId } from './contract-identity.js';
import { computeSemanticContractFingerprint, contractFingerprintFromContract } from './contract-fingerprint.js';
import { buildGraphQLSchemaModel, graphqlTypeFingerprint } from './schema-parsers/graphql-model.js';
import { scanGraphQLDocuments } from './schema-parsers/graphql-parser.js';
import { parseProtoRepository } from './schema-parsers/proto-parser.js';
import { protoDefinitionFingerprint } from './schema-parsers/proto-model.js';
import { attributeImportedOperations, extractDocumentOperations, extractSourceOperations, type DocumentImportUse } from '../semantic/protocol-contracts/graphql-operations.js';
import { mapOperations, mapOperationToSchema } from '../semantic/protocol-contracts/graphql-matcher.js';
import { extractGrpcBindingSites, resolveGrpcBindings, type GrpcBindingFact, type GrpcBindingSite } from '../semantic/protocol-contracts/grpc-bindings.js';
import {
  GRAPHQL_CONTRACT_SCHEMA_VERSION,
  GRAPHQL_LIMITS,
  graphqlTypeId,
  namedType,
  type GraphQLCoverage,
  type GraphQLOperationFact,
  type GraphQLOperationMapping,
  type GraphQLOperationType,
  type GraphQLSchemaModel,
  type GraphQLTypeDef,
  type GraphQLTypeKind,
} from '../semantic/protocol-contracts/graphql-types.js';
import {
  GRPC_CONTRACT_SCHEMA_VERSION,
  type ProtoCoverage,
  type ProtoEnumDef,
  type ProtoFileModel,
  type ProtoMessageDef,
  type ProtoServiceDef,
} from '../semantic/protocol-contracts/grpc-types.js';

export const PROTOCOL_SNAPSHOT_FILE = 'protocol-contracts.json';
/** Sidecar format version: both protocol schema versions it was produced with. */
export const PROTOCOL_SNAPSHOT_VERSION = `graphql@${GRAPHQL_CONTRACT_SCHEMA_VERSION}+grpc@${GRPC_CONTRACT_SCHEMA_VERSION}`;

/** Root-field resolver bound to its handler symbol (from protocol-facts provider evidence). */
export interface GraphQLResolverBinding {
  /** `<RootType>.<field>`. */
  field: string;
  symbolId: string;
  symbolName?: string;
  pattern: string;
  filePath: string;
  line: number;
}

export interface ProtocolSnapshot {
  version: string;
  graphql: {
    schema?: GraphQLSchemaModel;
    operations: GraphQLOperationFact[];
    resolverBindings: GraphQLResolverBinding[];
    boundaries: string[];
  };
  grpc: {
    files: ProtoFileModel[];
    bindingSites: GrpcBindingSite[];
    boundaries: string[];
  };
}

export type GraphQLContractPayload = {
  protocol: 'graphql';
  schemaVersion: string;
  service: string;
  rootOperation?: GraphQLOperationType;
  type: GraphQLTypeDef;
  /** Kinds of every named type this type's fields/args/input fields reference. */
  referencedKinds: Record<string, GraphQLTypeKind>;
  /** Root fields bound to resolver symbols (root types only). */
  resolvers?: Record<string, string>;
  coverage: GraphQLCoverage;
};

export type GrpcContractPayload = {
  protocol: 'grpc';
  schemaVersion: string;
  package?: string;
  syntax?: ProtoFileModel['syntax'];
  definition:
    | { kind: 'service'; service: ProtoServiceDef }
    | { kind: 'message'; message: ProtoMessageDef }
    | { kind: 'enum'; enum: ProtoEnumDef };
  coverage: ProtoCoverage;
};

export type ProtocolContractPayload = GraphQLContractPayload | GrpcContractPayload;

/** Reads a repository's TS/JS sources named by `graph` file nodes (bounded, repo-contained). */
export function readProtocolSources(repoPath: string, graph: KnowledgeGraph): Array<{ filePath: string; source: string }> {
  const files: Array<{ filePath: string; source: string }> = [];
  const root = path.resolve(repoPath);
  for (const node of graph.allNodes()) {
    if (node.kind !== 'file' || !isProtocolSourceFile(node.filePath)) continue;
    if (files.length >= PROTOCOL_FACT_LIMITS.maxFilesPerRepo) break;
    const abs = path.resolve(root, node.filePath);
    if (abs !== root && !abs.startsWith(root + path.sep)) continue; // never read outside the repository
    try {
      if (fs.statSync(abs).size > PROTOCOL_FACT_LIMITS.maxFileBytes) continue;
      files.push({ filePath: node.filePath, source: fs.readFileSync(abs, 'utf-8') });
    } catch {
      // File moved since analysis; it contributes nothing until the next analyze.
    }
  }
  return files;
}

function graphqlResolverBindings(sources: ReadonlyArray<{ filePath: string; source: string }>, symbols: SymbolSpanIndex, schema: GraphQLSchemaModel | undefined): GraphQLResolverBinding[] {
  if (!schema) return [];
  const rootByOperation = schema.rootTypes;
  const bindings: GraphQLResolverBinding[] = [];
  for (const fact of extractProtocolFacts(sources, symbols)) {
    if (fact.protocol !== 'graphql' || fact.role !== 'provider' || !fact.symbolId) continue;
    const [operation, field] = fact.key.split('.') as [GraphQLOperationType, string];
    const rootType = rootByOperation[operation];
    const type = rootType ? schema.types.find((candidate) => candidate.name === rootType) : undefined;
    if (!type?.fields?.some((candidate) => candidate.name === field)) continue;
    bindings.push({ field: `${rootType}.${field}`, symbolId: fact.symbolId, symbolName: fact.symbolName, pattern: fact.pattern, filePath: fact.filePath, line: fact.line });
  }
  return bindings.sort((a, b) => a.field.localeCompare(b.field) || a.symbolId.localeCompare(b.symbolId));
}

/**
 * Extracts one repository's protocol contract inputs from its working files. `graph` supplies
 * file nodes and symbol spans for operation/binding attribution. Runs at analysis/sync time,
 * never per query.
 */
export function extractProtocolSnapshot(input: { rootDir: string; service: string; graph: KnowledgeGraph }): ProtocolSnapshot {
  const symbols = buildSymbolSpanIndex(input.graph);
  const sources = readProtocolSources(input.rootDir, input.graph);

  const scan = scanGraphQLDocuments(input.rootDir);
  const graphqlBoundaries = [...scan.boundaries];
  const schema = buildGraphQLSchemaModel(scan.documents.map(({ filePath, source }) => ({ filePath, source })), input.service);
  const documentOperations: GraphQLOperationFact[] = [];
  for (const document of scan.documents) {
    const extracted = extractDocumentOperations(document.filePath, document.source);
    documentOperations.push(...extracted.operations);
    graphqlBoundaries.push(...extracted.boundaries.filter((reason) => !schema.coverage.boundaryReasons.includes(reason)));
  }
  const sourceOperations: GraphQLOperationFact[] = [];
  const imports: DocumentImportUse[] = [];
  for (const file of sources) {
    if (!/gql|graphql/.test(file.source)) continue;
    const extracted = extractSourceOperations(file.filePath, file.source, symbols);
    sourceOperations.push(...extracted.operations);
    imports.push(...extracted.documentImports);
    graphqlBoundaries.push(...extracted.boundaries);
  }
  let operations = [...attributeImportedOperations(documentOperations, imports), ...sourceOperations];
  if (operations.length > GRAPHQL_LIMITS.maxOperationsPerRepo) {
    graphqlBoundaries.push('operation-count-limit');
    operations = operations.slice(0, GRAPHQL_LIMITS.maxOperationsPerRepo);
  }

  const protos = parseProtoRepository(input.rootDir);
  return {
    version: PROTOCOL_SNAPSHOT_VERSION,
    graphql: {
      schema: schema.types.length > 0 ? schema : undefined,
      operations: operations.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.operationId.localeCompare(b.operationId)),
      resolverBindings: graphqlResolverBindings(sources, symbols, schema.types.length > 0 ? schema : undefined),
      boundaries: [...new Set(graphqlBoundaries)].sort(),
    },
    grpc: {
      files: protos.files,
      bindingSites: extractGrpcBindingSites(sources, symbols),
      boundaries: protos.boundaries,
    },
  };
}

export function writeProtocolSnapshot(artifactsDir: string, snapshot: ProtocolSnapshot): void {
  const target = path.join(artifactsDir, PROTOCOL_SNAPSHOT_FILE);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot));
  fs.renameSync(tmp, target);
}

/** Returns undefined for a snapshot built before this sidecar existed or by another version —
 * callers must treat that as legacy (`unknown`), never as "no protocol contracts". */
export function readProtocolSnapshot(artifactsDir: string): ProtocolSnapshot | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(artifactsDir, PROTOCOL_SNAPSHOT_FILE), 'utf8')) as ProtocolSnapshot;
    return parsed?.version === PROTOCOL_SNAPSHOT_VERSION ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function graphqlReferencedKinds(type: GraphQLTypeDef, kinds: ReadonlyMap<string, GraphQLTypeKind>): Record<string, GraphQLTypeKind> {
  const names = new Set<string>();
  for (const field of type.fields ?? []) {
    names.add(namedType(field.type));
    for (const arg of field.args) names.add(namedType(arg.type));
  }
  for (const field of type.inputFields ?? []) names.add(namedType(field.type));
  return Object.fromEntries([...names].sort().flatMap((name) => (kinds.has(name) ? [[name, kinds.get(name)!]] : [])));
}

interface ContractMember {
  repoName: string;
  repoPath: string;
  repositoryId: string;
  snapshotId: string;
}

function finishContract(contract: Contract, repositoryId: string, semantic: Record<string, unknown>): Contract {
  const withId = { ...contract, contractId: getStableContractId(contractIdentityFromContract(contract, repositoryId)) };
  return { ...withId, semanticFingerprint: computeSemanticContractFingerprint({ ...contractFingerprintFromContract(withId), semantic }) };
}

/** One `graphql` contract per schema type (root types included: root fields are its fields). */
export function graphqlContracts(snapshot: ProtocolSnapshot, member: ContractMember): Contract[] {
  const schema = snapshot.graphql.schema;
  if (!schema) return [];
  const kinds = new Map(schema.types.map((type) => [type.name, type.kind] as const));
  const rootByType = new Map(Object.entries(schema.rootTypes).map(([operation, typeName]) => [typeName, operation as GraphQLOperationType]));
  const resolversByType = new Map<string, Record<string, string>>();
  for (const binding of snapshot.graphql.resolverBindings) {
    const [typeName, field] = binding.field.split('.') as [string, string];
    resolversByType.set(typeName, { ...(resolversByType.get(typeName) ?? {}), [field]: binding.symbolId });
  }
  return schema.types.map((type) => {
    const protocol: GraphQLContractPayload = {
      protocol: 'graphql',
      schemaVersion: schema.schemaVersion,
      service: schema.service,
      rootOperation: rootByType.get(type.name),
      type,
      referencedKinds: graphqlReferencedKinds(type, kinds),
      resolvers: resolversByType.get(type.name),
      coverage: schema.coverage,
    };
    const id = graphqlTypeId(schema.service, type.name);
    return finishContract({
      repoName: member.repoName,
      repoPath: member.repoPath,
      repositoryId: member.repositoryId,
      kind: 'graphql',
      name: `type.${type.name}`,
      nodeId: id,
      nodeKind: `graphql:${type.kind}`,
      filePath: type.anchor.filePath,
      sourceCanonicalId: id,
      snapshotId: member.snapshotId,
      role: 'producer',
      certainty: schema.coverage.complete ? 'exact' : 'lower-bound',
      coverage: { complete: schema.coverage.complete, examinedCount: 1, incompleteReasons: [...schema.coverage.boundaryReasons] },
      protocol,
    }, member.repositoryId, { schemaVersion: schema.schemaVersion, typeFingerprint: graphqlTypeFingerprint(type), rootOperation: protocol.rootOperation ?? null });
  });
}

/** One `grpc` contract per proto service, message and enum. */
export function grpcContracts(snapshot: ProtocolSnapshot, member: ContractMember): Contract[] {
  const contracts: Contract[] = [];
  for (const file of snapshot.grpc.files) {
    const definitions: Array<{ id: string; name: string; nodeKind: string; definition: GrpcContractPayload['definition']; anchor: { filePath: string } }> = [
      ...file.services.map((service) => ({ id: `grpc:service:${service.fullName}`, name: service.fullName, nodeKind: 'grpc:service', definition: { kind: 'service' as const, service }, anchor: service.anchor })),
      ...file.messages.map((message) => ({ id: `grpc:message:${message.fullName}`, name: message.fullName, nodeKind: 'grpc:message', definition: { kind: 'message' as const, message }, anchor: message.anchor })),
      ...file.enums.map((protoEnum) => ({ id: `grpc:enum:${protoEnum.fullName}`, name: protoEnum.fullName, nodeKind: 'grpc:enum', definition: { kind: 'enum' as const, enum: protoEnum }, anchor: protoEnum.anchor })),
    ];
    for (const entry of definitions) {
      const payload = entry.definition.kind === 'service' ? entry.definition.service : entry.definition.kind === 'message' ? entry.definition.message : entry.definition.enum;
      contracts.push(finishContract({
        repoName: member.repoName,
        repoPath: member.repoPath,
        repositoryId: member.repositoryId,
        kind: 'grpc',
        name: entry.name,
        nodeId: entry.id,
        nodeKind: entry.nodeKind,
        filePath: entry.anchor.filePath,
        sourceCanonicalId: entry.id,
        snapshotId: member.snapshotId,
        role: 'producer',
        certainty: file.coverage.complete ? 'exact' : 'lower-bound',
        coverage: { complete: file.coverage.complete, examinedCount: 1, incompleteReasons: [...file.coverage.boundaryReasons] },
        protocol: { protocol: 'grpc', schemaVersion: file.schemaVersion, package: file.package, syntax: file.syntax, definition: entry.definition, coverage: file.coverage },
      }, member.repositoryId, { schemaVersion: file.schemaVersion, definitionFingerprint: protoDefinitionFingerprint(payload), syntax: file.syntax ?? null }));
    }
  }
  return contracts;
}

export interface ProtocolMemberSnapshot {
  repoId: string;
  repoName: string;
  snapshot: ProtocolSnapshot;
}

export interface ProtocolConsumerRef {
  contractId: string;
  ref: ContractConsumerRef;
}

function consumerCertainty(certainty: 'exact' | 'candidate', complete: boolean): ContractConsumerRef['certainty'] {
  if (certainty === 'exact') return 'exact';
  return complete ? 'heuristic' : 'lower-bound';
}

/** Consumer refs for one operation mapping: one ref per touched type contract, whose
 * `consumedFields` are that type's `Type.field`, `Type.field(arg)`, `Enum.VALUE` and
 * `input:Type` evidence. */
export function graphqlConsumerRefsForMapping(
  mapping: GraphQLOperationMapping,
  operation: GraphQLOperationFact,
  consumer: { repoId: string; repoName: string },
  contractIdByType: ReadonlyMap<string, string>,
): ProtocolConsumerRef[] {
  if (mapping.certainty === 'unresolved') return [];
  const evidenceByType = new Map<string, Set<string>>();
  const add = (typeName: string, evidence: string) => {
    const set = evidenceByType.get(typeName) ?? new Set<string>();
    set.add(evidence);
    evidenceByType.set(typeName, set);
  };
  const prefix = `graphql:${mapping.service}:`;
  for (const fieldId of mapping.fieldIds) {
    const local = fieldId.slice(prefix.length);
    add(local.split('.')[0]!, local);
  }
  for (const ref of mapping.argumentRefs) add(ref.split('.')[0]!, ref);
  for (const ref of mapping.enumRefs) add(ref.split('.')[0]!, ref);
  for (const typeName of mapping.inputTypes) add(typeName, `input:${typeName}`);

  const refs: ProtocolConsumerRef[] = [];
  for (const [typeName, evidence] of evidenceByType) {
    const contractId = contractIdByType.get(typeName);
    if (!contractId) continue;
    refs.push({
      contractId,
      ref: {
        repositoryId: consumer.repoId,
        repositoryName: consumer.repoName,
        consumerId: operation.symbolId ?? operation.operationId,
        sourceCanonicalId: operation.symbolId ?? operation.operationId,
        sourceAnchor: `${operation.filePath}:${operation.line}`,
        certainty: consumerCertainty(mapping.certainty, mapping.coverage.complete),
        consumedFields: [...evidence].sort(),
        callSites: [operation.operationId],
        coverage: { complete: mapping.coverage.complete, examinedCount: 1, incompleteReasons: [...mapping.coverage.boundaryReasons] },
      },
    });
  }
  return refs;
}

/** Message/enum full names reachable from a message through its fields (bounded by the set). */
function reachableTypes(start: string, messages: ReadonlyMap<string, ProtoMessageDef>, out: Set<string>): void {
  if (out.has(start)) return;
  out.add(start);
  for (const field of messages.get(start)?.fields ?? []) {
    const next = field.cardinality === 'map' ? field.mapValueType : field.resolvedType;
    if (next && (field.typeKind === 'message' || field.typeKind === 'enum')) reachableTypes(next, messages, out);
  }
}

/** Consumer refs for one resolved gRPC binding: the service contract (with `rpc:` evidence) and
 * every message/enum contract reachable from the RPC's request/response. */
export function grpcConsumerRefsForBinding(
  binding: GrpcBindingFact,
  consumer: { repoId: string; repoName: string },
  index: { serviceContracts: ReadonlyMap<string, string>; typeContracts: ReadonlyMap<string, string>; rpcTypes: ReadonlyMap<string, readonly string[]>; messages: ReadonlyMap<string, ProtoMessageDef> },
): ProtocolConsumerRef[] {
  if (binding.role !== 'consumer') return [];
  const refs: ProtocolConsumerRef[] = [];
  const certainty: ContractConsumerRef['certainty'] = binding.certainty === 'exact' && binding.symbolId ? 'exact' : binding.boundaryReasons.length > 0 ? 'lower-bound' : 'heuristic';
  const coverage = { complete: binding.certainty === 'exact', examinedCount: 1, totalKnownCount: binding.rpcIds.length, incompleteReasons: [...binding.boundaryReasons] };
  const base = {
    repositoryId: consumer.repoId,
    repositoryName: consumer.repoName,
    consumerId: binding.symbolId ?? `${binding.filePath}:${binding.line}`,
    sourceCanonicalId: binding.symbolId,
    sourceAnchor: `${binding.filePath}:${binding.line}`,
    certainty,
    coverage,
  };
  for (const rpcId of binding.rpcIds) {
    const serviceFullName = rpcId.slice('grpc:'.length).split('/')[0]!;
    const serviceContract = index.serviceContracts.get(serviceFullName);
    if (serviceContract) refs.push({ contractId: serviceContract, ref: { ...base, consumedFields: [`rpc:${rpcId}`], callSites: [rpcId] } });
    const reachable = new Set<string>();
    for (const typeName of index.rpcTypes.get(rpcId) ?? []) reachableTypes(typeName, index.messages, reachable);
    for (const typeName of reachable) {
      const typeContract = index.typeContracts.get(typeName);
      if (typeContract) refs.push({ contractId: typeContract, ref: { ...base, consumedFields: [`type:${typeName}`, `via:${rpcId}`], callSites: [rpcId] } });
    }
  }
  return refs;
}

/**
 * Group-wide protocol consumers: every member's operations mapped against every member's
 * schema (exact only for a unique fully-validating schema) and every member's gRPC binding
 * sites resolved against the group's protos by canonical package/service/RPC.
 */
export function buildProtocolConsumerRefs(contracts: readonly Contract[], members: readonly ProtocolMemberSnapshot[]): ProtocolConsumerRef[] {
  const refs: ProtocolConsumerRef[] = [];

  const schemas = members.flatMap((member) => (member.snapshot.graphql.schema ? [member.snapshot.graphql.schema] : []));
  const graphqlContractIds = new Map<string, Map<string, string>>();
  for (const contract of contracts) {
    if (contract.protocol?.protocol !== 'graphql' || !contract.contractId) continue;
    const byType = graphqlContractIds.get(contract.protocol.service) ?? new Map<string, string>();
    byType.set(contract.protocol.type.name, contract.contractId);
    graphqlContractIds.set(contract.protocol.service, byType);
  }
  if (schemas.length > 0) {
    for (const member of members) {
      // An operation imported/used by several functions has one fact per using symbol; map the
      // document once and emit a ref per fact.
      const factsById = new Map<string, GraphQLOperationFact[]>();
      for (const operation of member.snapshot.graphql.operations) factsById.set(operation.operationId, [...(factsById.get(operation.operationId) ?? []), operation]);
      const unique = [...factsById.values()].map((facts) => facts[0]!);
      for (const mapping of mapOperations(unique, schemas)) {
        for (const fact of factsById.get(mapping.operationId) ?? []) {
          refs.push(...graphqlConsumerRefsForMapping(mapping, fact, { repoId: member.repoId, repoName: member.repoName }, graphqlContractIds.get(mapping.service) ?? new Map()));
        }
      }
    }
  }

  const protos = members.flatMap((member) => member.snapshot.grpc.files);
  if (protos.length > 0) {
    const serviceContracts = new Map<string, string>();
    const typeContracts = new Map<string, string>();
    for (const contract of contracts) {
      if (contract.protocol?.protocol !== 'grpc' || !contract.contractId) continue;
      if (contract.protocol.definition.kind === 'service') serviceContracts.set(contract.name, contract.contractId);
      else typeContracts.set(contract.name, contract.contractId);
    }
    const rpcTypes = new Map<string, string[]>();
    const messages = new Map<string, ProtoMessageDef>();
    for (const file of protos) {
      for (const message of file.messages) messages.set(message.fullName, message);
      for (const service of file.services) for (const rpc of service.rpcs) rpcTypes.set(`grpc:${service.fullName}/${rpc.name}`, [rpc.requestType, rpc.responseType]);
    }
    for (const member of members) {
      for (const binding of resolveGrpcBindings(member.snapshot.grpc.bindingSites, protos)) {
        refs.push(...grpcConsumerRefsForBinding(binding, { repoId: member.repoId, repoName: member.repoName }, { serviceContracts, typeContracts, rpcTypes, messages }));
      }
    }
  }
  return refs;
}

/** Maps operations from `members` against one specific schema — used by drift to find the
 * consumers that relied on the *base* schema. */
export function graphqlConsumersForSchema(schema: GraphQLSchemaModel, contractIdByType: ReadonlyMap<string, string>, members: readonly ProtocolMemberSnapshot[]): ProtocolConsumerRef[] {
  const refs: ProtocolConsumerRef[] = [];
  for (const member of members) {
    for (const operation of member.snapshot.graphql.operations) {
      const mapping = mapOperationToSchema(operation, schema);
      refs.push(...graphqlConsumerRefsForMapping(mapping, operation, { repoId: member.repoId, repoName: member.repoName }, contractIdByType));
    }
  }
  return refs;
}
