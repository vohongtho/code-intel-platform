import { Language } from '../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../semantic/fact-bundle.js';
import type { FactBundle } from '../../semantic/fact-bundle.js';
import { declaration } from '../../semantic/adapters/common.js';
import { summarizeFrameworkDetection } from '../detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../contracts.js';

const VERSION = '0.1.0';

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
    if (/\b(?:fastify|app)\.(get|post|put|patch|delete|route|register|addHook)\s*\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'fastify registration' });
    }
  }

  return signals;
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

      const routeMatch = trimmed.match(/\b(?:fastify|app)\.(get|post|put|patch|delete)\s*\((['"])(.*?)\2\s*,\s*(\w+)/);
      if (routeMatch) {
        const handlerRef = `fastify:handler:${relPath}:${routeMatch[4]}`;
        facts.push(declaration(handlerRef, Language.TypeScript, relPath, lineNumber, 'function', routeMatch[4]));
        facts.push({
          factId: `fastify:route:${relPath}:${routeMatch[4]}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: routeMatch[3],
          method: routeMatch[1].toLowerCase(),
          handlerRef,
          framework: 'fastify',
          frameworkEvidence: {
            frameworkId: 'fastify',
            adapterVersion: VERSION,
            registrationText: routeMatch[0],
            exact: true,
          },
        });
        continue;
      }

      const hookMatch = trimmed.match(/\b(?:fastify|app)\.addHook\s*\((['"])(.*?)\1\s*,\s*(\w+)/);
      if (hookMatch) {
        facts.push({
          factId: `fastify:hook:${relPath}:${hookMatch[3]}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          registrationKind: 'middleware',
          targetText: hookMatch[2],
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

  return facts;
}

export const fastifyFrameworkAdapter: FrameworkAdapter = {
  id: 'fastify',
  version: VERSION,
  languages: [Language.JavaScript, Language.TypeScript],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'framework:fastify',
        frameworkDetections: ['fastify'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
