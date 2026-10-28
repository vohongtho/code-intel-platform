/**
 * protocol-facts.ts
 *
 * Evidence-backed, literal-keyed protocol facts for cross-repository
 * contracts beyond HTTP: message-bus event topics, GraphQL root operations
 * and gRPC methods (TypeScript/JavaScript sources).
 *
 * A fact is keyed by a *protocol identifier read from a literal* — the topic
 * string, `query.<field>` from a GraphQL document/resolver, or
 * `<Service>/<rpc>` from a gRPC registration/client — never by a symbol or
 * type name. Each fact is attached to its enclosing (or decorated, or named
 * handler) symbol via real line spans; when that cannot be done the fact is
 * kept with an `unresolvedReason` so it can only ever produce a candidate
 * continuation. Generic `EventEmitter` calls (`.on` / `.emit`) are
 * deliberately not treated as cross-repository events.
 */

import path from 'node:path';
import {
  canonicalSymbolId,
  decoratedSymbol,
  enclosingSymbol,
  uniqueDeclarationNamed,
  type SymbolSpanIndex,
} from './symbol-spans.js';
import type { CodeNode } from '../shared/index.js';

export type ProtocolKind = 'event' | 'graphql' | 'grpc';
export type ProtocolRole = 'provider' | 'consumer';

export interface ProtocolFact {
  protocol: ProtocolKind;
  role: ProtocolRole;
  /** event: topic; graphql: `<operation>.<rootField>`; grpc: `<Service>/<rpc lowercased>`. */
  key: string;
  filePath: string;
  line: number;
  symbolId?: string;
  symbolName?: string;
  unresolvedReason?: string;
  /** Which source pattern produced the fact (diagnostics/tests). */
  pattern: string;
}

export const PROTOCOL_FACT_LIMITS = Object.freeze({ maxFilesPerRepo: 5000, maxFileBytes: 512 * 1024, maxFactsPerRepo: 5000 });

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const IDENT = '[A-Za-z_$][\\w$]*';
const GRPC_CLIENT_NON_RPC = new Set(['close', 'waitForReady', 'getChannel', 'then', 'catch', 'bind', 'call', 'apply']);

export function isProtocolSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !filePath.endsWith('.d.ts');
}

function resolved(node: CodeNode | undefined, reason: string): Pick<ProtocolFact, 'symbolId' | 'symbolName' | 'unresolvedReason'> {
  return node ? { symbolId: canonicalSymbolId(node), symbolName: node.name } : { unresolvedReason: reason };
}

/** Name of the method declared on the first non-decorator line after `index`. */
function methodNameAfter(lines: readonly string[], index: number): string | undefined {
  for (let i = index + 1; i < Math.min(lines.length, index + 7); i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith('@') || trimmed === '') continue;
    const match = new RegExp(`^(?:(?:public|private|protected|static|async|override)\\s+)*(${IDENT})\\s*\\(`).exec(trimmed);
    return match?.[1];
  }
  return undefined;
}

function stringLiteral(text: string): RegExp {
  return new RegExp(text.replace('LIT', `(['"])([^'"\\n]+)\\1`));
}

function extractEvents(filePath: string, lines: readonly string[], index: SymbolSpanIndex, out: ProtocolFact[]): void {
  const publish = stringLiteral(`\\.publish\\(\\s*LIT`);
  const kafkaSend = stringLiteral(`\\bsend\\(\\s*\\{\\s*topic\\s*:\\s*LIT`);
  const subscribeNamed = new RegExp(`\\.subscribe\\(\\s*(['"])([^'"\\n]+)\\1\\s*,\\s*(?:this\\.)?(${IDENT})\\s*[,)]`);
  const subscribeAny = stringLiteral(`\\.subscribe\\(\\s*LIT\\s*,`);
  const pattern = stringLiteral(`^\\s*@(?:EventPattern|MessagePattern)\\(\\s*LIT`);
  lines.forEach((text, i) => {
    const line = i + 1;
    let m = publish.exec(text) ?? kafkaSend.exec(text);
    if (m) {
      out.push({ protocol: 'event', role: 'provider', key: m[2]!, filePath, line, pattern: m[0].includes('topic') ? 'kafka-send' : 'publish', ...resolved(enclosingSymbol(index, filePath, line), 'publish call is not inside a function/method with a known span') });
      return;
    }
    m = subscribeNamed.exec(text);
    if (m) {
      out.push({ protocol: 'event', role: 'consumer', key: m[2]!, filePath, line, pattern: 'subscribe-handler', ...resolved(uniqueDeclarationNamed(index, filePath, m[3]!), `subscription handler ${m[3]} is not a unique function in this file`) });
      return;
    }
    m = subscribeAny.exec(text);
    if (m) {
      out.push({ protocol: 'event', role: 'consumer', key: m[2]!, filePath, line, pattern: 'subscribe-inline', unresolvedReason: 'inline subscription handler has no symbol identity' });
      return;
    }
    m = pattern.exec(text);
    if (m) {
      const name = methodNameAfter(lines, i);
      out.push({ protocol: 'event', role: 'consumer', key: m[2]!, filePath, line, pattern: 'event-pattern-decorator', ...resolved(name ? decoratedSymbol(index, filePath, line, name) : undefined, 'decorated handler method not found') });
    }
  });
}

/** First root field of the first operation in a GraphQL document. */
export function graphqlOperationKey(document: string): string | undefined {
  const body = document.replace(/#[^\n]*/g, ' ').replace(/fragment\s+\w+\s+on\s+\w+\s*\{[\s\S]*?\}/g, ' ');
  const match = /^\s*(?:(query|mutation|subscription)\b\s*[A-Za-z_]\w*\s*)?(?:\([^)]*\)\s*)?(?:@\w+\s*)*\{\s*(?:[A-Za-z_]\w*\s*:\s*)?([A-Za-z_]\w*)/.exec(body)
    ?? /^\s*(query|mutation|subscription)\s*(?:\([^)]*\)\s*)?\{\s*(?:[A-Za-z_]\w*\s*:\s*)?([A-Za-z_]\w*)/.exec(body);
  if (!match) return undefined;
  return `${(match[1] ?? 'query').toLowerCase()}.${match[2]}`;
}

function extractGraphql(filePath: string, source: string, lines: readonly string[], index: SymbolSpanIndex, out: ProtocolFact[]): void {
  // Providers: NestJS code-first resolvers (only in files importing @nestjs/graphql).
  if (/from\s+['"]@nestjs\/graphql['"]/.test(source)) {
    lines.forEach((text, i) => {
      const m = /^\s*@(Query|Mutation|Subscription)\(([^)]*\)?)/.exec(text);
      if (!m) return;
      const explicitName = /name\s*:\s*['"](\w+)['"]/.exec(text)?.[1];
      const method = methodNameAfter(lines, i);
      const field = explicitName ?? method;
      if (!field) return;
      out.push({ protocol: 'graphql', role: 'provider', key: `${m[1]!.toLowerCase()}.${field}`, filePath, line: i + 1, pattern: 'nest-resolver', ...resolved(method ? decoratedSymbol(index, filePath, i + 1, method) : undefined, 'decorated resolver method not found') });
    });
  }
  // Providers: resolver maps (`Query: { user(...) {...} }`) in files that look like resolvers.
  if (/resolvers|graphql|apollo/i.test(source)) {
    let operation: string | undefined;
    let depth = 0;
    lines.forEach((text, i) => {
      if (!operation) {
        const open = /^\s*(Query|Mutation|Subscription)\s*:\s*\{\s*$/.exec(text);
        if (open) {
          operation = open[1]!.toLowerCase();
          depth = 1;
        }
        return;
      }
      if (depth === 1) {
        const member = new RegExp(`^\\s*(?:async\\s+)?(${IDENT})\\s*(\\(|:\\s*(${IDENT})?)`).exec(text);
        if (member && member[1] !== 'async') {
          const line = i + 1;
          const declared = (index.declarationsByFile.get(filePath) ?? []).find((node) => node.startLine === line && node.name === member[1]);
          const referenced = member[3] && member[3] !== 'async' && member[3] !== 'function' ? uniqueDeclarationNamed(index, filePath, member[3]) : undefined;
          out.push({ protocol: 'graphql', role: 'provider', key: `${operation}.${member[1]}`, filePath, line, pattern: 'resolver-map', ...resolved(declared ?? referenced, 'resolver map entry has no symbol identity') });
        }
      }
      for (const ch of text) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
      }
      if (depth <= 0) operation = undefined;
    });
  }
  // Consumers: gql`...` / graphql`...` documents, attributed to the function using them.
  for (const template of findGraphqlTemplates(source)) {
    const key = graphqlOperationKey(template.text);
    if (!key) continue;
    for (const use of attributeDocumentUse(index, filePath, source, lines, template.start)) {
      out.push({ protocol: 'graphql', role: 'consumer', key, filePath, ...use });
    }
  }
}

/** gql`...` / graphql`...` tagged templates: tag offset, body text and body start offset. */
export function findGraphqlTemplates(source: string): Array<{ start: number; bodyStart: number; text: string }> {
  const templates: Array<{ start: number; bodyStart: number; text: string }> = [];
  for (const m of source.matchAll(/\b(?:gql|graphql)\s*`/g)) {
    const bodyStart = m.index! + m[0].length;
    const end = source.indexOf('`', bodyStart);
    if (end === -1) continue;
    templates.push({ start: m.index!, bodyStart, text: source.slice(bodyStart, end) });
  }
  return templates;
}

export interface DocumentUse {
  line: number;
  pattern: 'gql-inline' | 'gql-unbound' | 'gql-const';
  symbolId?: string;
  symbolName?: string;
  unresolvedReason?: string;
}

/** Attributes a GraphQL document at `offset` to the function containing it or, when it is
 * bound to a top-level const, to every function using that const. */
export function attributeDocumentUse(index: SymbolSpanIndex, filePath: string, source: string, lines: readonly string[], offset: number): DocumentUse[] {
  const line = source.slice(0, offset).split('\n').length;
  const inside = enclosingSymbol(index, filePath, line);
  if (inside) return [{ line, pattern: 'gql-inline', symbolId: canonicalSymbolId(inside), symbolName: inside.name }];
  const constName = new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*$`).exec(source.slice(source.lastIndexOf('\n', offset) + 1, offset))?.[1];
  if (!constName) return [{ line, pattern: 'gql-unbound', unresolvedReason: 'operation document is not bound to a name or used inside a function' }];
  return attributeIdentifierUse(index, filePath, lines, constName, line);
}

/** Every function in `lines` that mentions `identifier` (excluding its declaration line). */
export function attributeIdentifierUse(index: SymbolSpanIndex, filePath: string, lines: readonly string[], identifier: string, declarationLine: number): DocumentUse[] {
  const usage = new RegExp(`\\b${identifier.replace(/\$/g, '\\$')}\\b`);
  const users = new Map<string, CodeNode>();
  lines.forEach((text, i) => {
    if (i + 1 === declarationLine || !usage.test(text)) return;
    const user = enclosingSymbol(index, filePath, i + 1);
    if (user) users.set(user.id, user);
  });
  if (users.size === 0) {
    return [{ line: declarationLine, pattern: 'gql-const', unresolvedReason: `${identifier} is not used inside a function with a known span` }];
  }
  return [...users.values()].map((user) => ({ line: user.startLine ?? declarationLine, pattern: 'gql-const' as const, symbolId: canonicalSymbolId(user), symbolName: user.name }));
}

function grpcKey(service: string, rpc: string): string {
  return `${service}/${rpc.toLowerCase()}`;
}

function extractGrpc(filePath: string, source: string, lines: readonly string[], index: SymbolSpanIndex, out: ProtocolFact[]): void {
  lines.forEach((text, i) => {
    const line = i + 1;
    const method = /^\s*@GrpcMethod\(\s*(['"])(\w+)\1(?:\s*,\s*(['"])(\w+)\3)?/.exec(text);
    if (method) {
      const name = methodNameAfter(lines, i);
      const rpc = method[4] ?? name;
      if (!rpc) return;
      out.push({ protocol: 'grpc', role: 'provider', key: grpcKey(method[2]!, rpc), filePath, line, pattern: 'grpc-method-decorator', ...resolved(name ? decoratedSymbol(index, filePath, line, name) : undefined, 'decorated rpc method not found') });
      return;
    }
    const add = /addService\(\s*[\w$.]*?\b(\w+)\.service\s*,\s*\{([^}]*)\}/.exec(text);
    if (add) {
      for (const entry of add[2]!.split(',').map((part) => part.trim()).filter(Boolean)) {
        const [rpc, impl] = entry.split(':').map((part) => part.trim());
        if (!rpc || !new RegExp(`^${IDENT}$`).test(rpc)) continue;
        const implName = impl && new RegExp(`^${IDENT}$`).test(impl) ? impl : rpc;
        out.push({ protocol: 'grpc', role: 'provider', key: grpcKey(add[1]!, rpc), filePath, line, pattern: 'add-service', ...resolved(uniqueDeclarationNamed(index, filePath, implName), `rpc implementation ${implName} is not a unique function in this file`) });
      }
    }
  });

  // Clients: getService<T>('Svc') (NestJS) or `new pkg.Svc(` in files importing grpc.
  const clients = new Map<string, string>();
  const nestClient = new RegExp(`(?:this\\.)?(${IDENT})\\s*=\\s*[\\w$.]*getService(?:<[^>]*>)?\\(\\s*(['"])(\\w+)\\2\\s*\\)`, 'g');
  for (const m of source.matchAll(nestClient)) clients.set(m[1]!, m[3]!);
  if (/from\s+['"]@grpc\/grpc-js['"]|require\(\s*['"]@grpc\/grpc-js['"]\s*\)|from\s+['"]grpc['"]/.test(source)) {
    const ctor = new RegExp(`(?:const|let|var|this\\.)\\s*(${IDENT})\\s*=\\s*new\\s+[\\w$]+\\.(\\w+)\\s*\\(`, 'g');
    for (const m of source.matchAll(ctor)) clients.set(m[1]!, m[2]!);
  }
  for (const [variable, service] of clients) {
    const call = new RegExp(`(?:this\\.)?\\b${variable.replace(/\$/g, '\\$')}\\.(${IDENT})\\s*\\(`, 'g');
    lines.forEach((text, i) => {
      for (const m of text.matchAll(call)) {
        if (GRPC_CLIENT_NON_RPC.has(m[1]!)) continue;
        out.push({ protocol: 'grpc', role: 'consumer', key: grpcKey(service, m[1]!), filePath, line: i + 1, pattern: 'grpc-client-call', ...resolved(enclosingSymbol(index, filePath, i + 1), 'client call is not inside a function/method with a known span') });
      }
    });
  }
}

/** Extracts protocol facts from one repository's sources (bounded, deterministic order). */
export function extractProtocolFacts(files: ReadonlyArray<{ filePath: string; source: string }>, index: SymbolSpanIndex): ProtocolFact[] {
  const out: ProtocolFact[] = [];
  const ordered = [...files].filter((file) => isProtocolSourceFile(file.filePath)).sort((a, b) => a.filePath.localeCompare(b.filePath)).slice(0, PROTOCOL_FACT_LIMITS.maxFilesPerRepo);
  for (const file of ordered) {
    if (file.source.length > PROTOCOL_FACT_LIMITS.maxFileBytes) continue;
    if (!/publish|subscribe|send\(|Pattern|gql|graphql|Query|Mutation|resolvers|Grpc|addService|getService|grpc/.test(file.source)) continue;
    const lines = file.source.split('\n');
    extractEvents(file.filePath, lines, index, out);
    extractGraphql(file.filePath, file.source, lines, index, out);
    extractGrpc(file.filePath, file.source, lines, index, out);
    if (out.length >= PROTOCOL_FACT_LIMITS.maxFactsPerRepo) break;
  }
  const unique = new Map(out.map((fact) => [`${fact.protocol}\u0000${fact.role}\u0000${fact.key}\u0000${fact.filePath}\u0000${fact.line}\u0000${fact.symbolId ?? ''}`, fact]));
  return [...unique.values()]
    .slice(0, PROTOCOL_FACT_LIMITS.maxFactsPerRepo)
    .sort((a, b) => a.protocol.localeCompare(b.protocol) || a.key.localeCompare(b.key) || a.role.localeCompare(b.role) || a.filePath.localeCompare(b.filePath) || a.line - b.line);
}
