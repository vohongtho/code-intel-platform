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
    if (/\.html?$/.test(filePath) && /<form\b|<script\b|action=|on(?:submit|click|change)=|src=/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'html web registration' });
      signals.push({ kind: 'config', strength: 'strong', filePath, value: 'html document' });
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

      const actionFirst = trimmed.match(/<form[^>]*action=["']([^"']+)["'][^>]*method=["']([^"']+)["']/i);
      const methodFirst = trimmed.match(/<form[^>]*method=["']([^"']+)["'][^>]*action=["']([^"']+)["']/i);
      if (actionFirst || methodFirst) {
        const path = actionFirst?.[1] ?? methodFirst?.[2] ?? '';
        const method = (actionFirst?.[2] ?? methodFirst?.[1] ?? 'get').toLowerCase();
        facts.push({
          factId: `html:form:${relPath}:${lineNumber}`,
          language: Language.HTML,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path,
          method,
          framework: 'html',
          frameworkEvidence: { frameworkId: 'html', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
      }

      const scriptSrc = trimmed.match(/<script[^>]*src=["']([^"']+)["']/i);
      if (scriptSrc) {
        facts.push({
          factId: `html:script:${relPath}:${lineNumber}`,
          language: Language.HTML,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          registrationKind: 'embedded-script',
          targetText: scriptSrc[1],
          framework: 'html',
          frameworkEvidence: { frameworkId: 'html', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
      }

      const inlineHandler = trimmed.match(/on(?:click|submit|change)=["']([^"']+)["']/i);
      if (inlineHandler) {
        const handlerRef = `html:inline:${relPath}:${lineNumber}`;
        facts.push(declaration(handlerRef, Language.HTML, relPath, lineNumber, 'function', inlineHandler[1]));
        facts.push({
          factId: `html:inline-reg:${relPath}:${lineNumber}`,
          language: Language.HTML,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          registrationKind: 'inline-handler',
          subjectRef: handlerRef,
          targetText: inlineHandler[1],
          framework: 'html',
          frameworkEvidence: { frameworkId: 'html', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
      }
    }
  }

  return facts;
}

export const htmlWebFrameworkAdapter: FrameworkAdapter = {
  id: 'html-web',
  version: VERSION,
  languages: [Language.HTML],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.HTML,
        adapterId: 'framework:html-web',
        frameworkDetections: ['html'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
