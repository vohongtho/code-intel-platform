import { Language } from '../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../semantic/fact-bundle.js';
import type { FactBundle } from '../../semantic/fact-bundle.js';
import { declaration } from '../../semantic/adapters/common.js';
import {
  buildHttpProducerFacts,
  composeRoutePrefix,
  extractRequestKeysFromRange,
  extractResponsesFromRange,
  findFunctionBodyRange,
  splitTopLevel,
} from '../../semantic/api-contracts/index.js';
import { summarizeFrameworkDetection } from '../detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../contracts.js';

const VERSION = '0.2.0';

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;

    if (filePath.endsWith('package.json') && /"express"\s*:/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: 'express' });
    }
    if (/from\s+['"]express['"]|require\(['"]express['"]\)/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: 'express import' });
    }
    if (/\b(?:app|router)\.(get|post|put|patch|delete|use|all)\s*\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'express registration' });
    }
  }

  return signals;
}

/**
 * Resolves each Express `Router()` variable to a fully composed mount prefix by tracking
 * `app.use(prefix, router)` / `parentRouter.use(prefix, childRouter)` bindings within the
 * same file. A router that is exported and mounted from a different file cannot be resolved
 * here — its routes still extract with their local (unprefixed) path, and the caller marks
 * the reduced coverage rather than guessing a prefix.
 */
function buildRouterPrefixMap(lines: readonly string[]): { prefixByVar: Map<string, string>; routerVars: Set<string> } {
  const routerVars = new Set<string>();
  for (const line of lines) {
    const match = line.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:express\.)?Router\s*\(/);
    if (match) routerVars.add(match[1]!);
  }

  const mounts: Array<{ parent: string; prefix: string; child: string }> = [];
  for (const line of lines) {
    const match = line.trim().match(/\b(\w+)\.use\s*\((['"])(.*?)\2\s*,\s*(\w+)\s*\)/);
    if (match && routerVars.has(match[4]!)) {
      mounts.push({ parent: match[1]!, prefix: match[3]!, child: match[4]! });
    }
  }

  const prefixByVar = new Map<string, string>([['app', '']]);
  for (let pass = 0; pass < 4; pass += 1) {
    for (const mount of mounts) {
      const parentPrefix = prefixByVar.get(mount.parent);
      if (parentPrefix === undefined) continue;
      prefixByVar.set(mount.child, composeRoutePrefix(parentPrefix, mount.prefix));
    }
  }

  return { prefixByVar, routerVars };
}

const ROUTE_CALL_PATTERN = /^\b(\w+)\.(get|post|put|patch|delete|all)\s*\((['"])(.*?)\3\s*,\s*(.+)\)\s*;?\s*$/;
const MIDDLEWARE_USE_PATTERN = /\b(?:app|router)\.use\s*\((?:['"].*?['"]\s*,\s*)?(\w+)\)/;

export const expressFrameworkAdapter: FrameworkAdapter = {
  id: 'express',
  version: VERSION,
  languages: [Language.JavaScript, Language.TypeScript],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    const facts: FactBundle['facts'][number][] = [];

    for (const filePath of view.filePaths) {
      const source = view.fileCache.get(filePath) ?? '';
      if (!source) continue;
      const relPath = filePath.replace(/^.*?code-intel-platform\//, '');
      const lines = source.split('\n');
      const { prefixByVar, routerVars } = buildRouterPrefixMap(lines);

      for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        const trimmed = line.trim();
        if (!trimmed) continue;

        const routeMatch = trimmed.match(ROUTE_CALL_PATTERN);
        if (routeMatch) {
          const mountVar = routeMatch[1]!;
          const args = splitTopLevel(routeMatch[5]!, ',')
            .map((arg) => arg.trim())
            .filter((arg) => /^\w+$/.test(arg));
          const handlerName = args.at(-1);
          if (!handlerName) continue; // inline handler expression: identity not resolvable, skip (pre-existing limitation)
          const middlewareNames = args.slice(0, -1);

          const knownMount = mountVar === 'app' || routerVars.has(mountVar);
          // A receiver that is neither the conventional `app` instance nor a locally-declared
          // `express.Router()` is not provably an Express route registration — e.g. a bare
          // `fastify.get(path, handler)` or an unrelated `cache.get(key, cb)` has the exact
          // same shape. Skip rather than guess; this mirrors the same fix already applied to
          // fastify's own (over-broad) detection signal.
          if (!knownMount) continue;
          const prefix = prefixByVar.get(mountVar);
          const unresolvedMount = knownMount && mountVar !== 'app' && prefix === undefined;
          const composedPath = prefix !== undefined ? composeRoutePrefix(prefix, routeMatch[4]!) : routeMatch[4]!;

          const handlerRef = `express:handler:${relPath}:${handlerName}`;
          const middlewareRefs = middlewareNames.map((name) => `express:handler:${relPath}:${name}`);
          facts.push(declaration(handlerRef, Language.JavaScript, relPath, lineNumber, 'function', handlerName));

          const sourceRange = { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length };
          const frameworkEvidence = { frameworkId: 'express', adapterVersion: VERSION, registrationText: trimmed, exact: true };
          facts.push({
            factId: `express:route:${relPath}:${handlerName}`,
            language: Language.JavaScript,
            filePath: relPath,
            sourceRange,
            routeKind: 'http' as const,
            path: composedPath,
            method: routeMatch[2]!.toLowerCase(),
            handlerRef,
            framework: 'express',
            frameworkEvidence,
          });

          const bodyRange = findFunctionBodyRange(lines, handlerName);
          const producerFacts = buildHttpProducerFacts({
            factId: `express:http-route:${relPath}:${handlerName}`,
            language: Language.JavaScript,
            filePath: relPath,
            sourceRange,
            method: routeMatch[2],
            path: composedPath,
            handlerRef,
            middlewareRefs,
            framework: 'express',
            frameworkEvidence,
            requestShape: bodyRange ? extractRequestKeysFromRange(lines, bodyRange.declLine, bodyRange.end) : undefined,
            responses: bodyRange ? extractResponsesFromRange(lines, bodyRange.declLine, bodyRange.end) : undefined,
            extraBoundaries: [
              ...(unresolvedMount ? (['unsupported-framework-construct'] as const) : []),
              ...(bodyRange ? [] : (['unresolved-response-shape', 'unresolved-dto'] as const)),
            ],
          });
          facts.push(producerFacts.routeFact);
          if (producerFacts.requestShapeFact) facts.push(producerFacts.requestShapeFact);
          facts.push(...producerFacts.responseShapeFacts);
          continue;
        }

        const middlewareMatch = trimmed.match(MIDDLEWARE_USE_PATTERN);
        if (middlewareMatch) {
          facts.push({
            factId: `express:middleware:${relPath}:${middlewareMatch[1]}`,
            language: Language.JavaScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
            registrationKind: 'middleware',
            targetText: middlewareMatch[1]!,
            subjectRef: `express:handler:${relPath}:${middlewareMatch[1]}`,
            framework: 'express',
            frameworkEvidence: {
              frameworkId: 'express',
              adapterVersion: VERSION,
              registrationText: trimmed,
              exact: true,
            },
          });
        }
      }
    }

    return createFactBundle({
      schema: { version: FACT_SCHEMA_VERSION, language: Language.JavaScript, adapterId: 'framework:express', frameworkDetections: ['express'] },
      facts,
      diagnostics: [],
    });
  },
};
