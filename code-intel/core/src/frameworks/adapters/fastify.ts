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
} from '../../semantic/api-contracts/index.js';
import { summarizeFrameworkDetection } from '../detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../contracts.js';

const VERSION = '0.2.0';

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;

    if (filePath.endsWith('package.json') && /"fastify"\s*:/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: 'fastify' });
    }
    if (/from\s+['"]fastify['"]|require\(['"]fastify['"]\)/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: 'fastify import' });
    }
    // A bare `app.get/post/put/patch/delete(...)` is not fastify-distinctive — Express uses
    // the identical shape and this signal alone previously caused plain Express apps to be
    // mislabeled as fastify (whichever framework's facts projected last silently won the
    // route node). Only count it when the receiver is explicitly named `fastify`, or when the
    // more fastify-distinctive `register`/`addHook` methods are used (any receiver name).
    if (/\bfastify\.(get|post|put|patch|delete|route|register|addHook)\s*\(/.test(source) || /\b(?:fastify|app)\.(register|addHook)\s*\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'fastify registration' });
    }
  }

  return signals;
}

interface PluginPrefixRange {
  start: number;
  end: number;
  prefix: string;
}

/**
 * Resolves `.register(pluginFn, { prefix: '...' })` to a line range by locating pluginFn's
 * body in the same file. Routes registered inside that range compose the prefix; routes
 * outside any known range, or inside a plugin registered without a resolvable body, keep
 * their local path (unresolved-framework-construct boundary reported by the caller).
 */
function buildPluginPrefixRanges(lines: readonly string[]): PluginPrefixRange[] {
  const ranges: PluginPrefixRange[] = [];
  const registerPattern = /\.register\s*\(\s*(\w+)\s*,\s*\{[^}]*\bprefix:\s*(['"])(.*?)\2/;
  for (const line of lines) {
    const match = line.match(registerPattern);
    if (!match) continue;
    const bodyRange = findFunctionBodyRange(lines, match[1]!);
    if (!bodyRange) continue;
    ranges.push({ start: bodyRange.declLine, end: bodyRange.end, prefix: match[3]! });
  }
  return ranges;
}

function resolvePrefixForLine(ranges: readonly PluginPrefixRange[], lineNumber: number): string | undefined {
  // Innermost (narrowest) range wins when plugins are nested.
  let best: PluginPrefixRange | undefined;
  for (const range of ranges) {
    if (lineNumber < range.start || lineNumber > range.end) continue;
    if (!best || range.end - range.start < best.end - best.start) best = range;
  }
  return best?.prefix;
}

const ROUTE_CALL_PATTERN = /\b(fastify|app)\.(get|post|put|patch|delete)\s*\((['"])(.*?)\3\s*,\s*(\w+)/;
const FASTIFY_PROVENANCE_PATTERN = /\bfastify\s*\(|require\(['"]fastify['"]\)|from\s+['"]fastify['"]/;
const HOOK_CALL_PATTERN = /\b(?:fastify|app)\.addHook\s*\((['"])(.*?)\1\s*,\s*(\w+)/;

export const fastifyFrameworkAdapter: FrameworkAdapter = {
  id: 'fastify',
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
      const pluginRanges = buildPluginPrefixRanges(lines);
      // `app.get(...)` alone is not fastify-distinctive — Express uses the identical shape.
      // Only accept it when this file also has file-local proof of fastify provenance
      // (constructing/importing fastify); a bare `fastify.` receiver is unambiguous already.
      const hasFastifyProvenance = FASTIFY_PROVENANCE_PATTERN.test(source);

      for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        const trimmed = line.trim();
        if (!trimmed) continue;

        const routeMatch = trimmed.match(ROUTE_CALL_PATTERN);
        if (routeMatch) {
          const receiver = routeMatch[1]!;
          if (receiver === 'app' && !hasFastifyProvenance) continue;
          const handlerName = routeMatch[5]!;
          const localPath = routeMatch[4]!;
          const prefix = resolvePrefixForLine(pluginRanges, lineNumber);
          const composedPath = prefix !== undefined ? composeRoutePrefix(prefix, localPath) : localPath;

          const handlerRef = `fastify:handler:${relPath}:${handlerName}`;
          facts.push(declaration(handlerRef, Language.TypeScript, relPath, lineNumber, 'function', handlerName));

          const sourceRange = { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length };
          const frameworkEvidence = { frameworkId: 'fastify', adapterVersion: VERSION, registrationText: routeMatch[0], exact: true };
          facts.push({
            factId: `fastify:route:${relPath}:${handlerName}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange,
            routeKind: 'http' as const,
            path: composedPath,
            method: routeMatch[2]!.toLowerCase(),
            handlerRef,
            framework: 'fastify',
            frameworkEvidence,
          });

          const bodyRange = findFunctionBodyRange(lines, handlerName);
          const producerFacts = buildHttpProducerFacts({
            factId: `fastify:http-route:${relPath}:${handlerName}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange,
            method: routeMatch[2],
            path: composedPath,
            handlerRef,
            middlewareRefs: [],
            framework: 'fastify',
            frameworkEvidence,
            requestShape: bodyRange ? extractRequestKeysFromRange(lines, bodyRange.declLine, bodyRange.end) : undefined,
            responses: bodyRange ? extractResponsesFromRange(lines, bodyRange.declLine, bodyRange.end) : undefined,
            extraBoundaries: bodyRange ? [] : (['unresolved-response-shape', 'unresolved-dto'] as const),
          });
          facts.push(producerFacts.routeFact);
          if (producerFacts.requestShapeFact) facts.push(producerFacts.requestShapeFact);
          facts.push(...producerFacts.responseShapeFacts);
          continue;
        }

        const hookMatch = trimmed.match(HOOK_CALL_PATTERN);
        if (hookMatch) {
          facts.push({
            factId: `fastify:hook:${relPath}:${hookMatch[3]}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
            registrationKind: 'middleware',
            targetText: hookMatch[2]!,
            subjectRef: `fastify:handler:${relPath}:${hookMatch[3]}`,
            framework: 'fastify',
            frameworkEvidence: {
              frameworkId: 'fastify',
              adapterVersion: VERSION,
              registrationText: trimmed,
              exact: true,
            },
          });
        }
      }
    }

    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'framework:fastify',
        frameworkDetections: ['fastify'],
      },
      facts,
      diagnostics: [],
    });
  },
};
