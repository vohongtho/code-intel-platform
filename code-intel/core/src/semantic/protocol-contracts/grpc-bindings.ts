import { canonicalSymbolId, decoratedSymbol, enclosingSymbol, uniqueDeclarationNamed, type SymbolSpanIndex } from '../../multi-repo/symbol-spans.js';
import { grpcRpcId, type ProtoFileModel } from './grpc-types.js';

/**
 * Source-verified gRPC provider/consumer bindings. A binding is `exact` only when the source
 * proves the fully-qualified package + service and the RPC exists in a parsed proto service;
 * a service whose package had to be inferred is at most a `candidate`, and method-name
 * equality alone never produces a binding.
 */

export type GrpcBindingRole = 'provider' | 'consumer';

export interface GrpcBindingFact {
  role: GrpcBindingRole;
  /** Canonical RPC ids this binding may refer to; exactly one for an exact binding. */
  rpcIds: readonly string[];
  certainty: 'exact' | 'candidate';
  framework: 'grpc-js' | 'nestjs';
  pattern: string;
  filePath: string;
  line: number;
  symbolId?: string;
  symbolName?: string;
  /** Why the binding is not exact (package inferred, ambiguous service, unattributed symbol). */
  boundaryReasons: readonly string[];
}

export interface ProtocolCapabilityRow {
  protocol: 'graphql' | 'grpc';
  language: string;
  framework: string;
  role: 'provider' | 'consumer' | 'schema';
  status: 'supported' | 'unsupported';
  evidence: string;
}

/** Published so callers can tell "no binding found" from "ecosystem not analyzed". */
export const GRPC_BINDING_CAPABILITIES: readonly ProtocolCapabilityRow[] = [
  { protocol: 'grpc', language: 'proto', framework: 'protobuf schema', role: 'schema', status: 'supported', evidence: 'in-repository parser: packages, services/RPCs, streaming, messages, fields, map/oneof, enums, reserved' },
  { protocol: 'grpc', language: 'typescript/javascript', framework: '@grpc/grpc-js', role: 'consumer', status: 'supported', evidence: 'new <loadPackageDefinition path>.<Service>(...) client + <client>.<rpc>(...) calls' },
  { protocol: 'grpc', language: 'typescript/javascript', framework: '@grpc/grpc-js', role: 'provider', status: 'supported', evidence: 'server.addService(<loadPackageDefinition path>.<Service>.service, { <rpc>: impl })' },
  { protocol: 'grpc', language: 'typescript', framework: '@nestjs/microservices', role: 'provider', status: 'supported', evidence: "@GrpcMethod('<Service>', '<Rpc>') with the repository's Transport.GRPC options.package" },
  { protocol: 'grpc', language: 'typescript', framework: '@nestjs/microservices', role: 'consumer', status: 'supported', evidence: "ClientGrpc.getService('<Service>') with the repository's Transport.GRPC options.package" },
  { protocol: 'grpc', language: 'java', framework: 'grpc-java', role: 'provider', status: 'unsupported', evidence: 'schema-level drift only' },
  { protocol: 'grpc', language: 'java', framework: 'grpc-java', role: 'consumer', status: 'unsupported', evidence: 'schema-level drift only' },
  { protocol: 'grpc', language: 'go', framework: 'grpc-go', role: 'provider', status: 'unsupported', evidence: 'schema-level drift only' },
  { protocol: 'grpc', language: 'go', framework: 'grpc-go', role: 'consumer', status: 'unsupported', evidence: 'schema-level drift only' },
  { protocol: 'grpc', language: 'csharp', framework: 'Grpc.AspNetCore / Grpc.Net.Client', role: 'provider', status: 'unsupported', evidence: 'schema-level drift only' },
  { protocol: 'grpc', language: 'csharp', framework: 'Grpc.AspNetCore / Grpc.Net.Client', role: 'consumer', status: 'unsupported', evidence: 'schema-level drift only' },
  { protocol: 'grpc', language: 'python', framework: 'grpcio', role: 'consumer', status: 'unsupported', evidence: 'schema-level drift only' },
];

export const GRAPHQL_BINDING_CAPABILITIES: readonly ProtocolCapabilityRow[] = [
  { protocol: 'graphql', language: 'graphql', framework: 'SDL schema documents', role: 'schema', status: 'supported', evidence: 'graphql-js AST: object/input/interface/union/enum/scalar, fields, args/defaults, wrappers, extensions' },
  { protocol: 'graphql', language: 'graphql', framework: 'operation documents', role: 'consumer', status: 'supported', evidence: '.graphql/.gql operations, attributed through relative `import X from "./x.graphql"` uses' },
  { protocol: 'graphql', language: 'typescript/javascript', framework: 'gql/graphql tagged templates', role: 'consumer', status: 'supported', evidence: 'gql`...` documents attributed to the enclosing or using function; ${...} interpolations are a boundary' },
  { protocol: 'graphql', language: 'typescript', framework: '@nestjs/graphql', role: 'provider', status: 'supported', evidence: '@Query/@Mutation/@Subscription root-field resolvers' },
  { protocol: 'graphql', language: 'typescript/javascript', framework: 'resolver maps (Apollo/graphql-tools)', role: 'provider', status: 'supported', evidence: 'Query/Mutation/Subscription: { field() {} } root-field entries' },
  { protocol: 'graphql', language: 'typescript', framework: '@nestjs/graphql @ResolveField / type resolvers', role: 'provider', status: 'unsupported', evidence: 'non-root field resolvers are not bound; schema drift still applies' },
  { protocol: 'graphql', language: 'any', framework: 'persisted queries / generated hooks without documents', role: 'consumer', status: 'unsupported', evidence: 'no operation document in source' },
];

const IDENT = '[A-Za-z_$][\\w$]*';
const GRPC_CLIENT_NON_RPC = new Set(['close', 'waitForReady', 'getChannel', 'then', 'catch', 'bind', 'call', 'apply', 'service']);

interface ServiceIndex {
  /** Fully-qualified service name -> RPC names. */
  byFullName: ReadonlyMap<string, readonly string[]>;
  /** Short service name -> fully-qualified names. */
  byShortName: ReadonlyMap<string, readonly string[]>;
}

export function buildServiceIndex(files: readonly ProtoFileModel[]): ServiceIndex {
  const byFullName = new Map<string, string[]>();
  const byShortName = new Map<string, string[]>();
  for (const file of files) {
    for (const service of file.services) {
      byFullName.set(service.fullName, service.rpcs.map((rpc) => rpc.name));
      byShortName.set(service.name, [...new Set([...(byShortName.get(service.name) ?? []), service.fullName])].sort());
    }
  }
  return { byFullName, byShortName };
}

/** grpc-js exposes both `GetUser` and `getUser` on clients/implementations. */
function matchRpc(rpcs: readonly string[], written: string): string | undefined {
  return rpcs.find((rpc) => rpc === written) ?? rpcs.find((rpc) => rpc.toLowerCase() === written.toLowerCase() && rpc.slice(1) === written.slice(1));
}

interface ServiceResolution {
  rpcIds: (rpc: string) => string[];
  exact: boolean;
  reason?: string;
}

/** Resolves a (possibly package-less) service reference against parsed protos. */
function resolveService(index: ServiceIndex, pkg: string | undefined, service: string): ServiceResolution | undefined {
  if (pkg !== undefined) {
    const fullName = pkg ? `${pkg}.${service}` : service;
    const rpcs = index.byFullName.get(fullName);
    if (!rpcs) return undefined;
    return { rpcIds: (rpc) => { const m = matchRpc(rpcs, rpc); return m ? [grpcRpcId(fullName, m)] : []; }, exact: true };
  }
  const candidates = index.byShortName.get(service) ?? [];
  if (candidates.length === 0) return undefined;
  return {
    rpcIds: (rpc) => candidates.flatMap((fullName) => { const m = matchRpc(index.byFullName.get(fullName) ?? [], rpc); return m ? [grpcRpcId(fullName, m)] : []; }),
    exact: false,
    reason: candidates.length > 1 ? 'ambiguous-service-package' : 'package-inferred',
  };
}

/** `const proto = grpc.loadPackageDefinition(def)` / `.acme.v1` suffix / one alias hop. */
function packageRoots(source: string): Map<string, string> {
  const roots = new Map<string, string>();
  for (const m of source.matchAll(new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*(?:[\\w$]+\\.)?loadPackageDefinition\\([^)]*\\)((?:\\.${IDENT})*)`, 'g'))) {
    roots.set(m[1]!, (m[2] ?? '').replace(/^\./, ''));
  }
  for (const m of source.matchAll(new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*(${IDENT})((?:\\.${IDENT})+)\\s*;`, 'g'))) {
    const base = roots.get(m[2]!);
    if (base !== undefined) roots.set(m[1]!, [base, m[3]!.replace(/^\./, '')].filter(Boolean).join('.'));
  }
  return roots;
}

/** Splits `root.a.b.Service` into a proven package (when `root` is a known package root). */
function splitServicePath(dotted: string, roots: ReadonlyMap<string, string>): { pkg?: string; service: string } {
  const parts = dotted.split('.');
  const service = parts.pop()!;
  const root = parts.shift();
  if (root === undefined || !roots.has(root)) return { service };
  return { pkg: [roots.get(root)!, ...parts].filter(Boolean).join('.'), service };
}

/** The repository's single NestJS Transport.GRPC `package`, when exactly one is declared. */
export function nestGrpcPackages(sources: ReadonlyArray<{ source: string }>): string[] {
  const packages = new Set<string>();
  for (const { source } of sources) {
    if (!/Transport\.GRPC/.test(source)) continue;
    for (const m of source.matchAll(/\bpackage\s*:\s*(['"])([\w.]+)\1/g)) packages.add(m[2]!);
    for (const m of source.matchAll(/\bpackage\s*:\s*\[([^\]]*)\]/g)) for (const p of m[1]!.matchAll(/(['"])([\w.]+)\1/g)) packages.add(p[2]!);
  }
  return [...packages].sort();
}

function attribution(node: ReturnType<typeof enclosingSymbol>): Pick<GrpcBindingSite, 'symbolId' | 'symbolName'> {
  return node ? { symbolId: canonicalSymbolId(node), symbolName: node.name } : {};
}

/** A provider/consumer call site as written, before resolution against any proto model.
 * `pkg` is set only when the source proves it; it is persisted per repository and resolved
 * group-wide (client repositories rarely contain the server's protos). */
export interface GrpcBindingSite {
  role: GrpcBindingRole;
  pkg?: string;
  service: string;
  rpc: string;
  framework: GrpcBindingFact['framework'];
  pattern: string;
  filePath: string;
  line: number;
  symbolId?: string;
  symbolName?: string;
}

/** Extracts gRPC binding sites from one repository's TS/JS sources. */
export function extractGrpcBindingSites(files: ReadonlyArray<{ filePath: string; source: string }>, symbols: SymbolSpanIndex): GrpcBindingSite[] {
  const nestPackages = nestGrpcPackages(files);
  const nestPkg = nestPackages.length === 1 ? nestPackages[0] : undefined;
  const out: GrpcBindingSite[] = [];

  for (const { filePath, source } of files) {
    if (!/grpc|Grpc|addService|getService/.test(source)) continue;
    const lines = source.split('\n');
    const roots = packageRoots(source);

    // grpc-js clients: `const client = new proto.acme.v1.UserService(addr, creds)`.
    const clients = new Map<string, { pkg?: string; service: string; framework: GrpcBindingFact['framework'] }>();
    for (const m of source.matchAll(new RegExp(`(?:const|let|var|this\\.)\\s*(${IDENT})\\s*=\\s*new\\s+((?:${IDENT}\\.)+${IDENT})\\s*\\(`, 'g'))) {
      const split = splitServicePath(m[2]!, roots);
      if (split.pkg === undefined && !roots.size) continue; // not a loadPackageDefinition client
      clients.set(m[1]!, { ...split, framework: 'grpc-js' });
    }
    // NestJS clients: `this.users = this.client.getService<UserServiceClient>('UserService')`.
    for (const m of source.matchAll(new RegExp(`(?:this\\.)?(${IDENT})\\s*=\\s*[\\w$.]*getService(?:<[^>]*>)?\\(\\s*(['"])(\\w+)\\2\\s*\\)`, 'g'))) {
      clients.set(m[1]!, { pkg: nestPkg, service: m[3]!, framework: 'nestjs' });
    }
    for (const [variable, client] of clients) {
      const call = new RegExp(`(?:this\\.)?\\b${variable.replace(/\$/g, '\\$')}\\.(${IDENT})\\s*\\(`, 'g');
      lines.forEach((text, i) => {
        for (const m of text.matchAll(call)) {
          if (GRPC_CLIENT_NON_RPC.has(m[1]!)) continue;
          out.push({ role: 'consumer', ...client, rpc: m[1]!, pattern: 'client-call', filePath, line: i + 1, ...attribution(enclosingSymbol(symbols, filePath, i + 1)) });
        }
      });
    }

    lines.forEach((text, i) => {
      const line = i + 1;
      // grpc-js servers: `server.addService(proto.acme.v1.UserService.service, { getUser: impl })`.
      const add = new RegExp(`addService\\(\\s*((?:${IDENT}\\.)+${IDENT})\\.service\\s*,\\s*\\{([^}]*)\\}`).exec(text);
      if (add) {
        const split = splitServicePath(add[1]!, roots);
        for (const entry of add[2]!.split(',').map((part) => part.trim()).filter(Boolean)) {
          const [rpc, impl] = entry.split(':').map((part) => part.trim());
          if (!rpc || !new RegExp(`^${IDENT}$`).test(rpc)) continue;
          const implName = impl && new RegExp(`^${IDENT}$`).test(impl) ? impl : rpc;
          out.push({ role: 'provider', ...split, rpc, framework: 'grpc-js', pattern: 'add-service', filePath, line, ...attribution(uniqueDeclarationNamed(symbols, filePath, implName)) });
        }
      }
      // NestJS: `@GrpcMethod('UserService', 'GetUser')`.
      const method = /^\s*@GrpcMethod\(\s*(['"])(\w+)\1(?:\s*,\s*(['"])(\w+)\3)?/.exec(text);
      if (method) {
        const name = methodNameAfter(lines, i);
        const rpc = method[4] ?? (name ? name[0]!.toUpperCase() + name.slice(1) : undefined);
        if (!rpc) return;
        out.push({ role: 'provider', pkg: nestPkg, service: method[2]!, rpc, framework: 'nestjs', pattern: 'grpc-method-decorator', filePath, line, ...attribution(name ? decoratedSymbol(symbols, filePath, line, name) : undefined) });
      }
    });
  }
  return out.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.role.localeCompare(b.role) || a.rpc.localeCompare(b.rpc));
}

/**
 * Resolves binding sites against the group's parsed protos by canonical package/service/RPC.
 * A site whose package is unknown resolves only as a `candidate` (one per same-named service);
 * an RPC the service does not declare produces no binding at all.
 */
export function resolveGrpcBindings(sites: readonly GrpcBindingSite[], protos: readonly ProtoFileModel[]): GrpcBindingFact[] {
  const index = buildServiceIndex(protos);
  const out: GrpcBindingFact[] = [];
  for (const site of sites) {
    const resolution = resolveService(index, site.pkg, site.service);
    if (!resolution) continue;
    const rpcIds = resolution.rpcIds(site.rpc);
    if (rpcIds.length === 0) continue;
    const reasons = [...(resolution.reason ? [resolution.reason] : []), ...(site.symbolId ? [] : ['unattributed-symbol'])].sort();
    out.push({
      role: site.role,
      rpcIds,
      certainty: resolution.exact && rpcIds.length === 1 ? 'exact' : 'candidate',
      framework: site.framework,
      pattern: site.pattern,
      filePath: site.filePath,
      line: site.line,
      symbolId: site.symbolId,
      symbolName: site.symbolName,
      boundaryReasons: reasons,
    });
  }
  const unique = new Map(out.map((fact) => [`${fact.role}\u0000${fact.rpcIds.join(',')}\u0000${fact.filePath}\u0000${fact.line}\u0000${fact.symbolId ?? ''}`, fact]));
  return [...unique.values()].sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.role.localeCompare(b.role) || a.rpcIds.join().localeCompare(b.rpcIds.join()));
}

function methodNameAfter(lines: readonly string[], index: number): string | undefined {
  for (let i = index + 1; i < Math.min(lines.length, index + 7); i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith('@') || trimmed === '') continue;
    return new RegExp(`^(?:(?:public|private|protected|static|async|override)\\s+)*(${IDENT})\\s*\\(`).exec(trimmed)?.[1];
  }
  return undefined;
}
