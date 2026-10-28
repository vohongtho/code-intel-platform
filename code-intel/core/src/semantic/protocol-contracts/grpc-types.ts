/**
 * Versioned protobuf/gRPC contract model shared by the in-repository proto parser
 * (multi-repo/schema-parsers/proto-model.ts), gRPC bindings and the drift comparator
 * (multi-repo/contract-drift/grpc-comparator.ts).
 */

/** Bumped whenever ProtoFileModel changes shape. Contracts without it (v1.0.11 flat
 * `Service.Rpc` contracts) degrade to `unknown` with a `legacy-schema` boundary. */
export const GRPC_CONTRACT_SCHEMA_VERSION = '1.0.12';

/** Proto files are untrusted input; each limit is reported as a coverage boundary when hit. */
export const PROTO_LIMITS = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxTokens: 200_000,
  /** Message/enum nesting depth. */
  maxDepth: 32,
  maxFilesPerRepo: 1000,
  maxDefinitionsPerFile: 5000,
});

export type ProtoStreamingMode = 'unary' | 'client-stream' | 'server-stream' | 'bidi-stream';
export type ProtoCardinality = 'singular' | 'optional' | 'required' | 'repeated' | 'map';

export interface ProtoAnchor {
  filePath: string;
  line: number;
}

export interface ProtoFieldDef {
  name: string;
  number: number;
  /** Type as written, e.g. `int32`, `Address`, `.acme.v1.Address`. */
  type: string;
  /** Scalar name, or fully-qualified message/enum name without a leading dot. Absent when
   * the reference could not be resolved within the repository. */
  resolvedType?: string;
  /** `message`/`enum` for resolved named types, `scalar` for builtin scalars. */
  typeKind?: 'scalar' | 'message' | 'enum';
  cardinality: ProtoCardinality;
  mapKeyType?: string;
  mapValueType?: string;
  oneof?: string;
  anchor: ProtoAnchor;
}

export interface ProtoReservedSet {
  /** Inclusive ranges; `max` is stored as 536870911. */
  ranges: ReadonlyArray<readonly [number, number]>;
  names: readonly string[];
}

export interface ProtoMessageDef {
  /** `pkg.Outer.Inner`. */
  fullName: string;
  name: string;
  /** Sorted by field number. */
  fields: readonly ProtoFieldDef[];
  oneofs: readonly string[];
  reserved: ProtoReservedSet;
  anchor: ProtoAnchor;
}

export interface ProtoEnumValueDef {
  name: string;
  number: number;
}

export interface ProtoEnumDef {
  fullName: string;
  name: string;
  values: readonly ProtoEnumValueDef[];
  reserved: ProtoReservedSet;
  allowAlias: boolean;
  anchor: ProtoAnchor;
}

export interface ProtoRpcDef {
  name: string;
  /** Fully-qualified (resolved) or as-written type names. */
  requestType: string;
  responseType: string;
  streaming: ProtoStreamingMode;
  anchor: ProtoAnchor;
}

export interface ProtoServiceDef {
  /** `pkg.Service`. */
  fullName: string;
  name: string;
  rpcs: readonly ProtoRpcDef[];
  anchor: ProtoAnchor;
}

export interface ProtoCoverage {
  complete: boolean;
  boundaryReasons: readonly string[];
}

export interface ProtoFileModel {
  schemaVersion: string;
  filePath: string;
  syntax?: 'proto2' | 'proto3' | 'editions';
  package?: string;
  imports: readonly string[];
  /** Nested definitions are flattened here with their fully-qualified names. */
  messages: readonly ProtoMessageDef[];
  enums: readonly ProtoEnumDef[];
  services: readonly ProtoServiceDef[];
  coverage: ProtoCoverage;
}

export const PROTO_MAX_FIELD_NUMBER = 536_870_911;

export const PROTO_SCALAR_TYPES: ReadonlySet<string> = new Set([
  'double', 'float', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64',
  'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'bool', 'string', 'bytes',
]);

/** `grpc:<package>.<Service>/<Method>` — never the method name alone. */
export function grpcRpcId(serviceFullName: string, method: string): string {
  return `grpc:${serviceFullName}/${method}`;
}

export function protoQualifiedName(pkg: string | undefined, ...parts: string[]): string {
  return [pkg, ...parts].filter((part): part is string => Boolean(part)).join('.');
}
