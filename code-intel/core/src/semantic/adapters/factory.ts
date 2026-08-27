import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';
import type { Language } from '../../shared/languages.js';
import { FACT_DIAGNOSTIC_CODES, type FactDiagnostic } from '../diagnostics.js';
import { FACT_SCHEMA_VERSION, createFactBundle, type FactBundle } from '../fact-bundle.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { declaration, declarationFragment, visibility } from './common.js';

export function createCapabilityAdapter(language: Language): LanguageFactAdapter {
  const descriptor = getLanguageCapabilityDescriptor(language);

  return {
    adapterId: descriptor.adapterId,
    language,
    capabilities: descriptor.capabilities,
    extract(context: AdapterExtractionContext): FactBundle {
      const unsupported = Object.entries(descriptor.capabilities)
        .filter(([, state]) => state !== 'supported')
        .map(([capability, state]) => ({
          code: FACT_DIAGNOSTIC_CODES.partialCapability,
          severity: state === 'not-applicable' ? 'info' : 'warning',
          language,
          affectedCapability: capability,
          impact: capability === 'imports' || capability === 'exports' || capability === 'calls' || capability === 'heritage'
            ? 'cross-file'
            : 'local',
          filePath: context.filePath,
          message: `Adapter capability ${capability} is ${state}`,
        } satisfies FactDiagnostic));

      const facts = [] as FactBundle['facts'][number][];
      const lines = context.source.split('\n');
      for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        const trimmed = line.trim();
        if (!trimmed) continue;

        const access = /^(public|private|protected|internal)\b/.exec(trimmed)?.[1];
        const vis = access === 'public' || access === 'private' || access === 'protected' || access === 'internal'
          ? visibility(access)
          : visibility(trimmed.startsWith('export ') || trimmed.startsWith('pub ') ? 'public' : 'unknown');

        const classLike = /(?:export\s+|pub\s+)?(?:abstract\s+)?(?:(enum)\s+class|(class|struct|interface|trait|enum|object))\s+(\w+)/g;
        for (const match of trimmed.matchAll(classLike)) {
          const name = match[3];
          const factId = `decl:${name}:${lineNumber}`;
          const rawKind = match[1] ?? match[2];
          const declarationKind = rawKind === 'trait' ? 'trait' : rawKind === 'struct' ? 'struct' : rawKind === 'enum' ? 'enum' : rawKind === 'object' ? 'class' : rawKind;
          const qualifiedName = `${context.filePath}:${name}`;
          facts.push(declaration(factId, language, context.filePath, lineNumber, declarationKind, name, {
            qualifiedName,
            visibility: vis,
            signature: { parameters: [] },
          }));
          facts.push(declarationFragment(`frag:${name}:${lineNumber}`, language, context.filePath, lineNumber, factId, name, { hasBody: trimmed.includes('{') }));
        }

        const patterns = [
          /(?:export\s+|pub\s+)?(?:async\s+)?(?:fn|func|function|def)\s+(\w+)\s*\(([^)]*)\)/g,
          /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:[\w<>\[\]?]+\s+)+(\w+)\s*\(([^)]*)\)/g,
          /\bfun\s+(\w+)\s*\(([^)]*)\)/g,
        ];
        for (const pattern of patterns) {
          for (const fn of trimmed.matchAll(pattern)) {
            const factId = `decl:${fn[1]}:${lineNumber}`;
            const params = fn[2].split(',').map((part) => part.trim()).filter(Boolean).map((part, position) => ({
              name: part.split(/[:\s]/)[0] || `arg${position}`,
            }));
            const qualifiedName = `${context.filePath}:${fn[1]}`;
            facts.push(declaration(factId, language, context.filePath, lineNumber, 'function', fn[1], {
              qualifiedName,
              visibility: vis,
              signature: { parameters: params },
            }));
            facts.push(declarationFragment(`frag:${fn[1]}:${lineNumber}`, language, context.filePath, lineNumber, factId, fn[1], { hasBody: /\{|=>|:/.test(trimmed) }));
          }
        }
      }

      return createFactBundle({
        schema: {
          version: FACT_SCHEMA_VERSION,
          language,
          adapterId: descriptor.adapterId,
        },
        facts,
        diagnostics: unsupported,
      });
    },
    validate(bundle: FactBundle): AdapterValidationResult {
      return {
        ok: bundle.diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
        diagnostics: bundle.diagnostics,
      };
    },
  };
}
