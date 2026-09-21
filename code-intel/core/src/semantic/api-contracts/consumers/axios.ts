import { Language } from '../../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../fact-bundle.js';
import type { FactBundle } from '../../fact-bundle.js';
import { splitTopLevel, parseInlineObjectKeys } from '../producer-common.js';
import { normalizeHttpMethod } from '../route-normalizer.js';
import { fullApiCoverage, partialApiCoverage } from '../types.js';
import type { HttpConsumerFact } from '../types.js';
import { composeUrlExpression, parseUrlExpression, trackConsumedKeys } from './common.js';
import { summarizeFrameworkDetection } from '../../../frameworks/detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../../../frameworks/contracts.js';

const VERSION = '0.1.0';

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];
  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    if (filePath.endsWith('package.json') && /"axios"\s*:/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: 'axios' });
    }
    if (/from\s+['"]axios['"]|require\(['"]axios['"]\)/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: 'axios import' });
    }
    if (/\baxios[.(]/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'axios call' });
    }
  }
  return signals;
}

const CREATE_CLIENT_PATTERN = /\b(?:const|let)\s+(\w+)\s*=\s*axios\.create\s*\(\s*\{[^}]*\bbaseURL\s*:\s*(['"])(.*?)\2/;
const METHOD_CALL_PATTERN = /(?:(?:const|let)\s+(\w+)\s*=\s*await\s+)?\b(\w+)\.(get|post|put|patch|delete)(?:<(\w+)>)?\s*\((.+)\)\s*;?\s*$/;
const CONFIG_CALL_PATTERN = /(?:(?:const|let)\s+(\w+)\s*=\s*await\s+)?\baxios\s*\((\{.+\})\)\s*;?\s*$/;

function buildClientBaseUrls(lines: readonly string[]): Map<string, string> {
  const baseUrls = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(CREATE_CLIENT_PATTERN);
    if (match) baseUrls.set(match[1]!, match[3]!);
  }
  return baseUrls;
}

interface ParsedCall {
  receiver: string;
  responseVar?: string;
  method?: string;
  generic?: string;
  urlArg?: string;
  bodyArg?: string;
}

function parseCallLine(trimmed: string): ParsedCall | undefined {
  const methodCall = trimmed.match(METHOD_CALL_PATTERN);
  if (methodCall) {
    const args = splitTopLevel(methodCall[5]!, ',').map((arg) => arg.trim());
    return {
      receiver: methodCall[2]!,
      responseVar: methodCall[1],
      method: methodCall[3],
      generic: methodCall[4],
      urlArg: args[0],
      bodyArg: args[1],
    };
  }
  const configCall = trimmed.match(CONFIG_CALL_PATTERN);
  if (configCall) {
    const urlFieldMatch = configCall[2]!.match(/\burl\s*:\s*([^,}]+)/);
    const methodFieldMatch = configCall[2]!.match(/\bmethod\s*:\s*['"](\w+)['"]/);
    return { receiver: 'axios', responseVar: configCall[1], method: methodFieldMatch?.[1], urlArg: urlFieldMatch?.[1] };
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
    const clientBaseUrls = buildClientBaseUrls(lines);

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed || CREATE_CLIENT_PATTERN.test(trimmed)) continue;

      const parsed = parseCallLine(trimmed);
      if (!parsed?.urlArg) continue;
      // Reject accidental matches on unrelated `.get(`/`.post(` calls whose receiver isn't
      // known to be axios or an axios.create() client (e.g. a Map's .get()).
      const receiver = parsed.receiver;
      const isAxiosCall = receiver === 'axios' || clientBaseUrls.has(receiver);
      if (!isAxiosCall) continue;

      let url = parseUrlExpression(parsed.urlArg);
      if (clientBaseUrls.has(receiver)) {
        url = composeUrlExpression(clientBaseUrls.get(receiver)!, url);
      }

      const boundaries: Array<'dynamic-url-expression' | 'unresolved-dto' | 'local-data-flow-exceeded'> = [];
      if (!url.isFullyStatic) boundaries.push('dynamic-url-expression');

      let consumedKeys: readonly string[] = [];
      if (parsed.responseVar) {
        const tracked = trackConsumedKeys(lines, index + 1, `${parsed.responseVar}\\.data`);
        consumedKeys = tracked.keys;
        if (tracked.boundaryExceeded) boundaries.push('local-data-flow-exceeded');
      }

      const bodyParsed = parsed.bodyArg ? parseInlineObjectKeys(parsed.bodyArg) : undefined;
      const methodNeedsBody = parsed.method === 'post' || parsed.method === 'put' || parsed.method === 'patch';
      let requestShapeFact;
      let requestShapeRef: string | undefined;
      if (methodNeedsBody) {
        if (bodyParsed) {
          requestShapeRef = `inline:${relPath}:${lineNumber}`;
          requestShapeFact = {
            factId: `axios:request-shape:${relPath}:${lineNumber}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
            shapeFactKind: 'http-request-shape' as const,
            shapeFingerprint: requestShapeRef,
            origin: { kind: 'inline' as const, fields: bodyParsed.fields },
            coverage: bodyParsed.hasSpread ? partialApiCoverage(['unresolved-dto']) : fullApiCoverage(),
          };
          if (bodyParsed.hasSpread) boundaries.push('unresolved-dto');
        } else if (parsed.bodyArg) {
          boundaries.push('unresolved-dto');
        }
      }

      const consumerFact: HttpConsumerFact = {
        factId: `axios:consumer:${relPath}:${lineNumber}`,
        language: Language.TypeScript,
        filePath: relPath,
        sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
        frameworkEvidence: { frameworkId: 'axios', adapterVersion: VERSION, registrationText: trimmed, exact: url.isFullyStatic },
        consumerFactKind: 'http-consumer',
        clientLibrary: 'axios',
        method: normalizeHttpMethod(parsed.method),
        url,
        requestShapeRef,
        consumedKeys,
        expectedResponseShapeSymbolRef: parsed.generic,
        coverage: boundaries.length === 0 ? fullApiCoverage() : partialApiCoverage(boundaries),
      };

      facts.push(consumerFact);
      if (requestShapeFact) facts.push(requestShapeFact);
    }
  }

  return facts;
}

export const axiosConsumerAdapter: FrameworkAdapter = {
  id: 'axios-client',
  version: VERSION,
  languages: [Language.JavaScript, Language.TypeScript],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: { version: FACT_SCHEMA_VERSION, language: Language.TypeScript, adapterId: 'framework:axios-client', frameworkDetections: ['axios'] },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
