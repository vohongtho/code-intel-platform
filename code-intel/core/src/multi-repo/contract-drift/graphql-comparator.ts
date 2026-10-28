import type { ContractConsumerRef, ContractDriftCompatibility, ContractDriftFinding } from '../types.js';
import type { GraphQLContractPayload } from '../protocol-contracts.js';
import type { ContractComparatorInput } from './common.js';
import { makeFinding } from './common.js';
import {
  BUILTIN_SCALARS,
  GRAPHQL_CONTRACT_SCHEMA_VERSION,
  printTypeRef,
  type GraphQLArgumentDef,
  type GraphQLFieldDef,
  type GraphQLInputFieldDef,
  type GraphQLTypeDef,
  type GraphQLTypeRef,
} from '../../semantic/protocol-contracts/graphql-types.js';

/**
 * GraphQL schema compatibility (documented rule table: docs/protocol-contract-compatibility.md).
 *
 * Every rule distinguishes a *proven affected known consumer* — an operation whose mapped
 * selection/argument/enum/input evidence names the changed element — from schema-level
 * potential breakage: without such evidence a breaking change is reported as
 * `potentially-breaking` with no fabricated consumer. Directive, runtime-authorization and
 * custom-scalar semantics are not modeled and surface as `unknown` boundaries.
 */

type WrapperChange = 'same' | 'strengthened' | 'weakened' | 'shape-changed' | 'named-type-changed';
const WRAPPER_RANK: Record<WrapperChange, number> = { same: 0, strengthened: 1, weakened: 2, 'shape-changed': 3, 'named-type-changed': 4 };

function worst(a: WrapperChange, b: WrapperChange): WrapperChange {
  return WRAPPER_RANK[a] >= WRAPPER_RANK[b] ? a : b;
}

/** Structural comparison of two wrapper chains; `strengthened` = nullable became non-null. */
export function compareTypeRefs(base: GraphQLTypeRef, head: GraphQLTypeRef): WrapperChange {
  if (base.kind === 'non-null' && head.kind === 'non-null') return compareTypeRefs(base.ofType, head.ofType);
  if (head.kind === 'non-null') return worst('strengthened', compareTypeRefs(base, head.ofType));
  if (base.kind === 'non-null') return worst('weakened', compareTypeRefs(base.ofType, head));
  if (base.kind === 'list' && head.kind === 'list') return compareTypeRefs(base.ofType, head.ofType);
  if (base.kind === 'list' || head.kind === 'list') return 'shape-changed';
  return base.name === head.name ? 'same' : 'named-type-changed';
}

function isRequiredInput(value: { type: GraphQLTypeRef; defaultValue?: string }): boolean {
  return value.type.kind === 'non-null' && value.defaultValue === undefined;
}

function payloadOf(contract: ContractComparatorInput['baseContract']): GraphQLContractPayload | undefined {
  const protocol = contract?.protocol;
  return protocol?.protocol === 'graphql' && protocol.schemaVersion === GRAPHQL_CONTRACT_SCHEMA_VERSION ? protocol : undefined;
}

interface Context {
  input: ContractComparatorInput;
  contractId: string;
  repositoryId: string;
  consumers: readonly ContractConsumerRef[];
  coverageReasons: string[];
  findings: ContractDriftFinding[];
  resolvers: Record<string, string>;
}

/** `Query.user(id)` -> `user`: the root field whose resolver handles this evidence key. */
function rootFieldOf(key: string): string {
  return (key.split('.')[1] ?? '').replace(/\(.*$/, '');
}

function readers(ctx: Context, evidence: readonly string[]): ContractConsumerRef[] {
  return ctx.consumers.filter((consumer) => (consumer.consumedFields ?? []).some((field) => evidence.includes(field)));
}

/** Emits a finding whose verdict depends on proven readers: `ifRead` when some known consumer's
 * evidence names the element, otherwise `ifUnread` with no fabricated consumers. */
function emit(
  ctx: Context,
  changeKind: string,
  summary: string,
  evidence: readonly string[],
  verdicts: { ifRead: ContractDriftCompatibility; ifUnread: ContractDriftCompatibility },
  options: { affected?: readonly ContractConsumerRef[]; extraReasons?: readonly string[] } = {},
): void {
  const affected = options.affected ?? readers(ctx, evidence);
  const resolverEvidence = evidence.flatMap((key) => {
    const symbol = ctx.resolvers[rootFieldOf(key)];
    return symbol ? [symbol] : [];
  });
  ctx.findings.push(makeFinding({
    contractId: ctx.contractId,
    kind: 'graphql',
    repositoryId: ctx.repositoryId,
    baseVersion: ctx.input.baseVersion,
    headVersion: ctx.input.headVersion,
    affectedConsumers: affected,
    compatibility: affected.length > 0 ? verdicts.ifRead : verdicts.ifUnread,
    changeKind,
    summary,
    ruleEvidence: [...evidence, ...resolverEvidence],
    extraCoverageReasons: [...ctx.coverageReasons, ...(options.extraReasons ?? [])],
  }));
}

function compareDirectives(ctx: Context, owner: string, base: readonly string[], head: readonly string[]): void {
  if (base.join('\u0000') === head.join('\u0000')) return;
  emit(ctx, 'graphql-directive-changed', `directives on ${owner} changed (${base.join(' ') || 'none'} -> ${head.join(' ') || 'none'})`, [owner], { ifRead: 'unknown', ifUnread: 'unknown' }, { extraReasons: ['directive-semantics-not-modeled'] });
}

function compareArguments(ctx: Context, typeName: string, base: GraphQLFieldDef, head: GraphQLFieldDef): void {
  const fieldKey = `${typeName}.${base.name}`;
  const selectors = readers(ctx, [fieldKey]);
  const headArgs = new Map(head.args.map((arg) => [arg.name, arg] as const));
  const baseArgs = new Map(base.args.map((arg) => [arg.name, arg] as const));
  const passes = (consumer: ContractConsumerRef, arg: string) => (consumer.consumedFields ?? []).includes(`${fieldKey}(${arg})`);

  for (const baseArg of base.args) {
    const argKey = `${fieldKey}(${baseArg.name})`;
    const headArg = headArgs.get(baseArg.name);
    if (!headArg) {
      emit(ctx, 'graphql-argument-removed', `argument "${baseArg.name}" of ${fieldKey} was removed`, [argKey], { ifRead: 'breaking', ifUnread: 'potentially-breaking' });
      continue;
    }
    compareInputValue(ctx, argKey, `argument "${baseArg.name}" of ${fieldKey}`, baseArg, headArg, selectors.filter((consumer) => !passes(consumer, baseArg.name)), readers(ctx, [argKey]));
  }
  for (const headArg of head.args) {
    if (baseArgs.has(headArg.name)) continue;
    const argKey = `${fieldKey}(${headArg.name})`;
    if (isRequiredInput(headArg)) {
      emit(ctx, 'graphql-required-argument-added', `${fieldKey} gained required argument "${headArg.name}: ${printTypeRef(headArg.type)}" without a default`, [fieldKey], { ifRead: 'breaking', ifUnread: 'potentially-breaking' }, { affected: selectors.filter((consumer) => !passes(consumer, headArg.name)) });
    } else {
      emit(ctx, 'graphql-optional-argument-added', `${fieldKey} gained optional argument "${headArg.name}"`, [argKey], { ifRead: 'compatible', ifUnread: 'compatible' }, { affected: [] });
    }
  }
}

/** Input-direction rules shared by arguments and input-object fields: becoming required is
 * breaking for senders that omit it; type changes are breaking for senders. */
function compareInputValue(
  ctx: Context,
  key: string,
  label: string,
  base: GraphQLArgumentDef | GraphQLInputFieldDef,
  head: GraphQLArgumentDef | GraphQLInputFieldDef,
  omitters: readonly ContractConsumerRef[],
  senders: readonly ContractConsumerRef[],
): void {
  const change = compareTypeRefs(base.type, head.type);
  if (change === 'named-type-changed' || change === 'shape-changed') {
    emit(ctx, 'graphql-input-type-changed', `${label} changed type ${printTypeRef(base.type)} -> ${printTypeRef(head.type)}`, [key], { ifRead: 'breaking', ifUnread: 'potentially-breaking' }, { affected: senders });
  } else if (change === 'strengthened' && isRequiredInput(head)) {
    emit(ctx, 'graphql-input-became-required', `${label} became required (${printTypeRef(base.type)} -> ${printTypeRef(head.type)}) without a default`, [key], { ifRead: 'breaking', ifUnread: 'potentially-breaking' }, { affected: omitters });
  } else if (change === 'weakened') {
    emit(ctx, 'graphql-input-became-optional', `${label} became optional (${printTypeRef(base.type)} -> ${printTypeRef(head.type)})`, [key], { ifRead: 'compatible', ifUnread: 'compatible' }, { affected: [] });
  }
  if (base.defaultValue !== head.defaultValue && change !== 'named-type-changed') {
    emit(ctx, 'graphql-default-value-changed', `${label} default changed (${base.defaultValue ?? 'none'} -> ${head.defaultValue ?? 'none'})`, [key], { ifRead: 'potentially-breaking', ifUnread: 'potentially-breaking' }, { affected: omitters });
  }
  compareDirectives(ctx, label, base.directives, head.directives);
}

function compareOutputFields(ctx: Context, base: GraphQLTypeDef, head: GraphQLTypeDef): void {
  const headFields = new Map((head.fields ?? []).map((field) => [field.name, field] as const));
  const baseFields = new Map((base.fields ?? []).map((field) => [field.name, field] as const));
  for (const baseField of base.fields ?? []) {
    const key = `${base.name}.${baseField.name}`;
    const headField = headFields.get(baseField.name);
    if (!headField) {
      emit(ctx, 'graphql-field-removed', `field ${key} was removed`, [key], { ifRead: 'breaking', ifUnread: 'potentially-breaking' });
      continue;
    }
    const change = compareTypeRefs(baseField.type, headField.type);
    if (change === 'named-type-changed' || change === 'shape-changed') {
      emit(ctx, 'graphql-field-type-changed', `field ${key} changed type ${printTypeRef(baseField.type)} -> ${printTypeRef(headField.type)}`, [key], { ifRead: 'breaking', ifUnread: 'potentially-breaking' });
    } else if (change === 'weakened') {
      emit(ctx, 'graphql-field-became-nullable', `field ${key} became nullable (${printTypeRef(baseField.type)} -> ${printTypeRef(headField.type)}); clients may not handle null`, [key], { ifRead: 'potentially-breaking', ifUnread: 'potentially-breaking' });
    } else if (change === 'strengthened') {
      emit(ctx, 'graphql-field-became-non-null', `field ${key} became non-null (${printTypeRef(baseField.type)} -> ${printTypeRef(headField.type)})`, [key], { ifRead: 'compatible', ifUnread: 'compatible' }, { affected: [] });
    }
    if (!baseField.deprecated && headField.deprecated) {
      emit(ctx, 'graphql-field-deprecated', `field ${key} was deprecated`, [key], { ifRead: 'compatible', ifUnread: 'compatible' });
    }
    compareArguments(ctx, base.name, baseField, headField);
    compareDirectives(ctx, `field ${key}`, baseField.directives, headField.directives);
  }
  for (const headField of head.fields ?? []) {
    if (baseFields.has(headField.name)) continue;
    const key = `${head.name}.${headField.name}`;
    const nullable = headField.type.kind !== 'non-null';
    emit(ctx, 'graphql-field-added', `${nullable ? 'nullable' : 'non-null'} output field ${key} was added`, [key], { ifRead: 'compatible', ifUnread: 'compatible' }, { affected: [] });
  }
}

function compareInputFields(ctx: Context, base: GraphQLTypeDef, head: GraphQLTypeDef): void {
  const inputKey = `input:${base.name}`;
  const users = readers(ctx, [inputKey]);
  const headFields = new Map((head.inputFields ?? []).map((field) => [field.name, field] as const));
  const baseFields = new Map((base.inputFields ?? []).map((field) => [field.name, field] as const));
  for (const baseField of base.inputFields ?? []) {
    const key = `${base.name}.${baseField.name}`;
    const headField = headFields.get(baseField.name);
    if (!headField) {
      emit(ctx, 'graphql-input-field-removed', `input field ${key} was removed; clients still sending it are rejected`, [inputKey], { ifRead: 'breaking', ifUnread: 'potentially-breaking' });
      continue;
    }
    compareInputValue(ctx, key, `input field ${key}`, baseField, headField, users, users);
  }
  for (const headField of head.inputFields ?? []) {
    if (baseFields.has(headField.name)) continue;
    const key = `${head.name}.${headField.name}`;
    if (isRequiredInput(headField)) {
      emit(ctx, 'graphql-input-field-added-required', `input ${head.name} gained required field "${headField.name}: ${printTypeRef(headField.type)}" without a default`, [inputKey], { ifRead: 'breaking', ifUnread: 'potentially-breaking' });
    } else {
      emit(ctx, 'graphql-input-field-added-optional', `optional input field ${key} was added`, [key], { ifRead: 'compatible', ifUnread: 'compatible' }, { affected: [] });
    }
  }
}

function compareEnumValues(ctx: Context, base: GraphQLTypeDef, head: GraphQLTypeDef): void {
  const headValues = new Set((head.enumValues ?? []).map((value) => value.name));
  const baseValues = new Set((base.enumValues ?? []).map((value) => value.name));
  for (const value of base.enumValues ?? []) {
    if (headValues.has(value.name)) continue;
    const key = `${base.name}.${value.name}`;
    // Proven: an operation sends this literal. Otherwise any operation sending the enum through a
    // variable may send it — potentially breaking for those, never fabricated as proven.
    const literalUsers = readers(ctx, [key]);
    const variableUsers = readers(ctx, [`input:${base.name}`]);
    emit(ctx, 'graphql-enum-value-removed', `enum value ${key} was removed`, [key], { ifRead: literalUsers.length > 0 ? 'breaking' : 'potentially-breaking', ifUnread: 'potentially-breaking' }, { affected: literalUsers.length > 0 ? literalUsers : variableUsers });
  }
  for (const value of head.enumValues ?? []) {
    if (baseValues.has(value.name)) continue;
    emit(ctx, 'graphql-enum-value-added', `enum value ${head.name}.${value.name} was added; clients exhaustively handling ${head.name} may not handle it`, [`${head.name}.${value.name}`], { ifRead: 'potentially-breaking', ifUnread: 'potentially-breaking' }, { affected: [] });
  }
}

function comparePossibleTypes(ctx: Context, base: GraphQLTypeDef, head: GraphQLTypeDef): void {
  const headMembers = new Set(head.possibleTypes ?? []);
  const baseMembers = new Set(base.possibleTypes ?? []);
  for (const member of base.possibleTypes ?? []) {
    if (!headMembers.has(member)) emit(ctx, 'graphql-possible-type-removed', `${member} is no longer a possible type of ${base.name}`, [base.name], { ifRead: 'potentially-breaking', ifUnread: 'potentially-breaking' }, { affected: [] });
  }
  for (const member of head.possibleTypes ?? []) {
    if (!baseMembers.has(member)) emit(ctx, 'graphql-possible-type-added', `${member} became a possible type of ${head.name}; clients switching on __typename may not handle it`, [head.name], { ifRead: 'potentially-breaking', ifUnread: 'potentially-breaking' }, { affected: [] });
  }
  const headInterfaces = new Set(head.interfaces ?? []);
  for (const iface of base.interfaces ?? []) {
    if (!headInterfaces.has(iface)) emit(ctx, 'graphql-interface-removed', `${base.name} no longer implements ${iface}`, [base.name], { ifRead: 'potentially-breaking', ifUnread: 'potentially-breaking' }, { affected: [] });
  }
}

function contractConsumers(ctx: Context): ContractConsumerRef[] {
  return [...ctx.consumers];
}

export function compareGraphQLContracts(input: ContractComparatorInput): ContractDriftFinding[] {
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
      kind: 'graphql',
      repositoryId,
      baseVersion: input.baseVersion,
      headVersion: input.headVersion,
      affectedConsumers: consumers,
      compatibility: 'unknown',
      changeKind: 'graphql-legacy-schema',
      summary: `${legacySide} GraphQL contract predates the ${GRAPHQL_CONTRACT_SCHEMA_VERSION} schema model; re-run group sync / rebuild the snapshot to compare it`,
      extraCoverageReasons: ['legacy-schema'],
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
    resolvers: { ...(base?.resolvers ?? {}), ...(head?.resolvers ?? {}) },
  };

  if (base && !head) {
    emit(ctx, 'graphql-type-removed', `type ${base.type.name} was removed`, [base.type.name], { ifRead: 'breaking', ifUnread: 'potentially-breaking' }, { affected: contractConsumers(ctx) });
    return ctx.findings;
  }
  if (!base && head) {
    emit(ctx, 'graphql-type-added', `type ${head.type.name} was added`, [head.type.name], { ifRead: 'compatible', ifUnread: 'compatible' }, { affected: [] });
    return ctx.findings;
  }

  const baseType = base!.type;
  const headType = head!.type;
  if (baseType.kind !== headType.kind) {
    emit(ctx, 'graphql-type-kind-changed', `type ${baseType.name} changed kind ${baseType.kind} -> ${headType.kind}`, [baseType.name], { ifRead: 'breaking', ifUnread: 'potentially-breaking' }, { affected: contractConsumers(ctx) });
    return ctx.findings;
  }
  if (baseType.kind === 'object' || baseType.kind === 'interface') compareOutputFields(ctx, baseType, headType);
  if (baseType.kind === 'input') compareInputFields(ctx, baseType, headType);
  if (baseType.kind === 'enum') compareEnumValues(ctx, baseType, headType);
  if (baseType.kind === 'union' || baseType.kind === 'interface' || baseType.kind === 'object') comparePossibleTypes(ctx, baseType, headType);
  if (baseType.kind === 'scalar' && !BUILTIN_SCALARS.has(baseType.name) && baseType.directives.join() !== headType.directives.join()) {
    emit(ctx, 'graphql-custom-scalar-changed', `custom scalar ${baseType.name} changed (${baseType.directives.join(' ') || 'none'} -> ${headType.directives.join(' ') || 'none'}); its value semantics are not statically modeled`, [baseType.name], { ifRead: 'unknown', ifUnread: 'unknown' }, { affected: contractConsumers(ctx), extraReasons: ['custom-scalar-semantics'] });
  } else if (baseType.kind !== 'scalar') {
    compareDirectives(ctx, `type ${baseType.name}`, baseType.directives, headType.directives);
  }

  if (ctx.findings.length === 0 && ctx.coverageReasons.length > 0) {
    emit(ctx, 'graphql-structure-incomplete', `schema for ${baseType.name} was only partially parsed; no change was found in the parsed part`, [baseType.name], { ifRead: 'unknown', ifUnread: 'unknown' }, { affected: [] });
  }
  return ctx.findings;
}
