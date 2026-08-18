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

    if (filePath.endsWith('package.json') && /"@nestjs\/(common|core|platform-express)"\s*:/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: '@nestjs/*' });
    }
    if (/from\s+['"]@nestjs\/(common|core)['"]/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: '@nestjs import' });
    }
    if (/@(Controller|Get|Post|Put|Patch|Delete|Module|Injectable)\b/.test(source)) {
      signals.push({ kind: 'decorator', strength: 'strong', filePath, value: 'nestjs decorator' });
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

    let pendingControllerPath: string | undefined;
    let pendingMethod: string | undefined;
    let pendingRoutePath: string | undefined;

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const controllerMatch = trimmed.match(/^@Controller\((['"])(.*?)\1\)/);
      if (controllerMatch) {
        pendingControllerPath = controllerMatch[2];
        continue;
      }

      const routeMatch = trimmed.match(/^@(Get|Post|Put|Patch|Delete)\((['"])(.*?)\2\)/);
      if (routeMatch) {
        pendingMethod = routeMatch[1].toLowerCase();
        pendingRoutePath = routeMatch[3];
        continue;
      }

      const classMatch = trimmed.match(/^export\s+class\s+(\w+)/);
      if (classMatch) {
        const className = classMatch[1];
        const classFactId = `nest:decl:${relPath}:${className}`;
        facts.push(declaration(classFactId, Language.TypeScript, relPath, lineNumber, 'class', className));

        if (pendingControllerPath !== undefined) {
          facts.push({
            factId: `nest:registration:${relPath}:${className}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: className.length },
            registrationKind: 'controller',
            subjectRef: classFactId,
            targetText: pendingControllerPath,
            framework: 'nest',
            frameworkEvidence: {
              frameworkId: 'nest',
              adapterVersion: VERSION,
              registrationText: '@Controller',
              exact: true,
            },
          });
          pendingControllerPath = undefined;
        }
        continue;
      }

      const methodMatch = trimmed.match(/^(?:async\s+)?(\w+)\(/);
      if (methodMatch && pendingMethod && pendingRoutePath !== undefined) {
        const methodName = methodMatch[1];
        const handlerRef = `nest:handler:${relPath}:${methodName}`;
        facts.push(declaration(handlerRef, Language.TypeScript, relPath, lineNumber, 'method', methodName));
        facts.push({
          factId: `nest:route:${relPath}:${methodName}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: methodName.length },
          routeKind: 'http',
          path: pendingRoutePath,
          method: pendingMethod,
          handlerRef,
          framework: 'nest',
          frameworkEvidence: {
            frameworkId: 'nest',
            adapterVersion: VERSION,
            registrationText: '@' + pendingMethod[0]!.toUpperCase() + pendingMethod.slice(1),
            exact: true,
          },
        });
        pendingMethod = undefined;
        pendingRoutePath = undefined;
        continue;
      }

      const providerMatch = trimmed.match(/^\s*providers:\s*\[([^\]]+)\]/);
      if (providerMatch) {
        for (const token of providerMatch[1].split(',').map((v) => v.trim()).filter(Boolean)) {
          facts.push({
            factId: `nest:provider:${relPath}:${token}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: token.length },
            registrationKind: 'provider',
            targetText: token,
            framework: 'nest',
            frameworkEvidence: {
              frameworkId: 'nest',
              adapterVersion: VERSION,
              registrationText: 'providers',
              exact: true,
            },
          });
        }
        continue;
      }

      const ctorMatch = trimmed.match(/^constructor\((.+)\)/);
      if (ctorMatch) {
        for (const part of ctorMatch[1].split(',').map((v) => v.trim()).filter(Boolean)) {
          const pieces = part.split(':').map((v) => v.trim());
          if (pieces.length < 2) continue;
          facts.push({
            factId: `nest:binding:${relPath}:${pieces[0]}`,
            language: Language.TypeScript,
            filePath: relPath,
            sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: part.length },
            bindingKind: 'contract-to-implementation',
            tokenText: pieces[1],
            contractRef: pieces[1],
            lifetime: 'singleton',
            dynamic: false,
            framework: 'nest',
            frameworkEvidence: {
              frameworkId: 'nest',
              adapterVersion: VERSION,
              registrationText: 'constructor',
              exact: true,
            },
          });
        }
      }
    }
  }

  return facts;
}

export const nestFrameworkAdapter: FrameworkAdapter = {
  id: 'nest',
  version: VERSION,
  languages: [Language.TypeScript],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'framework:nest',
        frameworkDetections: ['nest'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
