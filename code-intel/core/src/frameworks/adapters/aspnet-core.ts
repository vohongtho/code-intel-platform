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
    if (filePath.endsWith('.csproj') && /Microsoft\.AspNetCore|Microsoft\.Extensions\.DependencyInjection/.test(source)) {
      signals.push({ kind: 'dependency', strength: 'strong', filePath, value: 'aspnet package' });
    }
    if (/using\s+Microsoft\.AspNetCore\.|using\s+Microsoft\.Extensions\.DependencyInjection/.test(source)) {
      signals.push({ kind: 'import', strength: 'medium', filePath, value: 'aspnet using' });
    }
    if (/\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|Route)\b|Map(Get|Post|Put|Patch|Delete)\(|AddScoped\(|AddTransient\(|AddSingleton\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'aspnet registration' });
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

      const routePrefixMatch = trimmed.match(/^\[Route\((?:"([^"]*)"|nameof\((\w+)\))\)\]/);
      if (routePrefixMatch) {
        controllerPrefix = routePrefixMatch[1] ?? routePrefixMatch[2] ?? '';
        continue;
      }

      const attrMatch = trimmed.match(/^\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete)(?:\("([^"]*)"\))?\]/);
      if (attrMatch) {
        pendingMethod = attrMatch[1].replace(/^Http/, '').toLowerCase();
        pendingPath = attrMatch[2] ?? '';
        continue;
      }

      const actionMatch = trimmed.match(/^(?:public\s+)?(?:async\s+)?[\w<>]+\s+(\w+)\s*\(/);
      if (actionMatch && pendingMethod) {
        const handlerRef = `aspnet:handler:${relPath}:${actionMatch[1]}`;
        facts.push(declaration(handlerRef, Language.CSharp, relPath, lineNumber, 'method', actionMatch[1]));
        facts.push({
          factId: `aspnet:route:${relPath}:${actionMatch[1]}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: [controllerPrefix, pendingPath].filter(Boolean).join('/').replace(/\/+/g, '/'),
          method: pendingMethod,
          handlerRef,
          framework: 'aspnet-core',
          frameworkEvidence: {
            frameworkId: 'aspnet-core',
            adapterVersion: VERSION,
            registrationText: trimmed,
            exact: true,
          },
        });
        pendingMethod = undefined;
        pendingPath = undefined;
        continue;
      }

      const endpointMatch = trimmed.match(/\.Map(Get|Post|Put|Patch|Delete)\("([^"]+)"\s*,\s*(\w+)/);
      if (endpointMatch) {
        const handlerRef = `aspnet:handler:${relPath}:${endpointMatch[3]}`;
        facts.push(declaration(handlerRef, Language.CSharp, relPath, lineNumber, 'function', endpointMatch[3]));
        facts.push({
          factId: `aspnet:endpoint:${relPath}:${endpointMatch[3]}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          routeKind: 'http',
          path: endpointMatch[2],
          method: endpointMatch[1].toLowerCase(),
          handlerRef,
          framework: 'aspnet-core',
          frameworkEvidence: {
            frameworkId: 'aspnet-core',
            adapterVersion: VERSION,
            registrationText: trimmed,
            exact: true,
          },
        });
        continue;
      }

      const diMatch = trimmed.match(/Add(Scoped|Transient|Singleton)\s*<\s*([^,>]+)\s*,\s*([^>]+)\s*>\s*\(/);
      if (diMatch) {
        facts.push({
          factId: `msdi:${relPath}:${diMatch[2]}:${diMatch[3]}:${lineNumber}`,
          language: Language.CSharp,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          bindingKind: 'contract-to-implementation',
          contractRef: diMatch[2].trim(),
          implementationRef: diMatch[3].trim(),
          lifetime: diMatch[1].toLowerCase(),
          dynamic: false,
          framework: 'microsoft-di',
          frameworkEvidence: {
            frameworkId: 'microsoft-di',
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

export const aspnetCoreFrameworkAdapter: FrameworkAdapter = {
  id: 'aspnet-core',
  version: VERSION,
  languages: [Language.CSharp],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.CSharp,
        adapterId: 'framework:aspnet-core',
        frameworkDetections: ['aspnet-core', 'microsoft-di'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
