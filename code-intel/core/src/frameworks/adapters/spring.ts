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
    if (/org\.springframework\./.test(source)) {
      signals.push({ kind: filePath.endsWith('.xml') || filePath.endsWith('pom.xml') ? 'dependency' : 'import', strength: 'strong', filePath, value: 'spring' });
    }
    if (/@(RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|Autowired|Bean|Component|Service|Repository)\b/.test(source)) {
      signals.push({ kind: 'decorator', strength: 'strong', filePath, value: 'spring annotation' });
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

    let controllerPrefix = '';
    let pendingMethod: string | undefined;
    let pendingPath: string | undefined;

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const classMapping = trimmed.match(/^@RequestMapping\((?:value\s*=\s*)?"([^"]*)"\)/);
      if (classMapping) {
        controllerPrefix = classMapping[1];
        continue;
      }

      const methodMapping = trimmed.match(/^@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\((?:value\s*=\s*)?"?([^")}]*)"?\)/);
      if (methodMapping) {
        pendingMethod = methodMapping[1] === 'RequestMapping' ? 'request' : methodMapping[1].replace('Mapping', '').replace(/^([A-Z])/, (m) => m.toLowerCase());
        pendingPath = methodMapping[2] ?? '';
        continue;
      }

      const classMatch = trimmed.match(/^public\s+class\s+(\w+)/);
      if (classMatch) {
        const factId = `spring:decl:${relPath}:${classMatch[1]}`;
        facts.push(declaration(factId, Language.Java, relPath, lineNumber, 'class', classMatch[1]));
        continue;
      }

      const beanMatch = trimmed.match(/^public\s+(\w+)\s+(\w+)\(/);
      if (beanMatch && pendingMethod) {
        const handlerRef = `spring:handler:${relPath}:${beanMatch[2]}`;
        facts.push(declaration(handlerRef, Language.Java, relPath, lineNumber, 'method', beanMatch[2]));
        facts.push({
          factId: `spring:route:${relPath}:${beanMatch[2]}`,
          language: Language.Java,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: [controllerPrefix, pendingPath].filter(Boolean).join('/').replace(/\/+/g, '/'),
          method: pendingMethod,
          handlerRef,
          framework: 'spring',
          frameworkEvidence: {
            frameworkId: 'spring',
            adapterVersion: VERSION,
            registrationText: trimmed,
            exact: true,
          },
        });
        pendingMethod = undefined;
        pendingPath = undefined;
        continue;
      }

      const autowiredField = trimmed.match(/^(?:private|protected|public)\s+(\w+)\s+(\w+);$/);
      if (autowiredField && lines[index - 1]?.trim() === '@Autowired') {
        facts.push({
          factId: `spring:binding:${relPath}:${autowiredField[2]}`,
          language: Language.Java,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          bindingKind: 'contract-to-implementation',
          contractRef: autowiredField[1],
          tokenText: autowiredField[1],
          dynamic: false,
          framework: 'spring',
          frameworkEvidence: {
            frameworkId: 'spring',
            adapterVersion: VERSION,
            registrationText: '@Autowired',
            exact: false,
          },
        });
        continue;
      }

      const beanDecl = trimmed.match(/^@Bean$/);
      if (beanDecl) {
        const next = lines[index + 1]?.trim() ?? '';
        const nextMethod = next.match(/^public\s+(\w+)\s+(\w+)\(/);
        if (nextMethod) {
          facts.push({
            factId: `spring:bean:${relPath}:${nextMethod[2]}`,
            language: Language.Java,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber + 1, startColumn: 0, endLine: lineNumber + 1, endColumn: next.length },
            registrationKind: 'bean',
            targetText: nextMethod[2],
            framework: 'spring',
            frameworkEvidence: {
              frameworkId: 'spring',
              adapterVersion: VERSION,
              registrationText: '@Bean',
              exact: true,
            },
          });
        }
      }
    }
  }

  return facts;
}

export const springFrameworkAdapter: FrameworkAdapter = {
  id: 'spring',
  version: VERSION,
  languages: [Language.Java],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.Java,
        adapterId: 'framework:spring',
        frameworkDetections: ['spring'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
