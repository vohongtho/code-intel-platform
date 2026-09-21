import { Language } from '../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../semantic/fact-bundle.js';
import type { FactBundle } from '../../semantic/fact-bundle.js';
import { declaration } from '../../semantic/adapters/common.js';
import { buildHttpProducerFacts } from '../../semantic/api-contracts/index.js';
import { summarizeFrameworkDetection } from '../detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../contracts.js';

const VERSION = '0.2.0';

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];
  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    if (filePath.endsWith('.csproj') && /Microsoft\.AspNetCore|Microsoft\.Extensions\.DependencyInjection/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: 'aspnet package' });
    }
    if (/using\s+Microsoft\.AspNetCore\.|using\s+Microsoft\.Extensions\.DependencyInjection/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: 'aspnet using' });
    }
    if (/\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|Route)\b|Map(Get|Post|Put|Patch|Delete)\(|AddScoped\(|AddTransient\(|AddSingleton\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'aspnet registration' });
    }
  }
  return signals;
}

/** Strips Task<...> then ActionResult<...> wrappers. Returns undefined for a bare
 * IActionResult/ActionResult/Task/void that carries no statically knowable payload type. */
function unwrapAspNetReturnType(returnType: string): string | undefined {
  let text = returnType.trim();
  const taskMatch = text.match(/^Task<(.+)>$/);
  if (taskMatch) text = taskMatch[1]!.trim();
  else if (text === 'Task' || text === 'void') return undefined;

  const actionResultMatch = text.match(/^ActionResult<(.+)>$/);
  if (actionResultMatch) text = actionResultMatch[1]!.trim();
  else if (text === 'IActionResult' || text === 'ActionResult') return undefined;

  return text;
}

function defaultStatusForMethod(method: string): number {
  return method === 'post' ? 201 : 200;
}

interface ProducesResponseType {
  status: number;
  typeName?: string;
}

function extractFacts(view: RepositoryFactView): FactBundle['facts'] {
  const facts: FactBundle['facts'][number][] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    const relPath = filePath.replace(/^.*?code-intel-platform\//, '');
    const lines = source.split('\n');

    let controllerPrefix = '';
    let pendingMethod: string | undefined;
    let pendingPath: string | undefined;
    let pendingAuthorize: string[] = [];
    let pendingProduces: ProducesResponseType[] = [];

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const routePrefixMatch = trimmed.match(/^\[Route\((?:"([^"]*)"|nameof\((\w+)\))\)\]/);
      if (routePrefixMatch) {
        controllerPrefix = routePrefixMatch[1] ?? routePrefixMatch[2] ?? '';
        continue;
      }

      const attrMatch = trimmed.match(/^\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete)(?:\("([^"]*)"\))?\]/);
      if (attrMatch) {
        pendingMethod = attrMatch[1]!.replace(/^Http/, '').toLowerCase();
        pendingPath = attrMatch[2] ?? '';
        continue;
      }

      const authorizeMatch = trimmed.match(/^\[Authorize(?:\(([^)]*)\))?\]/);
      if (authorizeMatch) {
        pendingAuthorize.push(authorizeMatch[1] ? `Authorize(${authorizeMatch[1]})` : 'Authorize');
        continue;
      }

      const producesMatch = trimmed.match(/^\[ProducesResponseType\(/);
      if (producesMatch) {
        const statusMatch = trimmed.match(/StatusCodes\.Status(\d+)|\((\d+)/);
        const typeofMatch = trimmed.match(/typeof\((\w+)\)/);
        if (statusMatch) {
          pendingProduces.push({ status: Number(statusMatch[1] ?? statusMatch[2]), typeName: typeofMatch?.[1] });
        }
        continue;
      }

      const actionMatch = trimmed.match(/^(?:public\s+)?(?:async\s+)?([\w<>]+)\s+(\w+)\s*\(([^)]*)\)/);
      if (actionMatch && pendingMethod) {
        const returnTypeText = actionMatch[1]!.trim();
        const actionName = actionMatch[2]!;
        const paramsText = actionMatch[3]!;
        const handlerRef = `aspnet:handler:${relPath}:${actionName}`;
        const composedPath = [controllerPrefix, pendingPath].filter(Boolean).join('/').replace(/\/+/g, '/');

        facts.push(declaration(handlerRef, Language.CSharp, relPath, lineNumber, 'method', actionName));
        const sourceRange = { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length };
        const frameworkEvidence = { frameworkId: 'aspnet-core', adapterVersion: VERSION, registrationText: trimmed, exact: true };
        facts.push({
          factId: `aspnet:route:${relPath}:${actionName}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange,
          routeKind: 'http' as const,
          path: composedPath,
          method: pendingMethod,
          handlerRef,
          framework: 'aspnet-core',
          frameworkEvidence,
        });

        const bodyParamMatch = paramsText.match(/\[FromBody\]\s*(\w+)\s+\w+/);
        const bodyTypeName = bodyParamMatch?.[1];
        const inferredReturnType = unwrapAspNetReturnType(returnTypeText);
        const responseTypeName = pendingProduces.find((p) => p.typeName)?.typeName ?? inferredReturnType;

        const producerFacts = buildHttpProducerFacts({
          factId: `aspnet:http-route:${relPath}:${actionName}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange,
          method: pendingMethod,
          path: composedPath,
          handlerRef,
          middlewareRefs: [],
          authEvidence: pendingAuthorize.length > 0 ? [...pendingAuthorize] : undefined,
          framework: 'aspnet-core',
          frameworkEvidence,
          extraBoundaries: responseTypeName ? [] : (['unresolved-response-shape'] as const),
        });

        if (bodyTypeName) {
          const shapeFingerprint = `symbol:${relPath}:${bodyTypeName}`;
          producerFacts.routeFact.requestShapeRef = shapeFingerprint;
          producerFacts.requestShapeFact = {
            factId: `aspnet:http-route:${relPath}:${actionName}:request-shape`,
            language: Language.CSharp,
            filePath: relPath,
            sourceRange,
            shapeFactKind: 'http-request-shape',
            shapeFingerprint,
            origin: { kind: 'symbol', symbolRef: `aspnet:decl:${relPath}:${bodyTypeName}`, symbolName: bodyTypeName },
            coverage: { complete: true, boundaryReasons: [] },
          };
        }

        if (pendingProduces.length > 0) {
          producerFacts.routeFact.responses = pendingProduces.map((produces) => {
            if (!produces.typeName) return { status: produces.status, evidence: 'unknown' as const };
            const shapeFingerprint = `symbol:${relPath}:${produces.typeName}`;
            producerFacts.responseShapeFacts.push({
              factId: `aspnet:http-route:${relPath}:${actionName}:response-shape:${produces.status}`,
              language: Language.CSharp,
              filePath: relPath,
              sourceRange,
              shapeFactKind: 'http-response-shape',
              status: produces.status,
              shapeFingerprint,
              origin: { kind: 'symbol', symbolRef: `aspnet:decl:${relPath}:${produces.typeName}`, symbolName: produces.typeName },
              coverage: { complete: true, boundaryReasons: [] },
            });
            return { status: produces.status, responseShapeRef: shapeFingerprint, evidence: 'exact' as const };
          });
        } else if (inferredReturnType) {
          const status = defaultStatusForMethod(pendingMethod);
          const shapeFingerprint = `symbol:${relPath}:${inferredReturnType}`;
          producerFacts.routeFact.responses = [{ status, responseShapeRef: shapeFingerprint, evidence: 'heuristic' }];
          producerFacts.responseShapeFacts.push({
            factId: `aspnet:http-route:${relPath}:${actionName}:response-shape`,
            language: Language.CSharp,
            filePath: relPath,
            sourceRange,
            shapeFactKind: 'http-response-shape',
            status,
            shapeFingerprint,
            origin: { kind: 'symbol', symbolRef: `aspnet:decl:${relPath}:${inferredReturnType}`, symbolName: inferredReturnType },
            coverage: { complete: true, boundaryReasons: [] },
          });
        }

        facts.push(producerFacts.routeFact);
        if (producerFacts.requestShapeFact) facts.push(producerFacts.requestShapeFact);
        facts.push(...producerFacts.responseShapeFacts);

        pendingMethod = undefined;
        pendingPath = undefined;
        pendingAuthorize = [];
        pendingProduces = [];
        continue;
      }

      const endpointMatch = trimmed.match(/\.Map(Get|Post|Put|Patch|Delete)\("([^"]+)"\s*,\s*(\w+)/);
      if (endpointMatch) {
        const handlerRef = `aspnet:handler:${relPath}:${endpointMatch[3]}`;
        const method = endpointMatch[1]!.toLowerCase();
        const path = endpointMatch[2]!;
        facts.push(declaration(handlerRef, Language.CSharp, relPath, lineNumber, 'function', endpointMatch[3]!));
        const sourceRange = { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length };
        const frameworkEvidence = { frameworkId: 'aspnet-core', adapterVersion: VERSION, registrationText: trimmed, exact: true };
        facts.push({
          factId: `aspnet:endpoint:${relPath}:${endpointMatch[3]}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange,
          routeKind: 'http' as const,
          path,
          method,
          handlerRef,
          framework: 'aspnet-core',
          frameworkEvidence,
        });
        const producerFacts = buildHttpProducerFacts({
          factId: `aspnet:http-endpoint:${relPath}:${endpointMatch[3]}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange,
          method,
          path,
          handlerRef,
          middlewareRefs: [],
          framework: 'aspnet-core',
          frameworkEvidence,
          // Minimal-API handlers are lambdas/local functions; their request/response shape is
          // not resolved by this line-based scan (reflection-style delegate registration).
          extraBoundaries: ['reflection-registration'],
        });
        facts.push(producerFacts.routeFact);
        continue;
      }

      const diMatch = trimmed.match(/Add(Scoped|Transient|Singleton)\s*<\s*([^,>]+)\s*,\s*([^>]+)\s*>\s*\(/);
      if (diMatch) {
        facts.push({
          factId: `msdi:${relPath}:${diMatch[2]}:${diMatch[3]}:${lineNumber}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          bindingKind: 'contract-to-implementation',
          contractRef: diMatch[2]!.trim(),
          implementationRef: diMatch[3]!.trim(),
          lifetime: diMatch[1]!.toLowerCase(),
          dynamic: false,
          framework: 'microsoft-di',
          frameworkEvidence: {
            frameworkId: 'microsoft-di',
            adapterVersion: VERSION,
            registrationText: trimmed,
            exact: true,
          },
        });
      }
    }
  }

  return facts;
}

export const aspnetCoreFrameworkAdapter: FrameworkAdapter = {
  id: 'aspnet-core',
  version: VERSION,
  languages: [Language.CSharp],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.CSharp,
        adapterId: 'framework:aspnet-core',
        frameworkDetections: ['aspnet-core', 'microsoft-di'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
