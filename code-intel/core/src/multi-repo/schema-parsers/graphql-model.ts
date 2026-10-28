import { createHash } from 'node:crypto';
import { Kind, parse, print } from 'graphql';
import type {
  ConstDirectiveNode,
  DirectiveNode,
  DefinitionNode,
  DocumentNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  Location,
  NamedTypeNode,
  TypeNode,
} from 'graphql';
import {
  GRAPHQL_CONTRACT_SCHEMA_VERSION,
  GRAPHQL_LIMITS,
  type GraphQLArgumentDef,
  type GraphQLEnumValueDef,
  type GraphQLFieldDef,
  type GraphQLInputFieldDef,
  type GraphQLOperationType,
  type GraphQLSchemaModel,
  type GraphQLSourceAnchor,
  type GraphQLTypeDef,
  type GraphQLTypeKind,
  type GraphQLTypeRef,
} from '../../semantic/protocol-contracts/graphql-types.js';

export class GraphQLDepthLimitError extends Error {}

export type GraphQLParseOutcome =
  | { ok: true; document: DocumentNode }
  | { ok: false; reason: 'file-size-limit' | 'token-limit' | 'malformed-document'; message: string };

/** Parses one untrusted GraphQL document under GRAPHQL_LIMITS. Never executes anything: the
 * graphql-js parser only lexes/parses; directives are kept as printed text. */
export function parseGraphQLDocument(source: string): GraphQLParseOutcome {
  if (Buffer.byteLength(source, 'utf8') > GRAPHQL_LIMITS.maxFileBytes) {
    return { ok: false, reason: 'file-size-limit', message: `document exceeds ${GRAPHQL_LIMITS.maxFileBytes} bytes` };
  }
  try {
    return { ok: true, document: parse(source, { maxTokens: GRAPHQL_LIMITS.maxTokens }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // graphql-js 16 spells it "contains more that N tokens"; match either spelling.
    return { ok: false, reason: /more (?:than|that) \d+ tokens/i.test(message) ? 'token-limit' : 'malformed-document', message };
  }
}

export function anchorOf(filePath: string, loc: Location | undefined): GraphQLSourceAnchor {
  return { filePath, line: loc?.startToken.line ?? 0, column: loc?.startToken.column ?? 0 };
}

export function convertTypeRef(node: TypeNode, depth = 0): GraphQLTypeRef {
  if (depth > GRAPHQL_LIMITS.maxDepth) throw new GraphQLDepthLimitError(`type wrapper nesting exceeds ${GRAPHQL_LIMITS.maxDepth}`);
  if (node.kind === Kind.NAMED_TYPE) return { kind: 'named', name: node.name.value };
  if (node.kind === Kind.LIST_TYPE) return { kind: 'list', ofType: convertTypeRef(node.type, depth + 1) };
  return { kind: 'non-null', ofType: convertTypeRef(node.type, depth + 1) };
}

function directivesOf(nodes: readonly (ConstDirectiveNode | DirectiveNode)[] | undefined): { directives: string[]; deprecated: boolean } {
  const directives: string[] = [];
  let deprecated = false;
  for (const node of nodes ?? []) {
    if (node.name.value === 'deprecated') deprecated = true;
    else directives.push(print(node));
  }
  return { directives: directives.sort(), deprecated };
}

function argumentDef(filePath: string, node: InputValueDefinitionNode): GraphQLArgumentDef {
  return {
    name: node.name.value,
    type: convertTypeRef(node.type),
    defaultValue: node.defaultValue ? print(node.defaultValue) : undefined,
    directives: directivesOf(node.directives).directives,
    anchor: anchorOf(filePath, node.loc),
  };
}

function fieldDef(filePath: string, node: FieldDefinitionNode): GraphQLFieldDef {
  const { directives, deprecated } = directivesOf(node.directives);
  return {
    name: node.name.value,
    type: convertTypeRef(node.type),
    args: (node.arguments ?? []).map((arg) => argumentDef(filePath, arg)).sort((a, b) => a.name.localeCompare(b.name)),
    directives,
    deprecated,
    anchor: anchorOf(filePath, node.loc),
  };
}

function inputFieldDef(filePath: string, node: InputValueDefinitionNode): GraphQLInputFieldDef {
  const { directives, deprecated } = directivesOf(node.directives);
  return {
    name: node.name.value,
    type: convertTypeRef(node.type),
    defaultValue: node.defaultValue ? print(node.defaultValue) : undefined,
    directives,
    deprecated,
    anchor: anchorOf(filePath, node.loc),
  };
}

function enumValueDef(node: EnumValueDefinitionNode): GraphQLEnumValueDef {
  const { directives, deprecated } = directivesOf(node.directives);
  return { name: node.name.value, deprecated, directives };
}

interface MutableTypeDef {
  name: string;
  kind: GraphQLTypeKind;
  fields: Map<string, GraphQLFieldDef>;
  inputFields: Map<string, GraphQLInputFieldDef>;
  enumValues: Map<string, GraphQLEnumValueDef>;
  members: Set<string>;
  interfaces: Set<string>;
  directives: Set<string>;
  anchor: GraphQLSourceAnchor;
  defined: boolean;
}

const TYPE_KIND_BY_NODE: Partial<Record<string, GraphQLTypeKind>> = {
  [Kind.OBJECT_TYPE_DEFINITION]: 'object',
  [Kind.OBJECT_TYPE_EXTENSION]: 'object',
  [Kind.INTERFACE_TYPE_DEFINITION]: 'interface',
  [Kind.INTERFACE_TYPE_EXTENSION]: 'interface',
  [Kind.UNION_TYPE_DEFINITION]: 'union',
  [Kind.UNION_TYPE_EXTENSION]: 'union',
  [Kind.ENUM_TYPE_DEFINITION]: 'enum',
  [Kind.ENUM_TYPE_EXTENSION]: 'enum',
  [Kind.INPUT_OBJECT_TYPE_DEFINITION]: 'input',
  [Kind.INPUT_OBJECT_TYPE_EXTENSION]: 'input',
  [Kind.SCALAR_TYPE_DEFINITION]: 'scalar',
  [Kind.SCALAR_TYPE_EXTENSION]: 'scalar',
};

const DEFINITION_KINDS = new Set<string>([
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.SCALAR_TYPE_DEFINITION,
]);

class SchemaAccumulator {
  readonly types = new Map<string, MutableTypeDef>();
  readonly rootTypes: Partial<Record<GraphQLOperationType, string>> = {};
  readonly boundaries = new Set<string>();

  add(filePath: string, definition: DefinitionNode): void {
    if (definition.kind === Kind.SCHEMA_DEFINITION || definition.kind === Kind.SCHEMA_EXTENSION) {
      for (const operationType of definition.operationTypes ?? []) {
        this.rootTypes[operationType.operation as GraphQLOperationType] = operationType.type.name.value;
      }
      return;
    }
    const kind = TYPE_KIND_BY_NODE[definition.kind];
    if (!kind || !('name' in definition) || !definition.name) return;
    const name = definition.name.value;
    if (this.types.size >= GRAPHQL_LIMITS.maxTypesPerSchema && !this.types.has(name)) {
      this.boundaries.add('type-count-limit');
      return;
    }
    const isDefinition = DEFINITION_KINDS.has(definition.kind);
    let type = this.types.get(name);
    if (!type) {
      type = {
        name,
        kind,
        fields: new Map(),
        inputFields: new Map(),
        enumValues: new Map(),
        members: new Set(),
        interfaces: new Set(),
        directives: new Set(),
        anchor: anchorOf(filePath, definition.loc),
        defined: false,
      };
      this.types.set(name, type);
    }
    if (type.kind !== kind) {
      this.boundaries.add('conflicting-type-kind');
      return;
    }
    if (isDefinition) {
      if (type.defined) this.boundaries.add('duplicate-type-definition');
      type.defined = true;
      type.anchor = anchorOf(filePath, definition.loc);
    }
    for (const directive of directivesOf('directives' in definition ? definition.directives : undefined).directives) type.directives.add(directive);

    if ('fields' in definition && definition.fields) {
      for (const field of definition.fields) {
        if (kind === 'input') {
          const input = inputFieldDef(filePath, field as InputValueDefinitionNode);
          type.inputFields.set(input.name, input);
        } else {
          const output = fieldDef(filePath, field as FieldDefinitionNode);
          type.fields.set(output.name, output);
        }
      }
    }
    if ('interfaces' in definition) for (const iface of (definition.interfaces ?? []) as readonly NamedTypeNode[]) type.interfaces.add(iface.name.value);
    if ('types' in definition) for (const member of (definition.types ?? []) as readonly NamedTypeNode[]) type.members.add(member.name.value);
    if ('values' in definition) for (const value of definition.values ?? []) type.enumValues.set(value.name.value, enumValueDef(value));
  }

  build(service: string, files: readonly string[], extraBoundaries: readonly string[]): GraphQLSchemaModel {
    for (const type of this.types.values()) if (!type.defined) this.boundaries.add('extension-without-definition');
    const implementers = new Map<string, Set<string>>();
    for (const type of this.types.values()) {
      for (const iface of type.interfaces) {
        const set = implementers.get(iface) ?? new Set<string>();
        set.add(type.name);
        implementers.set(iface, set);
      }
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const types: GraphQLTypeDef[] = [...this.types.values()].map((type) => {
      const def: GraphQLTypeDef = { name: type.name, kind: type.kind, directives: [...type.directives].sort(), anchor: type.anchor };
      if (type.kind === 'object' || type.kind === 'interface') {
        def.fields = [...type.fields.values()].sort(byName);
        def.interfaces = [...type.interfaces].sort();
      }
      if (type.kind === 'interface') def.possibleTypes = [...(implementers.get(type.name) ?? [])].sort();
      if (type.kind === 'union') def.possibleTypes = [...type.members].sort();
      if (type.kind === 'input') def.inputFields = [...type.inputFields.values()].sort(byName);
      if (type.kind === 'enum') def.enumValues = [...type.enumValues.values()].sort(byName);
      return def;
    }).sort(byName);

    const rootTypes: Partial<Record<GraphQLOperationType, string>> = { ...this.rootTypes };
    for (const [operation, fallback] of [['query', 'Query'], ['mutation', 'Mutation'], ['subscription', 'Subscription']] as const) {
      if (!rootTypes[operation] && this.types.get(fallback)?.kind === 'object') rootTypes[operation] = fallback;
    }

    const boundaryReasons = [...new Set([...this.boundaries, ...extraBoundaries])].sort();
    return {
      schemaVersion: GRAPHQL_CONTRACT_SCHEMA_VERSION,
      service,
      rootTypes,
      types,
      files: [...files].sort(),
      coverage: { complete: boundaryReasons.length === 0, boundaryReasons },
    };
  }
}

export interface GraphQLSchemaDocumentInput {
  filePath: string;
  source: string;
}

/**
 * Builds one schema model from every SDL definition in `documents` (type extensions merged
 * into their definitions, interface implementers computed). Operation definitions are ignored
 * here. A document that fails to parse, or trips a limit, is skipped and recorded as a
 * coverage boundary — the model is then explicitly partial, never silently smaller.
 */
export function buildGraphQLSchemaModel(documents: readonly GraphQLSchemaDocumentInput[], service: string): GraphQLSchemaModel {
  const accumulator = new SchemaAccumulator();
  const files: string[] = [];
  const boundaries: string[] = [];
  for (const document of [...documents].sort((a, b) => a.filePath.localeCompare(b.filePath))) {
    const parsed = parseGraphQLDocument(document.source);
    if (!parsed.ok) {
      boundaries.push(`${parsed.reason}:${document.filePath}`);
      continue;
    }
    const sdl = parsed.document.definitions.filter((definition) => definition.kind !== Kind.OPERATION_DEFINITION && definition.kind !== Kind.FRAGMENT_DEFINITION);
    if (sdl.length === 0) continue;
    files.push(document.filePath);
    try {
      for (const definition of sdl) accumulator.add(document.filePath, definition);
    } catch (error) {
      if (!(error instanceof GraphQLDepthLimitError)) throw error;
      boundaries.push(`depth-limit:${document.filePath}`);
    }
  }
  return accumulator.build(service, files, boundaries);
}

function withoutAnchors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAnchors);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => key !== 'anchor' && entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, withoutAnchors(entry)]));
  }
  return value;
}

/** Order/format-insensitive fingerprint of a type definition: declaration order of fields,
 * arguments and enum values is not semantically meaningful for compatibility, and every list
 * in a GraphQLTypeDef is already sorted by name. Source anchors never contribute. */
export function graphqlTypeFingerprint(type: GraphQLTypeDef): string {
  return createHash('sha256').update(JSON.stringify(withoutAnchors(type))).digest('hex').slice(0, 16);
}

export function findGraphQLType(model: GraphQLSchemaModel, name: string): GraphQLTypeDef | undefined {
  return model.types.find((type) => type.name === name);
}
