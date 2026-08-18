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
    if (filePath.endsWith('requirements.txt') && /fastapi|flask|django/i.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: 'python web deps' });
    }
    if (/from\s+(fastapi|flask|django)\b|import\s+(fastapi|flask|django)\b/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: 'python web import' });
    }
    if (/@(app|router)\.(get|post|put|patch|delete)|urlpatterns\s*=|path\(|re_path\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'python web registration' });
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
    let pendingFramework: 'fastapi' | 'flask' | undefined;
    let pendingMethod: string | undefined;
    let pendingPath: string | undefined;

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const fastapiRoute = trimmed.match(/^@(app|router)\.(get|post|put|patch|delete)\((['"])(.*?)\3/);
      if (fastapiRoute) {
        pendingFramework = 'fastapi';
        pendingMethod = fastapiRoute[2];
        pendingPath = fastapiRoute[4];
        continue;
      }

      const flaskRoute = trimmed.match(/^@app\.route\((['"])(.*?)\1(?:,\s*methods\s*=\s*\[(['"])(\w+)\3\])?/);
      if (flaskRoute) {
        pendingFramework = 'flask';
        pendingMethod = (flaskRoute[4] ?? 'get').toLowerCase();
        pendingPath = flaskRoute[2];
        continue;
      }

      const fnMatch = trimmed.match(/^def\s+(\w+)\(/);
      if (fnMatch && pendingFramework && pendingMethod && pendingPath !== undefined) {
        const handlerRef = `${pendingFramework}:handler:${relPath}:${fnMatch[1]}`;
        facts.push(declaration(handlerRef, Language.Python, relPath, lineNumber, 'function', fnMatch[1]));
        facts.push({
          factId: `${pendingFramework}:route:${relPath}:${fnMatch[1]}`,
          language: Language.Python,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: pendingPath,
          method: pendingMethod,
          handlerRef,
          framework: pendingFramework,
          frameworkEvidence: {
            frameworkId: pendingFramework,
            adapterVersion: VERSION,
            registrationText: trimmed,
            exact: true,
          },
        });
        if (pendingFramework === 'fastapi' && /Depends\((\w+)\)/.test(source)) {
          const dep = source.match(/Depends\((\w+)\)/)?.[1];
          if (dep) {
            facts.push({
              factId: `fastapi:dep:${relPath}:${fnMatch[1]}`,
              language: Language.Python,
              filePath: relPath,
              sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
              bindingKind: 'factory',
              tokenText: dep,
              contractRef: dep,
              dynamic: false,
              framework: 'fastapi',
              frameworkEvidence: {
                frameworkId: 'fastapi',
                adapterVersion: VERSION,
                registrationText: 'Depends',
                exact: true,
              },
            });
          }
        }
        pendingFramework = undefined;
        pendingMethod = undefined;
        pendingPath = undefined;
        continue;
      }

      const djangoPath = trimmed.match(/^path\((['"])(.*?)\1\s*,\s*(\w+)/);
      if (djangoPath) {
        const handlerRef = `django:handler:${relPath}:${djangoPath[3]}`;
        facts.push(declaration(handlerRef, Language.Python, relPath, lineNumber, 'function', djangoPath[3]));
        facts.push({
          factId: `django:route:${relPath}:${djangoPath[3]}`,
          language: Language.Python,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: djangoPath[2],
          method: 'get',
          handlerRef,
          framework: 'django',
          frameworkEvidence: {
            frameworkId: 'django',
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

export const pythonWebFrameworkAdapter: FrameworkAdapter = {
  id: 'python-web',
  version: VERSION,
  languages: [Language.Python],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.Python,
        adapterId: 'framework:python-web',
        frameworkDetections: ['django', 'fastapi', 'flask'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
