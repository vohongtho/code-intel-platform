import type { ContractConsumerRef, ContractDriftCompatibility, ContractDriftFinding, ProtocolCompatibilityDimensions } from '../types.js';
import type { GrpcContractPayload } from '../protocol-contracts.js';
import type { ContractComparatorInput } from './common.js';
import { makeFinding } from './common.js';
import { isReservedNumber } from '../schema-parsers/proto-model.js';
import {
  GRPC_CONTRACT_SCHEMA_VERSION,
  grpcRpcId,
  type ProtoEnumDef,
  type ProtoFieldDef,
  type ProtoMessageDef,
  type ProtoServiceDef,
} from '../../semantic/protocol-contracts/grpc-types.js';

/**
 * Protobuf/gRPC compatibility with separate wire and generated-source dimensions (rule table:
 * docs/protocol-contract-compatibility.md, following the protobuf language guide's "Updating A
 * Message Type" rules). The top-level `compatibility` is the conservative aggregate of both.
 */

type Wire = NonNullable<ProtocolCompatibilityDimensions['wire']>;
type Source = NonNullable<ProtocolCompatibilityDimensions['source']>;

/** Conservative aggregate: any breaking dimension breaks; unknown wire never reads as safe. */
export function aggregateDimensions(dimensions: ProtocolCompatibilityDimensions): ContractDriftCompatibility {
  if (dimensions.wire === 'breaking' || dimensions.source === 'breaking') return 'breaking';
  if (dimensions.source === 'potentially-breaking') return 'potentially-breaking';
  if (dimensions.wire === 'unknown' || dimensions.source === 'unknown') return 'unknown';
  return 'compatible';
}

/** Wire-compatible scalar groups (language guide): values may be truncated/reinterpreted
 * within a group but parse; across groups they do not. */
const WIRE_GROUP: Record<string, string> = {
  int32: 'varint', uint32: 'varint', int64: 'varint', uint64: 'varint', bool: 'varint', enum: 'varint',
  sint32: 'zigzag', sint64: 'zigzag',
  fixed32: 'fixed32', sfixed32: 'fixed32',
  fixed64: 'fixed64', sfixed64: 'fixed64',
  float: 'float', double: 'double',
  string: 'length', bytes: 'length',
};

function wireTypeOf(field: ProtoFieldDef): string {
  if (field.cardinality === 'map') return `map<${field.mapKeyType},${field.mapValueType}>`;
  if (field.typeKind === 'enum') return 'enum';
  if (field.typeKind === 'message') return `message:${field.resolvedType}`;
  return field.resolvedType ?? field.type;
}

function compareFieldTypes(base: ProtoFieldDef, head: ProtoFieldDef): { wire: Wire; source: Source; note: string } | undefined {
  const baseWire = wireTypeOf(base);
  const headWire = wireTypeOf(head);
  if (baseWire === headWire && (base.resolvedType ?? base.type) === (head.resolvedType ?? head.type)) return undefined;
  if (!base.resolvedType || !head.resolvedType) return { wire: 'unknown', source: 'breaking', note: 'type reference could not be resolved on one side' };
  const baseGroup = WIRE_GROUP[baseWire];
  const headGroup = WIRE_GROUP[headWire];
  if (baseGroup && baseGroup === headGroup) {
    return { wire: 'compatible', source: 'breaking', note: `${base.type} -> ${head.type} stays in the ${baseGroup} wire group (values may be truncated or reinterpreted)` };
  }
  if (baseWire.startsWith('message:') && headWire.startsWith('message:')) {
    return { wire: 'unknown', source: 'breaking', note: `message type ${base.resolvedType} -> ${head.resolvedType}; wire compatibility depends on both messages' field numbers` };
  }
  if ((baseWire.startsWith('message:') && headWire === 'bytes') || (baseWire === 'bytes' && headWire.startsWith('message:'))) {
    return { wire: 'unknown', source: 'breaking', note: 'bytes <-> message is wire compatible only if the bytes hold an encoded message' };
  }
  return { wire: 'breaking', source: 'breaking', note: `${base.type} -> ${head.type} changes the wire encoding` };
}

function payloadOf(contract: ContractComparatorInput['baseContract']): GrpcContractPayload | undefined {
  const protocol = contract?.protocol;
  return protocol?.protocol === 'grpc' && protocol.schemaVersion === GRPC_CONTRACT_SCHEMA_VERSION ? protocol : undefined;
}

interface Context {
  input: ContractComparatorInput;
  contractId: string;
  repositoryId: string;
  consumers: readonly ContractConsumerRef[];
  coverageReasons: string[];
  findings: ContractDriftFinding[];
}

function emit(ctx: Context, changeKind: string, summary: string, dimensions: ProtocolCompatibilityDimensions, evidence: readonly string[], options: { affected?: readonly ContractConsumerRef[]; extraReasons?: readonly string[] } = {}): void {
  // Only a change that breaks something lists consumers; a fully compatible change never
  // claims impact on them.
  const aggregate = aggregateDimensions(dimensions);
  const affected = options.affected ?? (aggregate === 'compatible' ? [] : ctx.consumers);
  ctx.findings.push(makeFinding({
    contractId: ctx.contractId,
    kind: 'grpc',
    repositoryId: ctx.repositoryId,
    baseVersion: ctx.input.baseVersion,
    headVersion: ctx.input.headVersion,
    affectedConsumers: affected,
    compatibility: aggregate,
    changeKind,
    summary,
    ruleEvidence: evidence,
    extraCoverageReasons: [...ctx.coverageReasons, ...(options.extraReasons ?? [])],
    protocolDimensions: dimensions,
  }));
}

function compareMessages(ctx: Context, base: ProtoMessageDef, head: ProtoMessageDef): void {
  const headByNumber = new Map(head.fields.map((field) => [field.number, field] as const));
  const headByName = new Map(head.fields.map((field) => [field.name, field] as const));
  const baseByNumber = new Map(base.fields.map((field) => [field.number, field] as const));
  const baseByName = new Map(base.fields.map((field) => [field.name, field] as const));
  const owner = base.fullName;

  for (const baseField of base.fields) {
    const label = `${owner}.${baseField.name} = ${baseField.number}`;
    const headField = headByNumber.get(baseField.number);
    if (!headField) {
      const moved = headByName.get(baseField.name);
      if (moved) {
        emit(ctx, 'proto-field-number-changed', `field ${owner}.${baseField.name} changed number ${baseField.number} -> ${moved.number}; old and new peers no longer exchange it`, { wire: 'breaking', source: 'compatible' }, [label]);
        continue;
      }
      const reserved = isReservedNumber(head.reserved, baseField.number) && head.reserved.names.includes(baseField.name);
      if (reserved) {
        emit(ctx, 'proto-field-removed-reserved', `field ${label} was removed and its number/name reserved; generated code referencing it no longer compiles`, { wire: 'compatible', source: 'breaking' }, [label]);
      } else {
        const numberReserved = isReservedNumber(head.reserved, baseField.number);
        emit(ctx, 'proto-field-removed-unreserved', `field ${label} was removed without reserving its ${numberReserved ? 'name' : 'number'}; a later reuse would corrupt old data`, { wire: numberReserved ? 'compatible' : 'unknown', source: 'breaking' }, [label], { extraReasons: ['field-number-reuse-risk'] });
      }
      continue;
    }
    const typeChange = compareFieldTypes(baseField, headField);
    if (headField.name !== baseField.name) {
      // Different name AND different type (or a name that already existed elsewhere) on the
      // same number is a reuse of the number by another field, not a rename.
      if (typeChange || baseByName.has(headField.name)) {
        emit(ctx, 'proto-field-number-reused', `number ${baseField.number} of ${owner} was reused by "${headField.name}: ${headField.type}" (previously "${baseField.name}: ${baseField.type}")`, { wire: 'breaking', source: 'breaking' }, [label]);
        continue;
      }
      emit(ctx, 'proto-field-renamed', `field ${label} was renamed to "${headField.name}" (same number); binary wire format is unchanged, generated accessors and JSON names are not`, { wire: 'compatible', source: 'breaking' }, [label]);
    }
    if (typeChange) emit(ctx, 'proto-field-type-changed', `field ${label}: ${typeChange.note}`, { wire: typeChange.wire, source: typeChange.source }, [label]);
    if (baseField.cardinality !== headField.cardinality) {
      const presenceOnly = new Set([baseField.cardinality, headField.cardinality]);
      const wire: Wire = presenceOnly.has('repeated') || presenceOnly.has('map') ? 'unknown' : presenceOnly.has('required') ? 'breaking' : 'compatible';
      emit(ctx, 'proto-field-cardinality-changed', `field ${label} changed ${baseField.cardinality} -> ${headField.cardinality}`, { wire, source: wire === 'compatible' ? 'potentially-breaking' : 'breaking' }, [label]);
    }
    if (baseField.oneof !== headField.oneof) {
      emit(ctx, 'proto-field-oneof-changed', `field ${label} moved ${baseField.oneof ? `out of oneof "${baseField.oneof}"` : 'into'}${headField.oneof ? ` oneof "${headField.oneof}"` : ''}; safe only if no sender sets more than one member`, { wire: 'unknown', source: 'potentially-breaking' }, [label], { extraReasons: ['oneof-membership-change'] });
    }
  }

  for (const headField of head.fields) {
    if (baseByNumber.has(headField.number) || baseByName.has(headField.name)) continue;
    const label = `${owner}.${headField.name} = ${headField.number}`;
    if (isReservedNumber(base.reserved, headField.number) || base.reserved.names.includes(headField.name)) {
      emit(ctx, 'proto-reserved-field-reused', `field ${label} reuses a number/name reserved in base`, { wire: 'breaking', source: 'breaking' }, [label]);
    } else if (headField.cardinality === 'required') {
      emit(ctx, 'proto-required-field-added', `proto2 required field ${label} was added; messages from old senders fail to parse`, { wire: 'breaking', source: 'breaking' }, [label]);
    } else {
      emit(ctx, 'proto-field-added', `field ${label} was added`, { wire: 'compatible', source: 'compatible' }, [label]);
    }
  }
}

function compareEnums(ctx: Context, base: ProtoEnumDef, head: ProtoEnumDef): void {
  const headByName = new Map(head.values.map((value) => [value.name, value] as const));
  const headByNumber = new Map<number, string[]>();
  for (const value of head.values) headByNumber.set(value.number, [...(headByNumber.get(value.number) ?? []), value.name]);
  const baseNames = new Set(base.values.map((value) => value.name));
  for (const value of base.values) {
    const label = `${base.fullName}.${value.name} = ${value.number}`;
    const headValue = headByName.get(value.name);
    if (headValue && headValue.number !== value.number) {
      emit(ctx, 'proto-enum-number-changed', `enum value ${base.fullName}.${value.name} changed number ${value.number} -> ${headValue.number}`, { wire: 'breaking', source: 'compatible' }, [label]);
      continue;
    }
    if (headValue) continue;
    const renamedTo = (headByNumber.get(value.number) ?? []).filter((name) => !baseNames.has(name));
    if (renamedTo.length > 0) {
      emit(ctx, 'proto-enum-value-renamed', `enum value ${label} was renamed to ${renamedTo.join('/')} (same number)`, { wire: 'compatible', source: 'breaking' }, [label]);
    } else if (isReservedNumber(head.reserved, value.number)) {
      emit(ctx, 'proto-enum-value-removed-reserved', `enum value ${label} was removed and its number reserved`, { wire: 'compatible', source: 'breaking' }, [label]);
    } else {
      emit(ctx, 'proto-enum-value-removed-unreserved', `enum value ${label} was removed without reserving its number`, { wire: 'unknown', source: 'breaking' }, [label], { extraReasons: ['enum-number-reuse-risk'] });
    }
  }
  for (const value of head.values) {
    if (baseNames.has(value.name)) continue;
    if (base.values.some((existing) => existing.number === value.number)) continue; // reported as a rename above
    const label = `${head.fullName}.${value.name} = ${value.number}`;
    if (isReservedNumber(base.reserved, value.number)) {
      emit(ctx, 'proto-enum-reserved-number-reused', `enum value ${label} reuses a number reserved in base`, { wire: 'breaking', source: 'breaking' }, [label]);
    } else {
      emit(ctx, 'proto-enum-value-added', `enum value ${label} was added; old readers see an unknown value`, { wire: 'compatible', source: 'potentially-breaking' }, [label], { affected: [] });
    }
  }
}

function compareServices(ctx: Context, base: ProtoServiceDef, head: ProtoServiceDef): void {
  const headRpcs = new Map(head.rpcs.map((rpc) => [rpc.name, rpc] as const));
  const baseRpcs = new Set(base.rpcs.map((rpc) => rpc.name));
  const rpcConsumers = (rpcId: string) => ctx.consumers.filter((consumer) => (consumer.consumedFields ?? []).includes(`rpc:${rpcId}`));
  for (const rpc of base.rpcs) {
    const rpcId = grpcRpcId(base.fullName, rpc.name);
    const headRpc = headRpcs.get(rpc.name);
    if (!headRpc) {
      emit(ctx, 'grpc-rpc-removed', `RPC ${rpcId} was removed; callers get UNIMPLEMENTED`, { wire: 'breaking', source: 'breaking' }, [rpcId], { affected: rpcConsumers(rpcId) });
      continue;
    }
    if (rpc.requestType !== headRpc.requestType || rpc.responseType !== headRpc.responseType) {
      emit(ctx, 'grpc-rpc-message-changed', `RPC ${rpcId} changed (${rpc.requestType}) returns (${rpc.responseType}) -> (${headRpc.requestType}) returns (${headRpc.responseType})`, { wire: 'breaking', source: 'breaking' }, [rpcId], { affected: rpcConsumers(rpcId) });
    }
    if (rpc.streaming !== headRpc.streaming) {
      emit(ctx, 'grpc-rpc-streaming-changed', `RPC ${rpcId} changed streaming mode ${rpc.streaming} -> ${headRpc.streaming}`, { wire: 'breaking', source: 'breaking' }, [rpcId], { affected: rpcConsumers(rpcId) });
    }
  }
  for (const rpc of head.rpcs) {
    if (!baseRpcs.has(rpc.name)) emit(ctx, 'grpc-rpc-added', `RPC ${grpcRpcId(head.fullName, rpc.name)} was added`, { wire: 'compatible', source: 'compatible' }, [grpcRpcId(head.fullName, rpc.name)], { affected: [] });
  }
}

function definitionName(payload: GrpcContractPayload): string {
  const definition = payload.definition;
  return definition.kind === 'service' ? definition.service.fullName : definition.kind === 'message' ? definition.message.fullName : definition.enum.fullName;
}

export function compareGrpcContracts(input: ContractComparatorInput): ContractDriftFinding[] {
  const contractId = input.headVersion?.contractId ?? input.baseVersion?.contractId;
  const repositoryId = input.headVersion?.repositoryId ?? input.baseVersion?.repositoryId;
  if (!contractId || !repositoryId) return [];
  const base = payloadOf(input.baseContract);
  const head = payloadOf(input.headContract);
  const consumers = input.affectedConsumers ?? [];

  const legacySide = (input.baseVersion && !base) || input.protocolUnavailable?.base ? 'base'
    : (input.headVersion && !head) || input.protocolUnavailable?.head ? 'head' : undefined;
  if (legacySide) {
    return [makeFinding({
      contractId,
      kind: 'grpc',
      repositoryId,
      baseVersion: input.baseVersion,
      headVersion: input.headVersion,
      affectedConsumers: consumers,
      compatibility: 'unknown',
      changeKind: 'grpc-legacy-schema',
      summary: `${legacySide} gRPC contract predates the ${GRPC_CONTRACT_SCHEMA_VERSION} proto model; re-run group sync / rebuild the snapshot to compare it`,
      extraCoverageReasons: ['legacy-schema'],
      protocolDimensions: { wire: 'unknown', source: 'unknown' },
    })];
  }
  if (!base && !head) return [];

  const ctx: Context = {
    input,
    contractId,
    repositoryId,
    consumers,
    coverageReasons: [...new Set([...(base?.coverage.boundaryReasons ?? []), ...(head?.coverage.boundaryReasons ?? [])])].sort(),
    findings: [],
  };

  if (base && !head) {
    const kind = base.definition.kind;
    emit(ctx, `grpc-${kind}-removed`, `${kind} ${definitionName(base)} was removed`, kind === 'service' ? { wire: 'breaking', source: 'breaking' } : { wire: 'unknown', source: 'breaking' }, [definitionName(base)]);
    return ctx.findings;
  }
  if (!base && head) {
    emit(ctx, `grpc-${head.definition.kind}-added`, `${head.definition.kind} ${definitionName(head)} was added`, { wire: 'compatible', source: 'compatible' }, [definitionName(head)], { affected: [] });
    return ctx.findings;
  }

  if (base!.package !== head!.package) {
    emit(ctx, 'grpc-package-changed', `package ${base!.package ?? '(none)'} -> ${head!.package ?? '(none)'} changes every fully-qualified name`, { wire: 'breaking', source: 'breaking' }, [definitionName(base!)]);
    return ctx.findings;
  }
  const b = base!.definition;
  const h = head!.definition;
  if (b.kind === 'message' && h.kind === 'message') compareMessages(ctx, b.message, h.message);
  else if (b.kind === 'enum' && h.kind === 'enum') compareEnums(ctx, b.enum, h.enum);
  else if (b.kind === 'service' && h.kind === 'service') compareServices(ctx, b.service, h.service);

  if (ctx.findings.length === 0 && ctx.coverageReasons.length > 0) {
    emit(ctx, 'grpc-structure-incomplete', `${definitionName(base!)} was only partially parsed; no change was found in the parsed part`, { wire: 'unknown', source: 'unknown' }, [definitionName(base!)], { affected: [] });
  }
  return ctx.findings;
}
