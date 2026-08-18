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
    if (filePath.endsWith('go.mod') && /(github\.com\/go-chi\/chi|github\.com\/gorilla\/mux)/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: 'go router dep' });
    }
    if (/import\s+\(?[\s\S]*(net\/http|github\.com\/go-chi\/chi|github\.com\/gorilla\/mux)/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: 'go router import' });
    }
    if (/HandleFunc\(|http\.HandleFunc\(|\.Get\(|\.Post\(|\.Put\(|\.Delete\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'go router registration' });
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

      const stdMatch = trimmed.match(/(?:http\.)?HandleFunc\("([^"]+)"\s*,\s*(\w+)/);
      if (stdMatch) {
        const handlerRef = `gohttp:handler:${relPath}:${stdMatch[2]}`;
        facts.push(declaration(handlerRef, Language.Go, relPath, lineNumber, 'function', stdMatch[2]));
        facts.push({
          factId: `gohttp:route:${relPath}:${stdMatch[2]}:${lineNumber}`,
          language: Language.Go,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: stdMatch[1],
          method: 'get',
          handlerRef,
          framework: 'go-http',
          frameworkEvidence: {
            frameworkId: 'go-http',
            adapterVersion: VERSION,
            registrationText: trimmed,
            exact: true,
          },
        });
        continue;
      }

      const routerMatch = trimmed.match(/\.(Get|Post|Put|Delete)\("([^"]+)"\s*,\s*(\w+)/);
      if (routerMatch) {
        const handlerRef = `gohttp:handler:${relPath}:${routerMatch[3]}`;
        facts.push(declaration(handlerRef, Language.Go, relPath, lineNumber, 'function', routerMatch[3]));
        facts.push({
          factId: `gohttp:route:${relPath}:${routerMatch[3]}:${lineNumber}`,
          language: Language.Go,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: routerMatch[2],
          method: routerMatch[1].toLowerCase(),
          handlerRef,
          framework: 'go-http',
          frameworkEvidence: {
            frameworkId: 'go-http',
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

export const goHttpFrameworkAdapter: FrameworkAdapter = {
  id: 'go-http',
  version: VERSION,
  languages: [Language.Go],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.Go,
        adapterId: 'framework:go-http',
        frameworkDetections: ['go-http'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
