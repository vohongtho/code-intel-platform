import { Language } from '../../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../fact-bundle.js';
import type { FactBundle } from '../../fact-bundle.js';
import { splitTopLevel, parseInlineObjectKeys } from '../producer-common.js';
import { normalizeHttpMethod } from '../route-normalizer.js';
import { fullApiCoverage, partialApiCoverage } from '../types.js';
import type { HttpConsumerFact } from '../types.js';
import { parseUrlExpression, trackConsumedKeys } from './common.js';
import { summarizeFrameworkDetection } from '../../../frameworks/detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../../../frameworks/contracts.js';

const VERSION = '0.1.0';

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];
  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    if (/\bfetch\s*\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'medium', filePath, value: 'fetch call' });
    }
    if (/from\s+['"](?:node-fetch|whatwg-fetch|cross-fetch)['"]/.test(source)) {
      signals.push({ kind: 'import', strength: 'strong', filePath, value: 'fetch polyfill import' });
    }
  }
  return signals;
}

const FETCH_CALL_PATTERN = /(?:(?:const|let)\s+(\w+)\s*=\s*await\s+)?\bfetch\s*\((.+)\)\s*;?\s*$/;

function extractOptionsMethodAndBody(optionsText: string | undefined): { method: string; body?: ReturnType<typeof parseInlineObjectKeys> } {
  // fetch() defaults to GET whenever no `method` option is given, with or without options.
  if (!optionsText) return { method: 'GET' };
  const methodMatch = optionsText.match(/\bmethod\s*:\s*['"](\w+)['"]/);
  const stringifyMatch = optionsText.match(/\bbody\s*:\s*JSON\.stringify\(([^)]*)\)/);
  if (stringifyMatch) {
    return { method: methodMatch?.[1] ?? 'GET', body: parseInlineObjectKeys(stringifyMatch[1]!.trim()) };
  }
  const hasOpaqueBody = /\bbody\s*:/.test(optionsText);
  return { method: methodMatch?.[1] ?? 'GET', body: hasOpaqueBody ? undefined : { fields: [], hasSpread: false } };
}

function extractFacts(view: RepositoryFactView): FactBundle['facts'] {
  const facts: FactBundle['facts'][number][] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    const relPath = filePath.replace(/^.*?code-intel-platform\//, '');
    const lines = source.split('\n');

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const callMatch = trimmed.match(FETCH_CALL_PATTERN);
      if (!callMatch) continue;

      const responseVar = callMatch[1];
      const args = splitTopLevel(callMatch[2]!, ',').map((arg) => arg.trim());
      const urlArg = args[0];
      if (!urlArg) continue;

      const url = parseUrlExpression(urlArg);
      const { method: methodText, body } = extractOptionsMethodAndBody(args[1]);
      const boundaries: Array<'dynamic-url-expression' | 'unresolved-dto' | 'local-data-flow-exceeded'> = [];
      if (!url.isFullyStatic) boundaries.push('dynamic-url-expression');

      let consumedKeys: readonly string[] = [];
      if (responseVar) {
        const tracked = trackConsumedKeys(lines, index + 1, `await\\s+${responseVar}\\.json\\(\\)`);
        consumedKeys = tracked.keys;
        if (tracked.boundaryExceeded) boundaries.push('local-data-flow-exceeded');
      }

      let requestShapeFact;
      let requestShapeRef: string | undefined;
      if (body) {
        const origin = { kind: 'inline' as const, fields: body.fields };
        requestShapeRef = `inline:${relPath}:${lineNumber}`;
        requestShapeFact = {
          factId: `fetch:request-shape:${relPath}:${lineNumber}`,
          language: Language.JavaScript,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          shapeFactKind: 'http-request-shape' as const,
          shapeFingerprint: requestShapeRef,
          origin,
          coverage: body.hasSpread ? partialApiCoverage(['unresolved-dto']) : fullApiCoverage(),
        };
        if (body.hasSpread) boundaries.push('unresolved-dto');
      }

      const consumerFact: HttpConsumerFact = {
        factId: `fetch:consumer:${relPath}:${lineNumber}`,
        language: Language.JavaScript,
        filePath: relPath,
        sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
        frameworkEvidence: { frameworkId: 'fetch', adapterVersion: VERSION, registrationText: trimmed, exact: url.isFullyStatic },
        consumerFactKind: 'http-consumer',
        clientLibrary: 'fetch',
        method: normalizeHttpMethod(methodText),
        url,
        requestShapeRef,
        consumedKeys,
        coverage: boundaries.length === 0 ? fullApiCoverage() : partialApiCoverage(boundaries),
      };

      facts.push(consumerFact);
      if (requestShapeFact) facts.push(requestShapeFact);
    }
  }

  return facts;
}

export const fetchConsumerAdapter: FrameworkAdapter = {
  id: 'fetch-client',
  version: VERSION,
  languages: [Language.JavaScript, Language.TypeScript],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: { version: FACT_SCHEMA_VERSION, language: Language.JavaScript, adapterId: 'framework:fetch-client', frameworkDetections: ['fetch'] },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
