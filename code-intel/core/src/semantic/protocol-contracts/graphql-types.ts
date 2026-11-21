/**
 * Versioned GraphQL contract model shared by the schema parser (multi-repo/schema-parsers),
 * the operation extractor/matcher (this package) and the drift comparator
 * (multi-repo/contract-drift/graphql-comparator.ts).
 */

/** Bumped whenever GraphQLSchemaModel/GraphQLOperationFact change shape. Persisted contracts
 * carrying another version (or none — v1.0.11 flat contracts) are never compared field by
 * field; they degrade to `unknown` with a `legacy-schema` boundary. */
export const GRAPHQL_CONTRACT_SCHEMA_VERSION = '1.0.12';

/** GraphQL documents are untrusted input: every limit here is enforced before or during
 * parsing and reported as a coverage boundary when hit. */
export const GRAPHQL_LIMITS = Object.freeze({
  /** Large public schemas exceed 1 MB of SDL; 4 MB still parses in well under a second. */
  maxFileBytes: 4 * 1024 * 1024,
  /** Passed to graphql-js `parse({ maxTokens })`, which aborts lexing past it. */
  maxTokens: 1_000_000,
  /** Selection-set / type-wrapper nesting. */
  maxDepth: 32,
  maxFilesPerRepo: 1000,
  maxOperationsPerRepo: 2000,
  maxSelectionsPerOperation: 2000,
  maxTypesPerSchema: 5000,
  /** Schemas a single operation is matched against before the match is reported as capped. */
  maxCandidateSchemas: 8,
});

export type GraphQLTypeKind = 'object' | 'input' | 'interface' | 'union' | 'enum' | 'scalar';
export type GraphQLOperationType = 'query' | 'mutation' | 'subscription';

/** Wrapper-preserving type reference: `[User!]!` is non-null(list(non-null(named User))). */
export type GraphQLTypeRef =
  | { kind: 'named'; name: string }
  | { kind: 'list'; ofType: GraphQLTypeRef }
  | { kind: 'non-null'; ofType: GraphQLTypeRef };

export interface GraphQLSourceAnchor {
  filePath: string;
  line: number;
  column: number;
}

export interface GraphQLArgumentDef {
  name: string;
  type: GraphQLTypeRef;
  /** Printed default value literal, when declared. */
  defaultValue?: string;
  directives: readonly string[];
  anchor: GraphQLSourceAnchor;
}

export interface GraphQLFieldDef {
  name: string;
  type: GraphQLTypeRef;
  args: readonly GraphQLArgumentDef[];
  /** Printed directive applications other than @deprecated, e.g. `@auth(requires: ADMIN)`. */
  directives: readonly string[];
  deprecated: boolean;
  anchor: GraphQLSourceAnchor;
}

export interface GraphQLInputFieldDef {
  name: string;
  type: GraphQLTypeRef;
  defaultValue?: string;
  directives: readonly string[];
  deprecated: boolean;
  anchor: GraphQLSourceAnchor;
}

export interface GraphQLEnumValueDef {
  name: string;
  deprecated: boolean;
  directives: readonly string[];
}

export interface GraphQLTypeDef {
  name: string;
  kind: GraphQLTypeKind;
  /** object/interface. */
  fields?: readonly GraphQLFieldDef[];
  /** input. */
  inputFields?: readonly GraphQLInputFieldDef[];
  /** enum. */
  enumValues?: readonly GraphQLEnumValueDef[];
  /** union members, or (computed) object types implementing an interface. */
  possibleTypes?: readonly string[];
  /** object/interface: interfaces this type implements. */
  interfaces?: readonly string[];
  directives: readonly string[];
  anchor: GraphQLSourceAnchor;
}

export interface GraphQLCoverage {
  complete: boolean;
  boundaryReasons: readonly string[];
}

export interface GraphQLSchemaModel {
  schemaVersion: string;
  /** Schema-or-service identity used in canonical field ids. */
  service: string;
  rootTypes: Partial<Record<GraphQLOperationType, string>>;
  /** Sorted by name; extensions are merged into their base definition. */
  types: readonly GraphQLTypeDef[];
  files: readonly string[];
  coverage: GraphQLCoverage;
}

export interface GraphQLSelection {
  /** Schema field name (never the response alias). */
  field: string;
  alias?: string;
  /** Argument names passed at this selection. */
  arguments: readonly string[];
  /** Enum literals passed directly as an argument value (or inside a list value). */
  argumentEnumLiterals: ReadonlyArray<{ argument: string; value: string }>;
  /** Set for selections inside an inline fragment / fragment spread with a type condition. */
  typeCondition?: string;
  selections: readonly GraphQLSelection[];
}

export interface GraphQLVariableDef {
  name: string;
  type: GraphQLTypeRef;
  defaultValue?: string;
}

export interface GraphQLOperationFact {
  /** `graphql-op:<type>:<name or "anonymous">:<fingerprint>` — anonymous operations are
   * identified by fingerprint alone, never by a fabricated name. */
  operationId: string;
  operationType: GraphQLOperationType;
  name?: string;
  /** sha256 prefix of the normalized document (whitespace/comment-insensitive). */
  fingerprint: string;
  variables: readonly GraphQLVariableDef[];
  selections: readonly GraphQLSelection[];
  /** Response-shaped field paths by schema field name, e.g. `user.profile.displayName`. */
  selectedPaths: readonly string[];
  filePath: string;
  line: number;
  origin: 'document' | 'tagged-template';
  /** Enclosing/using symbol for tagged templates, when resolvable. */
  symbolId?: string;
  symbolName?: string;
  coverage: GraphQLCoverage;
}

export type GraphQLConsumerCertainty = 'exact' | 'candidate' | 'unresolved';

/** One operation mapped against one schema. */
export interface GraphQLOperationMapping {
  operationId: string;
  service: string;
  certainty: GraphQLConsumerCertainty;
  /** Canonical field ids reached by the selection tree: `graphql:<service>:<Type>.<field>`. */
  fieldIds: readonly string[];
  /** `<Type>.<field>(<arg>)` for every argument the operation passes. */
  argumentRefs: readonly string[];
  /** `<Enum>.<VALUE>` for enum literals the operation sends. */
  enumRefs: readonly string[];
  /** Input object types reachable from the operation's variable types. */
  inputTypes: readonly string[];
  /** Selected paths that do not exist in this schema. */
  unresolvedPaths: readonly string[];
  coverage: GraphQLCoverage;
}

export function graphqlFieldId(service: string, parentType: string, field: string): string {
  return `graphql:${service}:${parentType}.${field}`;
}

export function graphqlTypeId(service: string, typeName: string): string {
  return `graphql:${service}:type:${typeName}`;
}

export function namedType(ref: GraphQLTypeRef): string {
  return ref.kind === 'named' ? ref.name : namedType(ref.ofType);
}

export function printTypeRef(ref: GraphQLTypeRef): string {
  if (ref.kind === 'named') return ref.name;
  if (ref.kind === 'list') return `[${printTypeRef(ref.ofType)}]`;
  return `${printTypeRef(ref.ofType)}!`;
}

export const BUILTIN_SCALARS: ReadonlySet<string> = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
