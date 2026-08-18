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

      for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        const trimmed = line.trim();
        if (!trimmed) continue;

        const routeMatch = trimmed.match(/\b(?:app|router)\.(get|post|put|patch|delete|all)\s*\((['"])(.*?)\2\s*,\s*(\w+)/);
        if (routeMatch) {
          const handlerRef = `express:handler:${relPath}:${routeMatch[4]}`;
          facts.push(declaration(handlerRef, Language.JavaScript, relPath, lineNumber, 'function', routeMatch[4]));
          facts.push({
            factId: `express:route:${relPath}:${routeMatch[4]}`,
            language: Language.JavaScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
            routeKind: 'http',
            path: routeMatch[3],
            method: routeMatch[1].toLowerCase(),
            handlerRef,
            framework: 'express',
            frameworkEvidence: {
              frameworkId: 'express',
              adapterVersion: VERSION,
              registrationText: trimmed,
              exact: true,
            },
          });
          continue;
        }

        const middlewareMatch = trimmed.match(/\b(?:app|router)\.use\s*\((?:['"].*?['"]\s*,\s*)?(\w+)/);
        if (middlewareMatch) {
          facts.push({
            factId: `express:middleware:${relPath}:${middlewareMatch[1]}`,
            language: Language.JavaScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
            registrationKind: 'middleware',
            targetText: middlewareMatch[1],
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
