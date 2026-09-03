import { Language } from '../../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../fact-bundle.js';
import type { FactBundle } from '../../fact-bundle.js';
import { splitTopLevel, parseInlineObjectKeys } from '../producer-common.js';
import { normalizeHttpMethod } from '../route-normalizer.js';
import { fullApiCoverage, partialApiCoverage } from '../types.js';
import type { HttpConsumerFact } from '../types.js';
import { parseArrowParam, parseUrlExpression } from './common.js';
import { summarizeFrameworkDetection } from '../../../frameworks/detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../../../frameworks/contracts.js';

const VERSION = '0.1.0';
const MAX_SUBSCRIBE_LOOKAHEAD = 4;
const MAX_MEMBER_ACCESS_LOOKAHEAD = 6;

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];
  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    if (filePath.endsWith('package.json') && /"@angular\/common"\s*:/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: '@angular/common' });
    }
    if (/from\s+['"]@angular\/common\/http['"]/.test(source)) {
      signals.push({ kind: 'import', strength: 'strong', filePath, value: 'HttpClient import' });
    }
    if (/\.subscribe\s*\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'medium', filePath, value: 'subscribe call' });
    }
  }
  return signals;
}

const HTTP_CLIENT_FIELD_PATTERN = /(?:private|public|protected)?\s*(?:readonly\s+)?(\w+)\s*:\s*HttpClient\b/g;
const CALL_PATTERN = /\b(?:this\.)?(\w+)\.(get|post|put|patch|delete)(?:<(\w+)>)?\s*\((.+)\)\s*/;

function findHttpClientFieldNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(HTTP_CLIENT_FIELD_PATTERN)) names.add(match[1]!);
  return names;
}

function scanMemberAccessKeys(lines: readonly string[], fromIndex: number, varName: string): string[] {
  const windowEnd = Math.min(lines.length, fromIndex + MAX_MEMBER_ACCESS_LOOKAHEAD);
  const keys = new Set<string>();
  for (let i = fromIndex; i < windowEnd; i += 1) {
    for (const match of lines[i]!.matchAll(new RegExp(`\\b${varName}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
      keys.add(match[1]!);
    }
  }
  return [...keys].sort();
}

function findSubscribeCallback(lines: readonly string[], fromIndex: number): { lineIndex: number; paramText: string } | undefined {
  const windowEnd = Math.min(lines.length, fromIndex + MAX_SUBSCRIBE_LOOKAHEAD);
  for (let i = fromIndex; i < windowEnd; i += 1) {
    const match = lines[i]!.match(/\.subscribe\s*\(\s*(\(?[^=]*\)?)\s*=>/);
    if (match) return { lineIndex: i, paramText: match[1]! };
  }
  return undefined;
}

function extractFacts(view: RepositoryFactView): FactBundle['facts'] {
  const facts: FactBundle['facts'][number][] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source || !/from\s+['"]@angular\/common\/http['"]/.test(source)) continue;
    const relPath = filePath.replace(/^.*?code-intel-platform\//, '');
    const lines = source.split('\n');
    const httpFieldNames = findHttpClientFieldNames(source);
    if (httpFieldNames.size === 0) continue;

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const callMatch = trimmed.match(CALL_PATTERN);
      if (!callMatch || !httpFieldNames.has(callMatch[1]!)) continue;

      const args = splitTopLevel(callMatch[4]!, ',').map((arg) => arg.trim());
      const urlArg = args[0];
      if (!urlArg) continue;
      const method = callMatch[2]!;
      const generic = callMatch[3];
      const url = parseUrlExpression(urlArg);

      const boundaries: Array<'dynamic-url-expression' | 'unresolved-dto' | 'local-data-flow-exceeded'> = [];
      if (!url.isFullyStatic) boundaries.push('dynamic-url-expression');

      let consumedKeys: readonly string[] = [];
      const subscribeCallback = findSubscribeCallback(lines, index);
      if (subscribeCallback) {
        const parsedParam = parseArrowParam(subscribeCallback.paramText);
        if (parsedParam && 'keys' in parsedParam) {
          consumedKeys = parsedParam.keys;
        } else if (parsedParam && 'paramName' in parsedParam) {
          const keys = scanMemberAccessKeys(lines, subscribeCallback.lineIndex, parsedParam.paramName);
          if (keys.length > 0) consumedKeys = keys;
          else boundaries.push('local-data-flow-exceeded');
        }
      }

      const methodNeedsBody = method === 'post' || method === 'put' || method === 'patch';
      const bodyParsed = methodNeedsBody && args[1] ? parseInlineObjectKeys(args[1]) : undefined;
      let requestShapeFact;
      let requestShapeRef: string | undefined;
      if (methodNeedsBody) {
        if (bodyParsed) {
          requestShapeRef = `inline:${relPath}:${lineNumber}`;
          requestShapeFact = {
            factId: `angular-http:request-shape:${relPath}:${lineNumber}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
            shapeFactKind: 'http-request-shape' as const,
            shapeFingerprint: requestShapeRef,
            origin: { kind: 'inline' as const, fields: bodyParsed.fields },
            coverage: bodyParsed.hasSpread ? partialApiCoverage(['unresolved-dto']) : fullApiCoverage(),
          };
          if (bodyParsed.hasSpread) boundaries.push('unresolved-dto');
        } else if (args[1]) {
          boundaries.push('unresolved-dto');
        }
      }

      const consumerFact: HttpConsumerFact = {
        factId: `angular-http:consumer:${relPath}:${lineNumber}`,
        language: Language.TypeScript,
        filePath: relPath,
        sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
        frameworkEvidence: { frameworkId: 'angular-http', adapterVersion: VERSION, registrationText: trimmed, exact: url.isFullyStatic },
        consumerFactKind: 'http-consumer',
        clientLibrary: 'angular-http',
        method: normalizeHttpMethod(method),
        url,
        requestShapeRef,
        consumedKeys,
        expectedResponseShapeSymbolRef: generic,
        coverage: boundaries.length === 0 ? fullApiCoverage() : partialApiCoverage(boundaries),
      };

      facts.push(consumerFact);
      if (requestShapeFact) facts.push(requestShapeFact);
    }
  }

  return facts;
}

export const angularHttpConsumerAdapter: FrameworkAdapter = {
  id: 'angular-http-client',
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
        adapterId: 'framework:angular-http-client',
        frameworkDetections: ['angular-http'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
