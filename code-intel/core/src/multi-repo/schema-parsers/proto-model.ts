import { createHash } from 'node:crypto';
import {
  GRPC_CONTRACT_SCHEMA_VERSION,
  PROTO_LIMITS,
  PROTO_MAX_FIELD_NUMBER,
  PROTO_SCALAR_TYPES,
  protoQualifiedName,
  type ProtoCardinality,
  type ProtoEnumDef,
  type ProtoFieldDef,
  type ProtoFileModel,
  type ProtoMessageDef,
  type ProtoReservedSet,
  type ProtoRpcDef,
  type ProtoServiceDef,
  type ProtoStreamingMode,
} from '../../semantic/protocol-contracts/grpc-types.js';

/**
 * Bounded recursive-descent parser for the protobuf contract subset: syntax/edition, package,
 * imports, messages (fields, numbers, cardinality, map, oneof, reserved, nesting), enums
 * (values, reserved, allow_alias), and services (RPCs, streaming). Options are skipped (never
 * evaluated); extensions/groups are skipped and reported as coverage boundaries. Parse errors
 * and limits throw ProtoParseError, which parseProtoFile turns into an explicit boundary.
 */

export class ProtoParseError extends Error {
  constructor(message: string, readonly reason: 'malformed-document' | 'token-limit' | 'depth-limit' | 'definition-limit' = 'malformed-document') {
    super(message);
  }
}

interface Token {
  kind: 'ident' | 'number' | 'string' | 'symbol';
  value: string;
  line: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j += 1) if (source[j] === '\n') line += 1;
      i = stop;
      continue;
    }
    if (tokens.length >= PROTO_LIMITS.maxTokens) throw new ProtoParseError(`more than ${PROTO_LIMITS.maxTokens} tokens`, 'token-limit');
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = '';
      while (j < source.length && source[j] !== ch) {
        if (source[j] === '\n') throw new ProtoParseError(`unterminated string at line ${line}`);
        if (source[j] === '\\') {
          value += source[j + 1] ?? '';
          j += 2;
          continue;
        }
        value += source[j];
        j += 1;
      }
      if (j >= source.length) throw new ProtoParseError(`unterminated string at line ${line}`);
      tokens.push({ kind: 'string', value, line });
      i = j + 1;
      continue;
    }
    const ident = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/.exec(source.slice(i, i + 512));
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0], line });
      i += ident[0].length;
      continue;
    }
    if (ch === '.' && /[A-Za-z_]/.test(source[i + 1] ?? '')) {
      const qualified = /^\.[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/.exec(source.slice(i, i + 512))!;
      tokens.push({ kind: 'ident', value: qualified[0], line });
      i += qualified[0].length;
      continue;
    }
    const number = /^-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|inf|nan)/.exec(source.slice(i, i + 64));
    if (number && (ch !== '-' || number[0].length > 1)) {
      tokens.push({ kind: 'number', value: number[0], line });
      i += number[0].length;
      continue;
    }
    tokens.push({ kind: 'symbol', value: ch, line });
    i += 1;
  }
  return tokens;
}

interface RawField {
  name: string;
  number: number;
  type: string;
  cardinality: ProtoCardinality;
  mapKeyType?: string;
  mapValueType?: string;
  oneof?: string;
  line: number;
}

interface RawMessage {
  fullName: string;
  name: string;
  /** Scope chain used to resolve relative type names, innermost first. */
  scope: string;
  fields: RawField[];
  oneofs: string[];
  reserved: { ranges: Array<[number, number]>; names: string[] };
  line: number;
}

interface RawRpc {
  name: string;
  requestType: string;
  responseType: string;
  streaming: ProtoStreamingMode;
  line: number;
}

class ProtoParser {
  private pos = 0;
  private definitions = 0;
  syntax?: ProtoFileModel['syntax'];
  pkg?: string;
  readonly imports: string[] = [];
  readonly messages: RawMessage[] = [];
  readonly enums: ProtoEnumDef[] = [];
  readonly services: Array<{ fullName: string; name: string; scope: string; rpcs: RawRpc[]; line: number }> = [];
  readonly boundaries = new Set<string>();

  constructor(private readonly tokens: readonly Token[], private readonly filePath: string) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (!token) throw new ProtoParseError('unexpected end of file');
    this.pos += 1;
    return token;
  }

  private expect(value: string): Token {
    const token = this.next();
    if (token.value !== value) throw new ProtoParseError(`expected "${value}" but found "${token.value}" at line ${token.line}`);
    return token;
  }

  private accept(value: string): boolean {
    if (this.peek()?.value === value && this.peek()?.kind !== 'string') {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private ident(): Token {
    const token = this.next();
    if (token.kind !== 'ident') throw new ProtoParseError(`expected identifier but found "${token.value}" at line ${token.line}`);
    return token;
  }

  private integer(): number {
    const token = this.next();
    if (token.kind === 'ident' && token.value === 'max') return PROTO_MAX_FIELD_NUMBER;
    if (token.kind !== 'number') throw new ProtoParseError(`expected number but found "${token.value}" at line ${token.line}`);
    const value = token.value.toLowerCase().startsWith('0x') || token.value.toLowerCase().startsWith('-0x')
      ? Number.parseInt(token.value, 16)
      : /^-?0\d+$/.test(token.value) ? Number.parseInt(token.value, 8) : Number(token.value);
    if (!Number.isInteger(value)) throw new ProtoParseError(`expected integer but found "${token.value}" at line ${token.line}`);
    return value;
  }

  private countDefinition(): void {
    this.definitions += 1;
    if (this.definitions > PROTO_LIMITS.maxDefinitionsPerFile) throw new ProtoParseError(`more than ${PROTO_LIMITS.maxDefinitionsPerFile} definitions`, 'definition-limit');
  }

  /** Skips to the end of the current statement (`;`) or past one balanced `{...}` block. */
  private skipStatement(): void {
    let depth = 0;
    while (this.peek()) {
      const token = this.next();
      if (token.kind !== 'symbol') continue;
      if (token.value === '{') depth += 1;
      else if (token.value === '}') {
        depth -= 1;
        if (depth <= 0) {
          this.accept(';');
          return;
        }
      } else if (token.value === ';' && depth === 0) return;
    }
  }

  /** Skips a `[ ... ]` option list, if present. */
  private skipFieldOptions(): void {
    if (!this.accept('[')) return;
    let depth = 1;
    while (depth > 0) {
      const token = this.next();
      if (token.kind !== 'symbol') continue;
      if (token.value === '[') depth += 1;
      else if (token.value === ']') depth -= 1;
    }
  }

  parseFile(): void {
    while (this.peek()) {
      const token = this.peek()!;
      if (token.value === ';' && token.kind === 'symbol') {
        this.next();
        continue;
      }
      if (token.kind !== 'ident') throw new ProtoParseError(`unexpected "${token.value}" at line ${token.line}`);
      switch (token.value) {
        case 'syntax': {
          this.next();
          this.expect('=');
          const value = this.next().value;
          this.syntax = value === 'proto2' ? 'proto2' : 'proto3';
          this.expect(';');
          break;
        }
        case 'edition':
          this.next();
          this.expect('=');
          this.next();
          this.expect(';');
          this.syntax = 'editions';
          break;
        case 'package':
          this.next();
          this.pkg = this.ident().value;
          this.expect(';');
          break;
        case 'import': {
          this.next();
          if (this.peek()?.value === 'public' || this.peek()?.value === 'weak') this.next();
          const target = this.next();
          if (target.kind !== 'string') throw new ProtoParseError(`expected import path at line ${target.line}`);
          this.imports.push(target.value);
          this.expect(';');
          break;
        }
        case 'option':
          this.skipStatement();
          break;
        case 'message':
          this.next();
          this.parseMessage(this.pkg ?? '', 1);
          break;
        case 'enum':
          this.next();
          this.parseEnum(this.pkg ?? '');
          break;
        case 'service':
          this.next();
          this.parseService();
          break;
        case 'extend':
          this.boundaries.add('extensions-not-modeled');
          this.skipStatement();
          break;
        default:
          throw new ProtoParseError(`unexpected "${token.value}" at line ${token.line}`);
      }
    }
  }

  private parseReserved(target: { ranges: Array<[number, number]>; names: string[] }): void {
    do {
      const token = this.peek();
      if (token?.kind === 'string') {
        target.names.push(this.next().value);
      } else if (token?.kind === 'ident' && token.value !== 'max') {
        target.names.push(this.next().value); // editions: bare identifiers
      } else {
        const start = this.integer();
        const end = this.accept('to') ? this.integer() : start;
        target.ranges.push([start, end]);
      }
    } while (this.accept(','));
    this.expect(';');
  }

  private parseField(cardinality: ProtoCardinality, oneof: string | undefined): RawField {
    let type: string;
    let mapKeyType: string | undefined;
    let mapValueType: string | undefined;
    let effective = cardinality;
    const first = this.ident();
    if (first.value === 'map' && this.peek()?.value === '<') {
      this.expect('<');
      mapKeyType = this.ident().value;
      this.expect(',');
      mapValueType = this.ident().value;
      this.expect('>');
      type = `map<${mapKeyType},${mapValueType}>`;
      effective = 'map';
    } else {
      type = first.value;
    }
    const name = this.ident();
    this.expect('=');
    const number = this.integer();
    this.skipFieldOptions();
    this.expect(';');
    if (number < 1 || number > PROTO_MAX_FIELD_NUMBER) throw new ProtoParseError(`field number ${number} out of range at line ${name.line}`);
    return { name: name.value, number, type, cardinality: effective, mapKeyType, mapValueType, oneof, line: first.line };
  }

  private parseMessage(scope: string, depth: number): void {
    if (depth > PROTO_LIMITS.maxDepth) throw new ProtoParseError(`message nesting exceeds ${PROTO_LIMITS.maxDepth}`, 'depth-limit');
    this.countDefinition();
    const nameToken = this.ident();
    const fullName = protoQualifiedName(scope || undefined, nameToken.value);
    const message: RawMessage = { fullName, name: nameToken.value, scope: fullName, fields: [], oneofs: [], reserved: { ranges: [], names: [] }, line: nameToken.line };
    this.messages.push(message);
    this.expect('{');
    while (!this.accept('}')) {
      const token = this.peek();
      if (!token) throw new ProtoParseError(`unterminated message ${fullName}`);
      if (token.kind === 'symbol' && token.value === ';') {
        this.next();
        continue;
      }
      switch (token.value) {
        case 'message':
          this.next();
          this.parseMessage(fullName, depth + 1);
          break;
        case 'enum':
          this.next();
          this.parseEnum(fullName);
          break;
        case 'option':
          this.skipStatement();
          break;
        case 'reserved':
          this.next();
          this.parseReserved(message.reserved);
          break;
        case 'extensions':
        case 'extend':
          this.boundaries.add('extensions-not-modeled');
          this.skipStatement();
          break;
        case 'oneof': {
          this.next();
          const oneofName = this.ident().value;
          message.oneofs.push(oneofName);
          this.expect('{');
          while (!this.accept('}')) {
            if (this.peek()?.value === 'option') {
              this.skipStatement();
              continue;
            }
            if (this.accept(';')) continue;
            message.fields.push(this.parseField('singular', oneofName));
          }
          break;
        }
        case 'repeated':
        case 'optional':
        case 'required':
          this.next();
          if (this.peek()?.value === 'group') {
            this.boundaries.add('groups-not-modeled');
            this.skipStatement();
            break;
          }
          message.fields.push(this.parseField(token.value as ProtoCardinality, undefined));
          break;
        default:
          if (token.kind !== 'ident') throw new ProtoParseError(`unexpected "${token.value}" at line ${token.line}`);
          message.fields.push(this.parseField(this.syntax === 'proto2' ? 'optional' : 'singular', undefined));
      }
    }
  }

  private parseEnum(scope: string): void {
    this.countDefinition();
    const nameToken = this.ident();
    const fullName = protoQualifiedName(scope || undefined, nameToken.value);
    const values: Array<{ name: string; number: number }> = [];
    const reserved = { ranges: [] as Array<[number, number]>, names: [] as string[] };
    let allowAlias = false;
    this.expect('{');
    while (!this.accept('}')) {
      const token = this.peek();
      if (!token) throw new ProtoParseError(`unterminated enum ${fullName}`);
      if (token.kind === 'symbol' && token.value === ';') {
        this.next();
        continue;
      }
      if (token.value === 'option') {
        const start = this.pos;
        this.skipStatement();
        if (this.tokens.slice(start, this.pos).some((t) => t.value === 'allow_alias')) allowAlias = true;
        continue;
      }
      if (token.value === 'reserved') {
        this.next();
        this.parseReserved(reserved);
        continue;
      }
      const name = this.ident().value;
      this.expect('=');
      const number = this.integer();
      this.skipFieldOptions();
      this.expect(';');
      values.push({ name, number });
    }
    this.enums.push({
      fullName,
      name: nameToken.value,
      values: values.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name)),
      reserved: normalizeReserved(reserved),
      allowAlias,
      anchor: { filePath: this.filePath, line: nameToken.line },
    });
  }

  private parseRpcType(): { type: string; stream: boolean } {
    this.expect('(');
    const stream = this.peek()?.value === 'stream' && this.peek(1)?.kind === 'ident' ? (this.next(), true) : false;
    const type = this.ident().value;
    this.expect(')');
    return { type, stream };
  }

  private parseService(): void {
    this.countDefinition();
    const nameToken = this.ident();
    const fullName = protoQualifiedName(this.pkg, nameToken.value);
    const rpcs: RawRpc[] = [];
    this.expect('{');
    while (!this.accept('}')) {
      const token = this.peek();
      if (!token) throw new ProtoParseError(`unterminated service ${fullName}`);
      if (token.kind === 'symbol' && token.value === ';') {
        this.next();
        continue;
      }
      if (token.value === 'option') {
        this.skipStatement();
        continue;
      }
      if (token.value !== 'rpc') throw new ProtoParseError(`unexpected "${token.value}" in service at line ${token.line}`);
      this.next();
      const rpcName = this.ident();
      const request = this.parseRpcType();
      this.expect('returns');
      const response = this.parseRpcType();
      if (this.peek()?.value === '{') this.skipStatement();
      else this.expect(';');
      const streaming: ProtoStreamingMode = request.stream && response.stream ? 'bidi-stream' : request.stream ? 'client-stream' : response.stream ? 'server-stream' : 'unary';
      rpcs.push({ name: rpcName.value, requestType: request.type, responseType: response.type, streaming, line: rpcName.line });
    }
    this.services.push({ fullName, name: nameToken.value, scope: this.pkg ?? '', rpcs, line: nameToken.line });
  }
}

function normalizeReserved(reserved: { ranges: Array<[number, number]>; names: string[] }): ProtoReservedSet {
  return {
    ranges: [...reserved.ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    names: [...new Set(reserved.names)].sort(),
  };
}

export function isReservedNumber(reserved: ProtoReservedSet, number: number): boolean {
  return reserved.ranges.some(([start, end]) => number >= start && number <= end);
}

/** Parses one untrusted `.proto` file (type names stay as written until resolveProtoTypes).
 * Never throws: a malformed file or a tripped limit yields an empty, explicitly incomplete
 * model. */
export function parseProtoFile(filePath: string, source: string): ProtoFileModel {
  const empty = (reason: string): ProtoFileModel => ({
    schemaVersion: GRPC_CONTRACT_SCHEMA_VERSION,
    filePath,
    imports: [],
    messages: [],
    enums: [],
    services: [],
    coverage: { complete: false, boundaryReasons: [reason] },
  });
  if (Buffer.byteLength(source, 'utf8') > PROTO_LIMITS.maxFileBytes) return empty('file-size-limit');
  let parser: ProtoParser;
  try {
    parser = new ProtoParser(tokenize(source), filePath);
    parser.parseFile();
  } catch (error) {
    if (error instanceof ProtoParseError) return empty(error.reason);
    throw error;
  }
  const boundaryReasons = [...parser.boundaries].sort();
  return {
    schemaVersion: GRPC_CONTRACT_SCHEMA_VERSION,
    filePath,
    syntax: parser.syntax,
    package: parser.pkg,
    imports: [...parser.imports].sort(),
    messages: parser.messages.map((message): ProtoMessageDef => ({
      fullName: message.fullName,
      name: message.name,
      fields: message.fields
        .map((field): ProtoFieldDef => ({
          name: field.name,
          number: field.number,
          type: field.type,
          cardinality: field.cardinality,
          mapKeyType: field.mapKeyType,
          mapValueType: field.mapValueType,
          oneof: field.oneof,
          anchor: { filePath, line: field.line },
        }))
        .sort((a, b) => a.number - b.number),
      oneofs: [...message.oneofs].sort(),
      reserved: normalizeReserved(message.reserved),
      anchor: { filePath, line: message.line },
    })).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    enums: [...parser.enums].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    services: parser.services.map((service): ProtoServiceDef => ({
      fullName: service.fullName,
      name: service.name,
      rpcs: service.rpcs.map((rpc): ProtoRpcDef => ({
        name: rpc.name,
        requestType: rpc.requestType,
        responseType: rpc.responseType,
        streaming: rpc.streaming,
        anchor: { filePath, line: rpc.line },
      })).sort((a, b) => a.name.localeCompare(b.name)),
      anchor: { filePath, line: service.line },
    })).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    coverage: { complete: boundaryReasons.length === 0, boundaryReasons },
  };
}

/** Protobuf scoping: a relative name is looked up from the innermost scope outward. */
function resolveName(name: string, scope: string, known: ReadonlyMap<string, 'message' | 'enum'>): string | undefined {
  if (name.startsWith('.')) return known.has(name.slice(1)) ? name.slice(1) : undefined;
  const parts = scope ? scope.split('.') : [];
  for (let i = parts.length; i >= 0; i -= 1) {
    const candidate = [...parts.slice(0, i), name].join('.');
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resolves message-field and RPC type references across every file of a repository (imports
 * are not followed by path; any definition in the parsed set is visible, which over-approximates
 * proto visibility but never invents a type). Unresolved references keep their written name and
 * mark the file's coverage incomplete.
 */
export function resolveProtoTypes(files: readonly ProtoFileModel[]): ProtoFileModel[] {
  const known = new Map<string, 'message' | 'enum'>();
  for (const file of files) {
    for (const message of file.messages) known.set(message.fullName, 'message');
    for (const protoEnum of file.enums) known.set(protoEnum.fullName, 'enum');
  }
  return files.map((file) => {
    const unresolved = new Set<string>();
    const resolveRef = (type: string, scope: string): { resolvedType?: string; typeKind?: ProtoFieldDef['typeKind'] } => {
      if (PROTO_SCALAR_TYPES.has(type)) return { resolvedType: type, typeKind: 'scalar' };
      const resolved = resolveName(type, scope, known);
      if (!resolved) {
        unresolved.add(type);
        return {};
      }
      return { resolvedType: resolved, typeKind: known.get(resolved) };
    };
    const messages = file.messages.map((message) => ({
      ...message,
      fields: message.fields.map((field) => {
        if (field.cardinality === 'map') {
          const value = resolveRef(field.mapValueType!, message.fullName);
          return { ...field, mapValueType: value.resolvedType ?? field.mapValueType, resolvedType: field.type, typeKind: value.typeKind };
        }
        return { ...field, ...resolveRef(field.type, message.fullName) };
      }),
    }));
    const services = file.services.map((service) => ({
      ...service,
      rpcs: service.rpcs.map((rpc) => ({
        ...rpc,
        requestType: resolveRef(rpc.requestType, file.package ?? '').resolvedType ?? rpc.requestType,
        responseType: resolveRef(rpc.responseType, file.package ?? '').resolvedType ?? rpc.responseType,
      })),
    }));
    const boundaryReasons = [...new Set([...file.coverage.boundaryReasons, ...[...unresolved].map((type) => `unresolved-type:${type}`)])].sort();
    return { ...file, messages, services, coverage: { complete: boundaryReasons.length === 0, boundaryReasons } };
  });
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

/** Declaration-order/format-insensitive fingerprint (lists are already canonically sorted). */
export function protoDefinitionFingerprint(definition: ProtoMessageDef | ProtoEnumDef | ProtoServiceDef): string {
  return createHash('sha256').update(JSON.stringify(withoutAnchors(definition))).digest('hex').slice(0, 16);
}
