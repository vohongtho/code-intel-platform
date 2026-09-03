import { Language } from '../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../semantic/fact-bundle.js';
import type { FactBundle } from '../../semantic/fact-bundle.js';
import { declaration } from '../../semantic/adapters/common.js';
import { buildHttpProducerFacts, composeRoutePrefix, parseInlineObjectKeys } from '../../semantic/api-contracts/index.js';
import { summarizeFrameworkDetection } from '../detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../contracts.js';

const VERSION = '0.2.0';

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;

    if (filePath.endsWith('package.json') && /"@nestjs\/(common|core|platform-express)"\s*:/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: '@nestjs/*' });
    }
    if (/from\s+['"]@nestjs\/(common|core)['"]/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: '@nestjs import' });
    }
    if (/@(Controller|Get|Post|Put|Patch|Delete|Module|Injectable)\b/.test(source)) {
      signals.push({ kind: 'decorator', strength: 'strong', filePath, value: 'nestjs decorator' });
    }
  }

  return signals;
}

const PRIMITIVE_RETURN_TYPES = new Set(['void', 'any', 'unknown', 'never', 'string', 'number', 'boolean', 'undefined', 'null']);

function unwrapPromise(typeText: string): string {
  const match = typeText.match(/^Promise<(.+)>$/);
  return match ? match[1]!.trim() : typeText;
}

function defaultStatusForMethod(method: string): number {
  return method === 'post' ? 201 : 200;
}

interface MethodSignatureMatch {
  methodName: string;
  paramsText: string;
  /** Index into `trimmed` right after the parameter list's closing paren. */
  afterParamsIndex: number;
}

/** Matches `name(params)` with paren-depth tracking (not a `[^)]*` regex) because Nest
 * parameter decorators like `@Body()`/`@Param('id')` contain their own parens, which a
 * negated-character-class regex cannot skip past. */
function matchMethodSignature(trimmed: string): MethodSignatureMatch | undefined {
  const start = trimmed.match(/^(?:async\s+)?(\w+)\s*\(/);
  if (!start) return undefined;
  const openIndex = start[0].length - 1;
  let depth = 0;
  for (let i = openIndex; i < trimmed.length; i += 1) {
    if (trimmed[i] === '(') depth += 1;
    else if (trimmed[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return { methodName: start[1]!, paramsText: trimmed.slice(openIndex + 1, i), afterParamsIndex: i + 1 };
      }
    }
  }
  return undefined;
}

/** Brace-counts a method body starting at `lines[startIndex]` (which must contain the
 * opening `{`) and scans single-line `return { ... };` statements for object-literal keys.
 * Used only when no return-type annotation names a DTO to reference by symbol instead.
 * String slicing (not regex) on purpose: a `{...}` literal that may contain nested braces
 * is not safely bounded by a `.*`-style regex without backtracking risk. */
function extractReturnLiteralFields(lines: readonly string[], startIndex: number): ReturnType<typeof parseInlineObjectKeys> {
  let depth = 0;
  let started = false;
  for (let i = startIndex; i < lines.length; i += 1) {
    for (const ch of lines[i]!) {
      if (ch === '{') {
        depth += 1;
        started = true;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
    const trimmedLine = lines[i]!.trim();
    if (trimmedLine.startsWith('return {')) {
      const withoutReturn = trimmedLine.slice('return '.length).trim();
      const withoutSemicolon = withoutReturn.endsWith(';') ? withoutReturn.slice(0, -1).trim() : withoutReturn;
      const parsed = parseInlineObjectKeys(withoutSemicolon);
      if (parsed) return parsed;
    }
    if (started && depth <= 0) break;
  }
  return undefined;
}

function extractFacts(view: RepositoryFactView): FactBundle['facts'] {
  const facts: FactBundle['facts'][number][] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    const relPath = filePath.replace(/^.*?code-intel-platform\//, '');
    const lines = source.split('\n');

    let pendingControllerPath: string | undefined;
    let pendingMethod: string | undefined;
    let pendingRoutePath: string | undefined;
    let pendingStatusCode: number | undefined;
    let pendingGuards: string[] = [];
    let controllerGuards: string[] = [];
    let controllerPrefix = '';

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const controllerMatch = trimmed.match(/^@Controller\((['"])(.*?)\1\)/);
      if (controllerMatch) {
        pendingControllerPath = controllerMatch[2];
        continue;
      }

      const routeMatch = trimmed.match(/^@(Get|Post|Put|Patch|Delete)\((['"])(.*?)\2\)/);
      if (routeMatch) {
        pendingMethod = routeMatch[1]!.toLowerCase();
        pendingRoutePath = routeMatch[3];
        continue;
      }
      const bareRouteMatch = trimmed.match(/^@(Get|Post|Put|Patch|Delete)\(\)/);
      if (bareRouteMatch) {
        pendingMethod = bareRouteMatch[1]!.toLowerCase();
        pendingRoutePath = '';
        continue;
      }

      const guardsMatch = trimmed.match(/^@(?:UseGuards|UseInterceptors)\(([^)]*)\)/);
      if (guardsMatch) {
        const names = guardsMatch[1]!.split(',').map((v) => v.trim()).filter(Boolean);
        pendingGuards.push(...names);
        continue;
      }

      const statusMatch = trimmed.match(/^@HttpCode\((\d+)\)/);
      if (statusMatch) {
        pendingStatusCode = Number(statusMatch[1]);
        continue;
      }

      const classMatch = trimmed.match(/^export\s+class\s+(\w+)/);
      if (classMatch) {
        const className = classMatch[1]!;
        const classFactId = `nest:decl:${relPath}:${className}`;
        facts.push(declaration(classFactId, Language.TypeScript, relPath, lineNumber, 'class', className));

        if (pendingControllerPath !== undefined) {
          controllerPrefix = pendingControllerPath;
          controllerGuards = pendingGuards;
          pendingGuards = [];
          facts.push({
            factId: `nest:registration:${relPath}:${className}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: className.length },
            registrationKind: 'controller',
            subjectRef: classFactId,
            targetText: pendingControllerPath,
            framework: 'nest',
            frameworkEvidence: {
              frameworkId: 'nest',
              adapterVersion: VERSION,
              registrationText: '@Controller',
              exact: true,
            },
          });
          pendingControllerPath = undefined;
        }
        continue;
      }

      const methodMatch = matchMethodSignature(trimmed);
      const methodHasBodyOnThisLine = methodMatch && trimmed.slice(methodMatch.afterParamsIndex).includes('{');
      if (methodMatch && methodHasBodyOnThisLine && pendingMethod && pendingRoutePath !== undefined) {
        const methodName = methodMatch.methodName;
        const paramsText = methodMatch.paramsText;
        const afterParams = trimmed.slice(methodMatch.afterParamsIndex, trimmed.indexOf('{', methodMatch.afterParamsIndex)).trim();
        const returnTypeText = afterParams.startsWith(':') ? afterParams.slice(1).trim() : undefined;
        const handlerRef = `nest:handler:${relPath}:${methodName}`;
        const composedPath = composeRoutePrefix(controllerPrefix, pendingRoutePath);
        const guards = [...controllerGuards, ...pendingGuards];

        facts.push(declaration(handlerRef, Language.TypeScript, relPath, lineNumber, 'method', methodName));
        const sourceRange = { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: methodName.length };
        const frameworkEvidence = {
          frameworkId: 'nest',
          adapterVersion: VERSION,
          registrationText: '@' + pendingMethod[0]!.toUpperCase() + pendingMethod.slice(1),
          exact: true,
        };
        facts.push({
          factId: `nest:route:${relPath}:${methodName}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange,
          routeKind: 'http' as const,
          path: composedPath,
          method: pendingMethod,
          handlerRef,
          framework: 'nest',
          frameworkEvidence,
        });

        const bodyParamMatch = paramsText.match(/@Body\(\)\s*\w+\s*:\s*([\w<>[\].]+)/);
        const bodyTypeName = bodyParamMatch?.[1];

        const responseTypeName =
          returnTypeText && !PRIMITIVE_RETURN_TYPES.has(unwrapPromise(returnTypeText).replace(/\[\]$/, ''))
            ? unwrapPromise(returnTypeText).replace(/\[\]$/, '')
            : undefined;
        const returnLiteral = responseTypeName ? undefined : extractReturnLiteralFields(lines, index);

        const producerFacts = buildHttpProducerFacts({
          factId: `nest:http-route:${relPath}:${methodName}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange,
          method: pendingMethod,
          path: composedPath,
          handlerRef,
          middlewareRefs: [],
          authEvidence: guards.length > 0 ? guards : undefined,
          framework: 'nest',
          frameworkEvidence,
          responses:
            !responseTypeName && returnLiteral
              ? [{ status: pendingStatusCode ?? defaultStatusForMethod(pendingMethod), parsed: returnLiteral }]
              : undefined,
          extraBoundaries: responseTypeName || returnLiteral ? [] : (['unresolved-response-shape'] as const),
        });

        // Symbol-referenced request/response shapes are layered on top of buildHttpProducerFacts'
        // inline-shape handling: Nest DTOs are named types, not inline object literals.
        if (bodyTypeName) {
          producerFacts.routeFact.requestShapeRef = `symbol:${relPath}:${bodyTypeName}`;
          producerFacts.requestShapeFact = {
            factId: `nest:http-route:${relPath}:${methodName}:request-shape`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange,
            shapeFactKind: 'http-request-shape',
            shapeFingerprint: `symbol:${relPath}:${bodyTypeName}`,
            origin: { kind: 'symbol', symbolRef: `nest:decl:${relPath}:${bodyTypeName}`, symbolName: bodyTypeName },
            coverage: { complete: true, boundaryReasons: [] },
          };
        }
        if (responseTypeName) {
          const status = pendingStatusCode ?? defaultStatusForMethod(pendingMethod);
          const shapeFingerprint = `symbol:${relPath}:${responseTypeName}`;
          producerFacts.routeFact.responses = [{ status, responseShapeRef: shapeFingerprint, evidence: 'exact' }];
          producerFacts.responseShapeFacts.push({
            factId: `nest:http-route:${relPath}:${methodName}:response-shape`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange,
            shapeFactKind: 'http-response-shape',
            status,
            shapeFingerprint,
            origin: { kind: 'symbol', symbolRef: `nest:decl:${relPath}:${responseTypeName}`, symbolName: responseTypeName },
            coverage: { complete: true, boundaryReasons: [] },
          });
        }

        facts.push(producerFacts.routeFact);
        if (producerFacts.requestShapeFact) facts.push(producerFacts.requestShapeFact);
        facts.push(...producerFacts.responseShapeFacts);

        pendingMethod = undefined;
        pendingRoutePath = undefined;
        pendingStatusCode = undefined;
        pendingGuards = [];
        continue;
      }

      const providerMatch = trimmed.match(/^\s*providers:\s*\[([^\]]+)\]/);
      if (providerMatch) {
        for (const token of providerMatch[1]!.split(',').map((v) => v.trim()).filter(Boolean)) {
          facts.push({
            factId: `nest:provider:${relPath}:${token}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: token.length },
            registrationKind: 'provider',
            targetText: token,
            framework: 'nest',
            frameworkEvidence: {
              frameworkId: 'nest',
              adapterVersion: VERSION,
              registrationText: 'providers',
              exact: true,
            },
          });
        }
        continue;
      }

      const ctorMatch = trimmed.match(/^constructor\((.+)\)/);
      if (ctorMatch) {
        for (const part of ctorMatch[1]!.split(',').map((v) => v.trim()).filter(Boolean)) {
          const pieces = part.split(':').map((v) => v.trim());
          if (pieces.length < 2) continue;
          facts.push({
            factId: `nest:binding:${relPath}:${pieces[0]}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: part.length },
            bindingKind: 'contract-to-implementation',
            tokenText: pieces[1],
            contractRef: pieces[1],
            lifetime: 'singleton',
            dynamic: false,
            framework: 'nest',
            frameworkEvidence: {
              frameworkId: 'nest',
              adapterVersion: VERSION,
              registrationText: 'constructor',
              exact: true,
            },
          });
        }
      }
    }
  }

  return facts;
}

export const nestFrameworkAdapter: FrameworkAdapter = {
  id: 'nest',
  version: VERSION,
  languages: [Language.TypeScript],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'framework:nest',
        frameworkDetections: ['nest'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
