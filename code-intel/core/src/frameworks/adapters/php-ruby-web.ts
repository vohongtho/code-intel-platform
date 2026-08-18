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
    if (/laravel\/framework|symfony\/framework-bundle|rails|Route::(get|post|put|patch|delete)|\$routes->(get|post|put|patch|delete)|\b(get|post|put|patch|delete)\s+['"][^'"]+['"],\s+to:/.test(source)) {
      signals.push({ kind: filePath.endsWith('.json') || filePath.endsWith('.lock') ? 'dependency' : 'registration', strength: 'strong', filePath, value: 'php/ruby web dep' });
    }
    if (/Route::(get|post|put|patch|delete)|\$routes->(get|post|put|patch|delete)|resources\s*:|resource\s*:/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'php/ruby route registration' });
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

      const laravelRoute = trimmed.match(/^Route::(get|post|put|patch|delete)\((['"])(.*?)\2\s*,\s*\[([^\]]+)\]\)/i);
      if (laravelRoute) {
        const controller = laravelRoute[4].split(',')[0]?.replace(/::class/, '').trim() ?? 'Handler';
        const handlerRef = `laravel:handler:${relPath}:${controller}`;
        facts.push(declaration(handlerRef, Language.PHP, relPath, lineNumber, 'class', controller));
        facts.push({
          factId: `laravel:route:${relPath}:${controller}:${lineNumber}`,
          language: Language.PHP,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: laravelRoute[3],
          method: laravelRoute[1].toLowerCase(),
          handlerRef,
          framework: 'laravel',
          frameworkEvidence: { frameworkId: 'laravel', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
        continue;
      }

      const symfonyRoute = trimmed.match(/^\$routes->(get|post|put|patch|delete)\((['"])(.*?)\2\s*,\s*(['"])(.*?)\4\)/i);
      if (symfonyRoute) {
        const handlerRef = `symfony:handler:${relPath}:${symfonyRoute[5]}`;
        facts.push(declaration(handlerRef, Language.PHP, relPath, lineNumber, 'function', symfonyRoute[5]));
        facts.push({
          factId: `symfony:route:${relPath}:${symfonyRoute[5]}:${lineNumber}`,
          language: Language.PHP,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: symfonyRoute[3],
          method: symfonyRoute[1].toLowerCase(),
          handlerRef,
          framework: 'symfony',
          frameworkEvidence: { frameworkId: 'symfony', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
        continue;
      }

      const railsRoute = trimmed.match(/^(get|post|put|patch|delete)\s+['"]([^'"]+)['"],\s+to:\s+['"]([^'"]+)['"]/i);
      if (railsRoute) {
        const handlerRef = `rails:handler:${relPath}:${railsRoute[3]}`;
        facts.push(declaration(handlerRef, Language.Ruby, relPath, lineNumber, 'function', railsRoute[3]));
        facts.push({
          factId: `rails:route:${relPath}:${railsRoute[3]}:${lineNumber}`,
          language: Language.Ruby,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: railsRoute[2],
          method: railsRoute[1].toLowerCase(),
          handlerRef,
          framework: 'rails',
          frameworkEvidence: { frameworkId: 'rails', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
      }
    }
  }

  return facts;
}

export const phpRubyWebFrameworkAdapter: FrameworkAdapter = {
  id: 'php-ruby-web',
  version: VERSION,
  languages: [Language.PHP, Language.Ruby],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.PHP,
        adapterId: 'framework:php-ruby-web',
        frameworkDetections: ['laravel', 'rails', 'symfony'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
